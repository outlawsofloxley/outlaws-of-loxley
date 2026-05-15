#!/usr/bin/env bash
# BASEic Brawlers mainnet launch sequence.
#
# DO NOT run blind. Walks through LAUNCH_AUTOMATION.md §7 step by step.
# Each step pauses + prints what's about to fire + waits for an explicit
# "go" before broadcasting. Receipts auto-post to X + Telegram between
# steps.
#
# Pre-conditions (all in env / secrets.env):
#   - BB_DEPLOYER_KEY, BB_DEPLOYER_ADDRESS populated
#   - BB_MAINNET_RPC set
#   - .env.base-mainnet fully populated (no <paste-...> placeholders)
#   - Deployer wallet funded: LP-side ETH + UNCX fees (0.15 ETH) + gas reserve
#   - GitHub repo flipped public (so contract NatSpec links resolve)
#
# Usage:
#   bash script/launch-mainnet.sh                  # interactive, full sequence
#   bash script/launch-mainnet.sh --step deploy    # only one step
#   bash script/launch-mainnet.sh --dry-run        # forge --rpc-url only (no broadcast)
#
# Each broadcast step waits for tx confirmation before posting receipts.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────

DRY_RUN=0
ONLY_STEP=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --step) ONLY_STEP="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

confirm() {
  local prompt="$1"
  echo
  echo "═══════════════════════════════════════════════════════════════════"
  echo "  $prompt"
  echo "═══════════════════════════════════════════════════════════════════"
  read -r -p "type 'go' to proceed, anything else to abort: " ans
  [[ "$ans" == "go" ]] || { echo "aborted."; exit 1; }
}

forge_run() {
  # forge script wrapper. honours DRY_RUN.
  local script="$1"; shift
  if [[ $DRY_RUN -eq 1 ]]; then
    forge script "$script" --rpc-url "$BB_MAINNET_RPC" "$@"
  else
    forge script "$script" --rpc-url "$BB_MAINNET_RPC" --broadcast "$@"
  fi
}

post_receipt() {
  # post-receipt R<N> --var KEY=VALUE ...
  # fires both X + TG in parallel.
  local rid="$1"; shift
  echo "[receipts] firing $rid to X + TG"
  ( cd "$ROOT/marketing/scripts/x" && node post-receipt.mjs "$rid" "$@" ) &
  local xpid=$!
  ( cd "$ROOT/marketing/scripts/tg" && node post-receipt.mjs "$rid" "$@" ) &
  local tpid=$!
  wait $xpid || echo "[receipts] X post for $rid failed (non-fatal)"
  wait $tpid || echo "[receipts] TG post for $rid failed (non-fatal)"
}

want_step() {
  [[ -z "$ONLY_STEP" || "$ONLY_STEP" == "$1" ]]
}

# Source env. Uses the unprefixed names in .env.base-mainnet (DEPLOYER_KEY,
# MAINNET_RPC, etc) — no legacy BB_ prefix.
[[ -f "$ROOT/.env.base-mainnet" ]] && set -a && source "$ROOT/.env.base-mainnet" && set +a

# Foundry's vm.envUint reads PRIVATE_KEY, so export it from DEPLOYER_KEY.
# Both 0x-prefixed and non-prefixed values work.
DEPLOYER_KEY="${DEPLOYER_KEY:-${BB_DEPLOYER_KEY:-}}"
[[ -n "$DEPLOYER_KEY" ]] || { echo "DEPLOYER_KEY missing in .env.base-mainnet"; exit 1; }
case "$DEPLOYER_KEY" in
  0x*) export PRIVATE_KEY="$DEPLOYER_KEY" ;;
  *)   export PRIVATE_KEY="0x$DEPLOYER_KEY" ;;
esac

# Alias the RPC url for both naming conventions.
export BB_MAINNET_RPC="${MAINNET_RPC:-${BB_MAINNET_RPC:-https://mainnet.base.org}}"

echo "=== BASEic Brawlers mainnet launch ==="
echo "Dry-run: $DRY_RUN"
[[ -n "$ONLY_STEP" ]] && echo "Step filter: $ONLY_STEP" || echo "Running full sequence"
echo

