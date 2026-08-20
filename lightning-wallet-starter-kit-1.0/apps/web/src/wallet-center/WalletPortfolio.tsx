import { useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import './portfolio.css';
import type { ScannedAsset } from '../asset-collector/types';
import { defaultPortfolioNetwork, portfolioNetworks, type PortfolioNetworkId } from './portfolio-networks';
import type { CustomToken } from './public-metadata';
import type { VaultWallet } from './vault';

export function portfolioErrorMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : '资产读取失败，请稍后重试';
  return /failed to fetch|networkerror|rpc timeout|load failed/i.test(message)
    ? '只读 RPC 暂时不可用或被浏览器拦截，请稍后重试或配置同网络备用 RPC'
    : message;
}

export function WalletPortfolio({ wallet, tokens }: { wallet: VaultWallet; tokens: CustomToken[] }) {
  const requestId = useRef(0);
  const [assets, setAssets] = useState<ScannedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const networks = portfolioNetworks(wallet.chain);
  const [networkId, setNetworkId] = useState<PortfolioNetworkId>(() => defaultPortfolioNetwork(wallet.chain).id);
  const network = networks.find(item => item.id === networkId) ?? networks[0]!;

  useEffect(() => () => { requestId.current += 1; }, []);

  async function refresh() {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError('');
    setWarning('');
    try {
      const { scanWalletPortfolio } = await import('./wallet-portfolio');
      const result = await scanWalletPortfolio(wallet, tokens, network);
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
      <div><h3>多链资产</h3><small>{network.label} · {network.scope === 'mainnet' ? '主网只读' : '测试网'} · 浏览器直连 RPC</small></div>
      <div className="wallet-portfolio-actions"><select aria-label="资产网络" value={network.id} disabled={loading} onChange={event => { requestId.current += 1;setNetworkId(event.target.value as PortfolioNetworkId);setAssets([]);setError('');setWarning('');setUpdatedAt(''); }}>{networks.map(item => <option key={item.id} value={item.id}>{item.label}{item.scope === 'mainnet' ? ' · Mainnet' : ' · Testnet'}</option>)}</select><button disabled={loading} onClick={() => void refresh()}><RefreshCw size={14}/>{loading ? '读取中…' : '刷新资产'}</button></div>
    </div>
    <p className="wallet-portfolio-note"><ShieldCheck size={15}/>每次先核对 Chain ID、Genesis 或官方 TRON 主机，再发送公开地址与 Token 合约。主网查询不等于交易授权；不解密、不读取、不上传私钥或助记词。</p>
    {error && <div className="wallet-portfolio-error">{error}</div>}
    {warning && <div className="wallet-portfolio-warning">{warning}</div>}
    {!assets.length && !loading && !error && <div className="mini-empty"><p>点击“刷新资产”读取原生币与 Token 余额</p></div>}
    {assets.length > 0 && <div className="wallet-asset-list">{assets.map(asset => <div className={asset.status === 'failed' ? 'failed' : ''} key={asset.id}>
      <span><b>{asset.symbol}</b><small>{asset.asset === 'native' ? '原生币' : 'Token'}</small></span>
      <strong>{asset.balance}</strong>
      <code title={asset.token}>{asset.token ?? network.label}</code>
      <small>{asset.error ?? (asset.status === 'ready' ? '已读取' : '读取失败')}</small>
    </div>)}</div>}
    {updatedAt && <small className="wallet-portfolio-updated">最后读取：{updatedAt} · 不自动刷新，避免公共 RPC 限流</small>}
  </section>;
}
