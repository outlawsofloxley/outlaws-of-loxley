#!/usr/bin/env node
/**
 * test-marketplace.mjs — list N brawlers from deployer, buy K from signer.
 *
 * Usage:
 *   node scripts/test-marketplace.mjs --list 10 --buy 5 --price 0.0001
 *
 * Reads addresses from .env.base-sepolia. Requires:
 *   - DEPLOYER_KEY (the seller, owns the brawlers)
 *   - SIGNER_KEY (the buyer, must be funded with ETH ≥ list_price * buy_count)
 *   - MARKETPLACE_ADDRESS (deployed marketplace)
 *   - BRAWLERS_ADDRESS
 */
import { readFileSync } from 'node:fs';
import { JsonRpcProvider, Wallet, Contract, getAddress, parseEther } from 'ethers';

function loadEnv(path) {
  const raw = readFileSync(path, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = loadEnv(new URL('../.env.base-sepolia', import.meta.url));

const RPC = 'https://base-sepolia-rpc.publicnode.com';
const CHAIN_ID = Number(env.TESTNET_CHAIN_ID || 84532);
const BRAWLERS = getAddress(env.BRAWLERS_ADDRESS);
const MARKETPLACE = getAddress(env.MARKETPLACE_ADDRESS);

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const N_LIST = Number(args.list ?? 10);
const N_BUY = Number(args.buy ?? 5);
const PRICE_ETH = args.price ?? '0.0001';

const BRAWLERS_ABI = [
  'function ownerOf(uint256) view returns (address)',
  'function setApprovalForAll(address operator, bool approved)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
];
const MARKETPLACE_ABI = [
  'function list(uint256 tokenId, uint256 price)',
  'function buy(uint256 tokenId) payable',
  'function listingOf(uint256 tokenId) view returns (tuple(address seller, uint256 price, uint64 listedAt))',
  'function feeBps() view returns (uint16)',
  'event Listed(uint256 indexed tokenId, address indexed seller, uint256 price)',
  'event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 fee)',
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const provider = new JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true });
  const seller = new Wallet(env.DEPLOYER_KEY, provider);
  const buyer = new Wallet(env.SIGNER_KEY, provider);

  console.log(`▶ test-marketplace`);
  console.log(`  marketplace=${MARKETPLACE}`);
  console.log(`  seller=${seller.address}`);
  console.log(`  buyer=${buyer.address}`);
  console.log(`  list=${N_LIST} brawlers @ ${PRICE_ETH} ETH each`);
  console.log(`  buy=${N_BUY} of those`);

  const brawlers = new Contract(BRAWLERS, BRAWLERS_ABI, seller);
  const marketSeller = new Contract(MARKETPLACE, MARKETPLACE_ABI, seller);
  const marketBuyer = new Contract(MARKETPLACE, MARKETPLACE_ABI, buyer);

  // ─── Approve marketplace once for all brawlers ───
  const approved = await brawlers.isApprovedForAll(seller.address, MARKETPLACE);
  if (!approved) {
    console.log(`\n▶ Approving marketplace to manage seller's brawlers...`);
    const tx = await brawlers.setApprovalForAll(MARKETPLACE, true, { gasLimit: 100_000n });
    await tx.wait(1);
    console.log(`  ✓ ${tx.hash}`);
  } else {
    console.log(`\n▶ Marketplace already approved for seller`);
  }

  // ─── Find N seller-owned brawlers (skip dead, skip listed) ───
  const candidates = [];
  for (let id = 1; id <= 200 && candidates.length < N_LIST; id++) {
    try {
      const owner = await brawlers.ownerOf(id);
      if (owner.toLowerCase() !== seller.address.toLowerCase()) continue;
      const existing = await marketSeller.listingOf(id);
      if (existing.price > 0n) continue;
      candidates.push(id);
    } catch { /* not minted */ break; }
  }
  if (candidates.length < N_LIST) {
    console.error(`Only found ${candidates.length} eligible brawlers; need ${N_LIST}`);
    process.exit(1);
  }
  console.log(`\n▶ Will list: #${candidates.join(', #')}`);

  // ─── List N brawlers ───
  const priceWei = parseEther(PRICE_ETH);
  console.log(`\n▶ LISTING phase`);
  const listed = [];
  for (let i = 0; i < N_LIST; i++) {
    const id = candidates[i];
    try {
      const tx = await marketSeller.list(id, priceWei, { gasLimit: 200_000n });
      const rc = await tx.wait(1);
      console.log(`  ✓ list #${id} (${tx.hash})`);
      listed.push(id);
    } catch (e) {
      console.error(`  ✗ list #${id}: ${e.shortMessage || e.message}`);
    }
    await sleep(150);
  }
  console.log(`▶ Listed ${listed.length}/${N_LIST}`);

  // ─── Buy K from buyer wallet ───
  console.log(`\n▶ BUYING phase from ${buyer.address}`);
  const purchased = [];
  for (let i = 0; i < Math.min(N_BUY, listed.length); i++) {
    const id = listed[i];
    try {
      const tx = await marketBuyer.buy(id, { value: priceWei, gasLimit: 250_000n });
      const rc = await tx.wait(1);
      console.log(`  ✓ buy  #${id} (${tx.hash})`);
      purchased.push(id);
    } catch (e) {
      console.error(`  ✗ buy  #${id}: ${e.shortMessage || e.message}`);
    }
    await sleep(150);
  }

  // ─── Trigger marketplace sync to index events ───
  console.log(`\n▶ Trigger /api/marketplace/sync`);
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch('https://baseicbrawlers.com/api/marketplace/sync', { method: 'POST' });
      const j = await r.json();
      console.log(`  attempt ${i + 1}: ok=${j.ok} synced=${j.synced ?? false} events=${j.eventsInserted ?? 0}`);
      if (j.fullyCaughtUp) break;
    } catch (e) { console.error(`  sync error: ${e.message}`); }
    await sleep(2000);
  }

  // ─── Verify final state ───
  console.log(`\n▶ Final state:`);
  console.log(`  Listed (still active): ${listed.length - purchased.length}`);
  console.log(`  Sold: ${purchased.length}`);
  for (const id of purchased) {
    const owner = await brawlers.ownerOf(id);
    const isBuyer = owner.toLowerCase() === buyer.address.toLowerCase();
    console.log(`    #${id} owner=${owner} ${isBuyer ? '(buyer ✓)' : '(MISMATCH)'}`);
  }

  console.log(`\n✓ done`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
