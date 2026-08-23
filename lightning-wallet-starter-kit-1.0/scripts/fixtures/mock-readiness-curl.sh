#!/bin/sh
set -eu

output=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output)
      output=$2
      shift 2
      ;;
    --write-out)
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

[ -n "$output" ] || { echo 'mock curl did not receive --output' >&2; exit 2; }
[ -n "${VERIFY_FIXTURE:-}" ] || { echo 'VERIFY_FIXTURE is required' >&2; exit 2; }
cp "$VERIFY_FIXTURE" "$output"
printf '200'
