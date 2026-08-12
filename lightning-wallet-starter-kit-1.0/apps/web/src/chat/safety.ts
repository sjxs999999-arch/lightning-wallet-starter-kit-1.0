const SEED_WORDS = /\b(?:abandon|ability|able|about|above|absent|absorb|abstract|absurd|abuse|access|accident)(?:\s+[a-z]{3,12}){10,23}\b/i;
const EVM_PRIVATE_KEY = /(?:^|[^a-fA-F0-9])0x[a-fA-F0-9]{64}(?=$|[^a-fA-F0-9])/;
const SOLANA_SECRET = /(?:^|[^1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{85,90}(?=$|[^1-9A-HJ-NP-Za-km-z])/;

export function sensitiveMaterialReason(text: string): string | null {
  if (EVM_PRIVATE_KEY.test(text)) return '检测到可能的 EVM 私钥，已阻止发送';
  if (SOLANA_SECRET.test(text)) return '检测到可能的 Solana 私钥，已阻止发送';
  if (SEED_WORDS.test(text.trim())) return '检测到可能的助记词，已阻止发送';
  return null;
}

export function addressLooksValid(chain: 'EVM' | 'SOL' | 'TRON', value: string) {
  if (chain === 'EVM') return /^0x[0-9a-fA-F]{40}$/.test(value);
  if (chain === 'TRON') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

export function externalHosts(text: string) {
  const found = text.match(/https:\/\/[^\s<>()]+/g) ?? [];
  return found.flatMap(value => { try { return [new URL(value).hostname]; } catch { return []; } });
}
