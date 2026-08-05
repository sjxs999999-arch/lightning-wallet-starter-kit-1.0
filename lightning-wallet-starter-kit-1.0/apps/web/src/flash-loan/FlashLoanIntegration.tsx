import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, RefreshCw, ShieldCheck, WalletCards, Zap } from 'lucide-react';
import { api } from '../api';
import { buildExternalUrl, containsSensitiveFields, integrationOrigin, readHistory, sanitizeHistory, saveHistory } from './bridge';
import type { FlashLoanContext, FlashLoanHistoryItem, FlashLoanSettings } from './types';

type ServiceStatus = 'checking' | 'ready' | 'offline';
type BridgeStatus = 'waiting' | 'connected' | 'legacy';
type EthereumProvider = { request(args: {method: string; params?: unknown[]}): Promise<unknown> };

function provider(): EthereumProvider | undefined {
  return (window as typeof window & {ethereum?: EthereumProvider}).ethereum;
}

export function FlashLoanIntegration() {
  const appUrl = import.meta.env.VITE_FLASH_LOAN_URL || 'http://localhost:32104';
  const targetOrigin = useMemo(() => integrationOrigin(appUrl), [appUrl]);
  const frame = useRef<HTMLIFrameElement>(null);
  const [service, setService] = useState<ServiceStatus>('checking');
  const [bridge, setBridge] = useState<BridgeStatus>('waiting');
  const [sessionToken, setSessionToken] = useState('');
  const [walletAddress, setWalletAddress] = useState<string>();
  const [history, setHistory] = useState<FlashLoanHistoryItem[]>(() => readHistory());
  const [error, setError] = useState('');
  const settings: FlashLoanSettings = {network: 'sepolia', theme: 'dark', dryRun: true};

  const context = useMemo<FlashLoanContext>(() => ({type: 'LIGHTNING_FLASH_LOAN_CONTEXT', version: 1, sessionToken, walletAddress, settings}), [sessionToken, walletAddress]);
  const sendContext = useCallback(() => {
    if (frame.current?.contentWindow && sessionToken) frame.current.contentWindow.postMessage(context, targetOrigin);
  }, [context, sessionToken, targetOrigin]);

  const check = useCallback(async () => {
    setService('checking'); setError('');
    try {
      const health = await api<{data:{status:string}}>('/integrations/flash-loan/health');
      setService(health.data.status === 'ready' ? 'ready' : 'offline');
    } catch { setService('offline'); setError('闪电贷应用当前不可用，主钱包其他功能不受影响。'); return; }
    try {
      const session = await api<{data:{token:string}}>('/integrations/flash-loan/session', {method:'POST', body:JSON.stringify({network:'sepolia', dryRun:true})});
      setSessionToken(session.data.token);
    } catch { setSessionToken(''); setError('统一登录已过期，请重新登录后再使用闪电贷集成。'); }
  }, []);

  useEffect(() => { void check(); }, [check]);
  useEffect(() => { if (service !== 'ready') return; const timer=window.setTimeout(()=>setBridge(value=>value==='waiting'?'legacy':value),3000); return()=>clearTimeout(timer); }, [service]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== targetOrigin || event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== 'object') return;
      const message = event.data as Record<string, unknown>;
      if (containsSensitiveFields(message)) { setError('已阻止包含敏感密钥字段的集成消息。'); return; }
      if (message.type === 'FLASH_LOAN_READY') { setBridge('connected'); sendContext(); }
      if (message.type === 'FLASH_LOAN_HISTORY') { const item=sanitizeHistory(message.payload); if(item)setHistory(saveHistory(item)); }
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, [sendContext, targetOrigin]);
  useEffect(() => { sendContext(); }, [sendContext]);

  async function connectWallet() {
    setError('');
    try {
      const accounts = await provider()?.request({method:'eth_requestAccounts'});
      if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw new Error('provider missing');
      setWalletAddress(accounts[0]);
    } catch { setError('钱包连接未完成。请安装钱包扩展，或在钱包中批准连接。'); }
  }

  const externalUrl = buildExternalUrl(appUrl, context);
  return <>
    <div className="page-head"><div><p className="eyebrow">EXISTING APP · SEPOLIA</p><h1>闪电贷款</h1><p>只集成现有 FlashForge 应用；不修改或重写其闪电贷逻辑。</p></div></div>
    <section className="panel integration flash-integration">
      <div className="integration-icon"><Zap/></div><div><h2>FlashForge 测试网</h2><p>统一深色主题、登录会话、钱包与网络设置。Dry Run 强制开启。</p><code>{appUrl}</code></div>
      <span className={`integration-status ${service}`}>{service==='checking'?'检查中':service==='ready'?'服务在线':'服务离线'}</span>
      <a href={externalUrl} target="_blank" rel="noreferrer">独立打开 <ChevronRight size={18}/></a>
    </section>
    <div className="flash-controls">
      <section className="panel"><h3>共享连接</h3><div className="flash-setting"><span>统一登录</span><b>{sessionToken?'已授权':'等待授权'}</b></div><div className="flash-setting"><span>网络</span><b>Sepolia 测试网</b></div><div className="flash-setting"><span>模式</span><b className="safe">Dry Run</b></div><button onClick={connectWallet}><WalletCards size={16}/>{walletAddress?`${walletAddress.slice(0,6)}…${walletAddress.slice(-4)}`:'连接浏览器钱包'}</button></section>
      <section className="panel"><h3>集成状态</h3><div className="flash-setting"><span>外部服务</span><b>{service==='ready'?'在线':'未就绪'}</b></div><div className="flash-setting"><span>集成协议</span><b>{bridge==='connected'?'已连接':bridge==='legacy'?'旧版未响应':'等待响应'}</b></div><div className="notice"><ShieldCheck size={18}/>只同步公开地址和交易元数据，不传输私钥、助记词或签名能力。</div><button onClick={check}><RefreshCw size={16}/>重新检查</button></section>
    </div>
    {error&&<div className="batch-error flash-error">{error}</div>}
    {service==='ready'&&sessionToken?<section className="flash-frame panel"><iframe ref={frame} onLoad={sendContext} title="FlashForge 闪电贷" src={externalUrl} allow="clipboard-read; clipboard-write" sandbox="allow-scripts allow-forms allow-popups allow-same-origin"/><p>{bridge==='legacy'?'外部应用在线，但尚未响应共享集成协议；不会将其误报为已完成交易集成。':'钱包签名仍由用户在钱包扩展中逐笔确认。'}</p></section>:<section className="panel empty"><div className="empty-icon"><Zap/></div><h2>{service==='ready'?'需要有效的统一登录':'闪电贷服务暂时不可用'}</h2><p>{service==='ready'?'请重新登录后继续。外部应用不会在未授权状态下加载。':'请启动现有 FlashForge 应用后重试；错误已隔离，不会导致整页白屏。'}</p>{service==='ready'&&<a className="button-link" href="/login">重新登录</a>}</section>}
    <section className="panel flash-history"><div className="panel-head"><div><p className="eyebrow">METADATA ONLY</p><h3>闪电贷交易记录</h3></div><span>{history.length} 条</span></div>{history.length?history.map(item=><div className="flash-history-row" key={item.id}><span>{new Date(item.createdAt).toLocaleString()}</span><b>{item.status}</b><code>{item.transactionHash||'未广播'}</code></div>):<p className="muted">尚无由外部应用同步的交易元数据。</p>}</section>
  </>;
}
