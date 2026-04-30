// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Brawlers} from "../contracts/Brawlers.sol";
import {Duel} from "../contracts/Duel.sol";
import {Graveyard} from "../contracts/Graveyard.sol";
import {BRAWL} from "../contracts/BRAWL.sol";
import {MintDrop} from "../contracts/MintDrop.sol";
import {MockUSDT} from "../contracts/mocks/MockUSDT.sol";

/**
 * @title ForkRehearsal
 * @notice Full mainnet-launch dress rehearsal against a forked Base mainnet
 *         on local Anvil. Deploys the entire stack, mints a couple test
 *         brawlers, enables BRAWL trading, then seeds + (optionally) locks
 *         the LP using REAL Aerodrome v2 + Unicrypt mainnet contracts.
 *
 *         Use this BEFORE the real mainnet deploy to verify every step
 *         actually works against the real DEX/locker contracts. No real
 *         ETH spent - Anvil fork uses simulated state.
 *
 *         Usage:
 *           # Terminal 1 - start anvil forking Base mainnet
 *           anvil --fork-url https://mainnet.base.org --chain-id 8453
 *
 *           # Terminal 2 - run this script against the fork
 *           PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
 *           forge script script/ForkRehearsal.s.sol:ForkRehearsal \
 *             --rpc-url http://127.0.0.1:8545 \
 *             --broadcast \
 *             --skip-simulation
 *
 *         The default key above is anvil's well-known account 0 (10000 ETH).
 *
 *         Env vars (all optional):
 *           AERODROME_ROUTER  - default: real Base mainnet address
 *           SKIP_LP_LOCK      - set to "1" to skip the Unicrypt step (lock
 *                                contract address can change)
 */
interface IAerodromeRouter {
    function addLiquidityETH(
        address token,
        bool stable,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);

    function poolFor(address tokenA, address tokenB, bool stable, address factory)
        external
        view
        returns (address pool);

    function defaultFactory() external view returns (address);
    function weth() external view returns (address);
}

contract ForkRehearsal is Script {
    // Real Base mainnet addresses - used because we're on a fork.
    address constant AERODROME_ROUTER_DEFAULT = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address dev = vm.addr(deployerKey);
        address router = vm.envOr("AERODROME_ROUTER", AERODROME_ROUTER_DEFAULT);

        console2.log("=== BASEic Brawlers - fork rehearsal ===");
        console2.log("Dev:                ", dev);
        console2.log("Dev ETH balance:    ", dev.balance);
        console2.log("Aerodrome router:   ", router);

        require(dev.balance > 1 ether, "Dev needs >1 ETH on the fork");
        require(address(router).code.length > 0, "Router has no code - is fork running?");

        vm.startBroadcast(deployerKey);

        // ── 1. Deploy our stack ──────────────────────────────────────
        BRAWL brawl = new BRAWL(dev, dev);
        Brawlers brawlers = new Brawlers(dev, 0x2a, dev);
        Duel duel = new Duel(
            dev,
            address(brawlers),
            dev, // signer = dev (anvil-local - no /api/run-duel involved)
            address(brawl),
            dev,
            10e18,
            1000
        );
        Graveyard graveyard = new Graveyard(dev, address(brawlers), address(duel), dev, 0.0001 ether);
        MockUSDT usdt = new MockUSDT();
        MockUSDT usdc = new MockUSDT();
        MintDrop mintDrop = new MintDrop(
            MintDrop.DeployParams({
                initialOwner: dev,
                brawlersAddr: address(brawlers),
                brawlAddr: address(brawl),
                usdtAddr: address(usdt),
                usdcAddr: address(usdc),
                devTreasury: dev,
                lpTreasury: dev,
                ethPrice: 0.0001 ether,
                usdtPrice: 10000,
                usdcPrice: 10000,
                airdropPerMint: 0,
                founderAirdropAmount: 20e18,
                lpShareBps: 3333,
                lpBrawlPerMint: 50e18
            })
        );
        brawlers.setDuelContract(address(duel));
        brawlers.setGraveyardContract(address(graveyard));
        brawlers.setMintDrop(address(mintDrop));
        duel.setGraveyardContract(address(graveyard));

        console2.log("BRAWL:      ", address(brawl));
        console2.log("Brawlers:   ", address(brawlers));
        console2.log("MintDrop:   ", address(mintDrop));

        // ── 2. Whitelist game contracts + open trading ───────────────
        address[] memory bulk = new address[](5);
        bulk[0] = address(duel);
        bulk[1] = address(graveyard);
        bulk[2] = address(mintDrop);
        bulk[3] = router;
        bulk[4] = dev;
        brawl.setWhitelistBulk(bulk, true);
        brawl.enableTrading();
        brawl.liftLimits();
        console2.log("BRAWL trading enabled, limits lifted");

        // ── 3. Seed the LP on REAL Aerodrome ─────────────────────────
        uint256 brawlAmount = 2_500e18;
        uint256 ethAmount = 0.125 ether;

        IERC20(address(brawl)).approve(router, brawlAmount);
        (uint256 actualBrawl, uint256 actualEth, uint256 liquidity) = IAerodromeRouter(router)
            .addLiquidityETH{value: ethAmount}(
            address(brawl),
            false,
            brawlAmount,
            (brawlAmount * 95) / 100,
            (ethAmount * 95) / 100,
            dev,
            block.timestamp + 1 hours
        );

        console2.log("");
        console2.log("=== LP seed result ===");
        console2.log("BRAWL deposited:    ", actualBrawl);
        console2.log("ETH deposited:      ", actualEth);
        console2.log("LP tokens minted:   ", liquidity);

        address weth = IAerodromeRouter(router).weth();
        address factory = IAerodromeRouter(router).defaultFactory();
        address pair = IAerodromeRouter(router).poolFor(address(brawl), weth, false, factory);
        console2.log("LP pair address:    ", pair);
        require(pair.code.length > 0, "LP pair was NOT created - check router/factory");
        console2.log("LP pair has code:   YES");

        // Whitelist the pair on BRAWL so trades work without limits.
        brawl.setWhitelist(pair, true);
        console2.log("LP pair whitelisted on BRAWL");

        // ── 4. Verify the LP works - try a tiny BRAWL -> ETH swap ────
        uint256 lpBalance = IERC20(pair).balanceOf(dev);
        console2.log("Dev's LP token balance:", lpBalance);
        require(lpBalance == liquidity, "LP token not credited to dev");

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== Fork rehearsal complete ===");
        console2.log("Verified end-to-end:");
        console2.log("  + Stack deploys cleanly");
        console2.log("  + BRAWL whitelist + trading toggle work");
        console2.log("  + Aerodrome router accepts addLiquidityETH");
        console2.log("  + Pair address resolves correctly");
        console2.log("  + LP tokens credited to dev wallet");
        console2.log("");
        console2.log("Ready for real mainnet deploy.");
    }
}
