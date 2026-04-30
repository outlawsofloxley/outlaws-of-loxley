'use client';

/**
 * Presentational table for a list of DuelCompleted events. Used by
 * /history (all or mine) and /brawler/[id]/history (per-brawler).
 *
 * Each row renders: block, both brawlers + new ELOs, rounds, winner,
 * and a truncated tx hash that links to the chain's explorer. The
 * explorer URL is chain-aware.
 */
import Link from 'next/link';
import type { DuelHistoryRow } from '@/hooks/useDuelHistory';
import { requireEnv } from '@/lib/env';
import { explorerTxUrl, truncHash } from '@/lib/explorer';

interface DuelHistoryTableProps {
  rows: readonly DuelHistoryRow[];
  nameOf: ReadonlyMap<number, string>;
  mineTokenIds?: ReadonlySet<number>;
  /** Token id to always highlight (per-brawler view) */
  highlightTokenId?: number;
}

export function DuelHistoryTable({
  rows,
  nameOf,
  mineTokenIds,
  highlightTokenId,
}: DuelHistoryTableProps) {
  const { env } = requireEnv();

  return (
    <div className="brawl-card overflow-hidden">
      {/* Desktop table */}
      <table className="hidden md:table w-full text-sm font-mono">
        <thead>
          <tr className="text-brawl-text-faint brawl-header text-xs border-b border-brawl-border">
            <th className="text-left px-3 py-2">Fighter A</th>
            <th className="text-center px-3 py-2">vs</th>
            <th className="text-left px-3 py-2">Fighter B</th>
            <th className="text-center px-3 py-2">Rounds</th>
            <th className="text-left px-3 py-2">Winner</th>
            <th className="text-right px-3 py-2">Tx</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const tie = r.winnerId === 0;
            const aWon = !tie && r.winnerId === r.tokenA;
            const bWon = !tie && r.winnerId === r.tokenB;
            const winnerName = tie
              ? 'Tie'
              : aWon
                ? nameOf.get(r.tokenA) ?? `#${r.tokenA}`
                : nameOf.get(r.tokenB) ?? `#${r.tokenB}`;
            const url = explorerTxUrl(env.chainId, r.txHash);
            const rowKey = `${r.txHash}-${r.logIndex}`;

            const mineA = mineTokenIds?.has(r.tokenA) ?? false;
            const mineB = mineTokenIds?.has(r.tokenB) ?? false;
            const hiA = highlightTokenId === r.tokenA;
            const hiB = highlightTokenId === r.tokenB;

            return (
              <tr
                key={rowKey}
                className="border-b border-brawl-border/40 hover:bg-brawl-bg/40 transition-colors"
              >
                <td className="px-3 py-2">
                  <BrawlerCell
                    tokenId={r.tokenA}
                    name={nameOf.get(r.tokenA)}
                    newElo={r.newEloA}
                    won={aWon}
                    tie={tie}
                    mine={mineA}
                    highlight={hiA}
                  />
                </td>
                <td className="text-center px-3 py-2 text-brawl-text-faint">vs</td>
                <td className="px-3 py-2">
                  <BrawlerCell
                    tokenId={r.tokenB}
                    name={nameOf.get(r.tokenB)}
                    newElo={r.newEloB}
                    won={bWon}
                    tie={tie}
                    mine={mineB}
                    highlight={hiB}
                  />
                </td>
                <td className="text-center px-3 py-2 text-brawl-text-dim">{r.rounds}</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      tie ? 'text-brawl-yellow' : 'text-brawl-green'
                    }
                  >
                    {winnerName}
                  </span>
                </td>
                <td className="text-right px-3 py-2">
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brawl-text-faint hover:text-brawl-orange"
                      title={r.txHash}
                    >
                      {truncHash(r.txHash)}
                    </a>
                  ) : (
                    <span className="text-brawl-text-faint" title={r.txHash}>
                      {truncHash(r.txHash)}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Mobile stacked cards */}
      <div className="md:hidden divide-y divide-brawl-border">
        {rows.map((r) => {
          const tie = r.winnerId === 0;
          const aWon = !tie && r.winnerId === r.tokenA;
          const bWon = !tie && r.winnerId === r.tokenB;
          const winnerName = tie
            ? 'Tie'
            : aWon
              ? nameOf.get(r.tokenA) ?? `#${r.tokenA}`
              : nameOf.get(r.tokenB) ?? `#${r.tokenB}`;
          const url = explorerTxUrl(env.chainId, r.txHash);
          const rowKey = `${r.txHash}-${r.logIndex}`;

          return (
            <div key={rowKey} className="p-3 space-y-2 text-sm font-mono">
              <div className="flex items-center justify-between text-xs">
                <span className="text-brawl-text-faint">block {r.blockNumber.toString()}</span>
                <span className={tie ? 'text-brawl-yellow' : 'text-brawl-green'}>
                  {winnerName}
                </span>
              </div>
              <BrawlerCell
                tokenId={r.tokenA}
                name={nameOf.get(r.tokenA)}
                newElo={r.newEloA}
                won={aWon}
                tie={tie}
                mine={mineTokenIds?.has(r.tokenA) ?? false}
                highlight={highlightTokenId === r.tokenA}
              />
              <div className="text-brawl-text-faint text-sm">vs — {r.rounds} rounds</div>
              <BrawlerCell
                tokenId={r.tokenB}
                name={nameOf.get(r.tokenB)}
                newElo={r.newEloB}
                won={bWon}
                tie={tie}
                mine={mineTokenIds?.has(r.tokenB) ?? false}
                highlight={highlightTokenId === r.tokenB}
              />
              <div className="text-sm text-brawl-text-faint break-all">
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" className="hover:text-brawl-orange">
                    {r.txHash}
                  </a>
                ) : (
                  r.txHash
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BrawlerCell({
  tokenId,
  name,
  newElo,
  won,
  tie,
  mine,
  highlight,
}: {
  tokenId: number;
  name: string | undefined;
  newElo: number;
  won: boolean;
  tie: boolean;
  mine: boolean;
  highlight: boolean;
}) {
  const display = name ?? `#${tokenId}`;
  const nameColor = won
    ? 'text-brawl-green'
    : tie
      ? 'text-brawl-yellow'
      : 'text-brawl-red';

  return (
    <div
      className={
        'flex items-center gap-2 ' +
        (highlight ? 'ring-1 ring-brawl-orange/50 rounded-sm px-1' : '')
      }
    >
      <Link href={`/brawler/${tokenId}`} className={`${nameColor} hover:underline truncate`}>
        {display}
      </Link>
      {mine && (
        <span className="text-xs brawl-header text-brawl-orange border border-brawl-orange/50 px-1">
          YOU
        </span>
      )}
      <span className="text-brawl-text-dim">RATING</span>
      <span className="text-brawl-cyan">{newElo}</span>
    </div>
  );
}
