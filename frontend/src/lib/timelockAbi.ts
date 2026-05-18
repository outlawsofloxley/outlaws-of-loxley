import { parseAbi } from 'viem';

export const BRAWL_TIMELOCK_ABI = parseAbi([
  'function token() view returns (address)',
  'function beneficiary() view returns (address)',
  'function startTimestamp() view returns (uint64)',
  'function cliffSeconds() view returns (uint64)',
  'function durationSeconds() view returns (uint64)',
  'function endTimestamp() view returns (uint64)',
  'function totalReleased() view returns (uint256)',
  'function currentAllocation() view returns (uint256)',
  'function vestedAmount() view returns (uint256)',
  'function releasable() view returns (uint256)',
  'function progressBps() view returns (uint16)',
  'function release()',
  'event Released(uint256 amount)',
]);
