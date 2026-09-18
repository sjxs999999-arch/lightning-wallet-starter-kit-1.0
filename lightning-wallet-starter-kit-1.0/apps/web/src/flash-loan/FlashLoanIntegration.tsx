import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, RefreshCw, ShieldCheck, WalletCards, Zap } from 'lucide-react';
import { ApiError, api } from '../api';
import { buildExternalUrl, connectSepoliaWallet, containsSensitiveFields, flashLoanHealthReady, flashLoanMessageOriginAllowed, flashLoanSessionActive, flashLoanSessionExpiry, integrationOrigin, postFlashLoanContext, type FlashLoanEthereumProvider, sanitizeHistory } from './bridge';
import { flashLoanLocalJob, loadLocalFlashLoanHistory, saveLocalFlashLoanJob } from './local-history';
import type { FlashLoanAuditJob, FlashLoanContext, FlashLoanSettings } from './types';
import { AaveV3PreflightPanel } from './AaveV3PreflightPanel';

type ServiceStatus = 'checking' | 'ready' | 'offline';
type BridgeStatus = 'waiting' | 'connected' | 'legacy';
const FLASH_LOAN_SETTINGS: FlashLoanSettings = {network: 'sepolia', theme: 'dark', dryRun: true};

function provider(): FlashLoanEthereumProvider | undefined {
  return (window as typeof window & {ethereum?: FlashLoanEthereumProvider}).ethereum;
}

