import type { TransferChain } from '../batch-transfer/types';
import { assertLocalTestnetScanProfile, scanWalletAssets, type ScanProfile } from './scanner';
import type { ScanInput } from './types';

self.onmessage = async (event: MessageEvent<{ chain: TransferChain; inputs: ScanInput[]; profile?: ScanProfile }>) => {
  const { chain, inputs, profile = 'configured' } = event.data;
  let completed = 0;
  try {
    if (profile === 'local-testnet') await assertLocalTestnetScanProfile(chain);
    const concurrency = profile === 'local-testnet' ? 2 : 8;
    for (let offset = 0; offset < inputs.length; offset += concurrency) {
      const groups = await Promise.all(inputs.slice(offset, offset + concurrency).map((input, index) => scanWalletAssets(chain, input, offset + index, profile)));
      completed += groups.length;
      self.postMessage({ type: 'batch', assets: groups.flat(), completed });
      await new Promise(resolve => setTimeout(resolve, profile === 'local-testnet' ? 100 : 0));
    }
    self.postMessage({ type: 'done', completed });
  } catch (cause) {
    self.postMessage({ type: 'error', completed, message: cause instanceof Error ? cause.message : '归集扫描网络验证失败' });
  }
};

export {};
