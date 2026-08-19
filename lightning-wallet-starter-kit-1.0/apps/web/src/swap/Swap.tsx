import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, History, RefreshCw, ShieldCheck } from 'lucide-react';
import { parseUnits } from 'ethers';
import { ApiError, api } from '../api';
import { executeSwap } from './executor';
import { validateImpact, validateSlippage } from './guard';
import { swapPlanPayload, swapResultPayload } from './persistence';
import type { SwapJob } from './persistence';
import { loadLocalSwapHistory, saveLocalSwapJob } from './local-history';
import { bestRoute } from './routing';
import type { SwapCandidate, SwapChain, SwapRequest } from './types';

export function Swap() {
  const [chain, setChain] = useState<SwapChain>('EVM');
  const [evmChainId, setEvmChainId] = useState(1);
  const [taker, setTaker] = useState('');
  const [sellToken, setSellToken] = useState('');
  const [buyToken, setBuyToken] = useState('');
  const [amount, setAmount] = useState('');
  const [decimals, setDecimals] = useState(18);
  const [slippage, setSlippage] = useState(0.5);
  const [dryRun, setDryRun] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [quotes, setQuotes] = useState<SwapCandidate[]>([]);
  const [selected, setSelected] = useState<SwapCandidate | null>(null);
  const [history, setHistory] = useState<SwapJob[]>([]);
  const [error, setError] = useState('');
  const [recordError, setRecordError] = useState('');
  const [busy, setBusy] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [lastUpdated, setLastUpdated] = useState('');
  const workerRef = useRef<Worker | null>(null);
  const quotedRequestRef = useRef<SwapRequest | null>(null);

  const loadHistory = useCallback(async () => {
    try { setHistory((await api<{ data: SwapJob[] }>('/swap/history?limit=20')).data); setRecordError(''); }
    catch (cause) { if (cause instanceof ApiError && cause.status === 401) { setHistory(loadLocalSwapHistory()); setRecordError(''); } else setRecordError('兑换历史暂时无法读取，当前报价未受影响'); }
  }, []);

  useEffect(() => {
    void loadHistory();
    return () => workerRef.current?.terminate();
  }, [loadHistory]);

  const request = useCallback((): SwapRequest => ({
    chain,
    ...(chain === 'EVM' ? { chainId: evmChainId } : {}),
    sellToken,
    buyToken,
    sellAmount: parseUnits(amount, decimals).toString(),
    taker,
    slippageBps: validateSlippage(slippage),
  }), [amount, buyToken, chain, decimals, evmChainId, sellToken, slippage, taker]);

  function invalidateQuotes() {
    setQuotes([]);
    setSelected(null);
    quotedRequestRef.current = null;
  }

  const quote = useCallback(() => {
    setError('');
    setRecordError('');
    setQuotes([]);
    setSelected(null);
    quotedRequestRef.current = null;
    try {
      const input = request();
      const started = performance.now();
      const worker = new Worker(new URL('./quote.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      setBusy(true);
      worker.onmessage = (event: MessageEvent<{ type: string; candidates?: SwapCandidate[]; message?: string }>) => {
        setBusy(false);
        worker.terminate();
        workerRef.current = null;
        if (event.data.type === 'error') { setError(event.data.message ?? '聚合报价失败'); return; }
        try {
          const candidates = event.data.candidates ?? [];
          const best = bestRoute(candidates);
          validateImpact(best.priceImpactPct);
          setQuotes(candidates);
          setSelected(best);
          quotedRequestRef.current = input;
          setElapsed(Math.round(performance.now() - started));
          setLastUpdated(new Date().toLocaleTimeString());
        } catch (cause) { setError(cause instanceof Error ? cause.message : '报价验证失败'); }
      };
      worker.onerror = () => { setBusy(false); setError('报价 Worker 异常；页面其他功能不受影响'); worker.terminate(); workerRef.current = null; };
      worker.postMessage({ request: input });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Swap 参数无效'); }
  }, [request]);

  useEffect(() => {
    if (!autoRefresh || !selected) return;
    const timer = setInterval(quote, 30_000);
    return () => clearInterval(timer);
  }, [autoRefresh, quote, selected]);

  async function updateResult(id: string, status: 'simulated' | 'submitted' | 'failed', value?: string) {
    if (id.startsWith('local-')) {
      const current = loadLocalSwapHistory().find(item => item.id === id);
      if (current) {
        const result = swapResultPayload(status, value);
        const next: SwapJob = { ...current, status: status === 'failed' ? 'failed' : 'completed', result: { ...current.result, ...result, dryRun: current.payload.dryRun, serverSigning: false, serverBroadcast: false, ...(status === 'submitted' ? { broadcastByWallet: true } : {}) }, updated_at: new Date().toISOString() };
        setHistory(saveLocalSwapJob(next));
      }
      return;
    }
    try {
      await api(`/swap/jobs/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(swapResultPayload(status, value)) });
      await loadHistory();
    } catch { setRecordError('兑换结果尚未写入审计历史，请保留当前页面并重试'); }
  }

  async function run() {
    if (!selected || executing) return;
    let input: SwapRequest;
    try {
      input = request();
      if (JSON.stringify(input) !== JSON.stringify(quotedRequestRef.current)) throw new Error('报价参数已变化，请重新获取报价');
      validateImpact(selected.priceImpactPct);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Swap 参数无效'); return; }

    setExecuting(true);
    setError('');
    setRecordError('');
    let job: SwapJob;
    try {
      job = (await api<{ data: SwapJob }>('/swap/jobs', { method: 'POST', body: JSON.stringify(swapPlanPayload(input, selected, dryRun, crypto.randomUUID())) })).data;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        const now = new Date().toISOString(), payload = swapPlanPayload(input, selected, dryRun, crypto.randomUUID());
        job = { id: `local-${crypto.randomUUID()}`, kind: 'swap', status: 'validated', payload: { chain: payload.chain, dryRun: payload.dryRun, taker: payload.taker, sellToken: payload.sellToken, buyToken: payload.buyToken, sellAmount: payload.sellAmount, slippageBps: payload.slippageBps, provider: payload.provider, amountIn: payload.amountIn, amountOut: payload.amountOut, minReceived: payload.minReceived, priceImpactPct: payload.priceImpactPct, route: payload.route }, result: { status: 'validated', dryRun, serverSigning: false, serverBroadcast: false }, created_at: now, updated_at: now };
        setHistory(saveLocalSwapJob(job));
      } else { setExecuting(false); setRecordError('兑换审计记录保存失败；为避免无记录执行，钱包签名已锁定'); return; }
    }

    try {
      if (dryRun) await updateResult(job.id, 'simulated');
      else await updateResult(job.id, 'submitted', await executeSwap(input, selected));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Swap 失败';
      setError(message);
      await updateResult(job.id, 'failed', message);
    } finally { setExecuting(false); }
  }

  return <>
    <div className="page-head"><div><p className="eyebrow">MULTICHAIN ROUTE AGGREGATOR</p><h1>闪电兑换</h1><p>同域安全报价、价格影响校验与用户钱包签名；服务器只保留脱敏审计记录。</p></div></div>
    <div className="grid">
      <section className="panel form-panel">
        <h3>Swap 参数</h3>
        <label>网络<select value={chain} disabled={busy || executing} onChange={event => { setChain(event.target.value as SwapChain); invalidateQuotes(); }}><option>EVM</option><option value="SOL">Solana</option><option>TRON</option></select></label>
        {chain==='EVM'&&<label>EVM 主网<select value={evmChainId} disabled={busy||executing} onChange={event=>{setEvmChainId(Number(event.target.value));invalidateQuotes()}}><option value={1}>Ethereum</option><option value={56}>BSC</option><option value={137}>Polygon</option><option value={8453}>Base</option><option value={42161}>Arbitrum</option></select></label>}
        <label>钱包地址<input value={taker} disabled={busy || executing} onChange={event => { setTaker(event.target.value.trim()); invalidateQuotes(); }} placeholder="公开签名地址"/></label>
        <label>卖出 Token<input value={sellToken} disabled={busy || executing} onChange={event => { setSellToken(event.target.value.trim()); invalidateQuotes(); }} placeholder="Token 地址或 Mint"/></label>
        <label>买入 Token<input value={buyToken} disabled={busy || executing} onChange={event => { setBuyToken(event.target.value.trim()); invalidateQuotes(); }} placeholder="Token 地址或 Mint"/></label>
        <div className="swap-pair"><label>卖出数量<input value={amount} disabled={busy || executing} inputMode="decimal" onChange={event => { setAmount(event.target.value); invalidateQuotes(); }}/></label><label>Decimals<input type="number" min="0" max="30" value={decimals} disabled={busy || executing} onChange={event => { setDecimals(Number(event.target.value)); invalidateQuotes(); }}/></label></div>
        <label>滑点：{slippage}%<input type="range" min="0.1" max="5" step="0.1" value={slippage} disabled={busy || executing} onChange={event => { setSlippage(Number(event.target.value)); invalidateQuotes(); }}/></label>
        <label className="dry-run"><input type="checkbox" checked={dryRun} disabled={busy || executing} onChange={event => setDryRun(event.target.checked)}/> Dry Run（默认开启）</label>
        <label className="dry-run"><input type="checkbox" checked={autoRefresh} disabled={executing} onChange={event => setAutoRefresh(event.target.checked)}/> 每 30 秒自动刷新报价 · 最后更新 {lastUpdated || '尚未报价'}</label>
        <div className="notice"><ShieldCheck size={18}/>不接收私钥或原始交易数据；Approve 使用精确卖出量，真实 Swap 必须由钱包确认。</div>
        {error && <div className="batch-error">{error}</div>}{recordError && <div className="batch-error">{recordError}</div>}
        <button onClick={quote} disabled={busy || executing || !taker || !sellToken || !buyToken || !amount}>{busy ? '聚合报价中…' : '获取最优报价'}</button>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>聚合报价</h3><span>{quotes.length} 条 · {elapsed} ms</span></div>
        {selected ? <><div className="best-route"><small>BEST ROUTE · {selected.provider}</small><strong>{selected.amountOut}</strong><p>最低收到 {selected.minReceived}</p><p>价格影响 {selected.priceImpactPct.toFixed(4)}%</p><code>{selected.route.join(' → ') || 'Direct'}</code></div><div className="quote-list">{quotes.map((item, index) => <button className={item === selected ? 'selected' : ''} key={`${item.provider}-${index}`} onClick={() => { try { validateImpact(item.priceImpactPct); setSelected(item); } catch (cause) { setError(cause instanceof Error ? cause.message : '高风险报价'); } }}><b>{item.provider}</b><span>{item.amountOut}</span><small>{item.priceImpactPct.toFixed(3)}%</small></button>)}</div><button className="swap-submit" onClick={() => void run()} disabled={executing}>{executing ? '正在保存审计结果…' : dryRun ? '保存并运行 Dry Run' : '保存后 Approve 并 Swap'}</button></> : <div className="mini-empty"><ArrowLeftRight/><p>输入 Token 和数量获取实时聚合报价</p></div>}
      </section>
    </div>
    <section className="panel transfer-history swap-history"><div className="panel-head"><div><p className="eyebrow">AUDIT TRAIL</p><h3><History size={16}/>最近兑换历史</h3></div><button onClick={() => void loadHistory()} title="刷新兑换历史"><RefreshCw size={15}/></button></div><div className="transfer-history-table"><div><b>创建时间</b><b>网络 / 路由</b><b>卖出</b><b>买入</b><b>状态</b></div>{history.map(job => <div key={job.id}><span>{new Date(job.created_at).toLocaleString()}</span><span>{job.payload.chain} · {job.payload.provider}</span><span>{job.payload.amountIn}</span><span>{job.payload.amountOut}</span><em className={job.status}>{job.result.status}</em></div>)}</div>{!history.length && <p className="transfer-history-empty">尚无已保存的闪电兑换任务。</p>}</section>
  </>;
}
