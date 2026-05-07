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
 * @title Phase7Test
 * @notice Covers the new Phase 7 tokenomics surface: MAX_SUPPLY, rarity
 *         shuffle, MintDrop ETH/USDT paths, BRAWL airdrop on mint, and the
 *         Duel stake/payout flow (fights cost 100 BRAWL, winner gets 90%,
 *         dev gets 10%).
 */
contract Phase7Test is Test {

    Brawlers internal brawlers;
    Duel internal duel;
    Graveyard internal graveyard;
    BRAWL internal brawl;
    MintDrop internal mintDrop;
    MockUSDT internal usdt;
    MockUSDT internal usdc; // Same 6-decimal mock surface for tests

    address internal owner;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal devTreasury = address(0xDE7);
    address internal mintTreasury = address(0x717A);
    address internal reserve = address(0xC0E);

    uint256 internal signerPk = 0xBEEF;
    address internal signerAddr;

    uint256 internal constant SEED = 0x2a;
    uint256 internal constant FIGHT_COST = 100e18;
    uint16 internal constant DEV_BPS = 1000;
    uint256 internal constant ETH_PRICE = 0.015 ether;
    uint256 internal constant USDT_PRICE = 40_000_000; // 40 USDT, 6 decimals
    uint256 internal constant USDC_PRICE = 40_000_000; // 40 USDC, 6 decimals
    uint256 internal constant AIRDROP = 50e18;
    uint256 internal constant AIRDROP_POOL = 25_000e18;

    function setUp() public {
        owner = address(this);
        signerAddr = vm.addr(signerPk);

        // BRAWL v2, initialHolder + initialOwner. Owner enables trading
        // and whitelists game contracts so test transfers don't hit
        // anti-sniper limits.
        brawl = new BRAWL(owner, owner);
        brawlers = new Brawlers(owner, SEED, address(0));
        duel = new Duel(
            owner,
            address(brawlers),
            signerAddr,
            address(brawl),
            devTreasury,
            FIGHT_COST,
            DEV_BPS
        );
        graveyard = new Graveyard(
            owner, address(brawlers), address(duel), devTreasury, 0.01 ether
        );
        usdt = new MockUSDT();
        usdc = new MockUSDT();
        mintDrop = new MintDrop(
            MintDrop.DeployParams({
                initialOwner: owner,
                brawlersAddr: address(brawlers),
                brawlAddr: address(brawl),
                usdtAddr: address(usdt),
                usdcAddr: address(usdc),
                devTreasury: mintTreasury,
                lpTreasury: address(0xDEADBEEF),
                ethPrice: ETH_PRICE,
                usdtPrice: USDT_PRICE,
                usdcPrice: USDC_PRICE,
                airdropPerMint: AIRDROP,
                founderAirdropAmount: 0, // off in baseline tests
                lpShareBps: 0, // all to dev treasury so existing assertions pass
                lpBrawlPerMint: 0           // off
            })
        );

        brawlers.setDuelContract(address(duel));
        brawlers.setGraveyardContract(address(graveyard));
        brawlers.setMintDrop(address(mintDrop));
        duel.setGraveyardContract(address(graveyard));

        // Whitelist + open trading for tests (so alice/bob can transfer freely).
        address[] memory wl = new address[](6);
        wl[0] = address(duel);
        wl[1] = address(graveyard);
        wl[2] = address(mintDrop);
        wl[3] = mintTreasury;
        wl[4] = alice;
        wl[5] = bob;
        brawl.setWhitelistBulk(wl, true);
        brawl.enableTrading();
        brawl.liftLimits();

        // Seed MintDrop's airdrop pool.
        brawl.transfer(address(mintDrop), AIRDROP_POOL);

        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    // ─── BRAWL token ────────────────────────────────────────────────

    function test_brawl_fixedSupply_mintedToHolder() public view {
        assertEq(brawl.totalSupply(), 100_000e18, "supply");
        // Test contract is the initial holder in setUp. After seeding MintDrop,
        // the test contract retains 100k - 25k = 75k.
        assertEq(brawl.balanceOf(owner), 75_000e18, "holder bal");
        assertEq(brawl.balanceOf(address(mintDrop)), AIRDROP_POOL, "mintdrop bal");
    }

    function test_brawl_metadata() public view {
        assertEq(brawl.name(), "Brawl Token");
        assertEq(brawl.symbol(), "BRAWL");
        assertEq(brawl.decimals(), 18);
    }

    function test_brawl_rejectsZeroHolder() public {
        vm.expectRevert(BRAWL.ZeroInitialHolder.selector);
        new BRAWL(address(0), owner);
    }

    // Zero-owner case is rejected by OZ Ownable's own constructor, no
    // additional test needed.

    // ─── Brawlers: supply cap + mint auth ───────────────────────────

    function test_brawlers_maxSupply_enforced() public {
        for (uint256 i = 0; i < 2000; i++) {
            brawlers.mint(alice);
        }
        assertEq(brawlers.nextTokenId(), 2001);
        vm.expectRevert(Brawlers.SupplyExhausted.selector);
        brawlers.mint(alice);
    }

    function test_brawlers_mint_requiresOwnerOrMintDrop() public {
        vm.prank(alice);
        vm.expectRevert(Brawlers.NotMintDropOrOwner.selector);
        brawlers.mint(alice);

        // MintDrop can call it (via its own mint paths, simulated here with
        // a direct prank from mintDrop's address).
        vm.prank(address(mintDrop));
        uint256 id = brawlers.mint(alice);
        assertEq(id, 1);
        assertEq(brawlers.ownerOf(id), alice);
    }

    // ─── Rarity distribution ────────────────────────────────────────

    function test_rarity_distributionCountsMatchDesign() public view {
        uint256[5] memory counts;
        for (uint256 id = 1; id <= 2000; id++) {
            uint8 tier = brawlers.rarityOf(id);
            assertLt(tier, 5, "tier out of range");
            counts[tier]++;
        }
        // Must match the TIER_* constants in Brawlers.sol (scaled to 2000).
        assertEq(counts[0], 1240, "common count");
        assertEq(counts[1], 500, "uncommon count");
        assertEq(counts[2], 200, "rare count");
        assertEq(counts[3], 40, "legendary count (internal tier 3)");
        assertEq(counts[4], 20, "epic count (internal tier 4)");
    }

    function test_rarity_outOfRange_reverts() public {
        // 0 is below range; 2002 is above (2001 is the King token, valid).
        vm.expectRevert(abi.encodeWithSelector(Brawlers.InvalidTokenId.selector, 0));
        brawlers.rarityOf(0);
        vm.expectRevert(abi.encodeWithSelector(Brawlers.InvalidTokenId.selector, 2002));
        brawlers.rarityOf(2002);
    }

    function test_rarity_king_is_tier_5() public view {
        assertEq(brawlers.rarityOf(2001), 5);
    }

    function test_rarity_mintedBrawlerWeaponMatchesTier() public {
        // Mint a handful and verify each brawler's weapon falls in the expected
        // tier's weapon range.
        for (uint256 id = 1; id <= 20; id++) {
            vm.prank(address(mintDrop));
            brawlers.mint(alice);
            uint8 tier = brawlers.rarityOf(id);
            uint8 weaponId = brawlers.getBrawler(id).weaponId;
            (uint8 start, uint8 count) = _tierRange(tier);
            assertGe(weaponId, start, "weapon below tier");
            assertLt(weaponId, start + count, "weapon above tier");
        }
    }

    function _tierRange(uint8 tier) internal pure returns (uint8 start, uint8 count) {
        if (tier == 0) return (0, 3);
        if (tier == 1) return (3, 2);
        if (tier == 2) return (5, 2);
        if (tier == 3) return (7, 2);
        if (tier == 4) return (9, 2);
        revert("bad tier");
    }

    // ─── Rarity freeze + commitment ─────────────────────────────────

    function test_rarity_initialHash_setAtConstruction() public view {
        // Hash is captured before any mint happens; equals current hash
        // since no dev-skip swap has fired yet.
        bytes32 initial = brawlers.initialRarityHash();
        assertTrue(initial != bytes32(0), "initial hash unset");
        assertEq(brawlers.rarityHash(), initial, "drift before any mint");
    }

    function test_rarity_initialHash_isDeterministicFromSeed() public {
        // Two contracts with the same seed must produce the same hash.
        Brawlers a = new Brawlers(owner, SEED, address(0));
        Brawlers b = new Brawlers(owner, SEED, address(0));
        assertEq(a.initialRarityHash(), b.initialRarityHash(), "seed determinism broken");
        // A different seed must produce a different hash.
        Brawlers c = new Brawlers(owner, SEED + 1, address(0));
        assertTrue(a.initialRarityHash() != c.initialRarityHash(), "seed unused in shuffle");
    }

    function test_freezeRarity_disablesDevSkip() public {
        // Spin up a fresh Brawlers with a real devWallet so _skipRareForDev
        // is actually engaged.
        address dev = address(0xDE7);
        Brawlers b = new Brawlers(owner, SEED, dev);
        bytes32 baseline = b.rarityHash();
        b.freezeRarity();
        assertTrue(b.rarityFrozen(), "freeze flag not set");
        // Mint a few directly to dev wallet via owner path. With the freeze
        // on, _skipRareForDev short-circuits and the rarity table is stable.
        for (uint256 i = 0; i < 10; i++) {
            b.mint(dev);
        }
        assertEq(b.rarityHash(), baseline, "frozen table mutated by dev mint");
    }

    function test_freezeRarity_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        brawlers.freezeRarity();
    }

    function test_freezeRarity_idempotent() public {
        brawlers.freezeRarity();
        // Second call is a no-op; must not revert.
        brawlers.freezeRarity();
        assertTrue(brawlers.rarityFrozen());
    }

    // ─── MintDrop: ETH path ─────────────────────────────────────────

    function test_mintDrop_mintWithETH_transfersFeeAndAirdrop() public {
        uint256 treasuryBefore = mintTreasury.balance;
        vm.prank(alice);
        uint256 id = mintDrop.mintWithETH{value: ETH_PRICE}(alice);

        assertEq(id, 1);
        assertEq(brawlers.ownerOf(id), alice);
        assertEq(brawl.balanceOf(alice), AIRDROP, "airdrop");
        assertEq(mintTreasury.balance, treasuryBefore + ETH_PRICE, "treasury got eth");
        assertEq(mintDrop.totalSold(), 1);
    }

    function test_mintDrop_mintWithETH_wrongAmount_reverts() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MintDrop.IncorrectETH.selector, ETH_PRICE, ETH_PRICE - 1)
        );
        mintDrop.mintWithETH{value: ETH_PRICE - 1}(alice);
    }

    function test_mintDrop_supplyExhausted_reverts() public {
        // Mint 2000 through MintDrop (cap matches Brawlers MAX_SUPPLY)
        vm.deal(alice, 100 ether);
        vm.startPrank(alice);
        for (uint256 i = 0; i < 2000; i++) {
            mintDrop.mintWithETH{value: ETH_PRICE}(alice);
        }
        vm.expectRevert(MintDrop.SupplyExhausted.selector);
        mintDrop.mintWithETH{value: ETH_PRICE}(alice);
        vm.stopPrank();
    }

    // ─── MintDrop: USDT path ────────────────────────────────────────

    function test_mintDrop_mintWithUSDT_happyPath() public {
        // Fund Alice with USDT and approve MintDrop.
        usdt.mint(alice, USDT_PRICE);
        vm.prank(alice);
        usdt.approve(address(mintDrop), USDT_PRICE);

        uint256 treasuryBefore = usdt.balanceOf(mintTreasury);
        vm.prank(alice);
        uint256 id = mintDrop.mintWithUSDT(alice);

        assertEq(id, 1);
        assertEq(brawlers.ownerOf(id), alice);
        assertEq(brawl.balanceOf(alice), AIRDROP);
        assertEq(usdt.balanceOf(mintTreasury), treasuryBefore + USDT_PRICE);
    }

    // ─── Duel: fee flow ─────────────────────────────────────────────

    function test_duel_winnerTakes180_devTakes20() public {
        (uint256 idA, uint256 idB) = _mintAndFundForDuel();

        uint256 aliceBefore = brawl.balanceOf(alice);
        uint256 bobBefore = brawl.balanceOf(bob);
        uint256 devBefore = brawl.balanceOf(devTreasury);

        _submitSignedDuel(idA, idB, uint32(idA), 1);

        // alice wins: -100 stake +180 payout = +80; bob: -100; dev: +20.
        assertEq(brawl.balanceOf(alice), aliceBefore + 80e18, "alice +80");
        assertEq(brawl.balanceOf(bob), bobBefore - FIGHT_COST, "bob -100");
        assertEq(brawl.balanceOf(devTreasury), devBefore + 20e18, "dev +20");
    }

    function test_duel_tie_splits90_90_20() public {
        (uint256 idA, uint256 idB) = _mintAndFundForDuel();

        uint256 aliceBefore = brawl.balanceOf(alice);
        uint256 bobBefore = brawl.balanceOf(bob);
        uint256 devBefore = brawl.balanceOf(devTreasury);

        _submitSignedDuel(idA, idB, 0 /* tie */, 2);

        // Tie: each gets 90, dev gets 20. Net: each -10, dev +20.
        assertEq(brawl.balanceOf(alice), aliceBefore - 10e18, "alice -10");
        assertEq(brawl.balanceOf(bob), bobBefore - 10e18, "bob -10");
        assertEq(brawl.balanceOf(devTreasury), devBefore + 20e18, "dev +20");
    }

    function test_duel_unapprovedPlayer_reverts() public {
        (uint256 idA, uint256 idB) = _mintTwoForDuel();
        // Fund only alice; don't approve bob.
        brawl.transfer(alice, FIGHT_COST * 5);
        brawl.transfer(bob, FIGHT_COST * 5);
        vm.prank(alice);
        brawl.approve(address(duel), type(uint256).max);
        // Bob skips approve.

        Duel.DuelResult memory r = _buildResult(idA, idB, uint32(idA), 99);
        bytes memory sig = _sign(r);

        vm.expectRevert(); // SafeERC20 insufficient allowance
        vm.prank(alice);
        duel.submitDuel(r, sig);
    }

    // ─── Helpers ────────────────────────────────────────────────────

    /// @dev Mint two brawlers via MintDrop; fund + approve both for fight fees.
    function _mintAndFundForDuel() internal returns (uint256 idA, uint256 idB) {
        (idA, idB) = _mintTwoForDuel();
        brawl.transfer(alice, FIGHT_COST * 5);
        brawl.transfer(bob, FIGHT_COST * 5);
        vm.prank(alice);
        brawl.approve(address(duel), type(uint256).max);
        vm.prank(bob);
        brawl.approve(address(duel), type(uint256).max);
    }

    function _mintTwoForDuel() internal returns (uint256 idA, uint256 idB) {
        // Skip past the founder window (tokenId 1..100 get 50% fight
        // discount in Duel v2). Tests below assume FULL fightCost on both
        // sides. Founder-discount behavior gets its own targeted tests.
        // Use an EOA recipient so _safeMint's onERC721Received check passes.
        address sink = address(0xBEEF1);
        for (uint256 i = 0; i < 100; i++) {
            brawlers.mint(sink);
        }
        vm.prank(alice);
        idA = mintDrop.mintWithETH{value: ETH_PRICE}(alice);
        vm.prank(bob);
        idB = mintDrop.mintWithETH{value: ETH_PRICE}(bob);
    }

    function _submitSignedDuel(uint256 idA, uint256 idB, uint32 winnerId, uint256 nonce)
        internal
    {
        Duel.DuelResult memory r = _buildResult(idA, idB, winnerId, nonce);
        bytes memory sig = _sign(r);
        vm.prank(alice);
        duel.submitDuel(r, sig);
    }

    function _buildResult(uint256 idA, uint256 idB, uint32 winnerId, uint256 nonce)
        internal
        view
        returns (Duel.DuelResult memory)
    {
        return Duel.DuelResult({
            tokenA: idA,
            tokenB: idB,
            winnerId: winnerId,
            rounds: 5,
            seed: 0xDEADBEEF,
            newEloA: 1020,
            newEloB: 980,
            nonce: nonce,
            expiry: block.timestamp + 1 hours
        });
    }

    function _sign(Duel.DuelResult memory r) internal view returns (bytes memory) {
        // EIP-712: digest is already domain-separated, sign directly.
        bytes32 digest = duel.hashDuelResult(r);
        (uint8 v, bytes32 rs, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(rs, s, v);
    }
}
