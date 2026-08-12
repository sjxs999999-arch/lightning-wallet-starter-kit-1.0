import { useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, Bell, ExternalLink, Search, ShieldCheck, Star, Trash2 } from 'lucide-react';
import { api } from '../api';
import { addAlert, loadAlerts, loadWatchlist, removeAlert, toggleWatch, triggered } from './storage';
import type { Candle, MarketChain, MarketToken, MarketTrade, PriceAlert, WatchItem } from './types';

type DataState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

const regularUsd = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 });
const compactUsd = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });
const money = (value: number | null, compact = false) => value === null ? '暂不可用' : (compact ? compactUsd : regularUsd).format(value);
const short = (value: string) => value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
const historyLabel = (state: DataState, count: number) => state === 'ready' ? `${count} 小时` : state === 'loading' ? '读取中' : state === 'error' ? '暂不可用' : state === 'empty' ? '暂无数据' : '实时数据';

export function MarketCenter() {
  const [chain, setChain] = useState<MarketChain>('EVM');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MarketToken[]>([]);
  const [token, setToken] = useState<MarketToken | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [trades, setTrades] = useState<MarketTrade[]>([]);
  const [historyState, setHistoryState] = useState<DataState>('idle');
  const [tradesState, setTradesState] = useState<DataState>('idle');
  const [watchlist, setWatchlist] = useState<WatchItem[]>(loadWatchlist);
  const [alerts, setAlerts] = useState<PriceAlert[]>(loadAlerts);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selectionId = useRef(0);
  const watched = useMemo(() => token ? watchlist.some(item => item.chain === token.chain && item.address === token.address) : false, [token, watchlist]);

  async function search() {
    if (query.trim().length < 2) { setError('请输入至少 2 个字符、Token 地址或 Symbol'); return; }
    setBusy(true);
    setError('');
    try {
      const response = await api<{ data: MarketToken[] }>(`/market/search?q=${encodeURIComponent(query.trim())}&chain=${chain}`);
      setResults(response.data);
      if (!response.data.length) setError('未找到公开市场数据，请检查链和搜索内容');
    } catch { setError('行情搜索暂时不可用，页面其他功能仍可继续使用'); }
    finally { setBusy(false); }
  }

  async function select(item: MarketToken) {
    const currentSelection = ++selectionId.current;
    setBusy(true);
    setError('');
    setToken(item);
    setCandles([]);
    setTrades([]);
    setHistoryState('loading');
    setTradesState('loading');
    try {
      const detail = await api<{ data: MarketToken }>(`/market/token?chain=${item.chain}&address=${encodeURIComponent(item.address)}`);
      if (currentSelection !== selectionId.current) return;
      setToken(detail.data);
      const [historyResult, tradesResult] = await Promise.allSettled([
        api<{ data: Candle[] }>(`/market/history?chain=${item.chain}&pool=${encodeURIComponent(detail.data.pairAddress)}&token=${encodeURIComponent(detail.data.address)}`),
        api<{ data: MarketTrade[] }>(`/market/trades?chain=${item.chain}&pool=${encodeURIComponent(detail.data.pairAddress)}&token=${encodeURIComponent(detail.data.address)}`),
      ]);
      if (currentSelection !== selectionId.current) return;
      if (historyResult.status === 'fulfilled') {
        setCandles(historyResult.value.data);
        setHistoryState(historyResult.value.data.length ? 'ready' : 'empty');
      } else { setHistoryState('error'); }
      if (tradesResult.status === 'fulfilled') {
        setTrades(tradesResult.value.data);
        setTradesState(tradesResult.value.data.length ? 'ready' : 'empty');
      } else { setTradesState('error'); }
    } catch {
      if (currentSelection === selectionId.current) {
        setError('代币详情暂时无法刷新，已保留搜索结果，未发生任何交易');
        setHistoryState('error');
        setTradesState('error');
      }
    } finally { if (currentSelection === selectionId.current) setBusy(false); }
  }

  function changeChain(value: MarketChain) {
    selectionId.current++;
    setChain(value);
    setResults([]);
    setToken(null);
    setCandles([]);
    setTrades([]);
    setHistoryState('idle');
    setTradesState('idle');
    setError('');
  }

  function createAlert(direction: 'above' | 'below') {
    if (!token) return;
    const value = Number(target);
    if (!Number.isFinite(value) || value <= 0) { setError('请输入有效的美元目标价格'); return; }
    setAlerts(addAlert(token, direction, value));
    setTarget('');
  }

  return <>
    <div className="page-head"><div><p className="eyebrow">READ-ONLY MULTI-CHAIN INTELLIGENCE</p><h1>市场中心</h1><p>EVM、Solana 与 TRON 的公开行情、价格历史和市场活动。</p></div></div>
    <div className="market-security"><ShieldCheck size={17}/>只读市场数据 · 不读取密钥 · 不签名 · 不广播交易</div>
    <section className="panel market-search">
      <select aria-label="选择链" value={chain} disabled={busy} onChange={event => changeChain(event.target.value as MarketChain)}><option value="EVM">EVM · Ethereum</option><option value="SOL">Solana</option><option value="TRON">TRON</option></select>
      <label><Search size={17}/><input aria-label="搜索市场" value={query} disabled={busy} onChange={event => setQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && void search()} placeholder="Token 地址、名称或 Symbol"/></label>
      <button onClick={() => void search()} disabled={busy}>{busy ? '读取中…' : '搜索'}</button>
    </section>
    {error && <div className="batch-error market-error"><AlertTriangle size={16}/>{error}</div>}
    <div className="market-layout">
      <section className="panel market-results">
        <div className="panel-head"><h3>搜索结果</h3><span>{results.length}</span></div>
        {results.map(item => <button key={`${item.chain}-${item.pairAddress}`} disabled={busy} className={token?.pairAddress === item.pairAddress ? 'selected' : ''} onClick={() => void select(item)}><span className={`market-token ${item.chain.toLowerCase()}`}>{item.symbol.slice(0, 2)}</span><div><b>{item.symbol} / {item.quoteSymbol}</b><small>{item.name} · {item.dexId}</small></div><em>{money(item.priceUsd)}</em></button>)}
        {!results.length && <div className="market-empty"><Activity/><p>搜索真实 Token 或地址以加载公开市场数据。</p></div>}
        <div className="market-watch"><h3><Star size={15}/> 自选列表</h3>{watchlist.map(item => <button key={`${item.chain}-${item.address}`} disabled={busy} onClick={() => { changeChain(item.chain); setQuery(item.address); }}><b>{item.symbol}</b><small>{item.chain} · {short(item.address)}</small></button>)}{!watchlist.length && <small>尚未添加自选 Token</small>}</div>
      </section>
      <section className="market-main">
        {token ? <>
          <Overview token={token} watched={watched} onWatch={() => setWatchlist(toggleWatch(token))}/>
          <section className="panel market-chart"><div className="panel-head"><h3>价格历史</h3><span>{historyLabel(historyState, candles.length)}</span></div><PriceChart candles={candles} state={historyState}/></section>
          <div className="market-bottom">
            <Trades trades={trades} state={tradesState}/>
            <section className="panel market-alerts"><div className="panel-head"><h3><Bell size={15}/> 价格提醒</h3><span>本机</span></div><div className="alert-create"><input aria-label="目标价格" value={target} onChange={event => setTarget(event.target.value)} placeholder="目标 USD"/><button onClick={() => createAlert('above')}>高于</button><button onClick={() => createAlert('below')}>低于</button></div>{alerts.filter(alert => alert.chain === token.chain && alert.address === token.address).map(alert => <div className={triggered(alert, token.priceUsd) ? 'alert-row triggered' : 'alert-row'} key={alert.id}><span>{alert.direction === 'above' ? '≥' : '≤'} {money(alert.target)}</span><small>{triggered(alert, token.priceUsd) ? '已触发' : '监控中'}</small><button aria-label={`删除 ${alert.symbol} 价格提醒`} onClick={() => setAlerts(removeAlert(alert.id))}><Trash2 size={14}/></button></div>)}<p className="market-note">提醒仅保存在当前浏览器，不会上传钱包信息。</p></section>
          </div>
          <Holders token={token}/>
        </> : <section className="panel market-placeholder"><Activity/><h2>选择一个市场</h2><p>这里会显示真实的价格、市值、FDV、流动性、成交量、图表与交易记录。</p></section>}
      </section>
    </div>
  </>;
}

