'use client';

/**
 * DuelAnimation, visual combat replay for the /duel page.
 *
 * Drives off the CombatEvent list returned by /api/run-duel:
 *   - round_start      → reset `attacker` / `defender` pointers
 *   - attack_hit/miss  → attacker traverses toward defender, weapon swings,
 *                        clash spark flashes, defender shakes
 *   - fight_end        → freeze the final state
 *
 * HP bars animate via CSS width transitions on the actual bar div, every
 * event step mutates `hpA`/`hpB`, React re-renders, Tailwind transitions
 * the `width` change. Damage numbers are absolutely-positioned spans with
 * `animate-damage-float` that get a unique key per hit so each mount
 * re-runs the animation. Weapon glyph derived from weapon name (pixel-art
 * pipeline is a TODO; emoji/unicode is a stand-in that still reads clearly).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PixelAvatar } from '@/components/PixelAvatar';
import type { Brawler } from '@/hooks/useBrawler';
import { startingHp } from '@/core/stats';
import type { CombatEvent } from '@/core/types';
import { rarityFromWeight, type RarityTier } from '@/lib/rarity';

// Rarity-colored glow for the battle-portrait uplift, bigger, brighter
// drop-shadow on rarer fighters so Epic/King look legitimately magical.
const RARITY_GLOW: Record<RarityTier, string> = {
  common: '0 0 6px rgba(154, 154, 154, 0.5)',
  uncommon: '0 0 8px rgba(74, 158, 255, 0.7)',
  rare: '0 0 10px rgba(184, 102, 232, 0.8)',
  legendary: '0 0 12px rgba(255, 160, 64, 0.85)',
  epic: '0 0 14px rgba(255, 80, 80, 0.9)',
  king: '0 0 16px rgba(255, 216, 74, 1)',
};

const RARITY_GRADIENT: Record<RarityTier, string> = {
  common: 'radial-gradient(ellipse at center, rgba(154,154,154,0.12) 0%, transparent 70%)',
  uncommon: 'radial-gradient(ellipse at center, rgba(74,158,255,0.18) 0%, transparent 70%)',
  rare: 'radial-gradient(ellipse at center, rgba(184,102,232,0.22) 0%, transparent 70%)',
  legendary: 'radial-gradient(ellipse at center, rgba(255,160,64,0.25) 0%, transparent 70%)',
  epic: 'radial-gradient(ellipse at center, rgba(255,80,80,0.28) 0%, transparent 70%)',
  king: 'radial-gradient(ellipse at center, rgba(255,216,74,0.32) 0%, transparent 70%)',
};

const RARITY_BORDER: Record<RarityTier, string> = {
  common: 'border-rarity-common',
  uncommon: 'border-rarity-uncommon',
  rare: 'border-rarity-rare',
  legendary: 'border-rarity-epic',
  epic: 'border-brawl-yellow',
  king: 'border-brawl-orange',
};

const EVENT_INTERVAL_MS = 1200;
const LUNGE_MS = 550;
const FINAL_FREEZE_MS = 1500;

// Map weapon name → unicode glyph. Keep the mapping loose, anything not
// matched falls back to the generic "⚔" crossed swords.
function weaponGlyph(weaponName: string): string {
  const n = weaponName.toLowerCase();
  if (n.includes('bazooka') || n.includes('rocket')) return '💥';
  if (n.includes('rail') || n.includes('laser') || n.includes('gun') || n.includes('pistol'))
    return '🔫';
  if (n.includes('bow') || n.includes('arrow') || n.includes('cross')) return '🏹';
  if (n.includes('fire') || n.includes('flam')) return '🔥';
  if (n.includes('electric') || n.includes('lightning') || n.includes('shock')) return '⚡';
  if (n.includes('kings') || n.includes('royal')) return '👑';
  if (n.includes('axe') || n.includes('hatchet')) return '🪓';
  if (n.includes('hammer') || n.includes('mallet')) return '🔨';
  if (n.includes('bat') || n.includes('club') || n.includes('staff')) return '🏏';
  if (n.includes('knife') || n.includes('dagger') || n.includes('shiv')) return '🗡️';
  if (n.includes('sword') || n.includes('blade') || n.includes('saber') || n.includes('sabre'))
    return '⚔️';
  return '⚔';
}

export interface DuelAnimationProps {
  a: Brawler;
  b: Brawler;
  events: readonly CombatEvent[];
  /**
   * Whether the losing side is dying from this fight (3rd consecutive loss).
   * Drives the 5-second death-animation sequence before the outcome overlay.
   */
  willDie?: { a: boolean; b: boolean };
  /** Fired after the final event + the victory-freeze beat. */
  onFinished?: () => void;
  /** If true, the animation is rendered in its "complete" state immediately. */
  skipAnimation?: boolean;
  /** If true, the animation is paused with an overlay, used to hold until the wallet tx is signed. */
  gated?: boolean;
  /** Message shown on the gated overlay. */
  gatedMessage?: string;
  /**
   * Optional explicit tap handler for the gated overlay. When provided, the
   * overlay renders a big primary button the user taps to open their wallet.
   * Necessary on mobile where wagmi's `writeContract` can't open a native
   * wallet-app deep-link from inside a `useEffect`, the call must be made
   * directly within a user-gesture callback.
   */
  gatedAction?: {
    label: string;
    onTap: () => void;
    disabled?: boolean;
  } | null;
  /**
   * Rendered as an absolute-positioned panel over the arena once the fight
   * is finished. Arena stays visible behind it, fighters frozen in their
   * final positions, HP bars at their ending values, scene backdrop intact.
   */
  finishedOverlay?: React.ReactNode;
}

