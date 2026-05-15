// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Brawlers} from "../contracts/Brawlers.sol";
import {Duel} from "../contracts/Duel.sol";
import {Graveyard} from "../contracts/Graveyard.sol";
import {BRAWL} from "../contracts/BRAWL.sol";
import {MintDrop} from "../contracts/MintDrop.sol";
import {Marketplace} from "../contracts/Marketplace.sol";
import {MockUSDT} from "../contracts/mocks/MockUSDT.sol";
import {DuelRouter} from "../contracts/DuelRouter.sol";

/**
 * @title Deploy
 * @notice One-command deploy of the full BASEic Brawlers stack: BRAWL ERC-20
 *         + Brawlers NFT + MintDrop (ETH/USDT/USDC) + Duel + Graveyard.
 *
 *         Reads config from environment (all optional with sane Sepolia
 *         test defaults, micro prices so Sepolia ETH isn't wasted):
 *           PRIVATE_KEY         , deployer (default: Anvil account 0)
 *           SIGNER_ADDRESS      , duel signer (default: Anvil account 1)
 *           BRAWL_INITIAL_HOLDER, receives 100k BRAWL (default: deployer)
 *           DEV_TREASURY        , dev-share recipient (default: deployer)
 *           MINT_TREASURY       , mint-proceeds recipient (default: deployer)
 *           RESURRECT_TREASURY  , graveyard fees recipient (default: deployer)
 *           MASTER_SEED         , brawler RNG seed (default: 0x2a)
 *           RESURRECTION_COST   , wei (default: 0.0001 ether, micro)
 *           ETH_MINT_PRICE      , wei per brawler (default: 0.0001 ether, micro)
 *           USDT_MINT_PRICE     , USDT units per brawler (default: 0.01 USDT = 10000)
 *           USDC_MINT_PRICE     , USDC units per brawler (default: 0.01 USDC = 10000)
 *           AIRDROP_PER_MINT    , BRAWL wei airdropped per mint (default: 50e18)
 *           FIGHT_COST          , BRAWL wei per player per fight (default: 100e18)
 *           DEV_SHARE_BPS       , dev cut in bps (default: 1000 = 10%)
 *           USDT_ADDRESS        , real USDT (default: 0 → deploy MockUSDT)
 *           USDC_ADDRESS        , real USDC (default: 0 → deploy MockUSDC)
 *           BASE_URI            , tokenURI prefix (default: local dev URL)
 *
 *         Usage (Base Sepolia):
 *           set -a; source .env.base-sepolia; set +a
 *           PRIVATE_KEY=$DEPLOYER_KEY \
 *           BASE_URI="https://frontend-liard-nine-57.vercel.app/api/token/" \
 *           forge script script/Deploy.s.sol:Deploy \
 *             --rpc-url $TESTNET_RPC --broadcast --chain-id 84532
 *
 *         Mainnet calibration (D's 2026-05-15 launch-eve lock-in):
 *           ETH_MINT_PRICE=7500000000000000      (0.0075 ETH = ~$30 at $4k ETH)
 *           USDT_MINT_PRICE=30000000             ($30 in USDT, 6 decimals)
 *           USDC_MINT_PRICE=30000000             ($30 in USDC, 6 decimals)
 *           RESURRECTION_COST=25000000000000000  (0.025 ETH base = ~$100 floor at
 *                                                Common 0 wins, $4k ETH. Tier mults
 *                                                push Epic 0w to ~$400, King 0w to
 *                                                ~$1500. resurrection-cost-keeper
 *                                                pegs base to $100 USD live.)
 *           FIGHT_COST=10000000000000000000      (10 BRAWL/fighter starter; fight-
 *                                                cost-keeper repegs to ~$1 USD in
 *                                                BRAWL every 5 min after LP seeds)
 *           AIRDROP_PER_MINT=0                   (no per-mint airdrop)
 *           FOUNDER_AIRDROP=0                    (founder bonus disabled; founders
 *                                                keep free Tier1 + 25% fight discount
 *                                                + 1 free revive)
 *           FEE_BPS=750                          (Marketplace fee = 7.5%)
 *           LP_SHARE_BPS=3333                    ($10 of $30 → LP fund)
 *           LP_BRAWL_PER_MINT=50000000000000000000 (50 BRAWL paired per mint;
 *                                                   tune via dash if price drifts)
 *
 *         Old-defaults header (kept for reference):
 *           USDT_MINT_PRICE=20000000             ($20 at 6 decimals)
 *           USDC_MINT_PRICE=20000000             ($20 at 6 decimals)
 *           RESURRECTION_COST=2500000000000000   (~$10 base)
 *
 *         Post-deploy auto-distributions (handled by this script):
 *           - 10,000 BRAWL → DEV_TREASURY (unlocked ops budget)
 *           - 20,000 BRAWL → HOUSE_KEEPER_ADDRESS (auto-fight wallet)
 *         Subsequent scripts (run by launch-mainnet.sh):
 *           - 50,000 BRAWL → SeedAndLockLP.s.sol (paired with ~$200 ETH, LP burned)
 *           - 20,000 BRAWL → LockTeamTokens.s.sol (UNCX V2, 6-month linear vest)
 */
