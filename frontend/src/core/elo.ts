/**
 * ELO rating calculations. Duplicated from root src/core/elo.ts, keep in sync.
 */

export const STARTING_ELO = 1000;

export type Outcome = 'win' | 'loss' | 'tie';

function outcomeScore(o: Outcome): number {
  switch (o) {
    case 'win':
      return 1;
    case 'loss':
      return 0;
    case 'tie':
      return 0.5;
  }
}

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function kFactor(gamesPlayed: number): number {
  if (gamesPlayed < 0) {
    throw new Error(`gamesPlayed must be non-negative, got ${gamesPlayed}`);
  }
  if (gamesPlayed <= 10) {
    return 32;
  }
  if (gamesPlayed <= 50) {
    return 24;
  }
  return 16;
}

export function ratingChange(
  playerRating: number,
  opponentRating: number,
  outcome: Outcome,
  gamesPlayed: number,
): number {
  const k = kFactor(gamesPlayed);
  const expected = expectedScore(playerRating, opponentRating);
  const actual = outcomeScore(outcome);
  const delta = k * (actual - expected);
  return Math.round(delta);
}

export function applyRatingChange(current: number, change: number): number {
  const next = current + change;
  return next < 100 ? 100 : next;
}

export function applyDuelResult(
  ratingA: number,
  ratingB: number,
  gamesA: number,
  gamesB: number,
  outcomeForA: Outcome,
): { newA: number; newB: number; deltaA: number; deltaB: number } {
  const outcomeForB: Outcome =
    outcomeForA === 'win' ? 'loss' : outcomeForA === 'loss' ? 'win' : 'tie';
  const deltaA = ratingChange(ratingA, ratingB, outcomeForA, gamesA);
  const deltaB = ratingChange(ratingB, ratingA, outcomeForB, gamesB);
  return {
    newA: applyRatingChange(ratingA, deltaA),
    newB: applyRatingChange(ratingB, deltaB),
    deltaA,
    deltaB,
  };
}
