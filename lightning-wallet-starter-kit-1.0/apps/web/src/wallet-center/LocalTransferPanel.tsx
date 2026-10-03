import { useEffect, useMemo, useRef, useState } from 'react';
import './local-transfer.css';
import { ExternalLink, RadioTower, Send, ShieldCheck } from 'lucide-react';
import { portfolioNetworks, type PortfolioNetworkId } from './portfolio-networks';
import { localEvmNetwork, localEvmExplorer, localEvmMainnetEnabled } from './local-evm-network';
import type { CustomToken } from './public-metadata';
import type { VaultWallet } from './vault';
import { broadcastLocalTransfer, planLocalTransfer } from './local-transfer';
import { loadLocalTransferHistory, saveLocalTransferHistory } from './local-transfer-history';
import { useLocalWalletSession } from './LocalWalletSession';
import { signWithLocalWorker } from './local-signer';
import type { LocalTransferDraft, LocalTransferHistoryEntry, LocalTransferPlan } from './local-transfer-types';

type Props = { wallet: VaultWallet; vaultKey: CryptoKey; tokens: CustomToken[]; disabled?: boolean; onSensitiveStateChange?(active: boolean): void };

function nativeAsset(wallet: VaultWallet, networkId: PortfolioNetworkId = 'sepolia') {
  return wallet.chain === 'EVM'
    ? { symbol: localEvmNetwork(networkId).nativeSymbol, decimals: 18 }
    : wallet.chain === 'SOL'
      ? { symbol: 'Devnet SOL', decimals: 9 }
      : { symbol: 'Testnet TRX', decimals: 6 };
}

function transactionUrl(entry: LocalTransferHistoryEntry) {
  if (entry.chain === 'EVM') { const explorer = localEvmExplorer(entry.network);return explorer ? `${explorer}/tx/${encodeURIComponent(entry.hash)}` : undefined; }
  if (entry.chain === 'SOL') return `https://explorer.solana.com/tx/${encodeURIComponent(entry.hash)}?cluster=devnet`;
  return `https://nile.tronscan.org/#/transaction/${encodeURIComponent(entry.hash)}`;
}

function summary(plan: LocalTransferPlan) {
  return `${plan.network}\n从：${plan.draft.from}\n到：${plan.draft.to}\n数量：${plan.draft.amount} ${plan.draft.asset.symbol}\n资产合约：${plan.draft.asset.address ?? '原生币'}\n预计费用：${plan.feeLabel}`;
}

function friendlyError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : '';
  if (/insufficient/i.test(message)) return '资产或手续费余额不足，请检查所选网络余额';
  if (/429|too many|rate limit/i.test(message)) return 'RPC 请求过多，请稍后重试；页面和密钥均不受影响';
  if (/failed to fetch|network|timeout|timed out|could not coalesce/i.test(message)) return 'RPC 暂时不可用或超时，请稍后重试';
  if (/revert/i.test(message)) return 'Token 合约模拟执行失败；请核对余额、合约地址、decimals 和接收地址';
  return message || '转账操作失败；交易没有广播';
}

