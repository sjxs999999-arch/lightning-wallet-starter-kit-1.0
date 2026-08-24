#!/bin/sh
set -eu

output=
payload=
url=
failure=${MOCK_WALLET_ACCEPTANCE_FAILURE:-}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output=$2; shift 2 ;;
    --data) payload=$2; shift 2 ;;
    --write-out|--max-time|-X|-H) shift 2 ;;
    --silent|--show-error) shift ;;
    http*) url=$1; shift ;;
    *) shift ;;
  esac
done

[ -n "$output" ] && [ -n "$payload" ] && [ -n "$url" ] || exit 2

case "$payload" in
  *'"method":"eth_chainId"'*)
    chain=0xaa36a7
    [ "$failure" != evm-chain ] || chain=0x1
    jq -nc --arg chain "$chain" '{jsonrpc:"2.0",id:1,result:$chain}' > "$output"
    ;;
  *'"method":"eth_getTransactionReceipt"'*)
    reference=$(printf '%s' "$payload" | jq -r '.params[0]')
    status=0x1
    [ "$failure" != evm ] || status=0x0
    jq -nc --arg reference "$reference" --arg status "$status" '{jsonrpc:"2.0",id:1,result:{transactionHash:$reference,status:$status,blockNumber:"0x123"}}' > "$output"
    ;;
  *'"method":"getGenesisHash"'*)
    genesis=EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG
    [ "$failure" != solana-chain ] || genesis=wrong-cluster
    jq -nc --arg genesis "$genesis" '{jsonrpc:"2.0",id:1,result:$genesis}' > "$output"
    ;;
  *'"method":"getSignatureStatuses"'*)
    references=$(printf '%s' "$payload" | jq -c '.params[0]')
    if [ "$failure" = solana ]; then
      values=$(printf '%s' "$references" | jq '[.[] | {slot:123,confirmations:null,confirmationStatus:"finalized",err:"failed"}]')
    else
      values=$(printf '%s' "$references" | jq '[.[] | {slot:123,confirmations:null,confirmationStatus:"finalized",err:null}]')
    fi
    jq -nc --argjson values "$values" '{jsonrpc:"2.0",id:1,result:{context:{slot:123},value:$values}}' > "$output"
    ;;
  *)
    reference=$(printf '%s' "$payload" | jq -r '.value')
    case "$url" in
      */wallet/gettransactionbyid)
        result=SUCCESS
        [ "$failure" != tron ] || result=REVERT
        jq -nc --arg reference "$reference" --arg result "$result" '{txID:$reference,ret:[{contractRet:$result}]}' > "$output"
        ;;
      */wallet/gettransactioninfobyid)
        jq -nc --arg reference "$reference" '{id:$reference,blockNumber:123,receipt:{result:"SUCCESS"}}' > "$output"
        ;;
      *) exit 2 ;;
    esac
    ;;
esac

printf '200'
