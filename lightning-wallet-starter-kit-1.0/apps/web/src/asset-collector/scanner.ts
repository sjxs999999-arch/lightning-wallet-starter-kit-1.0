import bs58 from'bs58';import{formatAtomic}from'../amount';import type{ScanInput,ScannedAsset}from'./types';import type{TransferChain}from'../batch-transfer/types';
const endpoints=(primary:string,fallbacks:string)=>[primary,...fallbacks.split(',')].map(value=>value.trim().replace(/\/$/, '')).filter((value,index,values)=>Boolean(value)&&values.indexOf(value)===index);
const evmPrimary=import.meta.env.VITE_EVM_RPC_URL||'https://ethereum-sepolia-rpc.publicnode.com';
const rpc={EVM:endpoints(evmPrimary,import.meta.env.VITE_EVM_RPC_FALLBACK_URLS||(evmPrimary.includes('sepolia')?'https://rpc.sepolia.org':'https://eth.llamarpc.com')),SOL:endpoints(import.meta.env.VITE_SOLANA_RPC_URL||'https://api.devnet.solana.com',import.meta.env.VITE_SOLANA_RPC_FALLBACK_URLS||'https://solana-rpc.publicnode.com,https://solana.drpc.org'),TRON:endpoints(import.meta.env.VITE_TRON_RPC_URL||'https://nile.trongrid.io',import.meta.env.VITE_TRON_RPC_FALLBACK_URLS||'')};
const tron=(path:string)=>rpc.TRON.map(endpoint=>`${endpoint}${path}`);
async function json(urls:string[],body:unknown){let lastError='RPC 扫描失败';for(const url of urls){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);try{const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:controller.signal});if(!response.ok)throw new Error(`RPC HTTP ${response.status}`);const data=await response.json();if(data.error)throw new Error(data.error.message??'RPC 返回错误');return data}catch(error){lastError=error instanceof Error?error.name==='AbortError'?'RPC timeout':error.message:lastError;if(/429|too many|rate limit/i.test(lastError))await new Promise(resolve=>setTimeout(resolve,250))}finally{clearTimeout(timer)}}throw new Error(lastError)}
let evmGasPricePromise:Promise<bigint>|undefined;
async function evmGasPrice(index:number){if(!evmGasPricePromise)evmGasPricePromise=json(rpc.EVM,{jsonrpc:'2.0',id:index+10_000,method:'eth_gasPrice',params:[]}).then(result=>BigInt(result.result));try{return await evmGasPricePromise}catch(error){evmGasPricePromise=undefined;throw error}}
function tokenDecimals(detected:number,provided?:number){
  if(!Number.isInteger(detected)||detected<0||detected>30)throw new Error('Token decimals 无效');
  if(provided!==undefined&&provided!==detected)throw new Error(`CSV decimals ${provided} 与链上 decimals ${detected} 不一致`);
  return detected;
}

