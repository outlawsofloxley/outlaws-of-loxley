/**
 * ELO rating calculations.
 *
 * Standard Elo formula with a K-factor that decreases as players
 * accumulate games, new players swing more, veterans stabilize.
 *
 *   expected(A) = 1 / (1 + 10^((B - A) / 400))
 *   newA = A + K * (actualScore - expected(A))
 *
 * Where actualScore is 1 for a win, 0 for a loss, 0.5 for a tie.
 *
 * K-factor schedule (matches FIDE for chess):
 *   Games 0-10:  K=32 (new player, rating adjusts fast)
 *   Games 11-50: K=24
 *   Games 51+:   K=16 (established, rating stabilizes)
 */

export const STARTING_ELO = 1000;

/** ELO result for one side. */
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

/** Expected score for A given A and B's current ratings. Returns [0, 1]. */
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/** K-factor for a player based on their total games played. */
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

/** Rating change for a player with `games` games played after an outcome. */
export function ratingChange(
  playerRating: number,
  opponentRating: number,
  outcome: Outcome,
  gamesPlayed: number,
): number {
  const k = kFactor(gamesPlayed);
  const expected = expectedScore(playerRating, opponentRating);
  const actual = outcomeScore(outcome);
  // Round half-away-from-zero for predictable int behavior (matches Solidity ports).
  const delta = k * (actual - expected);
  return Math.round(delta);
}

/** Apply a rating change to a current rating. Never drops below 100 (floor). */
export function applyRatingChange(current: number, change: number): number {
  const next = current + change;
  return next < 100 ? 100 : next;
}

/**
 * Apply a full duel result to both players.
 * Returns the new ratings for A and B.
 */
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
