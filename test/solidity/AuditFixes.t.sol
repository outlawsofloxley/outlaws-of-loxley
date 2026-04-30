// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Brawlers} from "../../contracts/Brawlers.sol";
import {Duel} from "../../contracts/Duel.sol";
import {Graveyard} from "../../contracts/Graveyard.sol";
import {BRAWL} from "../../contracts/BRAWL.sol";
import {MintDrop} from "../../contracts/MintDrop.sol";
import {MockUSDT} from "../../contracts/mocks/MockUSDT.sol";

/**
 * @title AuditFixes
 * @notice Regression tests for the 2026-04-30 mainnet-readiness audit fixes:
 *         - H-1: Duel signatures are EIP-712, domain-separated by chainid
 *         - H-2: setPriceTiers requires the final tier to cover MAX_MINT
 *         - M-1: Brawlers contract pointers are one-time-set
 *         - M-4: Graveyard refunds resurrection overpayment
 *         - M-6: cost/airdrop setters are capped
 */
contract AuditFixesTest is Test {
    Brawlers internal brawlers;
    Duel internal duel;
    Graveyard internal graveyard;
    BRAWL internal brawl;
    MintDrop internal mintDrop;
    MockUSDT internal usdt;
    MockUSDT internal usdc;

    address internal owner;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal treasury = address(0x717A);

    uint256 internal signerPk = 0xBEEF;
    address internal signerAddr;

    function setUp() public {
        owner = address(this);
        signerAddr = vm.addr(signerPk);
        brawl = new BRAWL(owner, owner);
        usdt = new MockUSDT();
        usdc = new MockUSDT();
        brawlers = new Brawlers(owner, 0x42, address(0));
        duel = new Duel(owner, address(brawlers), signerAddr, address(brawl), treasury, 0, 0);
        graveyard = new Graveyard(owner, address(brawlers), address(duel), treasury, 0.01 ether);

        brawlers.setDuelContract(address(duel));
        brawlers.setGraveyardContract(address(graveyard));
        duel.setGraveyardContract(address(graveyard));

        MintDrop.DeployParams memory p = MintDrop.DeployParams({
            initialOwner: owner,
            brawlersAddr: address(brawlers),
            brawlAddr: address(brawl),
            usdtAddr: address(usdt),
            usdcAddr: address(usdc),
            devTreasury: treasury,
            lpTreasury: treasury,
            ethPrice: 0.015 ether,
            usdtPrice: 40_000_000,
            usdcPrice: 40_000_000,
            airdropPerMint: 0,
            founderAirdropAmount: 20e18,
            lpShareBps: 3333,
            lpBrawlPerMint: 50e18
        });
        mintDrop = new MintDrop(p);
        brawlers.setMintDrop(address(mintDrop));
    }

    // ─── M-1: one-time-set ───────────────────────────────────────────

    function test_M1_setDuelContract_secondCall_reverts() public {
        // First call already happened in setUp(). A second call must revert.
        vm.expectRevert(Brawlers.AlreadySet.selector);
        brawlers.setDuelContract(address(0xDEAD));
    }

    function test_M1_setGraveyardContract_secondCall_reverts() public {
        vm.expectRevert(Brawlers.AlreadySet.selector);
        brawlers.setGraveyardContract(address(0xDEAD));
    }

    function test_M1_setMintDrop_secondCall_reverts() public {
        vm.expectRevert(Brawlers.AlreadySet.selector);
        brawlers.setMintDrop(address(0xDEAD));
    }

    function test_M1_setDuelContract_zeroAddress_reverts() public {
        Brawlers fresh = new Brawlers(owner, 0x42, address(0));
        vm.expectRevert(Brawlers.ZeroAddress.selector);
        fresh.setDuelContract(address(0));
    }

    // ─── H-2: tier coverage ─────────────────────────────────────────

    function test_H2_setPriceTiers_finalTierShortOfMax_reverts() public {
        MintDrop.PriceTier[] memory tiers = new MintDrop.PriceTier[](2);
        tiers[0] = MintDrop.PriceTier({
            upToSold: 100,
            ethPrice: 0,
            usdcPrice: 0,
            usdtPrice: 0
        });
        // Final tier stops at 1500, not MAX_MINT (2000). Must revert so a
        // typo cannot leave mints 1501-2000 falling back to flat ethPrice.
        tiers[1] = MintDrop.PriceTier({
            upToSold: 1500,
            ethPrice: 0.015 ether,
            usdcPrice: 60_000_000,
            usdtPrice: 60_000_000
        });
        vm.expectRevert(MintDrop.InvalidTiers.selector);
        mintDrop.setPriceTiers(tiers);
    }

    function test_H2_setPriceTiers_finalTierAtMax_succeeds() public {
        MintDrop.PriceTier[] memory tiers = new MintDrop.PriceTier[](1);
        tiers[0] = MintDrop.PriceTier({
            upToSold: 2000,
            ethPrice: 0.015 ether,
            usdcPrice: 60_000_000,
            usdtPrice: 60_000_000
        });
        mintDrop.setPriceTiers(tiers);
        assertEq(mintDrop.priceTierCount(), 1);
    }

    function test_H2_setPriceTiers_emptyArray_disablesTiering() public {
        MintDrop.PriceTier[] memory tiers = new MintDrop.PriceTier[](0);
        mintDrop.setPriceTiers(tiers);
        assertEq(mintDrop.priceTierCount(), 0);
    }

    // ─── M-4: Graveyard refund ──────────────────────────────────────

    function test_M4_resurrect_overpay_refundsExcess() public {
        // Mint a non-founder brawler so resurrect costs > 0
        brawlers.mint(alice); // tokenId 1, founder
        uint256 idA;
        for (uint256 i = 0; i < 100; i++) {
            idA = brawlers.mint(alice); // skip past founder range
        }
        uint256 idB = brawlers.mint(bob);

        // Kill idA via 3 losing duels through the real Duel pipeline.
        for (uint256 n = 1; n <= 3; n++) {
            Duel.DuelResult memory r = Duel.DuelResult({
                tokenA: idA,
                tokenB: idB,
                winnerId: uint32(idB),
                rounds: 3,
                seed: 0xDEAD + n,
                newEloA: 990,
                newEloB: 1010,
                nonce: 100 + n,
                expiry: block.timestamp + 1 hours
            });
            bytes32 digest = duel.hashDuelResult(r);
            (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(signerPk, digest);
            bytes memory sig = abi.encodePacked(rs, ss, v);
            vm.prank(alice);
            duel.submitDuel(r, sig);
        }
        assertFalse(brawlers.isAlive(idA), "idA must be dead");

        uint256 required = graveyard.costFor(idA);
        require(required > 0, "test setup: required must be > 0");
        uint256 overpay = required * 3;
        vm.deal(alice, overpay);
        uint256 treasuryBefore = treasury.balance;

        vm.prank(alice);
        graveyard.resurrect{value: overpay}(idA);

        // Treasury gets exactly `required`, not the full overpay.
        assertEq(treasury.balance, treasuryBefore + required, "treasury overpaid");
        // Alice gets the change back.
        assertEq(alice.balance, overpay - required, "alice not refunded");
    }

    // ─── M-6: setter caps ───────────────────────────────────────────

    function test_M6_setResurrectionCost_aboveCap_reverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                Graveyard.CostTooHigh.selector,
                2 ether,
                graveyard.MAX_RESURRECTION_COST()
            )
        );
        graveyard.setResurrectionCost(2 ether);
    }

    function test_M6_setTierMults_aboveCap_reverts() public {
        uint256[6] memory mults = [uint256(10), 15, 25, 40, 70, 9999];
        vm.expectRevert(
            abi.encodeWithSelector(
                Graveyard.TierMultTooHigh.selector,
                uint8(5),
                uint256(9999),
                graveyard.MAX_TIER_MULT()
            )
        );
        graveyard.setTierMults(mults);
    }

    function test_M6_setFightCost_aboveCap_reverts() public {
        uint256 absurd = 1_000_000 * 10 ** 18;
        vm.expectRevert(
            abi.encodeWithSelector(Duel.FightCostTooHigh.selector, absurd)
        );
        duel.setFightEconomics(absurd, 1000, treasury);
    }

    function test_M6_setPrices_aboveCap_reverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                MintDrop.PriceTooHigh.selector,
                2 ether,
                mintDrop.MAX_ETH_PRICE()
            )
        );
        mintDrop.setPrices(2 ether, 40_000_000, 40_000_000);
    }

    function test_M6_setAirdropPerMint_aboveCap_reverts() public {
        uint256 absurd = 10_000 * 10 ** 18;
        vm.expectRevert(
            abi.encodeWithSelector(
                MintDrop.AirdropTooHigh.selector,
                absurd,
                mintDrop.MAX_AIRDROP_PER_MINT()
            )
        );
        mintDrop.setAirdropPerMint(absurd);
    }

    // ─── H-1: EIP-712 cross-chain replay defence ────────────────────

    function test_H1_signature_invalidOnDifferentChain() public {
        brawlers.mint(alice);
        brawlers.mint(bob);
        Duel.DuelResult memory r = Duel.DuelResult({
            tokenA: 1,
            tokenB: 2,
            winnerId: 1,
            rounds: 3,
            seed: 0xCAFE,
            newEloA: 1016,
            newEloB: 984,
            nonce: 999,
            expiry: block.timestamp + 1 hours
        });
        // Sign for the current chain.
        bytes32 digest = duel.hashDuelResult(r);
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(signerPk, digest);
        bytes memory sig = abi.encodePacked(rs, ss, v);

        // Now switch chainid (simulating moving to a different chain) and try
        // to verify. The domain separator changes with chainid, so the
        // signature must no longer recover to the trusted signer.
        vm.chainId(block.chainid + 1);
        vm.prank(alice);
        vm.expectRevert(Duel.InvalidSignature.selector);
        duel.submitDuel(r, sig);
    }

    function test_H1_signature_invalidOnDifferentContract() public {
        brawlers.mint(alice);
        brawlers.mint(bob);
        // Deploy a second Duel at a different address with the same trustedSigner.
        Duel duel2 = new Duel(owner, address(brawlers), signerAddr, address(brawl), treasury, 0, 0);

        Duel.DuelResult memory r = Duel.DuelResult({
            tokenA: 1,
            tokenB: 2,
            winnerId: 1,
            rounds: 3,
            seed: 0xBABE,
            newEloA: 1016,
            newEloB: 984,
            nonce: 1234,
            expiry: block.timestamp + 1 hours
        });

        // Sign for the original duel contract.
        bytes32 digest = duel.hashDuelResult(r);
        (uint8 v, bytes32 rs, bytes32 ss) = vm.sign(signerPk, digest);
        bytes memory sig = abi.encodePacked(rs, ss, v);

        // Replaying on duel2 must fail because verifyingContract differs.
        vm.prank(alice);
        vm.expectRevert(Duel.InvalidSignature.selector);
        duel2.submitDuel(r, sig);
    }

    function test_H1_domainSeparator_isStable() public view {
        bytes32 ds = duel.domainSeparator();
        assertTrue(ds != bytes32(0));
    }
}
