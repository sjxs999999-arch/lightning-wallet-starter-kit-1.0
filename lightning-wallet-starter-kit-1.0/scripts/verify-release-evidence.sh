#!/bin/sh
set -eu

STAGE=${1:-${RELEASE_STAGE:-}}
REPORT=${2:-${RELEASE_ACCEPTANCE_REPORT:-}}
EXPECTED_RELEASE=${EXPECTED_RELEASE:-2.40.0}
EXPECTED_ACCEPTANCE_ENVIRONMENT=${EXPECTED_ACCEPTANCE_ENVIRONMENT:-production}

case "$STAGE" in
  internal|public) : ;;
  *) echo 'Release stage must be internal or public.' >&2; exit 2 ;;
esac

[ -n "$REPORT" ] || { echo 'Release acceptance report path is required.' >&2; exit 2; }
[ -f "$REPORT" ] || { echo "Release acceptance report not found: $REPORT" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo 'jq is required to verify release acceptance evidence.' >&2; exit 2; }

case "$EXPECTED_ACCEPTANCE_ENVIRONMENT" in
  production|test) : ;;
  *) echo 'Expected acceptance environment must be production or test.' >&2; exit 2 ;;
esac

required_features='["wallet-center","wallet-chat","wallet-factory","solana-vanity","batch-transfer","asset-collection","batch-trade","swap","activity-history","token-studio","lp-manager","risk-scanner","project-dashboard","project-center","bridge-router","gasfree","flash-loan","market-center","automation-center","security-center","system-status"]'
required_flows='["batch-transfer","asset-collection","batch-trade","swap","token-studio","bridge-router","gasfree","flash-loan"]'

