type BlockhashResponse={result?:{value?:{blockhash?:string;lastValidBlockHeight?:number}};error?:{message?:string}};

export async function latestSolanaBlockhash(endpoints:string[],timeoutMs=5_000){
  let lastError='Solana RPC unavailable';
  for(const endpoint of endpoints){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getLatestBlockhash',params:[{commitment:'confirmed'}]}),signal:controller.signal});
      const body=await response.json() as BlockhashResponse,value=body.result?.value;
      if(!response.ok||body.error||!value?.blockhash||!Number.isSafeInteger(value.lastValidBlockHeight))throw new Error(body.error?.message??`RPC HTTP ${response.status}`);
      return{blockhash:value.blockhash,lastValidBlockHeight:value.lastValidBlockHeight!};
    }catch(error){lastError=error instanceof Error?error.message:lastError}
    finally{clearTimeout(timer)}
  }
  throw new Error(lastError);
}