export function FlashLoanIntegration() {
  const appUrl = import.meta.env.VITE_FLASH_LOAN_URL || (import.meta.env.PROD?`${window.location.origin}/flashforge/`:'http://localhost:32104');
  const targetOrigin = useMemo(() => integrationOrigin(appUrl), [appUrl]);
  const frame = useRef<HTMLIFrameElement>(null);
  const [service, setService] = useState<ServiceStatus>('checking');
  const [bridge, setBridge] = useState<BridgeStatus>('waiting');
  const [sessionToken, setSessionToken] = useState('');
  const [sessionExpiresAt, setSessionExpiresAt] = useState(0);
  const [walletAddress, setWalletAddress] = useState<string>();
  const [history, setHistory] = useState<FlashLoanAuditJob[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const context = useMemo<FlashLoanContext>(() => ({type: 'LIGHTNING_FLASH_LOAN_CONTEXT', version: 1, sessionToken, walletAddress, settings: FLASH_LOAN_SETTINGS}), [sessionToken, walletAddress]);
  const sendContext = useCallback(() => {
    if (frame.current?.contentWindow && flashLoanSessionActive(sessionToken, sessionExpiresAt)) postFlashLoanContext(frame.current.contentWindow, context, targetOrigin);
  }, [context, sessionExpiresAt, sessionToken, targetOrigin]);

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
    setService('checking'); setBridge('waiting'); setError(''); setNotice(''); setSessionToken(''); setSessionExpiresAt(0);
    let ready = false;
    try {
      const health = await api<{data:{status:string;network:string;mainnetEnabled:boolean}}>('/integrations/flash-loan/health');
      ready = flashLoanHealthReady(health.data);
    } catch { ready = false; }
    setService(ready ? 'ready' : 'offline');
    if (!ready) { setError('闪电贷兼容入口当前不可用，主钱包其他功能不受影响。'); return; }
    try {
      const session = await api<{data:{token:string;expiresIn:number}}>('/integrations/flash-loan/session', {method:'POST', body:JSON.stringify({network:'sepolia', dryRun:true})});
      setSessionToken(session.data.token);
      setSessionExpiresAt(flashLoanSessionExpiry(Date.now(), session.data.expiresIn));
    } catch { setSessionToken(''); setError('无法创建 5 分钟闪电贷受限会话；未共享钱包签名权限。'); }
  }, []);

  useEffect(() => { void check(); void loadHistory().catch(() => setError('闪电贷审计历史暂时不可用。')); }, [check, loadHistory]);
  useEffect(() => { if (service !== 'ready') return; const timer=window.setTimeout(()=>setBridge(value=>value==='waiting'?'legacy':value),3000); return()=>clearTimeout(timer); }, [service]);
  useEffect(() => {
    if (!sessionToken || !sessionExpiresAt) return;
    const remaining = sessionExpiresAt - Date.now();
    if (remaining <= 0) { setSessionToken(''); setSessionExpiresAt(0); return; }
    const timer = window.setTimeout(() => { setSessionToken(''); setSessionExpiresAt(0); setNotice('5 分钟 Dry Run 会话已到期，请重新检查后再试。'); }, remaining);
    return () => window.clearTimeout(timer);
  }, [sessionExpiresAt, sessionToken]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!flashLoanMessageOriginAllowed(event.origin, targetOrigin) || event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== 'object') return;
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
      const walletProvider = provider();
      if (!walletProvider) throw new Error('provider missing');
      setWalletAddress(await connectSepoliaWallet(walletProvider));
    } catch { setWalletAddress(undefined); setError('钱包连接未完成。请批准连接并切换到 Sepolia 测试网；其他网络会被拒绝。'); }
  }

  const externalUrl = buildExternalUrl(appUrl, context);
  return <>
    <div className="page-head"><div><p className="eyebrow">AAVE V3 · FAIL-CLOSED RELEASE GATE</p><h1>闪电贷款</h1><p>已具备 Aave V3 Sepolia 真实 calldata、合约绑定校验、整笔交易模拟与 Gas 预估路径；只有经审计 Receiver 白名单和发布开关同时满足时才开放内测。</p></div></div>
    <AaveV3PreflightPanel walletAddress={walletAddress} walletProvider={provider()} onConnect={connectWallet} onRecord={recordHistory}/>
    <section className="panel integration flash-integration">
      <div className="integration-icon"><Zap/></div><div><h2>外部策略兼容入口</h2><p>保留来源受限的外部策略界面与审计历史；它不能绕过上方 Aave 合约、Receiver 白名单、模拟与用户签名闸门。</p><code>{appUrl}</code></div>
      <span className={`integration-status ${service}`}>{service==='checking'?'检查中':service==='ready'?'服务在线':'服务离线'}</span>
      <a href={externalUrl} target="_blank" rel="noreferrer">独立打开 <ChevronRight size={18}/></a>
    </section>
    <div className="flash-controls">
      <section className="panel"><h3>共享连接</h3><div className="flash-setting"><span>受限会话</span><b>{sessionToken?'已授权 · 5 分钟':'等待授权'}</b></div><div className="flash-setting"><span>网络</span><b>Sepolia 测试网</b></div><div className="flash-setting"><span>模式</span><b className="safe">Dry Run</b></div><button onClick={connectWallet}><WalletCards size={16}/>{walletAddress?`${walletAddress.slice(0,6)}…${walletAddress.slice(-4)}`:'连接浏览器钱包'}</button></section>
      <section className="panel"><h3>集成状态</h3><div className="flash-setting"><span>外部服务</span><b>{service==='ready'?'在线':'未就绪'}</b></div><div className="flash-setting"><span>集成协议</span><b>{bridge==='connected'?'已连接':bridge==='legacy'?'旧版未响应':'等待响应'}</b></div><div className="notice"><ShieldCheck size={18}/>iframe 仅与已配置的精确来源通信；只共享 5 分钟受限会话和公开元数据。它没有签名或广播权限。</div><button onClick={check}><RefreshCw size={16}/>重新检查</button></section>
    </div>
    {error&&<div className="batch-error flash-error">{error}</div>}
    {notice&&<div className="automation-notice flash-error">{notice}</div>}
    {service==='ready'&&flashLoanSessionActive(sessionToken,sessionExpiresAt)?<section className="flash-frame panel"><iframe ref={frame} onLoad={sendContext} title="FlashForge 兼容入口" src={externalUrl} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer"/><p>{bridge==='legacy'?'外部入口在线，但尚未响应共享集成协议；不会将其误报为已完成交易集成。':'这是来源受限的外部策略界面；所有真实 Aave 交易仍必须返回上方预检闸门并由用户单独签名。'}</p></section>:<section className="panel empty"><div className="empty-icon"><Zap/></div><h2>{service==='ready'?'受限集成会话不可用':'外部策略入口暂时不可用'}</h2><p>{service==='ready'?'会话可能已到期，请重新检查。入口不会在未授权状态下加载。':'错误已隔离，不会影响 Aave 预检和其他钱包模块，也不会导致整页白屏。'}</p></section>}
    <section className="panel flash-history"><div className="panel-head"><div><p className="eyebrow">AUDIT · METADATA ONLY</p><h3>闪电贷 Dry Run 记录</h3></div><button onClick={() => void loadHistory()}>刷新历史</button><span>{history.length} 条</span></div>{history.length?history.map(item=><div className="flash-history-row" key={item.id}><span>{formatDate(item.created_at)}</span><b>{item.result.status}</b><code>{item.result.transactionHash||'未广播'}</code></div>):<p className="muted">尚无本地或服务器审计记录。</p>}</section>
  </>;
}

function formatDate(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?'—':date.toLocaleString()}
function shortId(value:string){return value.length>12?`${value.slice(0,8)}…`:value}
