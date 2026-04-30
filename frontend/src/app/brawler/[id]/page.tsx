'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { isAddress } from 'viem';
import { useBrawler, type Brawler } from '@/hooks/useBrawler';
import { useWalletName } from '@/hooks/useWalletNames';
import { PixelAvatar } from '@/components/PixelAvatar';
import { MarketplacePanel } from '@/components/MarketplacePanel';
import { BRAWLERS_ABI } from '@/lib/abi';
import { requireEnv } from '@/lib/env';
import {
  rarityBorderClass,
  rarityFromWeight,
  rarityLabel,
  rarityTextClass,
} from '@/lib/rarity';

function parseTokenId(raw: string): number | undefined {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || String(n) !== raw) {
    return undefined;
  }
  return n;
}

export default function BrawlerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = use(params);
  const tokenId = parseTokenId(rawId);
  const { address, isConnected } = useAccount();
  const { brawler, isLoading, error, refetch } = useBrawler(tokenId);

  const isOwner =
    isConnected &&
    !!address &&
    !!brawler &&
    brawler.owner.toLowerCase() === address.toLowerCase();

  // -- Invalid token id --
  if (tokenId === undefined) {
    return (
      <PageShell>
        <div className="text-center space-y-6 py-16">
          <h1 className="brawl-header text-2xl text-brawl-red">Invalid Brawler ID</h1>
          <p className="text-brawl-text-dim">
            &ldquo;{rawId}&rdquo; is not a valid token id. Ids must be positive integers.
          </p>
          <Link href="/browse" className="brawl-btn brawl-btn-secondary inline-block">
            &larr; Back to Browse
          </Link>
        </div>
      </PageShell>
    );
  }

  // -- Loading --
  if (isLoading) {
    return (
      <PageShell>
        <div className="text-center py-20 text-brawl-text-dim">
          <div className="brawl-header text-sm">Loading brawler #{tokenId}&hellip;</div>
          <div className="text-xs mt-2 font-mono">Reading from chain</div>
        </div>
      </PageShell>
    );
  }

  // -- RPC error --
  if (error) {
    return (
      <PageShell>
        <div className="brawl-card p-6 border-brawl-red">
          <h2 className="brawl-header text-sm text-brawl-red mb-2">Failed to load brawler</h2>
          <p className="text-sm text-brawl-text-dim mb-4">{error.message}</p>
          <div className="flex gap-3">
            <button type="button" className="brawl-btn brawl-btn-secondary" onClick={refetch}>
              Retry
            </button>
            <Link href="/browse" className="brawl-btn brawl-btn-secondary inline-block">
              Back to Browse
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  // -- Not found --
  if (!brawler) {
    return (
      <PageShell>
        <div className="text-center space-y-6 py-16">
          <h1 className="brawl-header text-2xl text-brawl-red">Brawler #{tokenId} Not Found</h1>
          <p className="text-brawl-text-dim">
            This token id isn&rsquo;t minted on the current chain.
          </p>
          <Link href="/browse" className="brawl-btn brawl-btn-secondary inline-block">
            &larr; Back to Browse
          </Link>
        </div>
      </PageShell>
    );
  }

  // -- Full detail --
  return (
    <PageShell>
      <div className="space-y-6">
        <div>
          <Link
            href="/browse"
            className="text-sm text-brawl-text-dim hover:text-brawl-orange font-mono"
          >
            &larr; Back to Browse
          </Link>
        </div>

        <BrawlerHero brawler={brawler} />

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/brawler/${brawler.tokenId}/history`}
            className="brawl-btn brawl-btn-secondary"
          >
            Fight History
          </Link>
        </div>

        <MarketplacePanel
          tokenId={brawler.tokenId}
          owner={brawler.owner}
          onChange={refetch}
        />

        {isOwner && (
          <OwnerActions
            tokenId={brawler.tokenId}
            owner={brawler.owner}
            onSuccess={refetch}
          />
        )}
        {isConnected && !isOwner && (
          <div className="brawl-card p-4 text-sm text-brawl-text-dim">
            You&rsquo;re connected but you don&rsquo;t own this brawler. Owner actions (Transfer,
            Rename) are hidden.
          </div>
        )}
        {!isConnected && (
          <div className="brawl-card p-4 text-sm text-brawl-text-dim">
            Connect your wallet to see owner actions if you own this brawler.
          </div>
        )}
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="max-w-5xl mx-auto px-4 md:px-8 py-8">{children}</div>;
}

function BrawlerHero({ brawler }: { brawler: Brawler }) {
  const tier = rarityFromWeight(brawler.weapon.weight);
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,18rem)_1fr]">
      {/* Portrait */}
      <div className={`brawl-card p-4 flex flex-col items-center gap-3 border-2 ${rarityBorderClass(tier)}`}>
        <div className="aspect-square w-full max-w-xs bg-brawl-bg">
          <PixelAvatar
            tokenId={brawler.tokenId}
            weaponName={brawler.weapon.name}
            rarity={tier}
            isDead={brawler.isDead}
            className="w-full h-full pixel"
          />
        </div>
        <div className="text-sm font-mono text-brawl-text-faint">#{brawler.tokenId}</div>
        <div className={`brawl-header text-xs tracking-wider ${rarityTextClass(tier)}`}>
          {rarityLabel(tier)}
        </div>
        {brawler.isDead && (
          <div className="brawl-header text-xs text-brawl-red">&dagger; In Graveyard</div>
        )}
      </div>

      {/* Meta */}
      <div className="space-y-5">
        <div>
          <h1
            className={
              'brawl-header text-2xl md:text-3xl mb-2 break-words ' +
              (brawler.isDead ? 'text-brawl-text-faint line-through' : 'text-brawl-text')
            }
          >
            {brawler.name}
          </h1>
          <div className="flex items-baseline gap-5 font-mono text-sm flex-wrap">
            <span title="Rating — skill score. Starts at 1000. Rises when you beat higher-rated opponents, falls with losses. Classic Elo-style formula.">
              <span className="text-brawl-text-dim">RATING </span>
              <span className="text-brawl-cyan font-bold text-lg">{brawler.elo}</span>
            </span>
            <span className="text-brawl-text-dim">Lvl {brawler.level}</span>
            <span className="text-brawl-text-dim">{brawler.xp} XP</span>
          </div>
          <div className="text-sm font-mono text-brawl-text-faint mt-1">
            Rating starts at 1000 and shifts after every duel — higher = better at fighting.
          </div>
        </div>

        {/* Record */}
        <div className="flex gap-6 border-t border-b border-brawl-border py-3">
          <RecordCell label="Wins" value={brawler.wins} color="text-brawl-green" />
          <RecordCell label="Losses" value={brawler.losses} color="text-brawl-red" />
          <RecordCell label="Ties" value={brawler.ties} color="text-brawl-text-dim" />
        </div>

        {/* Stats */}
        <div>
          <div className="text-xs brawl-header text-brawl-text-faint mb-2">Stats</div>
          <div className="space-y-1 font-mono text-sm">
            <StatRow
              label="Strength"
              abbr="STR"
              value={brawler.stats.strength}
              effect="Damage bonus & damage floor"
            />
            <StatRow
              label="Dexterity"
              abbr="DEX"
              value={brawler.stats.dexterity}
              effect="To-hit, armor class, initiative"
            />
            <StatRow
              label="Constitution"
              abbr="CON"
              value={brawler.stats.constitution}
              effect="Starting HP, armor class"
            />
            <StatRow
              label="Intelligence"
              abbr="INT"
              value={brawler.stats.intelligence}
              effect="Reserved for future content"
            />
            <StatRow
              label="Wisdom"
              abbr="WIS"
              value={brawler.stats.wisdom}
              effect="Reserved for future content"
            />
            <StatRow
              label="Charisma"
              abbr="CHA"
              value={brawler.stats.charisma}
              effect="Reserved for future content"
            />
          </div>
        </div>

        {/* Weapon */}
        <div>
          <div className="text-xs brawl-header text-brawl-text-faint mb-2">Weapon</div>
          <div className="brawl-card p-3 space-y-1 font-mono text-sm">
            <div className="text-brawl-yellow text-base">{brawler.weapon.name}</div>
            <div className="text-sm text-brawl-text-dim">
              DMG {brawler.weapon.damageMin}&ndash;{brawler.weapon.damageMax}
              {' · '}SPD {brawler.weapon.speed}
              {' · '}WT {brawler.weapon.weight}
            </div>
          </div>
        </div>

        {/* Owner — show "The King Brawler" persona when owner == dev wallet */}
        <OwnerLine ownerAddress={brawler.owner} />
      </div>
    </div>
  );
}

function RecordCell({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div>
      <div className="text-xs brawl-header text-brawl-text-faint">{label}</div>
      <div className={`${color} font-mono text-lg`}>{value}</div>
    </div>
  );
}

function OwnerLine({ ownerAddress }: { ownerAddress: `0x${string}` }) {
  const { env } = requireEnv();
  const handle = useWalletName(ownerAddress);
  // Dev wallet doubles as the houseKeeperAddress in env; when an NFT belongs
  // to it, surface the persona "The King Brawler" if the dev hasn't set their
  // own custom handle yet. Once they claim a real handle, that wins.
  const isDev =
    !!env.houseKeeperAddress &&
    ownerAddress.toLowerCase() === env.houseKeeperAddress.toLowerCase();
  const displayName = handle ?? (isDev ? 'The King Brawler' : null);
  return (
    <div className="pt-3 border-t border-brawl-border">
      <div className="text-xs brawl-header text-brawl-text-faint mb-1">Owner</div>
      {displayName && (
        <div className="brawl-header text-base text-brawl-orange mb-1">
          ⚔ {displayName}
        </div>
      )}
      <Link
        href={`/owner/${ownerAddress}`}
        className="font-mono text-sm text-brawl-cyan break-all hover:text-brawl-orange hover:underline block"
        title={`See all brawlers owned by ${ownerAddress}`}
      >
        {ownerAddress}
      </Link>
    </div>
  );
}

function StatRow({
  label,
  abbr,
  value,
  effect,
}: {
  label: string;
  abbr: string;
  value: number;
  effect: string;
}) {
  return (
    <div
      className="grid grid-cols-[auto_auto_1fr_auto] gap-x-2 items-baseline border-b border-brawl-border pb-1"
      title={`${label} (${abbr}) — ${effect}`}
    >
      <span className="text-brawl-text brawl-header text-sm">{label}</span>
      <span className="text-brawl-text-faint text-sm font-mono">({abbr})</span>
      <span className="hidden sm:inline text-brawl-text-dim text-sm italic truncate">
        {effect}
      </span>
      <span className="sm:hidden" />
      <span className="text-brawl-cyan font-bold">{value}</span>
    </div>
  );
}

function OwnerActions({
  tokenId,
  owner,
  onSuccess,
}: {
  tokenId: number;
  owner: `0x${string}`;
  onSuccess: () => void;
}) {
  // Phase 7+ decision: names are randomly rolled on mint and immutable.
  // Transfer stays; rename is gone from both UI and usage (contract function
  // still exists for legacy reasons but no UI entry point).
  const [mode, setMode] = useState<'idle' | 'transfer'>('idle');

  return (
    <div className="brawl-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="brawl-header text-sm text-brawl-orange">Owner Actions</h2>
        {mode !== 'idle' && (
          <button
            type="button"
            className="text-sm text-brawl-text-dim hover:text-brawl-orange font-mono"
            onClick={() => setMode('idle')}
          >
            Cancel
          </button>
        )}
      </div>

      {mode === 'idle' && (
        <div className="flex gap-3 flex-wrap">
          <button
            type="button"
            className="brawl-btn brawl-btn-secondary"
            onClick={() => setMode('transfer')}
          >
            Transfer
          </button>
        </div>
      )}

      {mode === 'transfer' && (
        <TransferForm
          tokenId={tokenId}
          owner={owner}
          onDone={() => {
            setMode('idle');
            onSuccess();
          }}
        />
      )}
    </div>
  );
}

function TransferForm({
  tokenId,
  owner,
  onDone,
}: {
  tokenId: number;
  owner: `0x${string}`;
  onDone: () => void;
}) {
  const { env } = requireEnv();
  const [to, setTo] = useState('');
  const {
    writeContract,
    data: txHash,
    isPending: isSigning,
    error: writeError,
    reset,
  } = useWriteContract();
  const {
    isLoading: isMining,
    isSuccess,
    error: mineError,
  } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (isSuccess) {
      onDone();
      reset();
    }
  }, [isSuccess, onDone, reset]);

  const trimmed = to.trim();
  const validAddr = trimmed.length > 0 && isAddress(trimmed);
  const isSelf =
    validAddr && (trimmed as `0x${string}`).toLowerCase() === owner.toLowerCase();
  const canSubmit = validAddr && !isSelf && !isSigning && !isMining;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        writeContract({
          abi: BRAWLERS_ABI,
          address: env.brawlersAddress,
          chainId: env.chainId,
          functionName: 'safeTransferFrom',
          args: [owner, trimmed as `0x${string}`, BigInt(tokenId)],
        });
      }}
      className="space-y-3"
    >
      <div>
        <label
          htmlFor="to-addr"
          className="text-xs brawl-header text-brawl-text-faint block"
        >
          Recipient Address
        </label>
        <input
          id="to-addr"
          type="text"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="0x…"
          className="w-full mt-1 px-3 py-3 bg-brawl-bg border-2 border-brawl-border text-brawl-text font-mono text-base focus:border-brawl-orange focus:outline-none min-h-[2.75rem]"
          autoFocus
        />
        {trimmed.length > 0 && !validAddr && (
          <div className="text-xs text-brawl-red mt-1 font-mono">Not a valid address</div>
        )}
        {isSelf && (
          <div className="text-xs text-brawl-red mt-1 font-mono">
            Can&rsquo;t transfer to yourself
          </div>
        )}
      </div>
      <div className="flex gap-3 items-center flex-wrap">
        <button type="submit" className="brawl-btn brawl-btn-danger" disabled={!canSubmit}>
          {isSigning ? 'Sign in wallet…' : isMining ? 'Mining…' : 'Transfer'}
        </button>
        {(writeError ?? mineError) && (
          <span className="text-xs text-brawl-red max-w-md break-words">
            {(writeError ?? mineError)?.message}
          </span>
        )}
      </div>
    </form>
  );
}
