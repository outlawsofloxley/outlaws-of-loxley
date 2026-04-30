// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Duel} from "../contracts/Duel.sol";
import {Brawlers} from "../contracts/Brawlers.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * Submit a real signed duel between tokens 8 and 9 on Base Sepolia.
 * Uses the env signer key to produce the same signature shape that the
 * production /api/run-duel endpoint produces. Verifies the on-chain Duel
 * contract accepts it, ELO updates, BRAWL pot is paid out.
 */
contract E2EDuel is Script {
    using MessageHashUtils for bytes32;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        uint256 signerKey = vm.envUint("SIGNER_KEY_RAW");
        address duel = vm.envAddress("DUEL_ADDRESS");
        address brawl = vm.envAddress("BRAWL_ADDRESS");
        address brawlers = vm.envAddress("BRAWLERS_ADDRESS");
        uint256 tokenA = vm.envUint("TOKEN_A");
        uint256 tokenB = vm.envUint("TOKEN_B");
        uint256 nonce = vm.envOr("NONCE", uint256(block.timestamp));

        Duel d = Duel(duel);

        Duel.DuelResult memory r = Duel.DuelResult({
            tokenA: tokenA,
            tokenB: tokenB,
            winnerId: uint32(tokenA), // A wins
            rounds: 3,
            seed: 0xdeadbeef,
            newEloA: 1015,
            newEloB: 985,
            nonce: nonce,
            expiry: block.timestamp + 1 hours
        });

        bytes32 hash = d.hashDuelResult(r);
        bytes32 ethSigned = hash.toEthSignedMessageHash();
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(signerKey, ethSigned);
        bytes memory sig = abi.encodePacked(rs, ss, v);

        console2.log("Submitting duel: A wins", tokenA, "vs B", tokenB);
        console2.log("Nonce:", nonce);
        console2.log("Sig length:", sig.length);

        // Read state before
        Brawlers br = Brawlers(brawlers);
        address ownerA = br.ownerOf(tokenA);
        address ownerB = br.ownerOf(tokenB);
        uint256 balABefore = IERC20(brawl).balanceOf(ownerA);
        uint256 balBBefore = IERC20(brawl).balanceOf(ownerB);
        console2.log("Owner A:", ownerA);
        console2.log("Owner B:", ownerB);
        console2.log("BRAWL bal A before:", balABefore);
        console2.log("BRAWL bal B before:", balBBefore);

        vm.startBroadcast(deployerKey);
        d.submitDuel(r, sig);
        vm.stopBroadcast();

        uint256 balAAfter = IERC20(brawl).balanceOf(ownerA);
        uint256 balBAfter = IERC20(brawl).balanceOf(ownerB);
        console2.log("BRAWL bal A after:", balAAfter, "(delta:", balAAfter > balABefore ? balAAfter - balABefore : balABefore - balAAfter);
        console2.log("BRAWL bal B after:", balBAfter, "(delta:", balBAfter > balBBefore ? balBAfter - balBBefore : balBBefore - balBAfter);
        console2.log("New ELO A:", br.getBrawler(tokenA).elo);
        console2.log("New ELO B:", br.getBrawler(tokenB).elo);
        console2.log("Wins A:", br.getBrawler(tokenA).wins);
        console2.log("Losses B:", br.getBrawler(tokenB).losses);
    }
}
