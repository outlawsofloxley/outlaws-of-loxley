// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * SeedLP_UniV3Sepolia - one-tx Uniswap V3 LP seed for the BRAWL/WETH 0.3%
 * pool on Base Sepolia. Uses Uniswap's NonfungiblePositionManager.
 *
 * Public Sepolia LP demo so we can show:
 *   - BRAWL works against a real DEX on a public testnet
 *   - The pool address is verifiable on a block explorer
 *   - Anyone can swap test-ETH for BRAWL via the Uniswap UI on Sepolia
 *
 * Initial price for the demo: 1 WETH = 10000 BRAWL = $0.40/BRAWL at $4k ETH
 * (close enough to the $0.20-$0.40 mainnet target band; clean sqrt for the
 * pool init).
 *
 * Required env: PRIVATE_KEY, BRAWL_ADDRESS
 * Hardcoded Sepolia infra:
 *   NPM      = 0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2
 *   Factory  = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24
 *   WETH9    = 0x4200000000000000000000000000000000000006
 */

interface IWETH9 {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
}

interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function createAndInitializePoolIfNecessary(
        address token0,
        address token1,
        uint24 fee,
        uint160 sqrtPriceX96
    ) external payable returns (address pool);

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

interface IFactory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

contract SeedLP_UniV3Sepolia is Script {
    address constant NPM = 0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2;
    address constant FACTORY = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24;
    address constant WETH9 = 0x4200000000000000000000000000000000000006;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address dev = vm.addr(deployerKey);
        address brawl = vm.envAddress("BRAWL_ADDRESS");

        // Sort tokens for Uniswap V3 (token0 < token1 by address).
        // WETH9 = 0x4200... < BRAWL = 0xFB... -> token0 = WETH9
        (address token0, address token1) =
            WETH9 < brawl ? (WETH9, brawl) : (brawl, WETH9);

        // Initial price: 1 WETH = 10000 BRAWL.
        // sqrtPriceX96 = sqrt(token1/token0) * 2^96
        // If token0=WETH, price = BRAWL/WETH = 10000, sqrt = 100,
        // 100 * 2^96 = 7922816251426433759354395033600
        uint160 sqrtPriceX96 = 7922816251426433759354395033600;

        uint256 wethAmount = 0.001 ether;       // ~$4
        uint256 brawlAmount = 10 * 1e18;        // 10 BRAWL — matches 10000:1

        console2.log("=== Uniswap V3 LP seed (Base Sepolia) ===");
        console2.log("Dev:        ", dev);
        console2.log("BRAWL:      ", brawl);
        console2.log("token0:     ", token0);
        console2.log("token1:     ", token1);
        console2.log("WETH amount:", wethAmount);
        console2.log("BRAWL amount:", brawlAmount);

        require(IERC20(brawl).balanceOf(dev) >= brawlAmount, "Dev short on BRAWL");
        require(dev.balance > wethAmount + 0.001 ether, "Dev needs WETH amount + gas buffer");

        vm.startBroadcast(deployerKey);

        // 1. Wrap ETH -> WETH
        IWETH9(WETH9).deposit{value: wethAmount}();

        // 2. Approve NPM for both tokens
        IERC20(brawl).approve(NPM, brawlAmount);
        IWETH9(WETH9).approve(NPM, wethAmount);

        // 3. Create + initialize the pool (no-op if it already exists)
        address pool = INonfungiblePositionManager(NPM).createAndInitializePoolIfNecessary(
            token0, token1, 3000, sqrtPriceX96
        );
        console2.log("Pool address:", pool);

        // 4. Mint a full-range position
        // tickSpacing for 0.3% fee = 60. Usable ticks rounded:
        //   MIN ~= -887220, MAX ~= 887220 (multiples of 60)
        (uint256 amount0Desired, uint256 amount1Desired) =
            WETH9 < brawl ? (wethAmount, brawlAmount) : (brawlAmount, wethAmount);
        (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1) =
            INonfungiblePositionManager(NPM).mint(
                INonfungiblePositionManager.MintParams({
                    token0: token0,
                    token1: token1,
                    fee: 3000,
                    tickLower: -887220,
                    tickUpper: 887220,
                    amount0Desired: amount0Desired,
                    amount1Desired: amount1Desired,
                    amount0Min: 0,
                    amount1Min: 0,
                    recipient: dev,
                    deadline: block.timestamp + 1 hours
                })
            );

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== LP minted ===");
        console2.log("Position NFT id:    ", tokenId);
        console2.log("Liquidity:          ", uint256(liquidity));
        console2.log("Amount0 used:       ", amount0);
        console2.log("Amount1 used:       ", amount1);
        console2.log("");
        console2.log("Verify on BaseScan:");
        console2.log("  Pool: https://sepolia.basescan.org/address/", pool);
        console2.log("  Position NFT (NPM): https://sepolia.basescan.org/token/0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2");
    }
}
