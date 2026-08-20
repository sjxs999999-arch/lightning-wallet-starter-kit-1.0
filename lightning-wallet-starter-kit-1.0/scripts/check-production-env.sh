#!/bin/sh
set -eu

PRODUCTION_ENV_FILE=${PRODUCTION_ENV_FILE:-.env.production}
STRICT_EXTERNAL_PROVIDERS=${STRICT_EXTERNAL_PROVIDERS:-false}
failure_count=0

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  failure_count=$((failure_count + 1))
}

pass() { printf 'PASS: %s\n' "$*"; }

value() {
  key=$1
  sed -n "s/^${key}=//p" "$PRODUCTION_ENV_FILE" | tail -n 1 | tr -d '\r' | sed 's/^"//;s/"$//'
}

required() {
  key=$1
  current=$(value "$key")
  if [ -z "$current" ]; then
    fail "$key is required"
    return 1
  fi
  case "$current" in
    replace-*|change-me*|example|example.*|admin@example.com)
      fail "$key still contains an example or placeholder value"
      return 1
      ;;
  esac
  return 0
}

minimum_length() {
  key=$1
  minimum=$2
  current=$(value "$key")
  [ -z "$current" ] && return 0
  length=$(printf '%s' "$current" | wc -c | tr -d ' ')
  [ "$length" -ge "$minimum" ] || fail "$key must contain at least $minimum characters"
}

optional_provider() {
  key=$1
  label=$2
  current=$(value "$key")
  case "$current" in
    '') configured=false ;;
    *example*|replace-*|change-me*) configured=false ;;
    *) configured=true ;;
  esac
  if [ "$configured" = true ]; then
    pass "$label configured"
  elif [ "$STRICT_EXTERNAL_PROVIDERS" = true ]; then
    fail "$label is required by STRICT_EXTERNAL_PROVIDERS=true"
  else
    printf 'PENDING: %s is not configured; its feature must remain unavailable.\n' "$label"
  fi
}

test -f "$PRODUCTION_ENV_FILE" || {
  echo "Missing $PRODUCTION_ENV_FILE" >&2
  exit 1
}

for key in NODE_ENV DOMAIN POSTGRES_PASSWORD REDIS_PASSWORD JWT_SECRET CHAT_JWT_SECRET ADMIN_EMAIL ADMIN_PASSWORD_HASH CORS_ORIGIN PUBLIC_ORIGIN VITE_ADMIN_URL FLASH_LOAN_PUBLIC_URL METRICS_TOKEN; do
  required "$key" || true
done

for key in POSTGRES_PASSWORD REDIS_PASSWORD; do minimum_length "$key" 16; done
for key in JWT_SECRET CHAT_JWT_SECRET METRICS_TOKEN; do minimum_length "$key" 32; done

jwt_secret=$(value JWT_SECRET)
chat_secret=$(value CHAT_JWT_SECRET)
[ -z "$jwt_secret" ] || [ -z "$chat_secret" ] || [ "$jwt_secret" != "$chat_secret" ] || fail 'JWT_SECRET and CHAT_JWT_SECRET must be distinct'

admin_hash=$(value ADMIN_PASSWORD_HASH)
normalized_admin_hash=$(printf '%s' "$admin_hash" | sed 's/\$\$/\$/g')
if [ -n "$normalized_admin_hash" ] && ! printf '%s' "$normalized_admin_hash" | grep -Eq '^scrypt\$[a-fA-F0-9]{32}\$[a-fA-F0-9]{64}$'; then
  fail 'ADMIN_PASSWORD_HASH must use the documented scrypt format'
fi

domain=$(value DOMAIN)
cors=$(value CORS_ORIGIN)
public_origin=$(value PUBLIC_ORIGIN)
admin_url=$(value VITE_ADMIN_URL)
node_env=$(value NODE_ENV)

