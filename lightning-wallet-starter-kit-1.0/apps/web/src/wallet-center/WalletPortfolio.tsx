import { useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import './portfolio.css';
import type { ScannedAsset } from '../asset-collector/types';
import type { CustomToken } from './public-metadata';
import type { VaultWallet } from './vault';

const NETWORK_LABEL = {
  EVM: 'Sepolia',
  SOL: 'Solana Devnet',
  TRON: 'TRON Nile / Shasta',
} as const;

export function portfolioErrorMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : '资产读取失败，请稍后重试';
  return /failed to fetch|networkerror|rpc timeout|load failed/i.test(message)
    ? '测试网 RPC 暂时不可用或被浏览器拦截，请稍后重试或配置同网络备用 RPC'
    : message;
}

export function WalletPortfolio({ wallet, tokens }: { wallet: VaultWallet; tokens: CustomToken[] }) {
  const requestId = useRef(0);
  const [assets, setAssets] = useState<ScannedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');

  useEffect(() => () => { requestId.current += 1; }, []);

  async function refresh() {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    setWarning('');
    try {
      const { scanLocalWalletPortfolio } = await import('./wallet-portfolio');
      const result = await scanLocalWalletPortfolio(wallet, tokens);
      if (requestId.current !== currentRequest) return;
      setAssets(result.assets);
      setWarning(result.skipped ? `${result.skipped} 条重复、无效或超限的 Token 元数据未扫描` : '');
      setUpdatedAt(new Date().toLocaleTimeString());
    } catch (cause) {
      if (requestId.current !== currentRequest) return;
      setAssets([]);
      setError(portfolioErrorMessage(cause));
    } finally {
      if (requestId.current === currentRequest) setLoading(false);
    }
  }

  return <section className="wallet-portfolio">
    <div className="panel-head">
      <div><h3>测试网资产</h3><small>{NETWORK_LABEL[wallet.chain]} · 浏览器直连只读 RPC</small></div>
      <button disabled={loading} onClick={() => void refresh()}><RefreshCw size={14}/>{loading ? '读取中…' : '刷新资产'}</button>
    </div>
    <p className="wallet-portfolio-note"><ShieldCheck size={15}/>只发送公开地址和 Token 合约到对应测试网 RPC；不解密、不读取、不上传私钥或助记词。</p>
    {error && <div className="wallet-portfolio-error">{error}</div>}
    {warning && <div className="wallet-portfolio-warning">{warning}</div>}
    {!assets.length && !loading && !error && <div className="mini-empty"><p>点击“刷新资产”读取原生币与 Token 余额</p></div>}
    {assets.length > 0 && <div className="wallet-asset-list">{assets.map(asset => <div className={asset.status === 'failed' ? 'failed' : ''} key={asset.id}>
      <span><b>{asset.symbol}</b><small>{asset.asset === 'native' ? '原生币' : 'Token'}</small></span>
      <strong>{asset.balance}</strong>
      <code title={asset.token}>{asset.token ?? NETWORK_LABEL[wallet.chain]}</code>
      <small>{asset.error ?? (asset.status === 'ready' ? '已读取' : '读取失败')}</small>
    </div>)}</div>}
    {updatedAt && <small className="wallet-portfolio-updated">最后读取：{updatedAt} · 不自动刷新，避免公共 RPC 限流</small>}
  </section>;
}
