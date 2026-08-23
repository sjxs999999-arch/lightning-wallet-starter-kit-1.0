#!/bin/sh
set -eu

API_ORIGIN=${API_ORIGIN:-https://api.lightingwallet.com}
EXPECTED_RELEASE=${EXPECTED_RELEASE:-2.35.0}
payload=$(mktemp)
trap 'rm -f "$payload"' EXIT HUP INT TERM

status=$(curl --silent --show-error --location --max-time 20 --output "$payload" --write-out '%{http_code}' "$API_ORIGIN/api/v1/system/capabilities")
[ "$status" = 200 ] || { printf 'FINAL READINESS BLOCKED: capability endpoint returned HTTP %s\n' "$status" >&2; exit 1; }

if ! jq -e --arg release "$EXPECTED_RELEASE" '
  .data.version == $release and
  .data.readiness.finalApproval == true and
  .data.readiness.walletAcceptanceRequired == false and
  (.data.readiness.externalBlockers | length) == 0 and
  .data.readiness.mainnet.execution == true and
  .data.readiness.mainnet.swap == true and
  .data.readiness.mainnet.launchpad == true and
  .data.readiness.mainnet.bridge == true and
  all(.data.features[]; .status == "ready") and
  .data.security.privateKeysUploaded == false and
  .data.security.serverSigning == false and
  .data.security.serverBroadcast == false
' "$payload" >/dev/null; then
  printf 'FINAL READINESS BLOCKED\n' >&2
  jq '{version:.data.version,readiness:.data.readiness,gatedFeatures:[.data.features[]|select(.status!="ready")|{name,status}]}' "$payload" >&2
  exit 1
fi

printf 'FINAL READINESS PASS: %s is fully approved with all mainnet gates and providers verified.\n' "$EXPECTED_RELEASE"