if ! jq -e \
  --arg release "$EXPECTED_RELEASE" \
  --arg environment "$EXPECTED_ACCEPTANCE_ENVIRONMENT" \
  --arg stage "$STAGE" \
  --argjson requiredFeatures "$required_features" \
  --argjson requiredFlows "$required_flows" '
  def pass: . == "pass";
  def tx_reference:
    if .chain == "EVM" then .reference | test("^0x[0-9a-fA-F]{64}$")
    elif .chain == "SOL" then .reference | test("^[1-9A-HJ-NP-Za-km-z]{64,100}$")
    elif .chain == "TRON" then .reference | test("^[0-9a-fA-F]{64}$")
    else false end;
  .format == "lightning-wallet-release-acceptance-v1" and
  .release == $release and
  .environment == $environment and
  (.recordedAt | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$")) and
  (.recordedBy | type == "string" and length >= 3 and length <= 254) and
  (.code.commit | type == "string" and test("^[0-9a-f]{40}$")) and
  ([.code.lint,.code.typecheck,.code.tests,.code.build,.code.secretScan] | all(pass)) and
  .providers.configuration == "pass" and
  .providers.liveQuotes == "pass" and
  (.providers.evidence | type == "array" and length > 0 and
    all(.[]; type == "string" and length > 0 and length <= 240 and (test("placeholder|demo|mock"; "i") | not))) and
  (.featureChecks | type == "array" and length == ($requiredFeatures | length)) and
  ([.featureChecks[].feature] | sort) == ($requiredFeatures | sort) and
  ([.featureChecks[].feature] | length) == ([.featureChecks[].feature] | unique | length) and
  all(.featureChecks[];
    .result == "pass" and
    (if (.feature == "wallet-factory" or .feature == "solana-vanity") then .mode == "local-only"
     elif .feature == "wallet-center" then .mode == "wallet-session"
     elif .feature == "automation-center" then .mode == "admin-controlled"
     elif (.feature == "activity-history" or .feature == "lp-manager" or .feature == "risk-scanner" or .feature == "project-dashboard" or .feature == "project-center" or .feature == "market-center" or .feature == "security-center" or .feature == "system-status") then .mode == "read-only"
     elif .feature == "flash-loan" then .mode == "external-provider"
     else .mode == "wallet-signed" end) and
    (.evidence | type == "string" and length > 0 and length <= 240 and (test("placeholder|demo|mock"; "i") | not))) and
  (.walletFlows | type == "array" and length == ($requiredFlows | length)) and
  ([.walletFlows[].feature] | sort) == ($requiredFlows | sort) and
  ([.walletFlows[].feature] | length) == ([.walletFlows[].feature] | unique | length) and
  all(.walletFlows[];
    (.walletProvider | type == "string" and length > 0 and length <= 80) and
    (.chain == "EVM" or .chain == "SOL" or .chain == "TRON") and
    (.network | type == "string" and length > 0 and length <= 80) and
    .connect == "pass" and
    .simulation == "pass" and
    (.sign == "pass" or .sign == "pending" or .sign == "not-run") and
    (.broadcast == "pass" or .broadcast == "pending" or .broadcast == "not-run") and
    (.confirm == "pass" or .confirm == "pending" or .confirm == "not-run") and
    (.intentVerified == "pass" or .intentVerified == "pending" or .intentVerified == "not-run") and
    (.intentHash | type == "string") and
    (if .broadcast == "pass" then .sign == "pass" and tx_reference else .confirm != "pass" and .reference == "" end) and
    (if .broadcast == "pass" then (.intentHash | test("^[0-9a-f]{64}$")) else .intentVerified != "pass" and .intentHash == "" end) and
    (if .confirm == "pass" then .broadcast == "pass" else true end)) and
  .security == {
    privateKeyUploaded: false,
    mnemonicUploaded: false,
    serverSigning: false,
    serverBroadcast: false
  } and
  ([.. | objects | keys[] | ascii_downcase] |
    any(test("(^|_)(private_?key|mnemonic|seed_?phrase|secret_?key|password|signature)(_|$)")) | not) and
  ([.. | strings] |
    any(test("-----BEGIN|(^|[^a-z])(mnemonic|seed phrase|private key|secret key|password)([^a-z]|$)"; "i")) | not) and
  (if $stage == "public" then
    all(.walletFlows[]; .sign == "pass" and .broadcast == "pass" and .confirm == "pass" and .intentVerified == "pass" and tx_reference) and
    ([.walletFlows[] | [.chain,.reference] | join("|")] | length) ==
      ([.walletFlows[] | [.chain,.reference] | join("|")] | unique | length) and
    .walletAcceptance.onChainVerified == "pass" and
    (.walletAcceptance.reportSha256 | type == "string" and test("^[0-9a-f]{64}$"))
   else true end)
' "$REPORT" >/dev/null; then
  echo 'Release evidence is incomplete, malformed, stale-stage, or contains a placeholder/unsafe claim.' >&2
  exit 1
fi

sign_count=$(jq '[.walletFlows[] | select(.sign == "pass")] | length' "$REPORT")
broadcast_count=$(jq '[.walletFlows[] | select(.broadcast == "pass")] | length' "$REPORT")
confirm_count=$(jq '[.walletFlows[] | select(.confirm == "pass")] | length' "$REPORT")
flow_count=$(jq '.walletFlows | length' "$REPORT")

printf 'PASS [code]: lint, typecheck, tests, build and secret scan are recorded for commit %s.\n' "$(jq -r '.code.commit' "$REPORT")"
printf 'PASS [providers]: configuration and live-quote evidence are recorded.\n'
printf 'PASS [wallet-connect]: %s/%s required flows connected.\n' "$flow_count" "$flow_count"
printf 'PASS [simulation]: %s/%s required flows simulated.\n' "$flow_count" "$flow_count"
printf '%s [signing]: %s/%s required flows signed.\n' "$([ "$sign_count" -eq "$flow_count" ] && printf PASS || printf TRACKED)" "$sign_count" "$flow_count"
printf '%s [broadcast]: %s/%s required flows broadcast.\n' "$([ "$broadcast_count" -eq "$flow_count" ] && printf PASS || printf TRACKED)" "$broadcast_count" "$flow_count"
printf '%s [confirmation]: %s/%s required flows confirmed.\n' "$([ "$confirm_count" -eq "$flow_count" ] && printf PASS || printf TRACKED)" "$confirm_count" "$flow_count"

if [ "$STAGE" = internal ]; then
  echo 'INTERNAL EVIDENCE PASS: code, provider, wallet-connect and simulation evidence are complete. This is not public-beta or mainnet-broadcast approval.'
else
  echo 'PUBLIC EVIDENCE PASS: signing, broadcast and confirmation evidence are complete. Live RPC and final-readiness checks must still pass.'
fi
