#!/bin/sh
set -eu

REPORT=${1:-${FINAL_WALLET_ACCEPTANCE_REPORT:-}}
EXPECTED_RELEASE=${EXPECTED_RELEASE:-2.38.0}
EXPECTED_ACCEPTANCE_ENVIRONMENT=${EXPECTED_ACCEPTANCE_ENVIRONMENT:-production}
CURL_BIN=${CURL_BIN:-curl}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SEPOLIA_RPC_URL=${WALLET_ACCEPTANCE_SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}
SOLANA_DEVNET_RPC_URL=${WALLET_ACCEPTANCE_SOLANA_DEVNET_RPC_URL:-https://api.devnet.solana.com}
TRON_NILE_RPC_URL=${WALLET_ACCEPTANCE_TRON_NILE_RPC_URL:-https://nile.trongrid.io}
MAX_AGE_SECONDS=${WALLET_ACCEPTANCE_MAX_AGE_SECONDS:-2592000}
VERIFY_DIR=$(mktemp -d)
trap 'rm -rf "$VERIFY_DIR"' EXIT HUP INT TERM

fail() { printf 'Wallet acceptance live verification failed: %s\n' "$*" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$*"; }

case "$MAX_AGE_SECONDS" in ''|*[!0-9]*) fail 'maximum evidence age must be a positive integer' ;; esac
[ "$MAX_AGE_SECONDS" -gt 0 ] || fail 'maximum evidence age must be greater than zero'
case "$SEPOLIA_RPC_URL" in https://*) : ;; *) fail 'Sepolia evidence RPC must use HTTPS' ;; esac
case "$SOLANA_DEVNET_RPC_URL" in https://*) : ;; *) fail 'Solana Devnet evidence RPC must use HTTPS' ;; esac
[ "$TRON_NILE_RPC_URL" = https://nile.trongrid.io ] || fail 'TRON evidence RPC must be the official Nile endpoint'

EXPECTED_RELEASE="$EXPECTED_RELEASE" EXPECTED_ACCEPTANCE_ENVIRONMENT="$EXPECTED_ACCEPTANCE_ENVIRONMENT" \
  "$SCRIPT_DIR/verify-wallet-acceptance.sh" "$REPORT"

approved_epoch=$(jq -r '.approvedAt | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601' "$REPORT") || fail 'approvedAt cannot be converted to UTC epoch time'
now_epoch=$(date -u +%s)
age=$((now_epoch - approved_epoch))
[ "$age" -ge -300 ] || fail 'approvedAt is more than five minutes in the future'
[ "$age" -le "$MAX_AGE_SECONDS" ] || fail 'acceptance evidence is older than the configured maximum age'
pass 'acceptance approval timestamp is current'

request_json() {
  name=$1
  url=$2
  payload=$3
  status=$($CURL_BIN --silent --show-error --max-time 20 --output "$VERIFY_DIR/$name.json" --write-out '%{http_code}' \
    -X POST -H 'Content-Type: application/json' --data "$payload" "$url") || fail "$name RPC request failed"
  [ "$status" = 200 ] || fail "$name RPC returned HTTP $status"
  jq -e . "$VERIFY_DIR/$name.json" >/dev/null || fail "$name RPC returned invalid JSON"
}

request_json evm-chain "$SEPOLIA_RPC_URL" '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
jq -e '.result == "0xaa36a7"' "$VERIFY_DIR/evm-chain.json" >/dev/null || fail 'EVM evidence RPC is not Sepolia'
evm_index=0
jq -r '.providers[] | select(.chain == "EVM") | .reference' "$REPORT" | while IFS= read -r reference; do
  evm_index=$((evm_index + 1))
  payload=$(jq -nc --arg reference "$reference" '{jsonrpc:"2.0",id:1,method:"eth_getTransactionReceipt",params:[$reference]}')
  request_json "evm-$evm_index" "$SEPOLIA_RPC_URL" "$payload"
  jq -e '.result != null and .result.status == "0x1" and (.result.blockNumber | type == "string") and (.result.transactionHash | ascii_downcase) == ($reference | ascii_downcase)' \
    --arg reference "$reference" "$VERIFY_DIR/evm-$evm_index.json" >/dev/null || fail "Sepolia transaction is missing, failed or mismatched: $reference"
done
pass 'all Sepolia transaction references are confirmed successful'

request_json solana-genesis "$SOLANA_DEVNET_RPC_URL" '{"jsonrpc":"2.0","id":1,"method":"getGenesisHash","params":[]}'
jq -e '.result == "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"' "$VERIFY_DIR/solana-genesis.json" >/dev/null || fail 'Solana evidence RPC is not Devnet'
solana_refs=$(jq -c '[.providers[] | select(.chain == "SOL") | .reference]' "$REPORT")
solana_payload=$(jq -nc --argjson references "$solana_refs" '{jsonrpc:"2.0",id:1,method:"getSignatureStatuses",params:[$references,{searchTransactionHistory:true}]}')
request_json solana-status "$SOLANA_DEVNET_RPC_URL" "$solana_payload"
solana_count=$(printf '%s' "$solana_refs" | jq 'length')
jq -e --argjson count "$solana_count" '
  (.result.value | length) == $count and
  all(.result.value[]; . != null and .err == null and (.confirmationStatus == "confirmed" or .confirmationStatus == "finalized"))
' "$VERIFY_DIR/solana-status.json" >/dev/null || fail 'one or more Solana Devnet signatures are missing, failed or unconfirmed'
pass 'all Solana Devnet signatures are confirmed successful'

tron_index=0
jq -r '.providers[] | select(.chain == "TRON") | .reference' "$REPORT" | while IFS= read -r reference; do
  tron_index=$((tron_index + 1))
  payload=$(jq -nc --arg reference "$reference" '{value:$reference}')
  request_json "tron-tx-$tron_index" "$TRON_NILE_RPC_URL/wallet/gettransactionbyid" "$payload"
  jq -e --arg reference "$reference" '
    (.txID | ascii_downcase) == ($reference | ascii_downcase) and .ret[0].contractRet == "SUCCESS"
  ' "$VERIFY_DIR/tron-tx-$tron_index.json" >/dev/null || fail "TRON Nile transaction is missing, failed or mismatched: $reference"
  request_json "tron-info-$tron_index" "$TRON_NILE_RPC_URL/wallet/gettransactioninfobyid" "$payload"
  jq -e --arg reference "$reference" '
    (.id | ascii_downcase) == ($reference | ascii_downcase) and
    (.blockNumber | type == "number" and . > 0) and
    ((.receipt.result // "SUCCESS") == "SUCCESS")
  ' "$VERIFY_DIR/tron-info-$tron_index.json" >/dev/null || fail "TRON Nile transaction is not confirmed successful: $reference"
done
pass 'all TRON Nile transaction references are confirmed successful'

printf 'Wallet acceptance public-chain evidence verified for release %s. No wallet or secret material was accessed.\n' "$EXPECTED_RELEASE"
