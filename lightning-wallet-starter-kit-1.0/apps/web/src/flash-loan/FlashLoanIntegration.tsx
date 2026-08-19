import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, RefreshCw, ShieldCheck, WalletCards, Zap } from 'lucide-react';
import { ApiError, api } from '../api';
import { buildExternalUrl, containsSensitiveFields, integrationOrigin, sanitizeHistory } from './bridge';
import { flashLoanLocalJob, loadLocalFlashLoanHistory, saveLocalFlashLoanJob } from './local-history';
import type { FlashLoanAuditJob, FlashLoanContext, FlashLoanSettings } from './types';

type ServiceStatus = 'checking' | 'ready' | 'offline';
type BridgeStatus = 'waiting' | 'connected' | 'legacy';
type EthereumProvider = { request(args: {method: string; params?: unknown[]}): Promise<unknown> };
const FLASH_LOAN_SETTINGS: FlashLoanSettings = {network: 'sepolia', theme: 'dark', dryRun: true};

function provider(): EthereumProvider | undefined {
  return (window as typeof window & {ethereum?: EthereumProvider}).ethereum;
}

export function FlashLoanIntegration() {
  const appUrl = import.meta.env.VITE_FLASH_LOAN_URL || (import.meta.env.PROD?`${window.location.origin}/flashforge/`:'http://localhost:32104');
  const targetOrigin = useMemo(() => integrationOrigin(appUrl), [appUrl]);
  const frame = useRef<HTMLIFrameElement>(null);
  const [service, setService] = useState<ServiceStatus>('checking');
  const [bridge, setBridge] = useState<BridgeStatus>('waiting');
  const [sessionToken, setSessionToken] = useState('');
  const [walletAddress, setWalletAddress] = useState<string>();
  const [history, setHistory] = useState<FlashLoanAuditJob[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const context = useMemo<FlashLoanContext>(() => ({type: 'LIGHTNING_FLASH_LOAN_CONTEXT', version: 1, sessionToken, walletAddress, settings: FLASH_LOAN_SETTINGS}), [sessionToken, walletAddress]);
  const sendContext = useCallback(() => {
    if (frame.current?.contentWindow && sessionToken) frame.current.contentWindow.postMessage(context, '*');
  }, [context, sessionToken]);

  const loadHistory = useCallback(async () => {
    const local = loadLocalFlashLoanHistory();
    try {
      const response = await api<{data:FlashLoanAuditJob[]}>('/integrations/flash-loan/history?limit=20');
      const localIds = new Set(local.map(item => item.payload.clientRecordId));
      setHistory([...response.data.filter(item => !localIds.has(item.payload.clientRecordId)), ...local].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status===401)) throw cause;
      setHistory(local);
    }
  }, []);

  const recordHistory = useCallback(async (input: unknown) => {
    const item = sanitizeHistory(input);
    if (!item) { setError('外部应用返回了无效或非 Dry Run 的历史记录，已拒绝保存。'); return; }
    setError(''); setNotice('');
    try {
      const response = await api<{data:{id:string}}>('/integrations/flash-loan/history', {method:'POST', body:JSON.stringify({...item,walletAddress:item.walletAddress??walletAddress})});
      setNotice(`FlashForge Dry Run 已写入服务器审计历史 · ${shortId(response.data.id)}`);
      await loadHistory();
    } catch (cause) {
      if (cause instanceof ApiError&&cause.status===401) {
        const job = flashLoanLocalJob({...item,walletAddress:item.walletAddress??walletAddress});
        setHistory(saveLocalFlashLoanJob(job));
        setNotice('FlashForge Dry Run 已保存到当前浏览器；未上传交易密钥或敏感数据。');
      } else setError('Dry Run 已完成，但审计记录未保存；没有签名或广播交易。');
    }
  }, [loadHistory, walletAddress]);

  const check = useCallback(async () => {
    setService('checking'); setError('');
    let ready = false;
    if (targetOrigin === window.location.origin) {
      try { ready = (await fetch(appUrl, { signal: AbortSignal.timeout(3000), cache: 'no-store' })).ok; }
      catch { ready = false; }
    } else {
      try { const health = await api<{data:{status:string}}>('/integrations/flash-loan/health'); ready = health.data.status === 'ready'; }
      catch { ready = false; }
    }
    setService(ready ? 'ready' : 'offline');
    if (!ready) { setError('现有闪电贷应用当前不可用，主钱包其他功能不受影响。'); return; }
    try {
      const session = await api<{data:{token:string}}>('/integrations/flash-loan/session', {method:'POST', body:JSON.stringify({network:'sepolia', dryRun:true})});
      setSessionToken(session.data.token);
    } catch { setSessionToken(''); setError('无法创建 5 分钟闪电贷受限会话；未共享钱包签名权限。'); }
  }, [appUrl, targetOrigin]);

  useEffect(() => { void check(); void loadHistory().catch(() => setError('闪电贷审计历史暂时不可用。')); }, [check, loadHistory]);
  useEffect(() => { if (service !== 'ready') return; const timer=window.setTimeout(()=>setBridge(value=>value==='waiting'?'legacy':value),3000); return()=>clearTimeout(timer); }, [service]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (![targetOrigin, 'null'].includes(event.origin) || event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== 'object') return;
      const message = event.data as Record<string, unknown>;
      if (containsSensitiveFields(message)) { setError('已阻止包含敏感密钥字段的集成消息。'); return; }
      if (message.type === 'FLASH_LOAN_READY') { setBridge('connected'); sendContext(); }
      if (message.type === 'FLASH_LOAN_HISTORY') void recordHistory(message.payload);
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, [recordHistory, sendContext, targetOrigin]);
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
      <section className="panel"><h3>共享连接</h3><div className="flash-setting"><span>受限会话</span><b>{sessionToken?'已授权 · 5 分钟':'等待授权'}</b></div><div className="flash-setting"><span>网络</span><b>Sepolia 测试网</b></div><div className="flash-setting"><span>模式</span><b className="safe">Dry Run</b></div><button onClick={connectWallet}><WalletCards size={16}/>{walletAddress?`${walletAddress.slice(0,6)}…${walletAddress.slice(-4)}`:'连接浏览器钱包'}</button></section>
      <section className="panel"><h3>集成状态</h3><div className="flash-setting"><span>外部服务</span><b>{service==='ready'?'在线':'未就绪'}</b></div><div className="flash-setting"><span>集成协议</span><b>{bridge==='connected'?'已连接':bridge==='legacy'?'旧版未响应':'等待响应'}</b></div><div className="notice"><ShieldCheck size={18}/>iframe 使用隔离来源，无法读取主控制台会话；仅接收 5 分钟闪电贷权限和公开元数据。</div><button onClick={check}><RefreshCw size={16}/>重新检查</button></section>
    </div>
    {error&&<div className="batch-error flash-error">{error}</div>}
    {notice&&<div className="automation-notice flash-error">{notice}</div>}
    {service==='ready'&&sessionToken?<section className="flash-frame panel"><iframe ref={frame} onLoad={sendContext} title="FlashForge 闪电贷" src={externalUrl} allow="clipboard-read; clipboard-write" sandbox="allow-scripts allow-forms allow-popups"/><p>{bridge==='legacy'?'外部应用在线，但尚未响应共享集成协议；不会将其误报为已完成交易集成。':'隔离 iframe 无法读取运营后台会话；Dry Run 记录由父页面严格校验后保存。'}</p></section>:<section className="panel empty"><div className="empty-icon"><Zap/></div><h2>{service==='ready'?'受限集成会话不可用':'闪电贷服务暂时不可用'}</h2><p>{service==='ready'?'请稍后重试。外部应用不会在未授权状态下加载。':'请恢复现有 FlashForge 服务后重试；错误已隔离，不会导致整页白屏。'}</p></section>}
    <section className="panel flash-history"><div className="panel-head"><div><p className="eyebrow">AUDIT · METADATA ONLY</p><h3>闪电贷 Dry Run 记录</h3></div><button onClick={() => void loadHistory()}>刷新历史</button><span>{history.length} 条</span></div>{history.length?history.map(item=><div className="flash-history-row" key={item.id}><span>{formatDate(item.created_at)}</span><b>{item.result.status}</b><code>{item.result.transactionHash||'未广播'}</code></div>):<p className="muted">尚无本地或服务器审计记录。</p>}</section>
  </>;
}

function formatDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleString()}
function shortId(value:string){return value.length>12?`${value.slice(0,8)}…`:value}
