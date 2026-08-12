/// <reference lib="webworker" />
import { validateEncryptedValue } from './key-check-core';
import type { EncryptedValue } from './types';

self.onmessage=async(event:MessageEvent<{key:CryptoKey;value:EncryptedValue}>)=>{const valid=await validateEncryptedValue(event.data.key,event.data.value);self.postMessage({valid});self.close()};
export {};
