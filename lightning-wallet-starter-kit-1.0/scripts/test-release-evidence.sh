#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
VALID=$SCRIPT_DIR/fixtures/release-acceptance.valid.test.json
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT HUP INT TERM

verify_internal() {
  EXPECTED_ACCEPTANCE_ENVIRONMENT=test "$SCRIPT_DIR/verify-release-evidence.sh" internal "$1" >/dev/null
}

verify_public() {
  EXPECTED_ACCEPTANCE_ENVIRONMENT=test "$SCRIPT_DIR/verify-release-evidence.sh" public "$1" >/dev/null
}

expect_reject() {
  name=$1
  stage=$2
  report=$3
  if EXPECTED_ACCEPTANCE_ENVIRONMENT=test "$SCRIPT_DIR/verify-release-evidence.sh" "$stage" "$report" >/dev/null 2>&1; then
    printf 'Release evidence verifier unexpectedly accepted %s.\n' "$name" >&2
    exit 1
  fi
}

verify_internal "$VALID"

expect_reject 'the untouched pending template' internal "$SCRIPT_DIR/fixtures/release-acceptance.template.json"

jq '.providers.configuration = "pending"' "$VALID" > "$TEST_DIR/provider-pending.json"
expect_reject 'a pending provider configuration' internal "$TEST_DIR/provider-pending.json"

jq '.featureChecks[0].evidence = "demo screen only"' "$VALID" > "$TEST_DIR/demo-claim.json"
expect_reject 'a demo-only feature claim' internal "$TEST_DIR/demo-claim.json"

jq '.walletFlows[0].simulation = "pending"' "$VALID" > "$TEST_DIR/simulation-pending.json"
expect_reject 'a pending simulation' internal "$TEST_DIR/simulation-pending.json"

jq 'del(.featureChecks[0])' "$VALID" > "$TEST_DIR/missing-feature.json"
expect_reject 'a missing required feature' internal "$TEST_DIR/missing-feature.json"

jq '(.featureChecks[] | select(.feature == "lp-manager") | .mode) = "wallet-signed"' "$VALID" > "$TEST_DIR/lp-false-signing.json"
expect_reject 'an LP Manager signing claim without an in-app transaction path' internal "$TEST_DIR/lp-false-signing.json"

expect_reject 'pending signatures and broadcasts at the public gate' public "$VALID"

jq '
  .walletFlows |= (to_entries | map(
    .value + {
      sign: "pass",
      broadcast: "pass",
      confirm: "pass",
      intentVerified: "pass",
      intentHash: (((.key + 1) | tostring) * 64),
      reference: (if .value.chain == "EVM" then "0x" + (((.key + 1) | tostring) * 64)
                  else (((.key + 1) | tostring) * 64) end)
    }
  )) |
  .walletAcceptance.onChainVerified = "pass" |
  .walletAcceptance.reportSha256 = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
' "$VALID" > "$TEST_DIR/public.json"
verify_public "$TEST_DIR/public.json"

