import { describe, expect, it } from 'vitest';
import { PublicKey, SystemProgram, Transaction as SolanaTransaction } from '@solana/web3.js';
import { Transaction as EvmTransaction } from 'ethers';
import { createExportKey, encryptValue } from '../batch-wallet/crypto';
import { deriveWallet, newMnemonic } from '../batch-wallet/engine';
import { signLocalPayload } from './local-signer-core';

async function encryptedWallet(chain: 'EVM' | 'SOL' | 'TRON') {
  const derived = await deriveWallet(chain, newMnemonic(), 0);
  const created = await createExportKey('local signing test password');
  return {
    key: created.key,
    wallet: { id: `${chain}-1`, chain, address: derived.address, encryptedPrivateKey: await encryptValue(created.key, derived.privateKey) },
  };
}

function base64(value: Uint8Array) { return btoa(String.fromCharCode(...value)); }

describe('one-shot local signer core', () => {
  it('signs an EVM transaction for the encrypted wallet address', async () => {
    const { key, wallet } = await encryptedWallet('EVM');
    const result = await signLocalPayload(key, wallet, { chain: 'EVM', transaction: {
      chainId: 11155111, nonce: 0, gasLimit: '21000', gasPrice: '1000000000', type: 0,
      to: wallet.address, value: '0',
    } });
    expect(result.chain).toBe('EVM');
    if (result.chain !== 'EVM') return;
    const transaction = EvmTransaction.from(result.signedTransaction);
    expect(transaction.from).toBe(wallet.address);
    expect(transaction.chainId).toBe(11155111n);
  });

  it('signs a Solana transaction and verifies its signature', async () => {
    const { key, wallet } = await encryptedWallet('SOL');
    const owner = new PublicKey(wallet.address);
    const transaction = new SolanaTransaction({ feePayer: owner, recentBlockhash: owner.toBase58() })
      .add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: owner, lamports: 0 }));
    const unsigned = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
    const result = await signLocalPayload(key, wallet, { chain: 'SOL', transaction: base64(unsigned) });
    expect(result.chain).toBe('SOL');
    if (result.chain !== 'SOL') return;
    const signed = SolanaTransaction.from(new Uint8Array(result.signedTransaction));
    expect(signed.feePayer?.toBase58()).toBe(wallet.address);
    expect(signed.verifySignatures()).toBe(true);
  });

  it('signs a TRON transaction without a server signer', async () => {
    const { key, wallet } = await encryptedWallet('TRON');
    const transaction = { txID: '11'.repeat(32), raw_data: { contract: [], ref_block_bytes: '', ref_block_hash: '', expiration: Date.now() + 60_000, timestamp: Date.now() }, raw_data_hex: '', visible: true };
    const result = await signLocalPayload(key, wallet, { chain: 'TRON', transaction });
    expect(result.chain).toBe('TRON');
    if (result.chain !== 'TRON') return;
    expect(result.signedTransaction.signature).toEqual([expect.stringMatching(/^[0-9a-f]{130}$/i)]);
  });

  it('rejects a ciphertext bound to a different address', async () => {
    const first = await encryptedWallet('EVM');
    const other = await deriveWallet('EVM', newMnemonic(), 0);
    await expect(signLocalPayload(first.key, { ...first.wallet, address: other.address }, { chain: 'EVM', transaction: {
      chainId: 11155111, nonce: 0, gasLimit: '21000', gasPrice: '1', type: 0, to: other.address, value: '0',
    } })).rejects.toThrow('KEY_MISMATCH');
  });
});

