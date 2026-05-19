#!/usr/bin/env bash
# Bulk-rename helper for cloning this repo into a new project.
# Usage:
#   bash script/rename-project.sh <new-slug> <NEW_TICKER>
# e.g.
#   bash script/rename-project.sh sonicfighters SFIGHT
#
# Reads the new slug + ticker, finds-and-replaces across the codebase.
# DOES NOT touch contract addresses, art, or git history. Always review
# the diff before committing.
set -e

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "usage: bash script/rename-project.sh <new-slug> <NEW_TICKER>"
  echo "  <new-slug>     lowercase project slug, e.g. 'sonicfighters'"
  echo "  <NEW_TICKER>   uppercase token ticker, e.g. 'SFIGHT'"
  exit 1
fi

NEW_SLUG="$1"
NEW_TICKER="$2"
NEW_NAME=$(echo "$NEW_SLUG" | sed -E 's/(^|-)([a-z])/\1\U\2/g' | tr -d '-')

echo "[rename] new project slug:  $NEW_SLUG"
echo "[rename] new project name:  $NEW_NAME"
echo "[rename] new token ticker:  $NEW_TICKER"
echo ""
echo "[rename] CHECKING current state..."

if [ ! -d ".git" ]; then
  echo "[rename] FATAL: not in a git repo root"
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[rename] FATAL: working tree dirty. Commit or stash first."
  exit 1
fi

echo "[rename] starting bulk replace (read-only paths: node_modules, .git, lib, broadcast, cache, out)"

# Replacement targets:
#   1. "BASEic Brawlers" -> "$NEW_NAME"
#   2. "baseic brawlers" -> "$NEW_NAME" (lowercase variant in copy)
#   3. "BASEicBrawlers"  -> "$NEW_NAME"  (handle variant)
#   4. "baseicbrawlers"  -> "$NEW_SLUG"  (domain / repo / channel)
#   5. "BRAWL"           -> "$NEW_TICKER" (token)
#   6. "Brawler" / "brawler" KEPT — the game concept is generic enough
#                                     to keep in copy if you want, but
#                                     review case-by-case.

FILES=$(git ls-files | grep -vE '^(lib/|frontend/node_modules/|marketing/.*/node_modules/|broadcast/|cache/|out/|.*\.lock|.*-lock\.json|.*\.png|.*\.jpg|.*\.svg|.*\.woff|.*\.ico)$')

count=0
for f in $FILES; do
  if [ -f "$f" ]; then
    # Use sed with multiple expressions. -i for in-place.
    if grep -lE 'BASEic Brawlers|BASEicBrawlers|baseicbrawlers|BRAWL[^E]|BRAWL$' "$f" >/dev/null 2>&1; then
      sed -i \
        -e "s|BASEic Brawlers|$NEW_NAME|g" \
        -e "s|BASEicBrawlers|$NEW_NAME|g" \
        -e "s|baseicbrawlers|$NEW_SLUG|g" \
        -e "s|\\bBRAWL\\b|$NEW_TICKER|g" \
        "$f"
      count=$((count + 1))
    fi
  fi
done

echo "[rename] modified $count files"
echo ""
echo "[rename] renaming key files (contracts, tests, deploy scripts)"

# Rename BRAWL.sol → <NEW_TICKER>.sol
if [ -f "contracts/BRAWL.sol" ]; then
  git mv "contracts/BRAWL.sol" "contracts/${NEW_TICKER}.sol"
  echo "  contracts/BRAWL.sol → contracts/${NEW_TICKER}.sol"
fi
if [ -f "contracts/BRAWLTimelock.sol" ]; then
  git mv "contracts/BRAWLTimelock.sol" "contracts/${NEW_TICKER}Timelock.sol"
  echo "  contracts/BRAWLTimelock.sol → contracts/${NEW_TICKER}Timelock.sol"
fi
if [ -f "test/solidity/BRAWLTimelock.t.sol" ]; then
  git mv "test/solidity/BRAWLTimelock.t.sol" "test/solidity/${NEW_TICKER}Timelock.t.sol"
  echo "  test/solidity/BRAWLTimelock.t.sol → test/solidity/${NEW_TICKER}Timelock.t.sol"
fi

echo ""
echo "[rename] DONE. Now:"
echo "  1. git status      (review what changed)"
echo "  2. git diff        (sanity-check the replacements)"
echo "  3. forge test      (should still pass 183/183)"
echo "  4. Manually review contract NAMES (e.g. 'contract BRAWL' inside .sol files — sed may have caught some)"
echo "  5. Generate new pixel art (this script doesn't touch art)"
echo "  6. Update contract addresses + env when you redeploy to the new chain"
echo "  7. git commit -m 'chore: rename to $NEW_NAME ($NEW_TICKER)' once you've reviewed"
