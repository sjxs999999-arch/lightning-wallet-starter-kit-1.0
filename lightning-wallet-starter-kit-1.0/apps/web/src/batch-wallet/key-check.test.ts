import { afterEach,describe,expect,it,vi } from 'vitest';
import { verifyExportKeyInWorker } from './key-check';
import type { EncryptedValue } from './types';

const encrypted:EncryptedValue={ciphertext:'AA==',iv:'AA==',version:1};

class PendingWorker{
  static latest:PendingWorker|undefined;
  onmessage:((event:MessageEvent<{valid:boolean}>)=>void)|null=null;
  onerror:((event:ErrorEvent)=>void)|null=null;
  terminated=false;
  constructor(){PendingWorker.latest=this}
  postMessage(){}
  terminate(){this.terminated=true}
}

describe('worker password validation cancellation',()=>{
  afterEach(()=>{vi.unstubAllGlobals();PendingWorker.latest=undefined});

  it('terminates the password-check worker when validation is cancelled',async()=>{
    vi.stubGlobal('Worker',PendingWorker);
    const controller=new AbortController(),pending=verifyExportKeyInWorker({} as CryptoKey,encrypted,controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({name:'AbortError'});
    expect(PendingWorker.latest?.terminated).toBe(true);
  });

  it('does not start a worker for an already-cancelled validation',async()=>{
    vi.stubGlobal('Worker',PendingWorker);
    const controller=new AbortController();controller.abort();
    await expect(verifyExportKeyInWorker({} as CryptoKey,encrypted,controller.signal)).rejects.toMatchObject({name:'AbortError'});
    expect(PendingWorker.latest).toBeUndefined();
  });
});
