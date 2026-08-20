#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
fixture=${MOCK_LIVE_PROVIDER_FIXTURE:-$SCRIPT_DIR/live-sunswap.valid.json}
output=
headers=
csrf=false
origin=false
payload=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output=$2; shift 2 ;;
    --dump-header) headers=$2; shift 2 ;;
    --data) payload=$2; shift 2 ;;
    --write-out|--max-time|-X) shift 2 ;;
    -H)
      [ "$2" = 'x-lightning-csrf: 1' ] && csrf=true
      [ "$2" = "Origin: ${CLIENT_ORIGIN:-https://lightingwallet.com}" ] && origin=true
      shift 2
      ;;
    *) shift ;;
  esac
done

[ "$csrf" = true ] && [ "$origin" = true ] || { echo 'missing required request protection' >&2; exit 1; }
[ -n "$output" ] && [ -n "$headers" ] || { echo 'missing output paths' >&2; exit 1; }
[ -n "${MOCK_LIVE_PROVIDER_FIXTURE:-}" ] || case "$payload" in *'"chain":"EVM"'*) fixture=$SCRIPT_DIR/live-lifi.valid.json ;; esac
cp "$fixture" "$output"
printf 'HTTP/2 200\r\naccess-control-allow-origin: %s\r\n\r\n' "${CLIENT_ORIGIN:-https://lightingwallet.com}" > "$headers"
printf '200 0.123456'
