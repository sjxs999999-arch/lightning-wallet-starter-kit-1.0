import { z } from 'zod';

export const riskTokenSchema = z.object({
  chain: z.enum(['1', '10', '137', '8453', '42161', 'solana']),
  address: z.string().trim().min(32).max(64).refine(value => !/\s/.test(value)),
}).strict();

type Finding = { label: string; status: 'safe' | 'warn' | 'danger' | 'unknown'; detail: string };
const flag = (value: unknown) => String(value ?? '') === '1';
const display = (value: unknown, fallback = '未提供') => typeof value === 'string' && value ? value : fallback;

function evmFindings(token: Record<string, unknown>): Finding[] {
  const cannotSell = flag(token.cannot_sell_all), honeypot = flag(token.is_honeypot), blacklist = flag(token.is_blacklisted), open = flag(token.is_open_source), mintable = flag(token.is_mintable), proxy = flag(token.is_proxy);
  return [
    { label: '卖出 / 貔貅风险', status: honeypot || cannotSell ? 'danger' : 'safe', detail: honeypot ? '检测到 Honeypot 信号' : cannotSell ? '可能无法全部卖出' : '未检测到限制信号' },
    { label: '黑名单能力', status: blacklist ? 'danger' : 'safe', detail: blacklist ? '合约包含黑名单信号' : '未检测到' },
    { label: '合约源码', status: open ? 'safe' : 'warn', detail: open ? '已开源' : '未确认开源' },
    { label: '额外铸币权限', status: mintable ? 'warn' : 'safe', detail: mintable ? '仍可增发' : '未检测到增发权限' },
    { label: '代理升级', status: proxy ? 'warn' : 'safe', detail: proxy ? '可升级代理' : '未检测到代理' },
    { label: '买 / 卖税', status: Number(token.buy_tax ?? 0) > 0.1 || Number(token.sell_tax ?? 0) > 0.1 ? 'danger' : Number(token.buy_tax ?? 0) > 0.03 || Number(token.sell_tax ?? 0) > 0.03 ? 'warn' : 'safe', detail: `${(Number(token.buy_tax ?? 0) * 100).toFixed(2)}% / ${(Number(token.sell_tax ?? 0) * 100).toFixed(2)}%` },
  ];
}

function solanaFindings(token: Record<string, unknown>): Finding[] {
  const status = (value: unknown) => value && typeof value === 'object' && 'status' in value ? (value as { status?: unknown }).status : undefined;
  const mintable = Boolean(status(token.mintable) ?? token.mint_authority), closable = Boolean(status(token.closable)), freezable = Boolean(status(token.freezable) ?? token.freeze_authority), locked = String(token.is_locked ?? '') === '1';
  return [
    { label: '铸币权限', status: mintable ? 'warn' : 'safe', detail: mintable ? 'Mint 权限仍存在' : '未检测到 Mint 权限' },
    { label: '冻结权限', status: freezable ? 'warn' : 'safe', detail: freezable ? 'Token 可冻结' : '未检测到冻结权限' },
    { label: '关闭权限', status: closable ? 'warn' : 'safe', detail: closable ? '账户可关闭' : '未检测到' },
    { label: '流动性锁定', status: locked ? 'safe' : 'unknown', detail: locked ? '检测到锁定信息' : '未确认' },
    { label: '交易限制', status: 'unknown', detail: '需结合实时模拟与交易池深度' },
  ];
}

export async function scanTokenRisk(raw: unknown) {
  const input = riskTokenSchema.parse(raw);
  const url = input.chain === 'solana' ? `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${encodeURIComponent(input.address)}` : `https://api.gopluslabs.io/api/v1/token_security/${input.chain}?contract_addresses=${encodeURIComponent(input.address)}`;
  const response = await fetch(url, { headers: { accept: 'application/json', ...(process.env.GOPLUS_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.GOPLUS_ACCESS_TOKEN}` } : {}) } });
  const body = await response.json() as { code?: number; message?: string; result?: Record<string, Record<string, unknown>> };
  if (!response.ok || body.code !== 1) throw new Error(body.message ?? `GOPLUS_HTTP_${response.status}`);
  const token = body.result?.[input.address] ?? body.result?.[input.address.toLowerCase()] ?? Object.values(body.result ?? {})[0];
  if (!token) throw new Error('TOKEN_RISK_NOT_FOUND');
  const findings = input.chain === 'solana' ? solanaFindings(token) : evmFindings(token);
  const danger = findings.filter(item => item.status === 'danger').length, warn = findings.filter(item => item.status === 'warn').length, unknown = findings.filter(item => item.status === 'unknown').length;
  const score = Math.max(0, 100 - danger * 35 - warn * 12 - unknown * 5);
  return { score, level: danger ? 'high' : warn >= 2 ? 'medium' : unknown >= findings.length / 2 ? 'unknown' : 'low', tokenName: display(token.token_name, ''), tokenSymbol: display(token.token_symbol, ''), findings, sources: ['GoPlus Security', '公开链上数据'], scannedAt: new Date().toISOString() };
}
