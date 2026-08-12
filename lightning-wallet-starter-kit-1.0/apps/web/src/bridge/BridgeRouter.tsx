import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, Gauge, LockKeyhole, RefreshCw, Route, ShieldCheck, Timer, WalletCards } from 'lucide-react';
import { api } from '../api';
import { executeBridgeRoute } from './executor';
import { formatDuration, routeRisk, validateBridgeRequest } from './guard';
import { BRIDGE_CHAINS, type BridgeQuoteRequest, type BridgeRoute } from './types';

function short(value: string) { return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value; }
function usd(value?: string) { const number = Number(value); return value !== undefined && Number.isFinite(number) ? `$${number.toFixed(2)}` : '待确认'; }

export function BridgeRouter() {
  const [fromChainId, setFromChainId] = useState(1);
  const [toChainId, setToChainId] = useState(42161);
  const [fromToken, setFromToken] = useState('USDC');
  const [toToken, setToToken] = useState('USDC');
  const [fromAmount, setFromAmount] = useState('1000000');
  const [fromAddress, setFromAddress] = useState('');
  const [toAddress, setToAddress] = useState('');
  const [slippageBps, setSlippageBps] = useState(50);
  const [order, setOrder] = useState<BridgeQuoteRequest['order']>('CHEAPEST');
  const [routes, setRoutes] = useState<BridgeRoute[]>([]);
  const [selected, setSelected] = useState('');
  const [quotedRequest, setQuotedRequest] = useState<BridgeQuoteRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const fromChain = useMemo(() => BRIDGE_CHAINS.find(chain => chain.id === fromChainId)!, [fromChainId]);
  const toChain = useMemo(() => BRIDGE_CHAINS.find(chain => chain.id === toChainId)!, [toChainId]);
  const chosen = routes.find(route => route.id === selected) ?? null;

  function invalidate() { setRoutes([]); setSelected(''); setQuotedRequest(null); setResult(''); }
  async function quote() {
    setBusy(true); setError(''); invalidate();
    try {
      const request = validateBridgeRequest({ fromChainId, toChainId, fromToken: fromToken.trim(), toToken: toToken.trim(), fromAmount, fromAddress: fromAddress.trim(), toAddress: (toAddress || fromAddress).trim(), slippageBps, order });
      const result = await api<{ data: BridgeRoute[] }>('/bridge/quotes', { method: 'POST', body: JSON.stringify(request) });
      if (!result.data.length) throw new Error('当前参数没有可用路线');
      setRoutes(result.data); setSelected(result.data[0]!.id); setQuotedRequest(request);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '跨链报价暂时不可用'); }
    finally { setBusy(false); }
  }

  async function continueRoute() {
    if (!chosen) return;
    const warnings = routeRisk(chosen);
    if (!window.confirm(`${chosen.providerLabel}\n预计到账：${chosen.toAmount ?? '待确认'}\n${warnings.length ? `风险：${warnings.join('；')}\n` : ''}确认继续到用户钱包或官方桥？`)) return;
    if (chosen.officialUrl) { window.open(chosen.officialUrl, '_blank', 'noopener,noreferrer'); return; }
    if (!quotedRequest || !chosen.transaction) { setError('该报价未包含可签名交易，请重新获取报价'); return; }
    setExecuting(true); setError(''); setResult('');
    try {
      const execution = await executeBridgeRoute(quotedRequest, chosen);
      setResult(execution.kind === 'approval' ? `精确额度授权已提交：${short(execution.reference)}。链上确认后请重新报价，再执行跨链。` : `跨链交易已由钱包提交：${short(execution.reference)}`);
      if (execution.kind === 'approval') { setRoutes([]); setSelected(''); setQuotedRequest(null); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '用户取消或钱包拒绝交易'); }
    finally { setExecuting(false); }
  }

  return <>
    <div className="page-head"><div><p className="eyebrow">LIGHTNING BRIDGE ROUTER</p><h1>跨链路由</h1><p>比较官方桥与聚合路线，费用、到账时间和风险先展示，最终交易只由用户钱包签名。</p></div></div>
    <div className="bridge-layout">
      <section className="panel bridge-form"><h3>跨链参数</h3>
        <div className="bridge-chain-pair"><label>来源网络<select value={fromChainId} onChange={event => { setFromChainId(Number(event.target.value)); invalidate(); }}>{BRIDGE_CHAINS.map(chain => <option value={chain.id} key={chain.id}>{chain.name}</option>)}</select></label><ArrowRight/><label>目标网络<select value={toChainId} onChange={event => { setToChainId(Number(event.target.value)); invalidate(); }}>{BRIDGE_CHAINS.map(chain => <option value={chain.id} key={chain.id}>{chain.name}</option>)}</select></label></div>
        <div className="bridge-two"><label>发送 Token<input value={fromToken} onChange={event => { setFromToken(event.target.value); invalidate(); }} placeholder="USDC 或 Token 地址"/></label><label>接收 Token<input value={toToken} onChange={event => { setToToken(event.target.value); invalidate(); }} placeholder="USDC 或 Token 地址"/></label></div>
        <label>发送数量（最小单位）<input value={fromAmount} inputMode="numeric" onChange={event => { setFromAmount(event.target.value.replace(/\D/g, '')); invalidate(); }} placeholder="例如 1 USDC = 1000000"/><small>按 Token decimals 输入整数，避免浮点精度错误。</small></label>
        <label>发送钱包地址<input value={fromAddress} onChange={event => { setFromAddress(event.target.value.trim()); invalidate(); }} placeholder={fromChain.family === 'SOL' ? 'Solana 地址' : '0x…'}/></label>
        <label>接收地址（留空则与发送地址相同）<input value={toAddress} onChange={event => { setToAddress(event.target.value.trim()); invalidate(); }} placeholder={toChain.family === 'SOL' ? 'Solana 地址' : '0x…'}/></label>
        <div className="bridge-two"><label>最大滑点<select value={slippageBps} onChange={event => { setSlippageBps(Number(event.target.value)); invalidate(); }}><option value={10}>0.10%</option><option value={30}>0.30%</option><option value={50}>0.50%</option><option value={100}>1.00%</option></select></label><label>排序<select value={order} onChange={event => { setOrder(event.target.value as BridgeQuoteRequest['order']); invalidate(); }}><option value="CHEAPEST">费用最低</option><option value="FASTEST">到账最快</option></select></label></div>
        <div className="bridge-risk-note"><AlertTriangle/>跨链桥涉及验证器、合约、流动性与延迟风险。报价会过期，签名前必须重新核对钱包弹窗。</div>
        {error && <div className="batch-error">{error}</div>}
        {result && <div className="notice"><CheckCircle2 size={17}/>{result}</div>}
        <button disabled={busy || executing || !fromAddress || !fromAmount} onClick={() => void quote()}>{busy ? <><RefreshCw className="spin" size={16}/>正在比较实时路线…</> : <><Route size={16}/>比较并模拟跨链路线</>}</button>
      </section>
      <section className="panel bridge-results"><div className="panel-head"><div><p className="eyebrow">NON-CUSTODIAL QUOTES</p><h3>可用路线</h3></div><span>{routes.length} 条</span></div>
        {routes.length ? <><div className="bridge-route-list">{routes.map((route, index) => { const warnings = routeRisk(route); return <button key={route.id} className={selected === route.id ? 'selected' : ''} disabled={executing} onClick={() => setSelected(route.id)}><div className="bridge-provider"><span>{index === 0 ? <CheckCircle2/> : route.kind === 'official' ? <ExternalLink/> : <Route/>}</span><div><b>{route.providerLabel}</b><small>{route.kind === 'official' ? '官方桥' : route.steps.join(' → ') || '聚合路由'}</small></div></div><div><small>预计到账</small><b>{route.toAmount ?? '连接后确认'}</b><em>最低 {route.toAmountMin ?? '—'}</em></div><div><small>费用 / Gas</small><b>{usd(route.feeUsd)} / {usd(route.gasCostUsd)}</b><em><Timer/> {formatDuration(route.durationSeconds)}</em></div><div className={warnings.length ? 'bridge-risk medium' : 'bridge-risk low'}><ShieldCheck/>{warnings.length ? `${warnings.length} 项提示` : '基础校验通过'}</div></button>; })}</div>{chosen && <div className="bridge-confirm"><div><b>{chosen.providerLabel}</b><span>{fromChain.name} → {toChain.name} · {short(fromAddress)}</span></div><button disabled={executing} onClick={() => void continueRoute()}>{executing ? '正在核验与模拟…' : chosen.officialUrl ? '打开官方桥' : '模拟后进入钱包确认'} <ArrowRight size={16}/></button></div>}</> : <div className="bridge-empty"><WalletCards/><h3>先获取实时路线</h3><p>支持 Arbitrum、Optimism、Base、Polygon 官方入口，以及 LI.FI、Across、Stargate 和 Wormhole/Mayan 路线。</p><div><span><Gauge/>费用比较</span><span><Timer/>到账预估</span><span><LockKeyhole/>用户签名</span></div></div>}
      </section>
    </div>
    <section className="panel bridge-boundary"><ShieldCheck/><div><b>资产与签名边界</b><p>服务器只转发公开报价，不持有资产、不接收私钥、不代签、不自动授权；需要授权时默认暂停，由用户在钱包中核对精确额度。</p></div></section>
  </>;
}
