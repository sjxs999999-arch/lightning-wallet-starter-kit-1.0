#!/bin/sh
set -eu

output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output=$2; shift 2 ;;
    --write-out) shift 2 ;;
    http*) url=$1; shift ;;
    *) shift ;;
  esac
done

[ -n "$output" ] || { echo 'mock runtime curl requires --output' >&2; exit 2; }
mode=${MOCK_RUNTIME_PROVIDER_MODE:-internal}

case "$url" in
  */integrations/flash-loan/health)
    case "$mode" in
      offline) printf '{"error":"offline"}\n' > "$output"; printf '503'; exit 0 ;;
      public) printf '{"data":{"status":"ready","network":"mainnet","mainnetEnabled":true}}\n' > "$output" ;;
      *) printf '{"data":{"status":"ready","network":"sepolia","mainnetEnabled":false}}\n' > "$output" ;;
    esac
    ;;
  */gasfree/status)
    case "$mode" in
      dry-run) printf '{"data":{"configured":false,"status":"dry-run-only","mainnetEnabled":false,"capabilities":["sponsor","paymaster"]}}\n' > "$output" ;;
      public) printf '{"data":{"configured":true,"status":"ready","mainnetEnabled":true,"capabilities":["sponsor","paymaster"]}}\n' > "$output" ;;
      *) printf '{"data":{"configured":true,"status":"ready","mainnetEnabled":false,"capabilities":["sponsor","paymaster"]}}\n' > "$output" ;;
    esac
    ;;
  *) echo "unexpected mock URL: $url" >&2; exit 2 ;;
esac

printf '200'