[ -z "$node_env" ] || [ "$node_env" = production ] || fail 'NODE_ENV must be production'
[ -z "$domain" ] || [ "$domain" = api.lightingwallet.com ] || fail 'DOMAIN must be api.lightingwallet.com for this production deployment'
[ -z "$public_origin" ] || [ "$public_origin" = https://lightingwallet.com ] || fail 'PUBLIC_ORIGIN must be https://lightingwallet.com'
[ -z "$admin_url" ] || [ "$admin_url" = https://admin.lightingwallet.com/login ] || fail 'VITE_ADMIN_URL must point to the isolated operator domain'

case "$cors" in
  *http://*) fail 'CORS_ORIGIN must not contain plaintext HTTP in production' ;;
esac
case ",$cors," in
  *,https://lightingwallet.com,*) : ;;
  *) [ -z "$cors" ] || fail 'CORS_ORIGIN must allow the client origin' ;;
esac
case ",$cors," in
  *,https://admin.lightingwallet.com,*) : ;;
  *) [ -z "$cors" ] || fail 'CORS_ORIGIN must allow the operator origin' ;;
esac

mainnet=$(value VITE_MAINNET_EXECUTION_ENABLED)
mainnet_swap=$(value VITE_ENABLE_MAINNET_SWAP)
mainnet_launchpad=$(value VITE_ENABLE_MAINNET_LAUNCHPAD)
mainnet_bridge=$(value VITE_ENABLE_MAINNET_BRIDGE)
wallet_acceptance=$(value FINAL_WALLET_ACCEPTANCE_APPROVED)
case "$mainnet" in ''|false|true) : ;; *) fail 'VITE_MAINNET_EXECUTION_ENABLED must be true or false' ;; esac
case "$mainnet_swap" in ''|false|true) : ;; *) fail 'VITE_ENABLE_MAINNET_SWAP must be true or false' ;; esac
case "$mainnet_launchpad" in ''|false|true) : ;; *) fail 'VITE_ENABLE_MAINNET_LAUNCHPAD must be true or false' ;; esac
case "$mainnet_bridge" in ''|false|true) : ;; *) fail 'VITE_ENABLE_MAINNET_BRIDGE must be true or false' ;; esac
case "$wallet_acceptance" in ''|false|true) : ;; *) fail 'FINAL_WALLET_ACCEPTANCE_APPROVED must be true or false' ;; esac
if [ "$mainnet_swap" = true ] && [ "$mainnet" != true ]; then
  fail 'VITE_ENABLE_MAINNET_SWAP=true requires VITE_MAINNET_EXECUTION_ENABLED=true'
fi
if [ "$mainnet_launchpad" = true ] && [ "$mainnet" != true ]; then
  fail 'VITE_ENABLE_MAINNET_LAUNCHPAD=true requires VITE_MAINNET_EXECUTION_ENABLED=true'
fi
if [ "$mainnet_bridge" = true ] && [ "$mainnet" != true ]; then
  fail 'VITE_ENABLE_MAINNET_BRIDGE=true requires VITE_MAINNET_EXECUTION_ENABLED=true'
fi
if [ "$mainnet" = true ] || [ "$mainnet_swap" = true ] || [ "$mainnet_launchpad" = true ] || [ "$mainnet_bridge" = true ]; then
  [ "$STRICT_EXTERNAL_PROVIDERS" = true ] || fail 'Mainnet flags require STRICT_EXTERNAL_PROVIDERS=true and the final acceptance gate'
  [ "$wallet_acceptance" = true ] || fail 'Mainnet flags require FINAL_WALLET_ACCEPTANCE_APPROVED=true after the signed wallet acceptance checklist passes'
fi

mfa_key=$(value OPERATOR_MFA_ENCRYPTION_KEY)
if [ -z "$mfa_key" ]; then
  printf 'PENDING: operator MFA enrollment is unavailable until OPERATOR_MFA_ENCRYPTION_KEY is configured.\n'
elif printf '%s' "$mfa_key" | grep -Eq '^[a-fA-F0-9]{64}$'; then
  pass 'operator MFA encryption key format'
elif command -v openssl >/dev/null 2>&1 && decoded_bytes=$(printf '%s' "$mfa_key" | openssl base64 -d -A 2>/dev/null | wc -c | tr -d ' ') && [ "$decoded_bytes" -eq 32 ]; then
  pass 'operator MFA encryption key format'
