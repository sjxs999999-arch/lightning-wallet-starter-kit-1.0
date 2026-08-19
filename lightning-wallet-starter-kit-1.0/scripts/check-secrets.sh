#!/bin/sh
set -eu

if git ls-files | grep -E '(^|/)\.env(\.|$)' | grep -Ev '\.env(\.production)?\.example$'; then
  echo 'Tracked environment credential file detected.' >&2
  exit 1
fi

if git grep -nEI -- 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|ADMIN_PASSWORD[[:space:]]*=[[:space:]]*[^#[:space:]]+' -- ':!package-lock.json'; then
  echo 'Potential credential material detected in tracked source.' >&2
  exit 1
fi

echo 'Tracked-source credential scan passed.'
