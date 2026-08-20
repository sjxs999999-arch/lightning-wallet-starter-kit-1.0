import { scanAsset, assertLocalTestnetScanProfile, scanWalletAssets } from '../asset-collector/scanner';
import type { ScannedAsset } from '../asset-collector/types';
import { validateAddress } from '../batch-transfer/validation';
import type { CustomToken } from './public-metadata';
import type { VaultWallet } from './vault';

const MAX_CUSTOM_TOKENS = 50;

export interface WalletPortfolioResult {
  assets: ScannedAsset[];
  skipped: number;
}

function normalizedToken(value?: string) {
  return value?.toLowerCase() ?? '';
}

function safeCustomTokens(wallet: Pick<VaultWallet, 'chain' | 'id'>, tokens: CustomToken[]) {
  const seen = new Set<string>();
  const valid: CustomToken[] = [];
  let skipped = 0;
  for (const token of tokens) {
    const key = normalizedToken(token.address);
    if (
      token.walletId !== wallet.id
      || token.chain !== wallet.chain
      || !validateAddress(wallet.chain, token.address)
      || !Number.isInteger(token.decimals)
      || token.decimals < 0
      || token.decimals > 30
      || !/^[A-Z0-9._-]{1,16}$/.test(token.symbol)
      || seen.has(key)
      || valid.length >= MAX_CUSTOM_TOKENS
    ) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    valid.push(token);
  }
  return { valid, skipped };
}

async function scanCustomTokens(wallet: Pick<VaultWallet, 'chain' | 'address'>, tokens: CustomToken[], offset: number) {
  const assets: ScannedAsset[] = [];
  for (let index = 0; index < tokens.length; index += 3) {
    const batch = tokens.slice(index, index + 3);
    assets.push(...await Promise.all(batch.map((token, batchIndex) => scanAsset(wallet.chain, {
      address: wallet.address,
      token: token.address,
      decimals: token.decimals,
    }, offset + index + batchIndex, 'local-testnet'))));
    if (index + 3 < tokens.length) await new Promise(resolve => setTimeout(resolve, 120));
  }
  return assets;
}

function applyCustomSymbols(assets: ScannedAsset[], tokens: CustomToken[]) {
  const symbols = new Map(tokens.map(token => [normalizedToken(token.address), token.symbol]));
  return assets.map(asset => asset.token && symbols.has(normalizedToken(asset.token))
    ? { ...asset, symbol: symbols.get(normalizedToken(asset.token))! }
    : asset);
}

export async function scanLocalWalletPortfolio(wallet: Pick<VaultWallet, 'id' | 'chain' | 'address'>, tokens: CustomToken[]): Promise<WalletPortfolioResult> {
  await assertLocalTestnetScanProfile(wallet.chain);
  const { valid, skipped } = safeCustomTokens(wallet, tokens);
  const discovered = await scanWalletAssets(wallet.chain, { address: wallet.address }, 0, 'local-testnet');
  const discoveredTokens = new Set(discovered.flatMap(asset => asset.token ? [normalizedToken(asset.token)] : []));
  const missingCustomTokens = valid.filter(token => !discoveredTokens.has(normalizedToken(token.address)));
  const customAssets = missingCustomTokens.length ? await scanCustomTokens(wallet, missingCustomTokens, discovered.length + 1) : [];
  return { assets: applyCustomSymbols([...discovered, ...customAssets], valid), skipped };
}
