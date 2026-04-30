/**
 * Block-explorer URL helpers. Single source of truth so every "tx 0x…"
 * widget across mint / duel / history can render a clickable link to the
 * right explorer for whatever chain wagmi is currently on.
 */

export function explorerTxUrl(chainId: number, txHash: string): string | null {
  if (chainId === 8453) return `https://basescan.org/tx/${txHash}`;
  if (chainId === 84532) return `https://sepolia.basescan.org/tx/${txHash}`;
  if (chainId === 1) return `https://etherscan.io/tx/${txHash}`;
  if (chainId === 56) return `https://bscscan.com/tx/${txHash}`;
  if (chainId === 97) return `https://testnet.bscscan.com/tx/${txHash}`;
  return null;
}

export function explorerAddressUrl(chainId: number, address: string): string | null {
  if (chainId === 8453) return `https://basescan.org/address/${address}`;
  if (chainId === 84532) return `https://sepolia.basescan.org/address/${address}`;
  if (chainId === 1) return `https://etherscan.io/address/${address}`;
  if (chainId === 56) return `https://bscscan.com/address/${address}`;
  if (chainId === 97) return `https://testnet.bscscan.com/address/${address}`;
  return null;
}

export function truncHash(hash: string): string {
  if (hash.length < 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}
