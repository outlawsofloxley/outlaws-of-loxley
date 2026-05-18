// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title BRAWLTimelock
 * @notice Non-revocable, beneficiary-immutable vesting lock for an ERC-20.
 *
 * @dev Designed for the BASEic Brawlers team token lock. Every parameter
 *      (token, beneficiary, start, cliff, duration) is `immutable` — there
 *      is no owner, no admin function, no escape hatch. Tokens vest
 *      linearly from `startTimestamp` over `durationSeconds`. Anyone can
 *      call `release()` (it's permissionless) which forwards the currently-
 *      vested amount to the immutable beneficiary address.
 *
 *      Marketing claim that survives Token Sniffer / GoPlus audits:
 *        "ownership: none. beneficiary: immutable. schedule: hardcoded.
 *         no admin function exists in bytecode."
 *
 *      Total allocation is computed live as
 *        currentAllocation = balanceOf(this) + totalReleased
 *      so the lock works correctly even if more tokens are added later
 *      (they just join the existing schedule, identical to how OZ's
 *      VestingWallet handles top-ups). No setter required.
 *
 * @custom:website   https://baseicbrawlers.com
 * @custom:audit     OZ VestingWallet was used as a reference but ownership
 *                   was removed; only the linear vesting math + cliff gate
 *                   logic carry over.
 */
contract BRAWLTimelock {
    IERC20 public immutable token;
    address public immutable beneficiary;
    uint64 public immutable startTimestamp;
    uint64 public immutable cliffSeconds;    // 0 = vest from t=start
    uint64 public immutable durationSeconds; // total vest length

    uint256 public totalReleased;

    event Released(uint256 amount);

    error ZeroAddress();
    error InvalidDuration();
    error CliffGreaterThanDuration();
    error NothingToRelease();
    error TransferFailed();

    constructor(
        address _token,
        address _beneficiary,
        uint64 _startTimestamp,
        uint64 _cliffSeconds,
        uint64 _durationSeconds
    ) {
        if (_token == address(0) || _beneficiary == address(0)) revert ZeroAddress();
        if (_durationSeconds == 0) revert InvalidDuration();
        if (_cliffSeconds > _durationSeconds) revert CliffGreaterThanDuration();

        token = IERC20(_token);
        beneficiary = _beneficiary;
        startTimestamp = _startTimestamp;
        cliffSeconds = _cliffSeconds;
        durationSeconds = _durationSeconds;
    }

    /// @notice Pull the currently-releasable amount + forward to beneficiary.
    ///         Permissionless — anyone can poke this, helps if the
    ///         beneficiary forgets to claim.
    function release() external {
        uint256 amount = releasable();
        if (amount == 0) revert NothingToRelease();
        totalReleased += amount;
        bool ok = token.transfer(beneficiary, amount);
        if (!ok) revert TransferFailed();
        emit Released(amount);
    }

    /// @notice Total tokens vested at the current block timestamp,
    ///         including any already released.
    function vestedAmount() public view returns (uint256) {
        return _vestedAt(uint64(block.timestamp));
    }

    /// @notice Tokens that can be released right now (vested minus already-released).
    function releasable() public view returns (uint256) {
        uint64 cliff = startTimestamp + cliffSeconds;
        if (block.timestamp < cliff) return 0;
        uint256 v = vestedAmount();
        if (v <= totalReleased) return 0;
        return v - totalReleased;
    }

    /// @notice Current allocation = locked balance + already-released.
    ///         If new tokens are sent in after deploy, they automatically
    ///         join the schedule.
    function currentAllocation() public view returns (uint256) {
        return token.balanceOf(address(this)) + totalReleased;
    }

    /// @notice Timestamp when vesting is 100% complete.
    function endTimestamp() public view returns (uint64) {
        return startTimestamp + durationSeconds;
    }

    /// @notice Fraction of vesting complete, expressed in basis points
    ///         (10000 = 100%). Cliff returns 0 until passed.
    function progressBps() public view returns (uint16) {
        uint64 ts = uint64(block.timestamp);
        if (ts < startTimestamp + cliffSeconds) return 0;
        uint64 end = startTimestamp + durationSeconds;
        if (ts >= end) return 10000;
        return uint16(((ts - startTimestamp) * 10000) / durationSeconds);
    }

    function _vestedAt(uint64 ts) internal view returns (uint256) {
        uint64 cliff = startTimestamp + cliffSeconds;
        uint64 end = startTimestamp + durationSeconds;
        uint256 alloc = currentAllocation();
        if (ts < cliff) return 0;
        if (ts >= end) return alloc;
        return (alloc * (ts - startTimestamp)) / durationSeconds;
    }
}
