import { randomUUID } from 'node:crypto';

const publicUrl = value => {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};

const mediaDescriptor = (value, kind) => {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') return null;
  const rules = {
    logo: { types: ['image/png', 'image/jpeg', 'image/webp'], max: 2_000_000 },
    banner: { types: ['image/png', 'image/jpeg', 'image/webp'], max: 5_000_000 },
    whitepaper: { types: ['application/pdf'], max: 10_000_000 },
  }[kind];
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const type = typeof value.type === 'string' ? value.type : '';
  const size = value.size;
  return name && name.length <= 120 && rules.types.includes(type) && Number.isInteger(size) && size >= 0 && size <= rules.max
    ? { name, type, size }
    : null;
};

export const parseLaunchpadDraft = input => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const allowed = ['chain', 'network', 'name', 'symbol', 'decimals', 'supply', 'description', 'website', 'socials', 'media', 'liquidity', 'dryRun'];
  if (!Object.keys(input).every(key => allowed.includes(key))) return null;
  const chain = ['EVM', 'SOL', 'TRON'].includes(input.chain) ? input.chain : null;
  const expected = { EVM: 'sepolia', SOL: 'solana-devnet', TRON: 'tron-nile' }[chain];
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const symbol = typeof input.symbol === 'string' ? input.symbol.trim().toUpperCase() : '';
  const decimals = input.decimals;
  const supply = typeof input.supply === 'string' ? input.supply : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const website = publicUrl(input.website);
  const socials = input.socials && typeof input.socials === 'object' && !Array.isArray(input.socials)
    ? { x: publicUrl(input.socials.x), telegram: publicUrl(input.socials.telegram), discord: publicUrl(input.socials.discord) }
    : null;
  const media = input.media && typeof input.media === 'object' && !Array.isArray(input.media)
    ? { logo: mediaDescriptor(input.media.logo, 'logo'), banner: mediaDescriptor(input.media.banner, 'banner'), whitepaper: mediaDescriptor(input.media.whitepaper, 'whitepaper') }
    : null;
  const liquidity = input.liquidity && typeof input.liquidity === 'object' && !Array.isArray(input.liquidity)
    ? { tokenAmount: String(input.liquidity.tokenAmount ?? ''), quoteSymbol: String(input.liquidity.quoteSymbol ?? '').trim().toUpperCase(), quoteAmount: String(input.liquidity.quoteAmount ?? ''), lockDays: input.liquidity.lockDays }
    : null;
  const positive = value => /^\d{1,78}$/.test(value) && BigInt(value) > 0n;
  if (!chain || input.network !== expected || name.length < 2 || name.length > 50 || !/^[A-Z0-9]{2,12}$/.test(symbol) || !Number.isInteger(decimals) || decimals < 0 || decimals > (chain === 'SOL' ? 9 : 18) || !positive(supply) || description.length > 1000 || website === null || !socials || Object.values(socials).includes(null) || !media || Object.values(media).includes(null) || !liquidity || !positive(liquidity.tokenAmount) || !positive(liquidity.quoteAmount) || !/^[A-Z0-9]{2,12}$/.test(liquidity.quoteSymbol) || !Number.isInteger(liquidity.lockDays) || liquidity.lockDays < 0 || liquidity.lockDays > 3650 || typeof input.dryRun !== 'boolean') return null;
  return { chain, network: expected, name, symbol, decimals, supply, description, website, socials, media, liquidity, dryRun: input.dryRun };
};

export const createLaunchpadValidation = draft => ({
  planId: randomUUID(),
  chain: draft.chain,
  network: draft.network,
  dryRun: draft.dryRun,
  status: draft.dryRun ? 'validated' : 'signature-required',
  broadcast: false,
  serverSigning: false,
  requiredSigner: 'user-wallet',
  checklist: {
    token: true,
    metadata: Boolean(draft.description),
    logo: Boolean(draft.media.logo),
    banner: Boolean(draft.media.banner),
    links: Boolean(draft.website || Object.values(draft.socials).some(Boolean)),
    whitepaper: Boolean(draft.media.whitepaper),
    liquidity: true,
  },
});