export function LocalTransferPanel({ wallet, vaultKey, tokens, disabled = false, onSensitiveStateChange }: Props) {
  const { isKeyActive } = useLocalWalletSession();
  const [assetId, setAssetId] = useState('native');
  const [networkId, setNetworkId] = useState<PortfolioNetworkId>(localEvmMainnetEnabled() ? 'ethereum' : 'sepolia');
  const networks = portfolioNetworks('EVM');
  const network = localEvmNetwork(networkId);
  const mainnet = wallet.chain === 'EVM' && network.scope === 'mainnet';
  const mainnetBlocked = mainnet && !localEvmMainnetEnabled();
  const [plan, setPlan] = useState<LocalTransferPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<LocalTransferHistoryEntry[]>(loadLocalTransferHistory);
  const sending = useRef(false);
  const mounted = useRef(true);
  const toRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const walletTokens = useMemo(() => tokens.filter(token => token.walletId === wallet.id), [tokens, wallet.id]);

  useEffect(() => { setAssetId('native');setNetworkId(localEvmMainnetEnabled() ? 'ethereum' : 'sepolia');setPlan(null);setError('');setNotice(''); }, [wallet.id]);
  useEffect(() => { mounted.current = true;return () => { mounted.current = false;onSensitiveStateChange?.(false); }; }, [onSensitiveStateChange]);

  function currentDraft(): LocalTransferDraft {
    const token = walletTokens.find(item => item.id === assetId);
    return {
      walletId: wallet.id, chain: wallet.chain, from: wallet.address, ...(wallet.chain === 'EVM' ? { networkId } : {}),
      to: (toRef.current?.value ?? '').trim(), amount: (amountRef.current?.value ?? '').trim(),
      asset: token ? { symbol: token.symbol, address: token.address, decimals: token.decimals } : nativeAsset(wallet, networkId),
    };
  }

  async function estimate() {
    setBusy(true);setPlan(null);setError('');setNotice('');
    try { setPlan(await planLocalTransfer(currentDraft()));setNotice('交易规划完成；尚未解密、签名或广播'); }
    catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  }

  async function signAndBroadcast() {
    if (!plan || disabled || mainnetBlocked || busy || sending.current) return;
    if (Date.now() > Date.parse(plan.expiresAt)) { setPlan(null);setError('交易规划已过期，请重新估算');return; }
    if (!window.confirm(`确认在 ${plan.network} 签名并广播？\n\n${summary(plan)}\n\n${mainnet ? '这将转移主网真实资产，广播后不可撤销。' : '这是测试网交易。'}`)) { setNotice('用户取消签名；没有解密或广播');return; }
    sending.current = true;setBusy(true);onSensitiveStateChange?.(true);setError('');setNotice('正在一次性 Worker 内验证密钥并签名…');
    let signed: Awaited<ReturnType<typeof signWithLocalWorker>> | undefined;
    try {
      if (!isKeyActive(vaultKey)) throw new Error('本地保险库已锁定，交易没有签名或广播');
      signed = await signWithLocalWorker(vaultKey, { id: wallet.id, chain: wallet.chain, address: wallet.address, encryptedPrivateKey: wallet.encryptedPrivateKey }, plan.signingPayload);
      if (!mounted.current || !isKeyActive(vaultKey)) throw new Error('本地保险库已锁定或页面已关闭；签名交易没有广播');
      setNotice('本地签名完成；正在向所选网络 RPC 广播…');
      const result = await broadcastLocalTransfer(plan, signed);
      const entry: LocalTransferHistoryEntry = {
        id: crypto.randomUUID(), walletId: wallet.id, chain: wallet.chain, network: plan.network,
        from: wallet.address, to: plan.draft.to, asset: plan.draft.asset.symbol, amount: plan.draft.amount,
        hash: result.hash, state: result.state, createdAt: new Date().toISOString(),
      };
      const next = [entry, ...history].slice(0, 200);
      saveLocalTransferHistory(next);setHistory(next);setPlan(null);setNotice(`交易${result.state === 'confirmed' ? '已确认' : '已广播'}：${result.hash}`);
    } catch (cause) { setError(friendlyError(cause)); }
    finally { if (signed?.chain === 'SOL') new Uint8Array(signed.signedTransaction).fill(0);signed = undefined;sending.current = false;onSensitiveStateChange?.(false);setBusy(false); }
  }

  const walletHistory = history.filter(entry => entry.walletId === wallet.id).slice(0, 10);
  return <section className="local-transfer-panel">
    <div className="panel-head"><div><h3><Send size={16}/>本地签名转账</h3><p>核对网络 · 用户确认 · Worker 签名 · 客户端广播</p></div><span className="testnet-pill"><RadioTower size={13}/>{mainnet ? 'MAINNET' : 'TESTNET'}</span></div>
    {wallet.chain === 'EVM' && <label>转账网络<select aria-label="本地转账网络" value={networkId} disabled={busy || disabled} onChange={event => { setNetworkId(event.target.value as PortfolioNetworkId);setAssetId('native');setPlan(null);setError('');setNotice(''); }}>{networks.map(item => <option key={item.id} value={item.id}>{item.label} · {item.scope === 'mainnet' ? '主网' : '测试网'}</option>)}</select></label>}
    {mainnetBlocked && <div className="batch-error">当前部署尚未启用本地 EVM 主网转账。请选择测试网，或等待主网功能发布。</div>}
    <div className="local-transfer-fields"><label>资产<select value={assetId} disabled={busy || disabled} onChange={event => { setAssetId(event.target.value);setPlan(null); }}><option value="native">{nativeAsset(wallet, networkId).symbol}</option>{walletTokens.map(token => <option key={token.id} value={token.id}>{token.symbol}</option>)}</select></label><label>接收地址<input ref={toRef} disabled={busy || disabled} autoComplete="off" spellCheck={false} onChange={() => setPlan(null)} placeholder="所选网络的接收地址"/></label><label>数量<input ref={amountRef} disabled={busy || disabled} inputMode="decimal" autoComplete="off" onChange={() => setPlan(null)} placeholder="0.001"/></label></div>
    <div className="local-transfer-safety"><ShieldCheck size={17}/><span>私钥只在一次性 Worker 内解密；不进入 React 状态、API、数据库或日志。EVM 网络按选择核对 Chain ID；Solana / TRON 本地转账仍限定测试网。主网转账需部署环境启用并由你逐笔确认。</span></div>
    {error && <div className="batch-error">{error}</div>}{notice && <div className="provider-message">{notice}</div>}
    {plan && <div className="local-transfer-plan"><b>签名前预览</b><dl><div><dt>网络</dt><dd>{plan.network}</dd></div><div><dt>接收</dt><dd><code>{plan.draft.to}</code></dd></div><div><dt>数量</dt><dd>{plan.draft.amount} {plan.draft.asset.symbol}</dd></div><div><dt>资产合约</dt><dd><code>{plan.draft.asset.address ?? '原生币'}</code></dd></div><div><dt>预计手续费</dt><dd>{plan.feeLabel}</dd></div></dl><p>{plan.risk.join(' · ')}</p></div>}
    <div className="detail-actions"><button disabled={busy || disabled || mainnetBlocked} onClick={() => void estimate()}>{busy ? '处理中…' : '验证并估算'}</button><button className="primary" disabled={!plan || busy || disabled || mainnetBlocked} onClick={() => void signAndBroadcast()}>{busy ? '处理中…' : '确认签名并广播'}</button></div>
    {walletHistory.length > 0 && <div className="local-transfer-history"><h4>本机交易记录（仅公开元数据）</h4>{walletHistory.map(entry => <div key={entry.id}><span className={entry.state}>{entry.state === 'confirmed' ? '已确认' : '已提交'}</span><b>{entry.amount} {entry.asset}</b><code>{entry.hash}</code>{transactionUrl(entry) && <a href={transactionUrl(entry)} target="_blank" rel="noreferrer"><ExternalLink size={12}/>浏览器</a>}</div>)}</div>}
  </section>;
}