else
  fail 'OPERATOR_MFA_ENCRYPTION_KEY must encode exactly 32 bytes as hex or base64'
fi

optional_provider VITE_WALLETCONNECT_PROJECT_ID 'WalletConnect Project ID'
optional_provider GASFREE_PROVIDER_URL 'GasFree Paymaster provider'
optional_provider MARKET_HOLDER_PROVIDER_URL 'Market holder-data provider'

walletconnect_id=$(value VITE_WALLETCONNECT_PROJECT_ID)
[ -z "$walletconnect_id" ] || printf '%s' "$walletconnect_id" | grep -Eq '^[a-fA-F0-9]{32}$' || fail 'VITE_WALLETCONNECT_PROJECT_ID must be a 32-character hexadecimal project ID'
for key in GASFREE_PROVIDER_URL MARKET_HOLDER_PROVIDER_URL; do
  provider_url=$(value "$key")
  [ -z "$provider_url" ] || case "$provider_url" in https://*) : ;; *) fail "$key must use HTTPS" ;; esac
done

swap_provider_urls=$(value SWAP_PROVIDER_URLS)
if [ -n "$swap_provider_urls" ]; then
  old_ifs=$IFS
  IFS=,
  for provider_url in $swap_provider_urls; do
    case "$provider_url" in https://*) : ;; *) fail 'Every SWAP_PROVIDER_URLS entry must use HTTPS' ;; esac
  done
  IFS=$old_ifs
fi

flash_app=$(value FLASH_LOAN_URL)
flash_api=$(value FLASH_LOAN_API_URL)
flash_targets=$(printf '%s,%s' "$flash_app" "$flash_api")
flash_approved=$(value FLASH_LOAN_PROVIDER_APPROVED)
case "$flash_approved" in ''|false|true) : ;; *) fail 'FLASH_LOAN_PROVIDER_APPROVED must be true or false' ;; esac
if [ "$flash_approved" != true ] || [ -z "$flash_app" ] || [ -z "$flash_api" ] || printf '%s' "$flash_targets" | grep -Eq 'example|localhost|lightingwallet\.com|flash-loan:32104'; then
  if [ "$STRICT_EXTERNAL_PROVIDERS" = true ]; then
    fail 'A real Flash Loan application and API are required by STRICT_EXTERNAL_PROVIDERS=true'
  else
    printf 'PENDING: Flash Loan is using the compatibility target; a real application and API are not configured.\n'
  fi
else
  pass 'Flash Loan application and API configured'
fi

delivery=$(value AUTOMATION_ENABLE_DELIVERY)
case "$delivery" in
  ''|false)
    [ "$STRICT_EXTERNAL_PROVIDERS" != true ] || fail 'Automation delivery must be explicitly enabled for the final strict provider gate'
    ;;
  true)
    telegram=$(value TELEGRAM_BOT_TOKEN)
    email_url=$(value EMAIL_PROVIDER_URL)
    email_key=$(value EMAIL_API_KEY)
    webhook_secret=$(value WEBHOOK_SIGNING_SECRET)
    if [ -z "$telegram" ] && { [ -z "$email_url" ] || [ -z "$email_key" ]; } && [ -z "$webhook_secret" ]; then
      fail 'AUTOMATION_ENABLE_DELIVERY=true requires at least one complete delivery provider'
    fi
    ;;
  *) fail 'AUTOMATION_ENABLE_DELIVERY must be true or false' ;;
esac

if [ "$failure_count" -ne 0 ]; then
  printf '\nProduction environment preflight failed with %s issue(s).\n' "$failure_count" >&2
  exit 1
fi

printf '\nProduction environment preflight passed. Mainnet execution: %s; mainnet Swap: %s; mainnet Launchpad: %s; mainnet Bridge: %s.\n' "${mainnet:-false}" "${mainnet_swap:-false}" "${mainnet_launchpad:-false}" "${mainnet_bridge:-false}"
