#!/bin/sh
set -eu

REPORT=${1:-${FINAL_WALLET_ACCEPTANCE_REPORT:-}}
EXPECTED_RELEASE=${EXPECTED_RELEASE:-2.37.0}
EXPECTED_ACCEPTANCE_ENVIRONMENT=${EXPECTED_ACCEPTANCE_ENVIRONMENT:-production}
EXPECTED_SHA256=${FINAL_WALLET_ACCEPTANCE_EVIDENCE_SHA256:-}

[ -n "$REPORT" ] || { echo 'Wallet acceptance report path is required.' >&2; exit 2; }
[ -f "$REPORT" ] || { echo "Wallet acceptance report not found: $REPORT" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo 'jq is required to verify wallet acceptance.' >&2; exit 2; }

case "$EXPECTED_ACCEPTANCE_ENVIRONMENT" in production|test) : ;; *) echo 'Expected acceptance environment must be production or test.' >&2; exit 2 ;; esac

if ! jq -e --arg release "$EXPECTED_RELEASE" --arg environment "$EXPECTED_ACCEPTANCE_ENVIRONMENT" '
  .format == "lightning-wallet-wallet-acceptance-v1" and
  .release == $release and
  .environment == $environment and
  (.approvedAt | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$")) and
  (.approvedBy | type == "string" and length >= 3 and length <= 254) and
  .security == {
    privateKeyUploaded: false,
    mnemonicUploaded: false,
    serverSigning: false,
    serverBroadcast: false
  } and
  (.providers | type == "array" and length == 10) and
  ([.providers[] | [.provider,.chain,.network] | join("|")] | length) ==
    ([.providers[] | [.provider,.chain,.network] | join("|")] | unique | length) and
  ([.providers[] | [.chain,.reference] | join("|")] | length) ==
    ([.providers[] | [.chain,.reference] | join("|")] | unique | length) and
  all(.providers[];
    .connect == "pass" and .sign == "pass" and .broadcast == "pass" and
    .confirm == "pass" and .historyReload == "pass" and
    (if .chain == "EVM" then .reference | test("^0x[0-9a-fA-F]{64}$")
     elif .chain == "SOL" then .reference | test("^[1-9A-HJ-NP-Za-km-z]{64,100}$")
     elif .chain == "TRON" then .reference | test("^[0-9a-fA-F]{64}$")
     else false end)
  ) and
  ([
    ["MetaMask","EVM","Sepolia"],
    ["WalletConnect","EVM","Sepolia"],
    ["OKX","EVM","Sepolia"],
    ["OKX","SOL","Solana Devnet"],
    ["OKX","TRON","TRON Nile"],
    ["Rabby","EVM","Sepolia"],
    ["Phantom","SOL","Solana Devnet"],
    ["Backpack","SOL","Solana Devnet"],
    ["Solflare","SOL","Solana Devnet"],
    ["TronLink","TRON","TRON Nile"]
  ] - [.providers[] | [.provider,.chain,.network]] | length) == 0 and
  (.negativeTests | type == "array" and length == 3) and
  ([.negativeTests[].chain] | sort) == ["EVM","SOL","TRON"] and
  all(.negativeTests[];
    .walletRejectNoBroadcast == "pass" and
    .rpcFailureNoWhiteScreen == "pass" and
    .routeFailureNoWhiteScreen == "pass"
  )
' "$REPORT" >/dev/null; then
  echo 'Wallet acceptance report is incomplete, malformed or contains a failed requirement.' >&2
  exit 1
fi

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo 'A SHA-256 utility is required.' >&2
    return 2
  fi
}

actual_sha=$(sha256_file "$REPORT")
if [ -n "$EXPECTED_SHA256" ]; then
  expected_sha=$(printf '%s' "$EXPECTED_SHA256" | tr 'A-F' 'a-f')
  case "$expected_sha" in
    *[!0-9a-f]*|'') echo 'Wallet acceptance evidence SHA-256 must be 64 hexadecimal characters.' >&2; exit 2 ;;
  esac
  [ "${#expected_sha}" -eq 64 ] || { echo 'Wallet acceptance evidence SHA-256 must be 64 hexadecimal characters.' >&2; exit 2; }
  [ "$actual_sha" = "$expected_sha" ] || { echo 'Wallet acceptance evidence SHA-256 does not match the report.' >&2; exit 1; }
fi

printf 'Wallet acceptance report verified for release %s. SHA-256: %s\n' "$EXPECTED_RELEASE" "$actual_sha"