contract Deploy is Script {
    // BRAWL allocation constants (sum == FIXED_SUPPLY = 100,000e18)
    // Locked in 2026-05-15 (launch-eve revision):
    //   50k LP (paired with $200 ETH, LP tokens BURNED to 0xdead post-seed)
    //   20k team vault (UNCX V2 vesting, 6-month linear, no cliff)
    //   20k keeper (auto-fight + setFightEconomics + setResurrectionCost peg)
    //   10k dev (Darren's wallet, unlocked, ops budget)
    //    0  MintDrop airdrop pool (founder bonus disabled; founders keep free
    //        Tier 1 mint + 25% fight discount + 1 free resurrect)
    uint256 internal constant BRAWL_LP = 50_000e18;
    uint256 internal constant BRAWL_TEAM_VAULT = 20_000e18;
    uint256 internal constant BRAWL_KEEPER = 20_000e18;
    uint256 internal constant BRAWL_DEV = 10_000e18;

    function run() external {
        // ─── Read env / defaults ─────────────────────────────────────
        uint256 deployerKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        address deployer = vm.addr(deployerKey);
        address signerAddr =
            vm.envOr("SIGNER_ADDRESS", address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8));
        address brawlHolder = vm.envOr("BRAWL_INITIAL_HOLDER", deployer);
        address devTreasury = vm.envOr("DEV_TREASURY", deployer);
        address mintTreasury = vm.envOr("MINT_TREASURY", deployer);
        address resurrectTreasury = vm.envOr("RESURRECT_TREASURY", deployer);
        uint256 masterSeed = vm.envOr("MASTER_SEED", uint256(0x2a));
        // Sepolia-friendly micro defaults, see header for mainnet calibration.
        uint256 resurrectionCost = vm.envOr("RESURRECTION_COST", uint256(0.025 ether));
        uint256 ethMintPrice = vm.envOr("ETH_MINT_PRICE", uint256(0.0001 ether));
        uint256 usdtMintPrice = vm.envOr("USDT_MINT_PRICE", uint256(10_000)); // 0.01 USDT (6 dp)
        uint256 usdcMintPrice = vm.envOr("USDC_MINT_PRICE", uint256(10_000)); // 0.01 USDC (6 dp)
        // 2026-04-27: airdropPerMint = 0 by default (mainnet design).
        // Sepolia override: set AIRDROP_PER_MINT=50000000000000000000 (50e18)
        // so testers can play. Founder bonus is on by default for testing.
        uint256 airdropPerMint = vm.envOr("AIRDROP_PER_MINT", uint256(0));
        uint256 founderAirdropAmount = vm.envOr("FOUNDER_AIRDROP", uint256(0)); // disabled; founders keep other 3 perks
        uint256 lpShareBps = vm.envOr("LP_SHARE_BPS", uint256(3333));               // 33.33% to LP fund
        // 2026-05-15: 0 by default. MintDrop holds no BRAWL post-launch (the
        // airdrop pool was dropped in favour of dev/keeper allocations) so
        // per-mint LP topups can't pull from it. Owner can fund MintDrop +
        // bump this via setLpBrawlPerMint later if we change the model.
        uint256 lpBrawlPerMint = vm.envOr("LP_BRAWL_PER_MINT", uint256(0));
        address lpTreasury = vm.envOr("LP_TREASURY", deployer);
        uint256 fightCost = vm.envOr("FIGHT_COST", uint256(10e18));                 // 10 BRAWL starter; fight-cost-keeper repegs to ~$1 USD live
        uint256 devShareBpsRaw = vm.envOr("DEV_SHARE_BPS", uint256(1000));
        require(devShareBpsRaw <= type(uint16).max, "Deploy: DEV_SHARE_BPS overflow uint16");
        uint16 devShareBps = uint16(devShareBpsRaw);
        address usdtEnv = vm.envOr("USDT_ADDRESS", address(0));
        address usdcEnv = vm.envOr("USDC_ADDRESS", address(0));
        string memory baseUri = vm.envOr("BASE_URI", string("http://localhost:3000/api/token/"));

        // ─── Summary ─────────────────────────────────────────────────
        console2.log("=== Brawlers Phase 7 deploy ===");
        console2.log("Deployer:             ", deployer);
        console2.log("Signer:               ", signerAddr);
        console2.log("BRAWL initial holder: ", brawlHolder);
        console2.log("Dev treasury:         ", devTreasury);
        console2.log("Mint treasury:        ", mintTreasury);
        console2.log("Resurrect treasury:   ", resurrectTreasury);
        console2.log("Master seed:          ", masterSeed);
        console2.log("Resurrection cost:    ", resurrectionCost);
        console2.log("ETH mint price:       ", ethMintPrice);
        console2.log("USDT mint price:      ", usdtMintPrice);
        console2.log("USDC mint price:      ", usdcMintPrice);
        console2.log("Airdrop per mint:     ", airdropPerMint);
        console2.log("Founder airdrop:      ", founderAirdropAmount);
        console2.log("LP share bps:         ", lpShareBps);
        console2.log("LP treasury:          ", lpTreasury);
        console2.log("Fight cost:           ", fightCost);
        console2.log("Dev share bps:        ", devShareBps);
        console2.log("Base URI:             ", baseUri);

        vm.startBroadcast(deployerKey);

        // ─── 1. Deploy BRAWL token (anti-sniping hardened) ───────────
        BRAWL brawl = new BRAWL(brawlHolder, deployer);
        console2.log("BRAWL:                ", address(brawl));

        // ─── 2. Deploy Brawlers NFT (runs rarity shuffle in constructor) ──
        // devWallet = deployer, the dev's mints get capped to common/uncommon
        // so the team can never pull a rare or better. Anti-rug signal.
        Brawlers brawlers = new Brawlers(deployer, masterSeed, deployer);
        console2.log("Brawlers:             ", address(brawlers));
        console2.log("Dev wallet (cap C/U): ", deployer);

        // ─── 3. Deploy Duel with fight economics ─────────────────────
        Duel duel = new Duel(
            deployer,
            address(brawlers),
            signerAddr,
            address(brawl),
            devTreasury,
            fightCost,
            devShareBps
        );
        console2.log("Duel:                 ", address(duel));

        // ─── 4. Deploy Graveyard ─────────────────────────────────────
        Graveyard graveyard = new Graveyard(
            deployer, address(brawlers), address(duel), resurrectTreasury, resurrectionCost
        );
        console2.log("Graveyard:            ", address(graveyard));

        // ─── 5. USDT + USDC (mock when addr unset, real on testnet/mainnet) ──
        address usdtAddr = usdtEnv;
        if (usdtAddr == address(0)) {
            MockUSDT mock = new MockUSDT();
            usdtAddr = address(mock);
            console2.log("MockUSDT (local):     ", usdtAddr);
        } else {
            console2.log("USDT (external):      ", usdtAddr);
        }
        address usdcAddr = usdcEnv;
        if (usdcAddr == address(0)) {
            // Reuse MockUSDT, same 6-decimal ERC-20 surface, fine for tests.
            MockUSDT mockc = new MockUSDT();
            usdcAddr = address(mockc);
            console2.log("MockUSDC (local):     ", usdcAddr);
        } else {
            console2.log("USDC (external):      ", usdcAddr);
        }

        // ─── 6. Deploy MintDrop (split treasuries + founder + bulk + lottery) ─
        MintDrop mintDrop = new MintDrop(
            MintDrop.DeployParams({
                initialOwner: deployer,
                brawlersAddr: address(brawlers),
                brawlAddr: address(brawl),
                usdtAddr: usdtAddr,
                usdcAddr: usdcAddr,
                devTreasury: mintTreasury,
                lpTreasury: lpTreasury,
                ethPrice: ethMintPrice,
                usdtPrice: usdtMintPrice,
                usdcPrice: usdcMintPrice,
                airdropPerMint: airdropPerMint,
                founderAirdropAmount: founderAirdropAmount,
                lpShareBps: lpShareBps,
                lpBrawlPerMint: lpBrawlPerMint
            })
        );
        console2.log("MintDrop:             ", address(mintDrop));

        // ─── 6b. Deploy Marketplace (peer-to-peer NFT sales, 5% fee) ─
        // Folded into the main deploy as of v11 so `npm run deploy:mainnet`
        // is one shot and the orchestrator picks up the address. Default
        // fee = 5% (capped at 10% by MAX_FEE_BPS in Marketplace itself).
        // Overridable via FEE_BPS / FEE_TREASURY env.
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(750)));  // 7.5% marketplace fee
        address feeTreasury = vm.envOr("FEE_TREASURY", devTreasury);
        Marketplace marketplace = new Marketplace(
            address(brawlers),
            feeTreasury,
            feeBps,
            deployer
        );
        console2.log("Marketplace:          ", address(marketplace));

        // ─── 7. Wire authorizations ──────────────────────────────────
        brawlers.setDuelContract(address(duel));
        brawlers.setGraveyardContract(address(graveyard));
        brawlers.setMintDrop(address(mintDrop));
        duel.setGraveyardContract(address(graveyard));
        // v11: Duel queries Marketplace.isListed before applying duel
        // results, blocking listed brawlers from being sent into combat.
        duel.setMarketplace(address(marketplace));

        // ─── 7b. DuelRouter (currency-aware fight wrapper, deployed when
        //         AERODROME_ROUTER is set in env — i.e., mainnet) ──────────
        // Players approve the router for their brawlers + BRAWL; the router
        // becomes the only authorized caller of Duel.submitDuel and handles
        // all ETH/BRAWL fight economics, swap-via-Aerodrome, and dev cut
        // distribution. Duel itself is set to fightCost=0/devShareBps=0
        // (it just records ELO + death streaks + emits events).
        address aerodromeRouter = vm.envOr("AERODROME_ROUTER", address(0));
        address duelRouterAddr = address(0);
        if (aerodromeRouter != address(0)) {
            uint256 routerFightBrawl = vm.envOr("ROUTER_FIGHT_COST_BRAWL", uint256(500e18));
            uint256 routerFightEth = vm.envOr("ROUTER_FIGHT_COST_ETH", uint256(0.00025 ether));
            DuelRouter dr = new DuelRouter(
                deployer,
                address(duel),
                address(brawlers),
                address(brawl),
                aerodromeRouter,
                signerAddr,
                devTreasury,
                routerFightBrawl,
                routerFightEth
            );
            duelRouterAddr = address(dr);
            console2.log("DuelRouter:           ", duelRouterAddr);
            // Staged rollout: by default we DEPLOY the router but leave Duel in
            // legacy mode (authorizedRouter unset, fightCost preserved). The
            // existing BRAWL-only flow keeps working day-1. Once the frontend
            // is router-aware (currency picker + router.fight calls + setApproval),
            // call setAuthorizedRouter + setFightEconomics(0,0,...) to flip Duel
            // into router-only mode.
            //
            // Default activated 2026-05-15 launch eve: the frontend duel page
            // routes through the router via response.quote + setApprovalForAll,
            // and the FightQuote API path is live. Set ACTIVATE_ROUTER=false
            // to keep Duel in legacy mode if something's wrong with the router
            // and you want a fast staged-rollout fallback.
            if (vm.envOr("ACTIVATE_ROUTER", true)) {
                duel.setAuthorizedRouter(duelRouterAddr);
                duel.setFightEconomics(0, 0, devTreasury);
                console2.log("  Router ACTIVATED at deploy (Duel locked to router).");
            } else {
                console2.log("  Router DEPLOYED but inert. To activate post-launch:");
                console2.log("    duel.setAuthorizedRouter(router); duel.setFightEconomics(0, 0, devTreasury);");
            }
        } else {
            console2.log("Skipping DuelRouter (AERODROME_ROUTER unset; Duel runs in legacy mode).");
        }

        // ─── 7c. Whitelist game contracts in BRAWL (anti-sniping bypass) ─
        // These addresses MUST move BRAWL freely (game txs would otherwise
        // hit max-tx / max-wallet caps and revert).
        uint256 bulkLen = duelRouterAddr == address(0) ? 4 : 5;
        address[] memory bulk = new address[](bulkLen);
        bulk[0] = address(duel);
        bulk[1] = address(graveyard);
        bulk[2] = address(mintDrop);
        bulk[3] = mintTreasury;
        if (duelRouterAddr != address(0)) {
            bulk[4] = duelRouterAddr;
        }
        brawl.setWhitelistBulk(bulk, true);

        // ─── 7e. Tiered mint pricing (mainnet 5-tier table) ──────────
        // Set TIERED_PRICING=true to apply the 5-tier mainnet calibration.
        // Tier ETH prices default to the $4k-ETH lock-in; override per-tier
        // via env if ETH price has drifted at launch time.
        if (vm.envOr("TIERED_PRICING", false)) {
            MintDrop.PriceTier[] memory tiers = new MintDrop.PriceTier[](5);
            // Tier 1: mints 1..100 = FREE (founder slot incentive)
            tiers[0] = MintDrop.PriceTier({
                upToSold: 100,
                ethPrice: 0,
                usdcPrice: 0,
                usdtPrice: 0
            });
            // Tier 2: 101..500 = $40
            tiers[1] = MintDrop.PriceTier({
                upToSold: 500,
                ethPrice: uint128(vm.envOr("TIER2_ETH", uint256(10_000_000_000_000_000))), // $40 @ $4k
                usdcPrice: uint128(vm.envOr("TIER2_USDC", uint256(40_000_000))),
                usdtPrice: uint128(vm.envOr("TIER2_USDT", uint256(40_000_000)))
            });
            // Tier 3: 501..1000 = $45
            tiers[2] = MintDrop.PriceTier({
                upToSold: 1000,
                ethPrice: uint128(vm.envOr("TIER3_ETH", uint256(11_250_000_000_000_000))), // $45 @ $4k
                usdcPrice: uint128(vm.envOr("TIER3_USDC", uint256(45_000_000))),
                usdtPrice: uint128(vm.envOr("TIER3_USDT", uint256(45_000_000)))
            });
            // Tier 4: 1001..1500 = $50
            tiers[3] = MintDrop.PriceTier({
                upToSold: 1500,
                ethPrice: uint128(vm.envOr("TIER4_ETH", uint256(12_500_000_000_000_000))), // $50 @ $4k
                usdcPrice: uint128(vm.envOr("TIER4_USDC", uint256(50_000_000))),
                usdtPrice: uint128(vm.envOr("TIER4_USDT", uint256(50_000_000)))
            });
            // Tier 5: 1501..2000 = $60
            tiers[4] = MintDrop.PriceTier({
                upToSold: 2000,
                ethPrice: uint128(vm.envOr("TIER5_ETH", uint256(15_000_000_000_000_000))), // $60 @ $4k
                usdcPrice: uint128(vm.envOr("TIER5_USDC", uint256(60_000_000))),
                usdtPrice: uint128(vm.envOr("TIER5_USDT", uint256(60_000_000)))
            });
            mintDrop.setPriceTiers(tiers);
            console2.log("Tiered pricing applied: 100 free / 400 @$40 / 500 @$45 / 500 @$50 / 500 @$60");
        }

        // ─── 7f. Founder fight discount (default 25%, override via env) ──
        uint256 founderDiscount = vm.envOr("FOUNDER_DISCOUNT_BPS", uint256(2500));
        if (founderDiscount != 2500) {
            duel.setFounderDiscountBps(founderDiscount);
            console2.log("Founder fight discount set to bps:", founderDiscount);
        }

        // ─── 8. Base URI ─────────────────────────────────────────────
        brawlers.setBaseURI(baseUri);

        // ─── 8b. House brawlers (optional) ───────────────────────────
        // If `HOUSE_BRAWLERS_COUNT` env is set, mint that many brawlers
        // directly to the deployer (devWallet) so `_skipRareForDev` lands
        // them all on C/U slots. Flag every minted ID as `isHouseBrawler`
        // so the founder discount / freebie / airdrop are NOT applied even
        // though they sit in the 1..100 founder range. Optionally transfer
        // to `HOUSE_KEEPER_ADDRESS` for the keeper bot.
        //
        // Day-1 UX: gives every public minter someone to fight from block 1.
        uint256 houseCount = vm.envOr("HOUSE_BRAWLERS_COUNT", uint256(0));
        if (houseCount > 0) {
            address keeperAddr = vm.envOr("HOUSE_KEEPER_ADDRESS", deployer);
            uint256[] memory houseIds = new uint256[](houseCount);
            for (uint256 i = 0; i < houseCount; i++) {
                // owner-path mint goes through `_skipRareForDev`, so dev
                // mints land on Common/Uncommon only. Skips MintDrop entirely
                // so no founder airdrop ever fires.
                houseIds[i] = brawlers.mint(deployer);
            }
            brawlers.setHouseBrawlersBulk(houseIds, true);
            console2.log("House brawlers minted + flagged:", houseCount);
            if (keeperAddr != deployer) {
                for (uint256 i = 0; i < houseCount; i++) {
                    brawlers.transferFrom(deployer, keeperAddr, houseIds[i]);
                }
                console2.log("House brawlers transferred to keeper:", keeperAddr);
            }
        }

        vm.stopBroadcast();

        // ─── 9. BRAWL distribution (auto-transfer dev + keeper allocations) ──
        //     Deployer holds all 100k initially. We auto-push:
        //       - 10k → DEV_TREASURY (unlocked ops budget)
        //       - 20k → HOUSE_KEEPER_ADDRESS (auto-fight wallet)
        //     Deployer is left with 70k = 50k LP + 20k team vault for the
        //     follow-up scripts (SeedAndLockLP + LockTeamTokens).
        //     Requires brawlHolder == deployer (the common case); otherwise the
        //     holder must run these transfers themselves.
        if (brawlHolder == deployer) {
            vm.startBroadcast(deployerKey);
            // BRAWL.transfer hits the launch-window maxTx/maxWallet limits,
            // dev + keeper must be whitelisted as senders/receivers to skip
            // the cap. Whitelist them here so the transfers succeed even if
            // trading hasn't been enabled yet.
            address[] memory unlockBulk = new address[](2);
            unlockBulk[0] = devTreasury;
            address keeperAddrForBrawl = vm.envOr("HOUSE_KEEPER_ADDRESS", deployer);
            unlockBulk[1] = keeperAddrForBrawl;
            brawl.setWhitelistBulk(unlockBulk, true);

            brawl.transfer(devTreasury, BRAWL_DEV);
            console2.log("Dev allocation sent:  ", BRAWL_DEV, "BRAWL -> ", devTreasury);

            if (keeperAddrForBrawl != deployer) {
                brawl.transfer(keeperAddrForBrawl, BRAWL_KEEPER);
                console2.log("Keeper allocation sent:", BRAWL_KEEPER, "BRAWL -> ", keeperAddrForBrawl);
            } else {
                console2.log("HOUSE_KEEPER_ADDRESS unset; keeper allocation left on deployer.");
            }
            vm.stopBroadcast();
        } else {
            console2.log("");
            console2.log("WARNING: BRAWL_INITIAL_HOLDER != deployer. The initial holder must");
            console2.log("manually transfer tokens after deploy:");
            console2.log("  ", BRAWL_DEV, "-> dev wallet (DEV_TREASURY)");
            console2.log("  ", BRAWL_KEEPER, "-> keeper wallet (HOUSE_KEEPER_ADDRESS)");
            console2.log("  ", BRAWL_LP, "-> Aerodrome LP via SeedAndLockLP.s.sol");
            console2.log("  ", BRAWL_TEAM_VAULT, "-> UNCX vest via LockTeamTokens.s.sol");
        }

        console2.log("");
        console2.log("=== Deployment complete ===");
        console2.log("  BRAWL_ADDRESS=     ", address(brawl));
        console2.log("  BRAWLERS_ADDRESS=  ", address(brawlers));
        console2.log("  DUEL_ADDRESS=      ", address(duel));
        console2.log("  GRAVEYARD_ADDRESS= ", address(graveyard));
        console2.log("  USDT_ADDRESS=      ", usdtAddr);
        console2.log("  USDC_ADDRESS=      ", usdcAddr);
        console2.log("  MINTDROP_ADDRESS=  ", address(mintDrop));
        console2.log("  MARKETPLACE_ADDRESS=", address(marketplace));
        console2.log("  DUEL_ROUTER_ADDRESS=", duelRouterAddr);
        console2.log("");
        console2.log("Next steps (orchestrated by launch-mainnet.sh):");
        console2.log("  SeedAndLockLP.s.sol  -> 50,000 BRAWL + ~$200 ETH, burn LP");
        console2.log("  LockTeamTokens.s.sol -> 20,000 BRAWL UNCX vest (6 months)");
        console2.log("  EnableTrading.s.sol  -> open trading + whitelist game contracts");
    }
}
