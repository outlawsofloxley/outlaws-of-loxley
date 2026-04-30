'use client';

import { requireEnv } from '@/lib/env';
import { explorerTxUrl, truncHash } from '@/lib/explorer';

interface TxLinkProps {
  txHash: `0x${string}`;
  /** Optional explicit chainId. Falls back to env.chainId when omitted. */
  chainId?: number;
  /** When true, render the truncated form (`0x12345…abcdef`). */
  truncate?: boolean;
  className?: string;
}

export function TxLink({ txHash, chainId, truncate = false, className }: TxLinkProps) {
  const { env } = requireEnv();
  const cid = chainId ?? env.chainId;
  const url = explorerTxUrl(cid, txHash);
  const display = truncate ? truncHash(txHash) : txHash;
  if (!url) {
    return (
      <span className={className} title={txHash}>
        tx {display}
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      title={txHash}
      className={`${className ?? ''} underline hover:text-brawl-orange`}
    >
      tx {display}
    </a>
  );
}
