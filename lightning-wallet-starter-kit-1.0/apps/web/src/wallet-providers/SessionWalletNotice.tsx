import { WalletCards } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ConnectedWallet, WalletFamily } from './types';
import { shortWalletAddress } from './module-session';

export function SessionWalletNotice({ wallet, family, usage = 'provider' }: { wallet: ConnectedWallet | null; family: WalletFamily; usage?: 'provider' | 'identity' | 'address-only' }) {
  if (!wallet) return <div className="notice notice-warn session-wallet-notice"><WalletCards size={18}/><span>尚未连接共享 {family} 钱包。先到 <Link to="/wallets">钱包中心</Link> 连接；本页不会索取私钥或助记词。</span></div>;
  if (wallet.family !== family) return <div className="notice notice-warn session-wallet-notice"><WalletCards size={18}/><span>已连接 {wallet.family} 钱包 {shortWalletAddress(wallet.address)}；当前模块需要 {family} 钱包。可在 <Link to="/wallets">钱包中心</Link> 切换。</span></div>;
  return <div className="notice session-wallet-notice"><WalletCards size={18}/><span>{usage === 'address-only'
    ? `已从共享会话自动带入 ${wallet.name} 公开地址 ${shortWalletAddress(wallet.address)}；本页只读，LP 操作会跳转官方协议并由其重新连接、模拟和签名。`
    : usage === 'identity'
      ? `已从共享会话锁定 ${wallet.name} 活动地址 ${shortWalletAddress(wallet.address)}；执行前会再次核对扩展活动账户，每次签名仍由钱包确认。`
      : `已复用 ${wallet.name} · ${wallet.network} · ${shortWalletAddress(wallet.address)}。地址和 provider 来自共享会话；每次签名仍由钱包单独确认。`}</span></div>;
}
