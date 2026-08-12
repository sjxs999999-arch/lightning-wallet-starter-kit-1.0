import type { EncryptedValue } from './types';

function abortError(){const error=new Error('本地验证已取消');error.name='AbortError';return error}

export function verifyExportKeyInWorker(key:CryptoKey,value:EncryptedValue,signal?:AbortSignal){return new Promise<boolean>((resolve,reject)=>{
  if(signal?.aborted){reject(abortError());return}
  const worker=new Worker(new URL('./key-check.worker.ts',import.meta.url),{type:'module'});let settled=false;
  const cleanup=()=>{signal?.removeEventListener('abort',onAbort);worker.terminate()};
  const finish=(result:boolean)=>{if(settled)return;settled=true;cleanup();resolve(result)};
  const fail=(cause:Error)=>{if(settled)return;settled=true;cleanup();reject(cause)};
  const onAbort=()=>fail(abortError());
  signal?.addEventListener('abort',onAbort,{once:true});
  worker.onmessage=(event:MessageEvent<{valid:boolean}>)=>finish(event.data.valid===true);
  worker.onerror=()=>fail(new Error('本地密码验证线程异常'));
  try{worker.postMessage({key,value})}catch(cause){fail(cause instanceof Error?cause:new Error('无法启动本地密码验证线程'))}
})}