interface Floater {
  /** Unique key so React remounts when the same defender gets hit again. */
  id: number;
  side: 'a' | 'b';
  text: string;
  kind: 'damage' | 'miss' | 'crit';
}

// Intro sequence (~2.5s) played BEFORE the real sim events. Guarantees at
// least 3 visible strikes plus a stare-down beat. Tuned so total runtime
// (intro + events + final freeze) lands near D's 10s target.
const INTRO_STEP_MS = 650;
const INTRO_STEPS: ReadonlyArray<
  | { kind: 'staredown' }
  | { kind: 'feint-a' }
  | { kind: 'feint-b' }
  | { kind: 'clash'; disco?: boolean; thunder?: boolean }
> = [
  { kind: 'staredown' },
  { kind: 'feint-a' },
  { kind: 'feint-b' },
  { kind: 'clash', disco: true, thunder: true },
];

export function DuelAnimation({
  a,
  b,
  events,
  willDie = { a: false, b: false },
  onFinished,
  skipAnimation = false,
  gated = false,
  gatedMessage = 'Waiting…',
  gatedAction = null,
  finishedOverlay,
}: DuelAnimationProps) {
  const maxHpA = useMemo(() => startingHp(a.stats, a.level), [a]);
  const maxHpB = useMemo(() => startingHp(b.stats, b.level), [b]);

  const [shownCount, setShownCount] = useState(skipAnimation ? events.length : 0);
  const [hpA, setHpA] = useState(maxHpA);
  const [hpB, setHpB] = useState(maxHpB);
  const [attackSide, setAttackSide] = useState<'a' | 'b' | null>(null);
  const [hitSide, setHitSide] = useState<'a' | 'b' | null>(null);
  const [clashing, setClashing] = useState(false);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [ended, setEnded] = useState(false);
  const [winnerId, setWinnerId] = useState<number | null | 'pending'>('pending');
  const [currentRound, setCurrentRound] = useState(0);

  // Pizazz state
  const [introStep, setIntroStep] = useState(skipAnimation ? INTRO_STEPS.length : 0);
  const [flashActive, setFlashActive] = useState(false);
  const [lightningKey, setLightningKey] = useState<number | null>(null);
  const [shakeActive, setShakeActive] = useState(false);
  const [discoKey, setDiscoKey] = useState<number | null>(null);
  const [bloodSide, setBloodSide] = useState<'a' | 'b' | null>(null);

  // Death-sequence state, when a side is going to die from this fight,
  // after the fight_end freeze we play a ~5s body-slump → ghost-peel →
  // RIP-banner sequence before firing onFinished (which reveals the
  // outcome overlay on top of the arena).
  const [dyingSide, setDyingSide] = useState<'a' | 'b' | null>(null);
  const [ripActive, setRipActive] = useState(false);

  const floaterIdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lungeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  // Tracks whether the finalize effect has already locked in the end state.
  // Without this, the effect's cleanup cancels its own victory-freeze
  // timeout the moment `ended` flips, and onFinished never fires.
  const finalizedRef = useRef(false);

  // Finalize when all events are shown, either via animation or skip.
  // A final-freeze beat lets the last hit / KO read before the overlay lands.
  // If a side will die from this fight we extend with a 5-second death
  // sequence (body slump → ghost rise → RIP banner).
  useEffect(() => {
    if (shownCount < events.length) return;
    if (events.length === 0) return;
    if (finalizedRef.current) return;
    finalizedRef.current = true;
    const last = events.at(-1);
    if (last && last.type === 'fight_end') {
      setWinnerId(last.winnerId);
    }
    setEnded(true);

    const side: 'a' | 'b' | null = willDie.a ? 'a' : willDie.b ? 'b' : null;

    if (skipAnimation) {
      // Snap straight to the end.
      if (side) setDyingSide(side);
      onFinishedRef.current?.();
      return;
    }

    if (!side) {
      setTimeout(() => {
        onFinishedRef.current?.();
      }, FINAL_FREEZE_MS);
      return;
    }

    // Death sequence: KO freeze → slump → ghost rise → RIP banner → done.
    // Total ~5 seconds.
    setTimeout(() => {
      setDyingSide(side); // triggers body slump + ghost-rise CSS animations
    }, 500);
    setTimeout(() => {
      setRipActive(true); // drop the RIP banner after the ghost has floated
    }, 3500);
    setTimeout(() => {
      onFinishedRef.current?.();
    }, 5000);
  }, [shownCount, events, skipAnimation, willDie]);

  // Intro sequence, 3 visible strikes (feint A, feint B, big clash) before
  // the real sim events kick in. Runs after the gate lifts.
  useEffect(() => {
    if (gated) return;
    if (skipAnimation) return;
    if (introStep >= INTRO_STEPS.length) return;
    const step = INTRO_STEPS[introStep]!;
    const timer = setTimeout(() => {
      switch (step.kind) {
        case 'staredown': {
          // No attack, just a charged "VS" beat. Trigger a subtle disco
          // so the arena feels alive during the beat of silence.
          setDiscoKey(Date.now());
          break;
        }
        case 'feint-a': {
          setAttackSide('a');
          setClashing(true);
          setTimeout(() => setAttackSide(null), LUNGE_MS);
          setTimeout(() => setClashing(false), LUNGE_MS);
          break;
        }
        case 'feint-b': {
          setAttackSide('b');
          setClashing(true);
          setTimeout(() => setAttackSide(null), LUNGE_MS);
          setTimeout(() => setClashing(false), LUNGE_MS);
          break;
        }
        case 'clash': {
          setAttackSide('a');
          setClashing(true);
          if (step.disco) setDiscoKey(Date.now());
          if (step.thunder) {
            setFlashActive(true);
            setTimeout(() => setFlashActive(false), 220);
            setShakeActive(true);
            setTimeout(() => setShakeActive(false), 400);
          }
          setTimeout(() => {
            setAttackSide('b');
            setTimeout(() => setAttackSide(null), LUNGE_MS);
          }, LUNGE_MS / 2);
          setTimeout(() => setClashing(false), LUNGE_MS);
          break;
        }
      }
      setIntroStep((s) => s + 1);
    }, INTRO_STEP_MS);
    return () => clearTimeout(timer);
  }, [introStep, gated, skipAnimation]);

  // Walk through events one at a time. Gated while the wallet tx is being
  // signed AND while the intro sequence is still playing.
  useEffect(() => {
    if (gated) return;
    if (introStep < INTRO_STEPS.length) return;
    if (skipAnimation || shownCount >= events.length) return;
    const ev = events[shownCount]!;
    timerRef.current = setTimeout(() => {
      applyEvent(ev);
      setShownCount((c) => c + 1);
    }, EVENT_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownCount, events, skipAnimation, gated, introStep]);

  // On skip, snap to the final state with no timers.
  useEffect(() => {
    if (!skipAnimation) return;
    let hA = maxHpA;
    let hB = maxHpB;
    let finalRound = 0;
    let finalWinner: number | null | 'pending' = 'pending';
    for (const ev of events) {
      if (ev.type === 'round_start') {
        finalRound = ev.round;
      } else if (ev.type === 'attack_hit') {
        if (ev.defenderId === a.tokenId) hA = Math.max(0, ev.defenderHpAfter);
        if (ev.defenderId === b.tokenId) hB = Math.max(0, ev.defenderHpAfter);
      } else if (ev.type === 'fight_end') {
        finalWinner = ev.winnerId;
      }
    }
    setHpA(hA);
    setHpB(hB);
    setCurrentRound(finalRound);
    setWinnerId(finalWinner);
    setEnded(true);
    onFinishedRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipAnimation]);

  function sideOf(tokenId: number): 'a' | 'b' | null {
    if (tokenId === a.tokenId) return 'a';
    if (tokenId === b.tokenId) return 'b';
    return null;
  }

  function applyEvent(ev: CombatEvent) {
    switch (ev.type) {
      case 'round_start': {
        setCurrentRound(ev.round);
        // Disco strobe on every round start, quick RGB pulse.
        setDiscoKey(Date.now() + ev.round);
        const s = sideOf(ev.attackerId);
        if (s) {
          setAttackSide(s);
          if (lungeTimerRef.current) clearTimeout(lungeTimerRef.current);
          lungeTimerRef.current = setTimeout(() => setAttackSide(null), LUNGE_MS);
        }
        break;
      }
      case 'attack_hit': {
        const defSide = sideOf(ev.defenderId);
        const attSide = sideOf(ev.attackerId);
        const hp = Math.max(0, ev.defenderHpAfter);
        if (defSide === 'a') setHpA(hp);
        if (defSide === 'b') setHpB(hp);
        if (defSide) {
          setHitSide(defSide);
          setBloodSide(defSide);
          setTimeout(() => setHitSide(null), LUNGE_MS);
          setTimeout(() => setBloodSide(null), 600);
        }
        if (attSide) {
          setAttackSide(attSide);
          if (lungeTimerRef.current) clearTimeout(lungeTimerRef.current);
          lungeTimerRef.current = setTimeout(() => setAttackSide(null), LUNGE_MS);
        }
        setClashing(true);
        setTimeout(() => setClashing(false), LUNGE_MS);

        // Thunder flash + shake on every hit; lightning bolt on crit.
        setFlashActive(true);
        setTimeout(() => setFlashActive(false), ev.isCritical ? 260 : 140);
        if (ev.isCritical || ev.damage >= 15 || hp <= 0) {
          setShakeActive(true);
          setTimeout(() => setShakeActive(false), 420);
        }
        if (ev.isCritical || hp <= 0) {
          setLightningKey(Date.now());
        }

        if (defSide) {
          const id = ++floaterIdRef.current;
          const text = ev.isCritical ? `CRIT! -${ev.damage}` : `-${ev.damage}`;
          const kind: Floater['kind'] = ev.isCritical ? 'crit' : 'damage';
          setFloaters((f) => [...f, { id, side: defSide, text, kind }]);
          setTimeout(() => {
            setFloaters((f) => f.filter((x) => x.id !== id));
          }, 1400);
        }
        break;
      }
      case 'attack_miss': {
        const defSide = sideOf(ev.defenderId);
        const attSide = sideOf(ev.attackerId);
        if (attSide) {
          setAttackSide(attSide);
          if (lungeTimerRef.current) clearTimeout(lungeTimerRef.current);
          lungeTimerRef.current = setTimeout(() => setAttackSide(null), LUNGE_MS);
        }
        if (defSide) {
          const id = ++floaterIdRef.current;
          setFloaters((f) => [...f, { id, side: defSide, text: 'MISS', kind: 'miss' }]);
          setTimeout(() => {
            setFloaters((f) => f.filter((x) => x.id !== id));
          }, 1100);
        }
        break;
      }
      case 'fight_end':
        setWinnerId(ev.winnerId);
        break;
    }
  }

  const hpPctA = Math.max(0, Math.min(100, (hpA / maxHpA) * 100));
  const hpPctB = Math.max(0, Math.min(100, (hpB / maxHpB) * 100));

  const winnerLabel =
    winnerId === 'pending'
      ? ''
      : winnerId === null
        ? 'Double KO'
        : winnerId === a.tokenId
          ? `${a.name} wins`
          : `${b.name} wins`;

  return (
    <div
      className={
        'relative brawl-card p-4 md:p-5 overflow-hidden ' +
        (shakeActive ? 'animate-arena-shake' : '')
      }
    >
      {/* Disco strobe, pulses rainbow bg briefly at round starts. */}
      {discoKey !== null && (
        <div
          key={`disco-${discoKey}`}
          className="pointer-events-none absolute inset-0 animate-disco-strobe"
          aria-hidden
        />
      )}

      {/* Thunder flash, white overlay on every hit, brighter on crits. */}
      {flashActive && (
        <div
          className="pointer-events-none absolute inset-0 bg-white/70"
          aria-hidden
        />
      )}

      {/* Lightning bolt, SVG zigzag drawn across the frame on crits / KOs. */}
      {lightningKey !== null && (
        <svg
          key={`lightning-${lightningKey}`}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 w-full h-full animate-lightning-strike"
          aria-hidden
        >
          <polyline
            points="50,-5 45,18 58,32 42,48 60,62 40,78 55,100"
            fill="none"
            stroke="#FFF8C0"
            strokeWidth="2.5"
            strokeLinejoin="miter"
          />
          <polyline
            points="50,-5 45,18 58,32 42,48 60,62 40,78 55,100"
            fill="none"
            stroke="#FFD84A"
            strokeWidth="1"
            strokeLinejoin="miter"
          />
        </svg>
      )}

      {/* Gated overlay, held until the wallet tx is signed. When a
          `gatedAction` is provided, renders an explicit tap button that
          fires the tx within a user-gesture context (required for mobile
          wallet-app deep-links to work). */}
      {gated && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-brawl-bg/85 backdrop-blur-sm">
          <div className="text-center space-y-3 px-3 max-w-[90%] md:max-w-sm">
            <div className="text-3xl animate-pulse">👛</div>
            <div className="brawl-header text-base text-brawl-orange">
              {gatedMessage}
            </div>
            <div className="text-sm text-brawl-text-dim font-mono leading-relaxed">
              You&rsquo;re staking your share of BRAWL to enter the arena
              (Founder 100 fighters get 25% off). Winner takes 90% of the
              pot, 10% to dev.
            </div>
            {gatedAction ? (
              <div className="pt-2">
                <button
                  type="button"
                  className="brawl-btn w-full max-w-[18rem] mx-auto"
                  onClick={gatedAction.onTap}
                  disabled={!!gatedAction.disabled}
                >
                  {gatedAction.label}
                </button>
                <div className="text-sm text-brawl-text-faint font-mono mt-2 leading-relaxed">
                  Tap to open MetaMask. Your wallet app will take over, 
                  confirm the stake there and you&rsquo;ll come back here
                  for the fight.
                </div>
              </div>
            ) : (
              <div className="text-sm text-brawl-text-faint font-mono">
                The fight starts the instant your tx is signed. If you don&rsquo;t
                see a popup, check the MetaMask icon in your browser toolbar, 
                it may have opened behind the window.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="relative z-10 flex items-center justify-between text-xs brawl-header mb-3 flex-wrap gap-2">
        <span className="text-brawl-text-faint">
          Round <span className="text-brawl-orange">{currentRound || ', '}</span>
        </span>
        {ended && (
          <span
            className={
              winnerId === null
                ? 'text-brawl-yellow'
                : 'text-brawl-green'
            }
          >
            ✦ {winnerLabel}
          </span>
        )}
      </div>

      <div className="relative z-10 grid grid-cols-[1fr_auto_1fr] gap-2 md:gap-4 items-stretch">
        <FighterLane
          side="a"
          brawler={a}
          hp={hpA}
          maxHp={maxHpA}
          hpPct={hpPctA}
          attacking={attackSide === 'a'}
          hit={hitSide === 'a'}
          bloody={bloodSide === 'a'}
          floaters={floaters.filter((f) => f.side === 'a')}
          winner={ended && winnerId === a.tokenId}
          loser={ended && winnerId !== null && winnerId !== a.tokenId}
          dying={dyingSide === 'a'}
          rip={ripActive && dyingSide === 'a'}
        />
        <div className="self-center flex flex-col items-center justify-center px-1 min-w-[3rem] relative">
          {clashing ? (
            <span
              key={floaterIdRef.current}
              className="brawl-header text-2xl md:text-4xl text-brawl-yellow animate-clash-spark"
              aria-hidden
            >
              ✦
            </span>
          ) : (
            <span className="brawl-header text-lg md:text-2xl text-brawl-orange">VS</span>
          )}
        </div>
        <FighterLane
          side="b"
          brawler={b}
          hp={hpB}
          maxHp={maxHpB}
          hpPct={hpPctB}
          attacking={attackSide === 'b'}
          hit={hitSide === 'b'}
          bloody={bloodSide === 'b'}
          floaters={floaters.filter((f) => f.side === 'b')}
          winner={ended && winnerId === b.tokenId}
          loser={ended && winnerId !== null && winnerId !== b.tokenId}
          dying={dyingSide === 'b'}
          rip={ripActive && dyingSide === 'b'}
        />
      </div>

      {/* Outcome overlay, arena stays visible behind, semi-translucent dark
          backing with winner + deltas + action buttons on top. */}
      {ended && finishedOverlay && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none animate-overlay-fade-in">
          <div className="pointer-events-auto w-full max-w-lg mx-4 brawl-card p-4 md:p-5 bg-brawl-bg/90 backdrop-blur-sm border-2 border-brawl-orange space-y-3">
            {finishedOverlay}
          </div>
        </div>
      )}
    </div>
  );
}

interface FighterLaneProps {
  side: 'a' | 'b';
  brawler: Brawler;
  hp: number;
  maxHp: number;
  hpPct: number;
  attacking: boolean;
  hit: boolean;
  bloody: boolean;
  floaters: Floater[];
  winner: boolean;
  loser: boolean;
  dying: boolean;
  rip: boolean;
}

function FighterLane({
  side,
  brawler,
  hp,
  maxHp,
  hpPct,
  attacking,
  hit,
  bloody,
  floaters,
  winner,
  loser,
  dying,
  rip,
}: FighterLaneProps) {
  const tier = rarityFromWeight(brawler.weapon.weight);
  const isIdle = !attacking && !hit && hp > 0;
  // When attacking, the fighter crosses a good chunk of the way toward
  // the opponent. Side A lunges right (+), side B lunges left (-).
  const lungeClass = attacking
    ? side === 'a'
      ? 'translate-x-8 md:translate-x-16'
      : '-translate-x-8 md:-translate-x-16'
    : 'translate-x-0';
  const hitClass = hit ? 'animate-hit-shake' : '';
  // Idle float is suppressed during attacks/hits/death so motion stays readable.
  const idleClass = isIdle ? 'animate-float-idle' : '';
  const dimClass = loser ? 'opacity-60 grayscale' : '';
  const haloClass = winner ? 'ring-2 ring-brawl-green/80 shadow-[0_0_20px_rgba(82,192,85,0.8)]' : '';

  const hpColor =
    hpPct > 60
      ? 'bg-brawl-green'
      : hpPct > 25
        ? 'bg-brawl-yellow'
        : 'bg-brawl-red';

  const glyph = weaponGlyph(brawler.weapon.name);

  // Weapon sits on the inside edge (where it would face the opponent) and
  // rotates on attack to convey a swing.
  const weaponBaseClass =
    'absolute top-1/2 -translate-y-1/2 text-xl md:text-3xl transition-transform duration-300 drop-shadow-[0_0_4px_rgba(0,0,0,0.8)]';
  const weaponPositionClass = side === 'a' ? 'right-1' : 'left-1';
  const weaponRotateClass = attacking
    ? side === 'a'
      ? 'rotate-[35deg] scale-125'
      : '-rotate-[35deg] scale-125'
    : 'rotate-0 scale-100';

  const portraitStyle: React.CSSProperties = {
    filter: loser ? 'none' : `drop-shadow(${RARITY_GLOW[tier]})`,
    background: RARITY_GRADIENT[tier],
  };

  return (
    <div className={`space-y-2 ${dimClass}`}>
      <div className="relative">
        <div
          className={`aspect-square w-full border-2 ${RARITY_BORDER[tier]} overflow-visible transition-transform duration-500 ease-out ${lungeClass} ${hitClass} ${idleClass} ${haloClass} relative`}
          style={portraitStyle}
        >
          <PixelAvatar
            tokenId={brawler.tokenId}
            weaponName={brawler.weapon.name}
            rarity={tier}
            isDead={hp <= 0}
            className="w-full h-full pixel"
          />
          <span
            className={`${weaponBaseClass} ${weaponPositionClass} ${weaponRotateClass}`}
            aria-hidden
          >
            {glyph}
          </span>
        </div>
        {/* Blood splatter, scattered red droplets on hit side for ~600ms. */}
        {bloody && (
          <svg
            viewBox="0 0 32 32"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 w-full h-full animate-blood-splat"
            aria-hidden
          >
            {/* Droplets scattered around impact zone */}
            <rect x="6" y="10" width="2" height="2" fill="#C13E3E" />
            <rect x="22" y="8" width="2" height="2" fill="#8A1A1A" />
            <rect x="10" y="16" width="2" height="2" fill="#C13E3E" />
            <rect x="18" y="20" width="2" height="2" fill="#8A1A1A" />
            <rect x="4" y="18" width="1" height="1" fill="#FF4A4A" />
            <rect x="27" y="14" width="1" height="1" fill="#FF4A4A" />
            <rect x="14" y="5" width="1" height="1" fill="#C13E3E" />
            <rect x="20" y="26" width="2" height="2" fill="#8A1A1A" />
            <rect x="2" y="24" width="1" height="1" fill="#C13E3E" />
            <rect x="28" y="22" width="1" height="1" fill="#C13E3E" />
          </svg>
        )}

        {/* Damage/miss floaters */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {floaters.map((f) => (
            <span
              key={f.id}
              className={
                'absolute animate-damage-float brawl-header text-sm md:text-lg ' +
                (f.kind === 'crit'
                  ? 'text-brawl-yellow'
                  : f.kind === 'miss'
                    ? 'text-brawl-text-dim'
                    : 'text-brawl-red')
              }
            >
              {f.text}
            </span>
          ))}
        </div>
        {hp <= 0 && !dying && !rip && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 pointer-events-none">
            <span className="brawl-header text-lg text-brawl-red">KO</span>
          </div>
        )}

        {/* Death sequence, body slumps + ghost rises out of the portrait.
            Triggered by `dying`; stays until the animation completes. */}
        {dying && (
          <>
            {/* Slumped body stays in portrait (the existing PixelAvatar
                already shows isDead styling because hp===0). We just add
                a dark veil + blood pool to sell it. */}
            <div className="absolute inset-0 pointer-events-none animate-death-slump bg-gradient-to-b from-transparent via-transparent to-black/70" />
            {/* Ghost, translucent duplicate of the brawler rising upward. */}
            <div className="absolute inset-0 pointer-events-none animate-ghost-rise">
              <div className="w-full h-full opacity-70 mix-blend-screen">
                <PixelAvatar
                  tokenId={brawler.tokenId}
                  weaponName={brawler.weapon.name}
                  rarity={tier}
                  isDead={false}
                  className="w-full h-full pixel"
                />
              </div>
            </div>
          </>
        )}

        {/* RIP banner, drops in at the end of the ghost animation. */}
        {rip && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none animate-rip-banner">
            <div className="bg-brawl-bg/90 border-2 border-brawl-red px-3 py-2 text-center">
              <div className="brawl-header text-sm text-brawl-red">⚰ R.I.P.</div>
              <div className="text-sm font-mono text-brawl-text-dim mt-1">
                Sent to the graveyard
              </div>
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between text-sm font-mono">
          <span
            className={
              'brawl-header truncate ' +
              (winner ? 'text-brawl-green' : 'text-brawl-text')
            }
            title={brawler.name}
          >
            {brawler.name}
          </span>
          <span className="text-brawl-text-dim">
            {hp} / {maxHp}
          </span>
        </div>
        <div className="h-2 bg-brawl-bg border border-brawl-border overflow-hidden">
          <div
            className={`h-full transition-[width] duration-500 ease-out ${hpColor}`}
            style={{ width: `${hpPct}%` }}
          />
        </div>
        <div className="text-sm font-mono text-brawl-text-faint truncate mt-1">
          <span aria-hidden className="mr-1">
            {glyph}
          </span>
          {brawler.weapon.name} · DMG {brawler.weapon.damageMin}–{brawler.weapon.damageMax}
        </div>
      </div>
    </div>
  );
}