export async function scanAsset(chain:TransferChain,input:ScanInput,index:number):Promise<ScannedAsset>{
  const id=`${chain}-${index}-${input.address}`,asset=input.token?'token':'native';
  try{
    if(chain==='EVM'){
      const data=input.token?`0x70a08231000000000000000000000000${input.address.slice(2).toLowerCase()}`:undefined;
      const[balanceResult,decimalsResult]=await Promise.all([
        json(rpc.EVM,{jsonrpc:'2.0',id:index,method:input.token?'eth_call':'eth_getBalance',params:input.token?[{to:input.token,data},'latest']:[input.address,'latest']}),
        input.token?json(rpc.EVM,{jsonrpc:'2.0',id:index+30_000,method:'eth_call',params:[{to:input.token,data:'0x313ce567'},'latest']}):Promise.resolve(undefined),
      ]);
      const decimals=input.token?tokenDecimals(Number(BigInt(decimalsResult.result)),input.decimals):18;
      const fee=(await evmGasPrice(index))*BigInt(input.token?65000:21000);
      return{...input,id,chain,asset,symbol:input.token?'ERC-20':'ETH',decimals,balance:formatAtomic(BigInt(balanceResult.result),decimals),estimatedFee:formatAtomic(fee,18),status:'ready'};
    }
    if(chain==='SOL'){
      if(input.token){
        const[result,supply]=await Promise.all([
          json(rpc.SOL,{jsonrpc:'2.0',id:index,method:'getTokenAccountsByOwner',params:[input.address,{mint:input.token},{encoding:'jsonParsed'}]}),
          json(rpc.SOL,{jsonrpc:'2.0',id:index+30_000,method:'getTokenSupply',params:[input.token]}),
        ]);
        const accounts=result.result.value as{account:{data:{parsed:{info:{tokenAmount:{amount:string}}}}}}[];
        const decimals=tokenDecimals(Number(supply.result.value.decimals),input.decimals);
        const amount=accounts.reduce((sum,item)=>sum+BigInt(item.account.data.parsed.info.tokenAmount.amount),0n);
        return{...input,id,chain,asset,symbol:'SPL',decimals,balance:formatAtomic(amount,decimals),estimatedFee:'0.00001',status:'ready'};
      }
      const result=await json(rpc.SOL,{jsonrpc:'2.0',id:index,method:'getBalance',params:[input.address]});
      return{...input,id,chain,asset,symbol:'SOL',balance:formatAtomic(BigInt(result.result.value),9),estimatedFee:'0.000005',status:'ready'};
    }
    const addressHex=Array.from(bs58.decode(input.address).slice(0,21),b=>b.toString(16).padStart(2,'0')).join('');
    if(input.token){
      const parameter=addressHex.padStart(64,'0');
      const[balanceResult,decimalsResult]=await Promise.all([
        json(tron('/wallet/triggerconstantcontract'),{owner_address:input.address,contract_address:input.token,function_selector:'balanceOf(address)',parameter,visible:true}),
        json(tron('/wallet/triggerconstantcontract'),{owner_address:input.address,contract_address:input.token,function_selector:'decimals()',parameter:'',visible:true}),
      ]);
      const raw=BigInt(`0x${balanceResult.constant_result?.[0]??'0'}`);
      const decimals=tokenDecimals(Number(BigInt(`0x${decimalsResult.constant_result?.[0]??'0'}`)),input.decimals);
      return{...input,id,chain,asset,symbol:'TRC-20',decimals,balance:formatAtomic(raw,decimals),estimatedFee:'15',status:'ready'};
    }
    const result=await json(tron('/wallet/getaccount'),{address:input.address,visible:true});
    return{...input,id,chain,asset,symbol:'TRX',balance:formatAtomic(BigInt(result.balance??0),6),estimatedFee:'1.1',status:'ready'};
  }catch(error){
    return{...input,id,chain,asset,symbol:input.token?'Token':'Native',balance:'0',estimatedFee:'0',status:'failed',error:error instanceof Error?error.message:'RPC 扫描失败'};
  }
}

type ParsedSolanaAccount={account:{data:{parsed:{info:{mint:string;tokenAmount:{amount:string;decimals:number}}}}}};
async function discoverSolanaTokens(input:ScanInput,index:number):Promise<ScannedAsset[]>{
  const programs=['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'];
  const responses=await Promise.all(programs.map((program,offset)=>json(rpc.SOL,{jsonrpc:'2.0',id:index+20_000+offset,method:'getTokenAccountsByOwner',params:[input.address,{programId:program},{encoding:'jsonParsed'}]})));
  const balances=new Map<string,{raw:bigint;decimals:number}>();
  for(const response of responses)for(const item of response.result.value as ParsedSolanaAccount[]){const info=item.account.data.parsed.info,current=balances.get(info.mint)??{raw:0n,decimals:info.tokenAmount.decimals};balances.set(info.mint,{raw:current.raw+BigInt(info.tokenAmount.amount),decimals:info.tokenAmount.decimals})}
  return[...balances.entries()].filter(([,value])=>value.raw>0n).map(([token,value],offset)=>({id:`SOL-${index}-token-${offset}-${input.address}`,chain:'SOL',asset:'token',symbol:`SPL·${token.slice(0,4)}`,address:input.address,token,decimals:value.decimals,balance:formatAtomic(value.raw,value.decimals),estimatedFee:'0.00001',status:'ready'}));
}

export async function scanWalletAssets(chain:TransferChain,input:ScanInput,index:number):Promise<ScannedAsset[]>{
  if(input.token)return[await scanAsset(chain,input,index)];
  const native=await scanAsset(chain,input,index);
  if(chain!=='SOL'||native.status==='failed')return[native];
  try{return[native,...await discoverSolanaTokens(input,index)]}catch(error){return[native,{id:`SOL-${index}-tokens-${input.address}`,chain:'SOL',asset:'token',symbol:'SPL',address:input.address,balance:'0',estimatedFee:'0',status:'failed',error:error instanceof Error?`Token 扫描失败：${error.message}`:'Token 扫描失败'}]}
}