function Overview({ token, watched, onWatch }: { token: MarketToken; watched: boolean; onWatch: () => void }) {
  return <section className="panel market-overview"><div className="market-title"><div><p className="eyebrow">{token.chain} · {token.dexId}</p><h2>{token.name} <small>{token.symbol}/{token.quoteSymbol}</small></h2><code>{short(token.address)}</code></div><button className={watched ? 'active' : ''} onClick={onWatch}><Star size={16}/>{watched ? '已关注' : '加入自选'}</button></div><div className="market-metrics"><Metric label="Token Price" value={money(token.priceUsd)}/><Metric label="Market Cap" value={money(token.marketCap, true)}/><Metric label="FDV" value={money(token.fdv, true)}/><Metric label="Liquidity" value={money(token.liquidityUsd, true)}/><Metric label="24H Volume" value={money(token.volume24h, true)}/><Metric label="Holder Count" value={token.holders?.holderCount?.toLocaleString() ?? '需配置数据源'}/></div><div className="market-sub"><span className={(token.priceChange24h ?? 0) >= 0 ? 'up' : 'down'}>24H {token.priceChange24h ?? '—'}%</span><span>买入 {token.buys24h ?? '—'} · 卖出 {token.sells24h ?? '—'}</span>{token.url && <a href={token.url} target="_blank" rel="noreferrer">查看数据源 <ExternalLink size={13}/></a>}</div></section>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div><span>{label}</span><b>{value}</b></div>; }

