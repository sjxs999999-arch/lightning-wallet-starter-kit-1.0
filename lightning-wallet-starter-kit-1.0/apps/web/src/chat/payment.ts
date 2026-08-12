import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { verifyMessage } from 'ethers';
import type { PaymentRequest } from './types';

type UnsignedPaymentRequest = Omit<PaymentRequest, 'signature'>;

export function canonicalPaymentRequest(payment: UnsignedPaymentRequest) {
  return JSON.stringify({ domain: 'wallet.br.com', purpose: 'chat-payment-request', requestId: payment.requestId, chain: payment.chain, chainId: payment.chainId, asset: payment.asset, amount: payment.amount, payTo: payment.payTo, requesterAddress: payment.requesterAddress, expiresAt: payment.expiresAt, memo: payment.memo, status: payment.status });
}

export function amountValid(value: string) { return value.length <= 80 && /^\d+(?:\.\d{1,18})?$/.test(value) && Number.isFinite(Number(value)) && Number(value) > 0; }

export function paymentShapeValid(payment: PaymentRequest, sender: { chain: string; address: string }, now = Date.now()) {
  const expiry = Date.parse(payment.expiresAt);
  return Boolean(payment.requestId && payment.requestId.length <= 80 && payment.chain === sender.chain && typeof payment.chainId === 'string' && /^[A-Za-z0-9:_-]{1,40}$/.test(payment.chainId) && typeof payment.asset === 'string' && /^[A-Za-z0-9:._-]{1,80}$/.test(payment.asset) && amountValid(payment.amount) && payment.payTo.toLowerCase() === sender.address.toLowerCase() && payment.requesterAddress.toLowerCase() === sender.address.toLowerCase() && Number.isFinite(expiry) && expiry > now && expiry <= now + 24 * 60 * 60_000 && typeof payment.memo === 'string' && payment.memo.length <= 120 && payment.status === 'pending' && typeof payment.signature === 'string' && payment.signature.length >= 40 && payment.signature.length <= 400);
}

export async function verifyPaymentRequest(payment: PaymentRequest, sender: { chain: string; address: string }, now = Date.now()) {
  if (!paymentShapeValid(payment, sender, now)) return false;
  const { signature, ...unsigned } = payment, message = canonicalPaymentRequest(unsigned);
  if (payment.chain === 'EVM') { try { return verifyMessage(message, signature).toLowerCase() === sender.address.toLowerCase(); } catch { return false; } }
  if (payment.chain === 'SOL') { try { return ed25519.verify(Uint8Array.from(atob(signature), value => value.charCodeAt(0)), new TextEncoder().encode(message), bs58.decode(sender.address)); } catch { return false; } }
  return false;
}
