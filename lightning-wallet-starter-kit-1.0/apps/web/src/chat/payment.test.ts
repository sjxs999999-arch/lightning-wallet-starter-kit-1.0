import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { Wallet } from 'ethers';
import { describe, expect, it } from 'vitest';
import { canonicalPaymentRequest, verifyPaymentRequest } from './payment';
import type { PaymentRequest } from './types';

const base = { requestId: '00000000-0000-4000-8000-000000000001', chainId: '1', asset: 'ETH', amount: '0.1', expiresAt: new Date(Date.now() + 60_000).toISOString(), memo: 'invoice', status: 'pending' as const };

describe('signed chat payment request', () => {
  it('verifies an EVM wallet signature and rejects payTo tampering', async () => {
    const wallet = Wallet.createRandom(), unsigned = { ...base, chain: 'EVM' as const, payTo: wallet.address, requesterAddress: wallet.address };
    const payment: PaymentRequest = { ...unsigned, signature: await wallet.signMessage(canonicalPaymentRequest(unsigned)) };
    await expect(verifyPaymentRequest(payment, { chain: 'EVM', address: wallet.address })).resolves.toBe(true);
    await expect(verifyPaymentRequest({ ...payment, payTo: '0x0000000000000000000000000000000000000001' }, { chain: 'EVM', address: wallet.address })).resolves.toBe(false);
  });

  it('verifies a Solana Ed25519 signature and rejects amount tampering', async () => {
    const pair = ed25519.keygen(), address = bs58.encode(pair.publicKey), unsigned = { ...base, chain: 'SOL' as const, chainId: 'solana:mainnet', asset: 'SOL', payTo: address, requesterAddress: address };
    const signature = ed25519.sign(new TextEncoder().encode(canonicalPaymentRequest(unsigned)), pair.secretKey), payment: PaymentRequest = { ...unsigned, signature: btoa(String.fromCharCode(...signature)) };
    await expect(verifyPaymentRequest(payment, { chain: 'SOL', address })).resolves.toBe(true);
    await expect(verifyPaymentRequest({ ...payment, amount: '99' }, { chain: 'SOL', address })).resolves.toBe(false);
  });
});
