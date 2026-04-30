'use client';

/**
 * /me, the connected wallet's profile. Lets the user claim/update their
 * display handle and see a quick summary of their brawlers.
 */
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { useAllBrawlers } from '@/hooks/useAllBrawlers';
import { WalletNamePanel } from '@/components/WalletNamePanel';
import { ConnectButton } from '@/components/ConnectButton';
import { useWalletName } from '@/hooks/useWalletNames';

export default function MePage() {
  const { address, isConnected } = useAccount();
  const { brawlers } = useAllBrawlers();
  const handle = useWalletName(address);

  const mine = address
    ? brawlers.filter((b) => b.owner.toLowerCase() === address.toLowerCase())
    : [];
  const alive = mine.filter((b) => !b.isDead);

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 space-y-6">
      <div>
        <h1 className="brawl-header text-2xl md:text-3xl text-brawl-orange">Profile</h1>
        <p className="text-sm text-brawl-text-dim mt-2">
          Your handle, your brawlers. Other players see your handle wherever
          your wallet appears in the app.
        </p>
      </div>

      {!isConnected ? (
        <div className="brawl-card p-6 text-center space-y-4">
          <div className="text-sm text-brawl-text-dim">
            Connect your wallet to claim a handle.
          </div>
          <div className="flex justify-center">
            <ConnectButton />
          </div>
        </div>
      ) : (
        <>
          <div className="brawl-card p-4 space-y-1">
            <div className="text-sm text-brawl-text-faint font-mono">Wallet</div>
            <div className="font-mono text-sm break-all">
              {handle ? (
                <>
                  <span className="brawl-header text-brawl-orange text-base mr-2">
                    {handle}
                  </span>
                  <span className="text-brawl-text-dim">{address}</span>
                </>
              ) : (
                address
              )}
            </div>
          </div>

          <WalletNamePanel />

          <div className="brawl-card p-4 space-y-3">
            <div className="brawl-header text-sm text-brawl-orange">
              Your brawlers ({mine.length})
            </div>
            <div className="text-sm text-brawl-text-dim">
              {alive.length} alive · {mine.length - alive.length} dead
            </div>
            {mine.length > 0 ? (
              <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                {mine.slice(0, 12).map((b) => (
                  <Link
                    key={b.tokenId}
                    href={`/brawler/${b.tokenId}`}
                    className="border border-brawl-border px-3 py-2 hover:border-brawl-orange transition-colors block"
                  >
                    <div className="brawl-header text-sm text-brawl-text">
                      #{b.tokenId} · {b.name}
                    </div>
                    <div className="text-sm font-mono text-brawl-text-faint">
                      Rating {b.elo} · {b.wins}W / {b.losses}L /{' '}
                      {b.ties}T {b.isDead ? '· dead' : ''}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-sm text-brawl-text-dim">
                No brawlers yet. <Link href="/mint" className="text-brawl-orange">Mint one</Link>.
              </div>
            )}
            {mine.length > 12 && (
              <Link
                href={`/owner/${address}`}
                className="text-sm text-brawl-orange hover:underline"
              >
                See all {mine.length} →
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  );
}
