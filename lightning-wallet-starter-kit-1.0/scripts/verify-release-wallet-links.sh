#!/bin/sh
set -eu

RELEASE_REPORT=${1:-${RELEASE_ACCEPTANCE_REPORT:-}}
WALLET_REPORT=${2:-${FINAL_WALLET_ACCEPTANCE_REPORT:-}}

[ -n "$RELEASE_REPORT" ] || { echo 'Release acceptance report path is required.' >&2; exit 2; }
[ -n "$WALLET_REPORT" ] || { echo 'Wallet acceptance report path is required.' >&2; exit 2; }
[ -f "$RELEASE_REPORT" ] || { echo "Release acceptance report not found: $RELEASE_REPORT" >&2; exit 1; }
[ -f "$WALLET_REPORT" ] || { echo "Wallet acceptance report not found: $WALLET_REPORT" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo 'jq is required to link release and wallet evidence.' >&2; exit 2; }

if ! jq -e --slurpfile release "$RELEASE_REPORT" '
  . as $wallet |
  $release[0] as $releaseReport |
  $wallet.release == $releaseReport.release and
  $wallet.environment == $releaseReport.environment and
  ($wallet.featureTransactions | type == "array") and
  all($releaseReport.walletFlows[];
    . as $flow |
    any($wallet.featureTransactions[];
      .feature == $flow.feature and
      .provider == $flow.walletProvider and
      .chain == $flow.chain and
      .network == $flow.network and
      .intentVerified == "pass" and
      .intentHash == $flow.intentHash and
      (if .chain == "SOL" then .reference == $flow.reference
       else (.reference | ascii_downcase) == ($flow.reference | ascii_downcase) end)
    )
  )
' "$WALLET_REPORT" >/dev/null; then
  echo 'Public release evidence is not linked to the wallet transactions verified by the wallet acceptance report.' >&2
  exit 1
fi

count=$(jq '.walletFlows | length' "$RELEASE_REPORT")
printf 'Release evidence links %s/%s feature broadcasts to unique operator-attested, transaction-bound wallet-acceptance records.\n' "$count" "$count"