jq '
  (.walletFlows[] | select(.feature == "batch-transfer")) |=
    (.walletProvider = "MetaMask" | .chain = "EVM" | .network = "Sepolia" | .intentHash = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" | .reference = "0x7777777777777777777777777777777777777777777777777777777777777777") |
  (.walletFlows[] | select(.feature == "asset-collection")) |=
    (.walletProvider = "TronLink" | .chain = "TRON" | .network = "TRON Nile" | .intentHash = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" | .reference = "7777777777777777777777777777777777777777777777777777777777777777") |
  (.walletFlows[] | select(.feature == "batch-trade")) |=
    (.walletProvider = "Phantom" | .chain = "SOL" | .network = "Solana Devnet" | .intentHash = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" | .reference = "6666666666666666666666666666666666666666666666666666666666666666") |
  (.walletFlows[] | select(.feature == "swap")) |=
    (.walletProvider = "MetaMask" | .chain = "EVM" | .network = "Sepolia" | .intentHash = "1111111111111111111111111111111111111111111111111111111111111111" | .reference = "0x8888888888888888888888888888888888888888888888888888888888888888") |
  (.walletFlows[] | select(.feature == "token-studio")) |=
    (.walletProvider = "WalletConnect" | .chain = "EVM" | .network = "Sepolia" | .intentHash = "2222222222222222222222222222222222222222222222222222222222222222" | .reference = "0x9999999999999999999999999999999999999999999999999999999999999999") |
  (.walletFlows[] | select(.feature == "bridge-router")) |=
    (.walletProvider = "OKX" | .chain = "EVM" | .network = "Sepolia" | .intentHash = "3333333333333333333333333333333333333333333333333333333333333333" | .reference = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") |
  (.walletFlows[] | select(.feature == "gasfree")) |=
    (.walletProvider = "Rabby" | .chain = "EVM" | .network = "Sepolia" | .intentHash = "4444444444444444444444444444444444444444444444444444444444444444" | .reference = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb") |
  (.walletFlows[] | select(.feature == "flash-loan")) |=
    (.walletProvider = "Rabby" | .chain = "EVM" | .network = "Sepolia" | .intentHash = "5555555555555555555555555555555555555555555555555555555555555555" | .reference = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc")
' "$TEST_DIR/public.json" > "$TEST_DIR/linked-public.json"
verify_public "$TEST_DIR/linked-public.json"
"$SCRIPT_DIR/verify-release-wallet-links.sh" "$TEST_DIR/linked-public.json" "$SCRIPT_DIR/fixtures/wallet-acceptance.valid.test.json" >/dev/null

jq '(.walletFlows[] | select(.feature == "bridge-router") | .reference) = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"' "$TEST_DIR/linked-public.json" > "$TEST_DIR/unlinked-public.json"
if "$SCRIPT_DIR/verify-release-wallet-links.sh" "$TEST_DIR/unlinked-public.json" "$SCRIPT_DIR/fixtures/wallet-acceptance.valid.test.json" >/dev/null 2>&1; then
  echo 'Release-to-wallet linker unexpectedly accepted an unrelated transaction reference.' >&2
  exit 1
fi

jq '(.walletFlows[] | select(.feature == "bridge-router") | .intentHash) = "6666666666666666666666666666666666666666666666666666666666666666"' "$TEST_DIR/linked-public.json" > "$TEST_DIR/wrong-intent.json"
if "$SCRIPT_DIR/verify-release-wallet-links.sh" "$TEST_DIR/wrong-intent.json" "$SCRIPT_DIR/fixtures/wallet-acceptance.valid.test.json" >/dev/null 2>&1; then
  echo 'Release-to-wallet linker unexpectedly accepted a mismatched feature intent hash.' >&2
  exit 1
fi

jq 'del(.featureTransactions)' "$SCRIPT_DIR/fixtures/wallet-acceptance.valid.test.json" > "$TEST_DIR/provider-only-wallet-report.json"
if "$SCRIPT_DIR/verify-release-wallet-links.sh" "$TEST_DIR/linked-public.json" "$TEST_DIR/provider-only-wallet-report.json" >/dev/null 2>&1; then
  echo 'Release-to-wallet linker unexpectedly accepted provider self-tests as feature transactions.' >&2
  exit 1
fi

jq '.walletFlows[0].confirm = "pending"' "$TEST_DIR/public.json" > "$TEST_DIR/unconfirmed.json"
expect_reject 'an unconfirmed public broadcast' public "$TEST_DIR/unconfirmed.json"

jq '.walletFlows[0].reference = "not-a-transaction"' "$TEST_DIR/public.json" > "$TEST_DIR/bad-reference.json"
expect_reject 'an invalid public transaction reference' public "$TEST_DIR/bad-reference.json"

jq '.walletFlows[1].reference = .walletFlows[0].reference' "$TEST_DIR/public.json" > "$TEST_DIR/duplicate-reference.json"
expect_reject 'a transaction reference reused for two feature claims' public "$TEST_DIR/duplicate-reference.json"

jq '.security.serverBroadcast = true' "$TEST_DIR/public.json" > "$TEST_DIR/server-broadcast.json"
expect_reject 'server-side broadcast' public "$TEST_DIR/server-broadcast.json"

jq '.private_key = "should-never-appear"' "$VALID" > "$TEST_DIR/sensitive-key.json"
expect_reject 'a sensitive key field' internal "$TEST_DIR/sensitive-key.json"

sh -n "$SCRIPT_DIR/verify-release-evidence.sh" "$SCRIPT_DIR/verify-release-wallet-links.sh" "$SCRIPT_DIR/verify-beta-readiness.sh"
grep -q 'FEATURE_INTENT_VERIFIER is required' "$SCRIPT_DIR/verify-beta-readiness.sh" || {
  echo 'Public beta gate is missing the independent on-chain intent decoder requirement.' >&2
  exit 1
}
grep -q 'FEATURE_INTENT_VERIFIER_APPROVED_SHA256' "$SCRIPT_DIR/verify-beta-readiness.sh" || {
  echo 'Public beta gate is missing the approved intent-verifier digest pin.' >&2
  exit 1
}
echo 'Internal/public release evidence gate tests passed.'