# ────────────────────────────────────────────────────────────────────
# Step 1: deploy all 6 contracts
# ────────────────────────────────────────────────────────────────────
if want_step deploy; then
  confirm "STEP 1/5: Deploy all 6 contracts via Deploy.s.sol"
  forge_run script/Deploy.s.sol

  # Pull addresses from broadcast/Deploy.s.sol/8453/run-latest.json
  if [[ $DRY_RUN -eq 0 ]]; then
    BROADCAST="broadcast/Deploy.s.sol/8453/run-latest.json"
    BRAWL_ADDRESS=$(jq -r '[.transactions[]|select(.contractName=="BRAWL")][0].contractAddress' "$BROADCAST")
    BRAWLERS_ADDRESS=$(jq -r '[.transactions[]|select(.contractName=="Brawlers")][0].contractAddress' "$BROADCAST")
    DUEL_ADDRESS=$(jq -r '[.transactions[]|select(.contractName=="Duel")][0].contractAddress' "$BROADCAST")
    MINTDROP_ADDRESS=$(jq -r '[.transactions[]|select(.contractName=="MintDrop")][0].contractAddress' "$BROADCAST")
    GRAVEYARD_ADDRESS=$(jq -r '[.transactions[]|select(.contractName=="Graveyard")][0].contractAddress' "$BROADCAST")
    MARKETPLACE_ADDRESS=$(jq -r '[.transactions[]|select(.contractName=="Marketplace")][0].contractAddress' "$BROADCAST")

    echo "BRAWL:       $BRAWL_ADDRESS"
    echo "Brawlers:    $BRAWLERS_ADDRESS"
    echo "Duel:        $DUEL_ADDRESS"
    echo "MintDrop:    $MINTDROP_ADDRESS"
    echo "Graveyard:   $GRAVEYARD_ADDRESS"
    echo "Marketplace: $MARKETPLACE_ADDRESS"

    BRAWL_TX=$(jq -r '[.transactions[]|select(.contractName=="BRAWL")][0].hash' "$BROADCAST")
    BRAWLERS_TX=$(jq -r '[.transactions[]|select(.contractName=="Brawlers")][0].hash' "$BROADCAST")
    post_receipt R1 --var BRAWL_ADDRESS="$BRAWL_ADDRESS" --var TX_HASH="$BRAWL_TX"
    post_receipt R2 --var BRAWLERS_ADDRESS="$BRAWLERS_ADDRESS" --var TX_HASH="$BRAWLERS_TX"
    post_receipt R3 \
      --var DUEL_ADDRESS="$DUEL_ADDRESS" \
      --var MINTDROP_ADDRESS="$MINTDROP_ADDRESS" \
      --var GRAVEYARD_ADDRESS="$GRAVEYARD_ADDRESS" \
      --var MARKETPLACE_ADDRESS="$MARKETPLACE_ADDRESS"

    export BRAWL_ADDRESS BRAWLERS_ADDRESS DUEL_ADDRESS MINTDROP_ADDRESS GRAVEYARD_ADDRESS MARKETPLACE_ADDRESS
  fi
fi

# ────────────────────────────────────────────────────────────────────
# Step 2: seed + lock (or burn) LP on Aerodrome
# ────────────────────────────────────────────────────────────────────
if want_step lp; then
  confirm "STEP 2/5: Seed LP on Aerodrome + lock/burn"
  : "${BRAWL_AMOUNT_WEI:?BRAWL_AMOUNT_WEI must be set (e.g. 30000000000000000000000 for 30k)}"
  : "${ETH_AMOUNT_WEI:?ETH_AMOUNT_WEI must be set (e.g. 500000000000000000 for 0.5 ETH)}"
  : "${AERODROME_ROUTER:=0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43}"

  forge_run script/SeedAndLockLP.s.sol

  if [[ $DRY_RUN -eq 0 ]]; then
    BROADCAST="broadcast/SeedAndLockLP.s.sol/8453/run-latest.json"
    LP_TX=$(jq -r '[.transactions[]|select(.transactionType=="CALL" and .function|test("addLiquidityETH"))][0].hash' "$BROADCAST")
    # PAIR_ADDRESS captured from logs (Aerodrome emits PoolCreated)
    PAIR_ADDRESS=$(jq -r '[.receipts[].logs[]|select(.topics[0]=="0x2128d88d14c80cb081c1252a5acff7a264671fbe8a3d4f0e1d3a8e2c12b6dba2")][0].address' "$BROADCAST" || echo "0x")

    BRAWL_IN_LP=$(printf '%.0f' "$(echo "$BRAWL_AMOUNT_WEI / 10^18" | bc -l)")
    ETH_IN_LP=$(printf '%.3f' "$(echo "$ETH_AMOUNT_WEI / 10^18" | bc -l)")
    post_receipt R4 \
      --var BRAWL_IN_LP="$BRAWL_IN_LP" \
      --var ETH_IN_LP="$ETH_IN_LP" \
      --var PAIR_ADDRESS="$PAIR_ADDRESS" \
      --var TX_HASH="$LP_TX"

    if [[ "${BURN_LP:-true}" == "true" ]]; then
      # Burn path (default since 2026-05-15): R5-lp-burned receipt
      BURN_TX=$(jq -r '[.transactions[]|select(.function|test("transfer\\("))][-1].hash' "$BROADCAST")
      post_receipt R5 \
        --var PAIR_ADDR="$PAIR_ADDRESS" \
        --var TX_HASH="$BURN_TX"
    elif [[ -n "${UNICRYPT_LOCKER:-}" ]]; then
      # Legacy UNCX path (only if explicitly opted in via BURN_LP=false + UNICRYPT_LOCKER)
      LOCK_DAYS=$(( ${LOCK_SECONDS:-15552000} / 86400 ))
      LOCK_URL="https://app.uncx.network/lockers/univ2/address/$PAIR_ADDRESS"
      LOCK_TX=$(jq -r '[.transactions[]|select(.function|test("lockLPToken"))][0].hash' "$BROADCAST")
      post_receipt R5 \
        --var LOCK_DAYS="$LOCK_DAYS" \
        --var LOCK_URL="$LOCK_URL" \
        --var TX_HASH="$LOCK_TX"
    fi
  fi
