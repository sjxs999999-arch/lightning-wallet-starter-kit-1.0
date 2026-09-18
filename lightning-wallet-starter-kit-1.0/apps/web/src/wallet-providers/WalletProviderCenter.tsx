import { useEffect, useState } from 'react';
import { CheckCircle2, Link, LogOut, Radio, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import {
  broadcastSelfTest,
  connectEvm,
  connectSol,
  connectTron,
  readNativeBalance,
  signChallenge,
} from './providers';
import { loadProviderHistory, saveProviderHistory } from './history';
import type { ConnectedWallet, TestnetHistory, WalletName, WalletNetworkMode } from './types';
import { LocalWalletCenter } from '../wallet-center/LocalWalletCenter';
import { useExternalWalletSession } from './ExternalWalletSession';

const wallets: { name: WalletName; family: 'EVM' | 'SOL' | 'TRON'; connector: string }[] = [
  { name: 'MetaMask', family: 'EVM', connector: 'EIP-6963' },
  { name: 'WalletConnect', family: 'EVM', connector: 'QR / Mobile' },
  { name: 'OKX Wallet', family: 'EVM', connector: 'EIP-6963' },
  { name: 'Rabby', family: 'EVM', connector: 'EIP-6963' },
  { name: 'OKX Wallet', family: 'SOL', connector: 'Injected' },
  { name: 'Phantom', family: 'SOL', connector: 'Injected' },
  { name: 'Backpack', family: 'SOL', connector: 'Injected' },
  { name: 'Solflare', family: 'SOL', connector: 'Injected' },
  { name: 'OKX Wallet', family: 'TRON', connector: 'Injected' },
  { name: 'TronLink', family: 'TRON', connector: 'Injected' },
];

function networkLabel(family: 'EVM' | 'SOL' | 'TRON', mode: WalletNetworkMode) {
  if (family === 'EVM') return mode === 'mainnet' ? 'Ethereum Mainnet' : 'Sepolia';
  if (family === 'SOL') return mode === 'mainnet' ? 'Solana Mainnet' : 'Solana Devnet';
  return mode === 'mainnet' ? 'TRON Mainnet' : 'Nile / Shasta';
}

function ProviderGateway({ embedded = false }: { embedded?: boolean }) {
  const [mode, setMode] = useState<WalletNetworkMode>('mainnet');
  const { connected, notice: sessionNotice, activate, disconnect: disconnectSession, clearNotice } = useExternalWalletSession();
  const [history, setHistory] = useState<TestnetHistory[]>(loadProviderHistory);
  const [confirmed, setConfirmed] = useState(false);
  const [balance, setBalance] = useState<{ symbol: string; formatted: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (connected) setMode(connected.mode);
  }, [connected]);

  useEffect(() => {
    if (!sessionNotice) return;
    setBalance(null);
    setConfirmed(false);
    setMessage(sessionNotice);
    clearNotice();
  }, [clearNotice, sessionNotice]);

  function record(wallet: ConnectedWallet, operation: TestnetHistory['operation'], status: TestnetHistory['status'], hash?: string, error?: string) {
    setHistory(saveProviderHistory({
      wallet: wallet.name,
      family: wallet.family,
      network: wallet.network,
      mode: wallet.mode,
      address: wallet.address,
      operation,
      status,
      hash,
      error,
    }));
  }

  async function changeMode(next: WalletNetworkMode) {
    if (connected) await disconnectSession();
    setMode(next);
    setBalance(null);
    setConfirmed(false);
    setMessage(next === 'mainnet' ? '主网会话可被 Swap、跨链、批量转账与 Token Studio 复用；钱包中心本身不发起自测交易。' : '测试网模式可在明确确认后广播最小自转交易。');
  }

  async function connect(name: WalletName, family: 'EVM' | 'SOL' | 'TRON') {
    setBusy(`${name}-${family}`);
    setMessage(`正在请求 ${name} 的公开账户；如果站点已授权，钱包会直接连接而不会重复弹窗。`);
    setConfirmed(false);
    setBalance(null);
    try {
      if (connected) await disconnectSession();
      const result = family === 'EVM'
        ? await connectEvm(name, import.meta.env.VITE_WALLETCONNECT_PROJECT_ID, 120, mode)
        : family === 'SOL'
          ? await connectSol(name, undefined, mode)
          : await connectTron(name === 'OKX Wallet' ? 'OKX Wallet' : 'TronLink', mode);
      activate(result);
      record(result, 'connect', 'connected');
      setMessage(`${name} 已验证并连接到 ${result.network}${result.mode === 'mainnet' ? '（可供业务模块发起用户确认签名）' : ''}。已授权钱包不会重复弹窗。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '连接失败');
    } finally {
      setBusy('');
    }
  }

  async function readBalance() {
    if (!connected) return;
    setBusy('balance');
    setMessage('');
    try {
      const result = await readNativeBalance(connected);
      setBalance(result);
      setMessage('余额读取完成；仅显示当前网络原生资产公开余额。');
    } catch (error) {
      setBalance(null);
      setMessage(error instanceof Error ? error.message : '余额读取失败');
    } finally {
      setBusy('');
    }
  }

  async function sign() {
    if (!connected) return;
    setBusy('sign');
    setMessage('');
    try {
      await signChallenge(connected);
      record(connected, 'sign', 'signed');
      setMessage('地址所有权签名验证成功；签名内容未上传或保存，也不会授权交易。');
    } catch (error) {
      const text = error instanceof Error ? error.message : '用户拒绝签名';
      record(connected, 'sign', text.toLowerCase().includes('reject') || text.includes('拒绝') ? 'rejected' : 'failed', undefined, text);
      setMessage(text);
    } finally {
      setBusy('');
    }
  }

  async function disconnect() {
    if (!connected) return;
    setBalance(null);
    setConfirmed(false);
    await disconnectSession();
    setMessage('钱包连接已从本页面断开。');
  }

  async function broadcast() {
    if (!connected || !confirmed || mode === 'mainnet') return;
    setBusy('broadcast');
    setMessage('');
    try {
      const hash = await broadcastSelfTest(connected);
      record(connected, 'broadcast', 'confirmed', hash);
      setMessage(`测试网交易已确认：${hash}`);
    } catch (error) {
      const text = error instanceof Error ? error.message : '广播失败';
      record(connected, 'broadcast', text.toLowerCase().includes('reject') || text.includes('拒绝') ? 'rejected' : 'failed', undefined, text);
      setMessage(`${text}；未确认或失败的交易不会标记为成功`);
    } finally {
      setBusy('');
    }
  }

  return <>
    {!embedded && <div className="page-head"><div><p className="eyebrow">NON-CUSTODIAL PROVIDER GATEWAY</p><h1>钱包中心</h1><p>连接用户自有钱包；主网会话可被交易模块复用，每笔交易仍需钱包独立确认。</p></div></div>}
    <div className={`provider-security ${mode === 'mainnet' ? 'mainnet' : ''}`}><ShieldCheck size={17}/>{mode === 'mainnet' ? '主网会话 · 业务模块独立模拟与签名门禁' : '测试网验证 · 广播前再次确认'} · 网络与活动账户持续复核 · 密钥永不离开钱包</div>
    <div className="provider-mode-tabs" role="group" aria-label="钱包网络模式">
      <button className={mode === 'mainnet' ? 'active' : ''} disabled={Boolean(busy)} onClick={() => void changeMode('mainnet')}>主网会话</button>
      <button className={mode === 'testnet' ? 'active' : ''} disabled={Boolean(busy)} onClick={() => void changeMode('testnet')}>测试网自测</button>
    </div>
    <div className="provider-layout">
      <section className="panel provider-list">
        <div className="panel-head"><h3>Wallet Providers</h3><span>{wallets.length} 个连接入口</span></div>
        {wallets.map(item => {
          const active = connected?.name === item.name && connected.family === item.family;
          return <button key={`${item.name}-${item.family}`} className={active ? 'connected' : ''} disabled={Boolean(busy)} onClick={() => void connect(item.name, item.family)}>
            <span className={`provider-logo ${item.family.toLowerCase()}`}>{item.name.slice(0, 2)}</span>
            <div><b>{item.name}</b><small>{item.connector} · {networkLabel(item.family, mode)}</small></div>
            {active ? <CheckCircle2/> : <Link/>}
          </button>;
        })}
      </section>
      <section className="provider-main">
        <section className="panel provider-session">
          <div className="panel-head"><h3>{mode === 'mainnet' ? '主网会话验收' : '测试网交易验证'}</h3><span className={mode === 'mainnet' ? 'network-mainnet' : ''}>{connected?.network ?? '未连接'}</span></div>
          {connected ? <>
            <div className="provider-address"><Wallet/><div><span>{connected.name} · {connected.network}</span><code>{connected.address}</code></div><strong>{connected.mode === 'mainnet' ? 'MAINNET' : 'TESTNET'}</strong></div>
            <div className="provider-flow">
              <span className="done">1 Connect</span><span className="done">2 Network</span><span>3 Balance</span><span>4 Sign</span><span>5 History</span>
            </div>
            <div className="provider-actions">
              <button disabled={Boolean(busy)} onClick={() => void readBalance()}><RefreshCw size={15}/>{busy === 'balance' ? '读取中…' : '读取公开余额'}</button>
              <button disabled={Boolean(busy)} onClick={() => void sign()}>{busy === 'sign' ? '等待钱包…' : '可选：签名验证'}</button>
              <button className="secondary" disabled={Boolean(busy)} onClick={() => void disconnect()}><LogOut size={15}/>断开</button>
            </div>
            {balance && <div className="provider-balance"><span>原生资产余额</span><b>{balance.formatted} {balance.symbol}</b><small>来自 {connected.network} 公开 RPC</small></div>}
            {mode === 'mainnet' ? <div className="provider-mainnet-note">钱包中心只负责建立和持续复核主网会话；Swap、跨链、批量转账与 Token Studio 会先重新报价/模拟，再由你在钱包中逐笔核对和签名。</div> : <div className="provider-testnet-broadcast">
              <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>我确认这是测试网自转交易，并将逐项检查钱包弹窗</label>
              <button className="danger" disabled={Boolean(busy) || !confirmed} onClick={() => void broadcast()}><Radio size={15}/>{busy === 'broadcast' ? '等待链上确认…' : '广播最小测试交易'}</button>
            </div>}
          </> : <div className="provider-empty"><Wallet/><h3>选择一个钱包连接</h3><p>{mode === 'mainnet' ? 'EVM 强制并复核 Ethereum Mainnet；Solana 核验 Mainnet genesis；TRON 仅接受官方 Mainnet RPC。' : 'EVM 强制并复核 Sepolia；Solana 核验 Devnet genesis；TRON 仅接受官方 Nile 或 Shasta RPC。'}</p><small>连接只会请求公开地址，不会读取私钥、助记词或 Keystore。首次授权会弹窗；已授权时会直接连接。</small></div>}
          {message && <div className="provider-message" role="status">{message}</div>}
        </section>
        <section className="panel provider-history">
          <div className="panel-head"><h3>连接验证历史</h3><span>仅公开元数据 · {history.length}</span></div>
          {history.map(item => <div key={item.id}><span>{new Date(item.at).toLocaleString()}</span><b>{item.wallet} · {item.operation}</b><code>{item.hash ?? item.address}</code><em className={item.status}>{item.mode === 'mainnet' ? 'mainnet · ' : 'testnet · '}{item.status}</em></div>)}
          {!history.length && <p>尚无连接、签名或测试网广播记录。</p>}
        </section>
      </section>
    </div>
  </>;
}

export function WalletProviderCenter() {
  const [tab, setTab] = useState<'local' | 'provider'>('local');
  return <>
    <div className="page-head"><div><p className="eyebrow">NON-CUSTODIAL WALLET CENTER</p><h1>钱包中心</h1><p>创建、导入和管理本地加密钱包，或连接扩展钱包，让已开通的主网模块复用会话并由用户确认签名。</p></div></div>
    <div className="wallet-center-tabs"><button className={tab === 'local' ? 'active' : ''} onClick={() => setTab('local')}>本地加密钱包</button><button className={tab === 'provider' ? 'active' : ''} onClick={() => setTab('provider')}>连接扩展钱包</button></div>
    {tab === 'local' ? <LocalWalletCenter/> : <ProviderGateway embedded/>}
  </>;
}