function PriceChart({ candles, state }: { candles: Candle[]; state: DataState }) {
  if (state === 'loading') return <div className="chart-empty">正在读取公开 OHLCV 数据…</div>;
  if (state === 'error') return <div className="chart-empty">价格历史数据源暂时不可用，请稍后重试</div>;
  if (candles.length < 2) return <div className="chart-empty">该池当前没有足够的 OHLCV 数据</div>;
  const values = candles.map(candle => candle.close);
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${95 - ((value - min) / range) * 85}`).join(' ');
  return <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="价格历史图"><defs><linearGradient id="market-fill"><stop offset="0" stopColor="#7c5cff" stopOpacity=".45"/><stop offset="1" stopColor="#7c5cff" stopOpacity="0"/></linearGradient></defs><polygon points={`0,100 ${points} 100,100`} fill="url(#market-fill)"/><polyline points={points} fill="none" stroke="#8d76ff" strokeWidth="1.4" vectorEffect="non-scaling-stroke"/></svg>;
}

function Trades({ trades, state }: { trades: MarketTrade[]; state: DataState }) {
  return <section className="panel market-trades"><div className="panel-head"><h3>最近交易</h3><span>{state === 'loading' ? '读取中' : trades.length}</span></div><div className="market-table"><div><b>方向</b><b>价格</b><b>金额</b><b>时间</b></div>{trades.slice(0, 20).map(item => <div key={item.id}><span className={item.side === 'buy' ? 'up' : 'down'}>{item.side}</span><span>{money(item.priceUsd)}</span><span>{money(item.volumeUsd)}</span><span>{item.time ? new Date(item.time).toLocaleTimeString() : '—'}</span></div>)}</div>{state === 'loading' && <p className="market-note">正在读取公开链上交易…</p>}{state === 'error' && <p className="market-note">最近交易数据源暂时不可用，请稍后重试。</p>}{state === 'empty' && <p className="market-note">该池最近 24 小时没有公开交易。</p>}</section>;
}

function Holders({ token }: { token: MarketToken }) {
  return <section className="panel market-holders"><div className="panel-head"><h3>Top Holders</h3><span>{token.holders?.status === 'available' ? '只读数据' : 'Provider 未配置'}</span></div>{token.holders?.topHolders?.map((holder, index) => <div key={holder.address}><b>#{index + 1}</b><code>{short(holder.address)}</code><span>{holder.balance}</span><em>{holder.sharePct === null ? '—' : `${holder.sharePct}%`}</em></div>)}{!token.holders?.topHolders?.length && <p className="market-note">当前未配置可信持有人数据源，因此不展示模拟数据。</p>}</section>;
}