fi

# ────────────────────────────────────────────────────────────────────
# Step 3: vest team tokens
# ────────────────────────────────────────────────────────────────────
if want_step vest; then
  confirm "STEP 3/5: Vest team tokens on UNCX"
  forge_run script/LockTeamTokens.s.sol

  if [[ $DRY_RUN -eq 0 ]]; then
    BROADCAST="broadcast/LockTeamTokens.s.sol/8453/run-latest.json"
    VEST_TX=$(jq -r '[.transactions[]|select(.function|test("lock\\("))][0].hash' "$BROADCAST")
    VEST_AMOUNT_INT=$(printf '%.0f' "$(echo "${VEST_AMOUNT_WEI:-20000000000000000000000} / 10^18" | bc -l)")
    VEST_DAYS=$(( ${VEST_DURATION_SECONDS:-15552000} / 86400 ))
    post_receipt R6 \
      --var VEST_AMOUNT="$VEST_AMOUNT_INT" \
      --var VEST_DAYS="$VEST_DAYS" \
      --var TX_HASH="$VEST_TX"
  fi
fi

# ────────────────────────────────────────────────────────────────────
# Step 4: enable trading + fire the launch thread
# ────────────────────────────────────────────────────────────────────
if want_step trading; then
  confirm "STEP 4/5: Enable trading on BRAWL + fire launch thread"
  forge_run script/EnableTrading.s.sol

  if [[ $DRY_RUN -eq 0 ]]; then
    BROADCAST="broadcast/EnableTrading.s.sol/8453/run-latest.json"
    TRADING_TX=$(jq -r '[.transactions[]|select(.function|test("enableTrading"))][0].hash' "$BROADCAST")
    post_receipt R7 --var TX_HASH="$TRADING_TX"
    # The 12-tweet launch thread fires as a separate workflow once R7 lands.
    # Triggered manually for now; queue via a future post-thread.mjs.
    echo
    echo "now fire the 12-tweet launch thread from marketing/content/x-launch-thread.md."
    echo "address placeholders to fill: BRAWL_ADDRESS=$BRAWL_ADDRESS  PAIR_ADDRESS=$PAIR_ADDRESS  BURN_RECEIPT=https://basescan.org/address/0x000000000000000000000000000000000000dEaD#tokentxns"
  fi
fi

# ────────────────────────────────────────────────────────────────────
# Step 5: verify contracts on basescan
# ────────────────────────────────────────────────────────────────────
if want_step verify; then
  confirm "STEP 5/5: Verify all contracts on Basescan"
  : "${ETHERSCAN_API_KEY:?ETHERSCAN_API_KEY (basescan v2) required}"
  forge verify-contract "$BRAWL_ADDRESS" contracts/BRAWL.sol:BRAWL --chain base --watch
  forge verify-contract "$BRAWLERS_ADDRESS" contracts/Brawlers.sol:Brawlers --chain base --watch
  forge verify-contract "$DUEL_ADDRESS" contracts/Duel.sol:Duel --chain base --watch
  forge verify-contract "$MINTDROP_ADDRESS" contracts/MintDrop.sol:MintDrop --chain base --watch
  forge verify-contract "$GRAVEYARD_ADDRESS" contracts/Graveyard.sol:Graveyard --chain base --watch
  forge verify-contract "$MARKETPLACE_ADDRESS" contracts/Marketplace.sol:Marketplace --chain base --watch

  post_receipt R8 \
    --var BRAWL_ADDRESS="$BRAWL_ADDRESS" \
    --var BRAWLERS_ADDRESS="$BRAWLERS_ADDRESS" \
    --var DUEL_ADDRESS="$DUEL_ADDRESS" \
    --var MINTDROP_ADDRESS="$MINTDROP_ADDRESS" \
    --var GRAVEYARD_ADDRESS="$GRAVEYARD_ADDRESS" \
    --var MARKETPLACE_ADDRESS="$MARKETPLACE_ADDRESS"
fi

# Renounce step is intentionally NOT here — runs separately 24-48h later:
#   bash script/launch-mainnet.sh --step renounce  (TODO if you want this)

echo
echo "═══════════════════════════════════════════════════════════════════"
echo "  Launch sequence complete."
echo "  Next: monitor for 24-48h, then run RenounceOwnership.s.sol + R9."
echo "═══════════════════════════════════════════════════════════════════"
