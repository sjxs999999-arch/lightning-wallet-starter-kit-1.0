import { useEffect, useState } from 'react';
import { ArrowLeftRight, Boxes, CircleDollarSign, History, Send, ShieldCheck, WalletCards } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { api } from '../api';
import { loadLocalActivity } from '../activity/history';

type Capability = { name: string; mode: string; status: string };
type CapabilityResponse = { data: { version: string; chains: string[]; features: Capability[]; security: { privateKeysUploaded: boolean; serverSigning: boolean } } };

const quickLinks = [
  { title: '连接钱包', detail: '连接扩展钱包并完成签名验证', path: '/wallets', icon: WalletCards },
  { title: '批量钱包', detail: '本地生成、加密导出和控制权验证', path: '/batch-wallets', icon: Boxes },
  { title: '批量转账', detail: 'CSV、Dry Run 与钱包批量签名', path: '/batch-transfer', icon: Send },
  { title: '资产归集', detail: '扫描资产、保留余额并规划归集', path: '/collection', icon: CircleDollarSign },
  { title: '闪电兑换', detail: '聚合报价、价格影响和钱包签名', path: '/swap', icon: ArrowLeftRight },
  { title: '交易记录', detail: '查看当前浏览器的公开操作记录', path: '/history', icon: History },
] as const;

export function ClientHome() {
  const [activity] = useState(loadLocalActivity);
  const [capabilities, setCapabilities] = useState<CapabilityResponse['data'] | null>(null);
  const [statusError, setStatusError] = useState(false);

  useEffect(() => {
    void api<CapabilityResponse>('/system/capabilities')
      .then(response => setCapabilities(response.data))
      .catch(() => setStatusError(true));
  }, []);

  const ready = capabilities?.features.filter(feature => feature.status === 'ready').length ?? 0;
  return <>
    <div className="page-head"><div><p className="eyebrow">NON-CUSTODIAL CLIENT</p><h1>闪电钱包首页</h1><p>连接钱包、本地生成密钥，并从同一个客户端进入多链资产工具。</p></div></div>
    <div className="client-home-safety"><ShieldCheck size={18}/><div><b>私钥始终留在本机</b><span>服务端签名：关闭 · 私钥上传：0 · 真实交易必须由钱包确认</span></div></div>
    <div className="client-home-stats">
      <section className="panel"><span>客户端版本</span><strong>{capabilities?.version ?? '2.19.0'}</strong><small>生产候选</small></section>
      <section className="panel"><span>支持网络</span><strong>{capabilities?.chains.length ?? 9}</strong><small>EVM · Solana · TRON</small></section>
      <section className="panel"><span>本地公开记录</span><strong>{activity.length}</strong><small>不包含私钥或签名内容</small></section>
      <section className="panel"><span>已就绪模块</span><strong>{capabilities ? ready : '—'}</strong><small>{statusError ? '状态服务暂时不可用' : '其余模块按准入状态显示'}</small></section>
    </div>
    <section className="client-home-links">{quickLinks.map(({ title, detail, path, icon: Icon }) => <NavLink to={path} className="panel" key={path}><span><Icon size={20}/></span><div><b>{title}</b><small>{detail}</small></div><strong>进入</strong></NavLink>)}</section>
    <section className="panel client-home-capabilities"><div className="panel-head"><div><p className="eyebrow">LIVE CAPABILITY GATES</p><h3>模块准入状态</h3></div><span>{capabilities?.features.length ?? 0} 项</span></div>{capabilities?.features.map(feature => <div key={feature.name}><div><b>{feature.name}</b><small>{feature.mode}</small></div><em className={feature.status === 'ready' ? 'ready' : 'gated'}>{feature.status}</em></div>)}{!capabilities && <p>{statusError ? '状态服务暂时无法读取；钱包本地功能仍可使用。' : '正在读取正式环境能力清单…'}</p>}</section>
  </>;
}
