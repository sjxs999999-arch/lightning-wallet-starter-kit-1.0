import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Database, Network, RefreshCw, Server, ShieldCheck } from 'lucide-react';
import { api } from '../api';

type Capability = { name: string; mode: string; status: string };
type Readiness = { finalApproval: boolean; walletAcceptanceRequired: boolean; externalBlockers: { code: string; label: string }[]; mainnet: { execution: boolean; swap: boolean; launchpad: boolean; bridge: boolean } };
type Capabilities = {
  version: string;
  environment: string;
  database: string;
  operator: string;
  chains: string[];
  features: Capability[];
  readiness?: Readiness;
  security: { privateKeysUploaded: boolean; serverSigning: boolean; serverBroadcast: boolean; analytics: boolean; sessionRevocation: boolean; httpOnlySession: boolean; csrfProtection: boolean; defaultDenyApi: boolean; contentSecurityPolicy: boolean; metadataOnlyDiagnostics: boolean; automaticSessionRecovery: boolean; workerOnlyExportValidation: boolean; zeroizedKeyBuffers: boolean };
};

export function SystemSettings() {
  const [data, setData] = useState<Capabilities | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try { setData((await api<{ data: Capabilities }>('/system/capabilities')).data); }
    catch { setError('系统能力清单暂时无法读取。'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <>
    <div className="page-head"><div><p className="eyebrow">PRODUCTION CONFIGURATION</p><h1>系统设置</h1><p>查看正式环境、支持网络、功能模式与不可绕过的安全边界。</p></div><button onClick={() => void load()}><RefreshCw size={16}/>刷新</button></div>
    {error && <div className="batch-error">{error}</div>}
    <div className="settings-summary">
      <section className="panel"><Server/><div><span>版本</span><strong>{data?.version ?? '读取中'}</strong></div></section>
      <section className="panel"><Database/><div><span>PostgreSQL</span><strong>{data?.database ?? '检查中'}</strong></div></section>
      <section className="panel"><Network/><div><span>支持网络</span><strong>{data?.chains.length ?? 0}</strong></div></section>
      <section className="panel"><ShieldCheck/><div><span>环境</span><strong>{data?.environment ?? '检查中'}</strong></div></section>
    </div>
    {data?.readiness && <section className={`panel final-readiness ${data.readiness.finalApproval ? 'approved' : 'blocked'}`}><div><ShieldCheck/><span><b>{data.readiness.finalApproval ? '最终生产验收：通过' : '最终生产验收：未通过'}</b><small>外部依赖 {data.readiness.externalBlockers.length} 项 · 钱包人工验收：{data.readiness.walletAcceptanceRequired ? '待完成' : '已确认'} · 主网总开关：{data.readiness.mainnet.execution ? '开启' : '关闭'}</small></span></div>{data.readiness.externalBlockers.length > 0 && <ul>{data.readiness.externalBlockers.map(item=><li key={item.code}><code>{item.code}</code><span>{item.label}</span></li>)}</ul>}</section>}
    <div className="settings-layout">
      <section className="panel"><div className="panel-head"><div><p className="eyebrow">CAPABILITIES</p><h3>功能运行模式</h3></div></div><div className="capability-list">{data?.features.map(feature => <div key={feature.name}><CheckCircle2/><div><b>{feature.name}</b><small>{feature.mode}</small></div><span>{feature.status}</span></div>)}</div></section>
      <section className="panel"><div className="panel-head"><div><p className="eyebrow">NETWORKS</p><h3>当前支持链</h3></div></div><div className="chain-cloud">{data?.chains.map(chain => <span key={chain}>{chain}</span>)}</div><div className="settings-security"><b>生产安全边界</b><p>私钥上传：0</p><p>服务端签名：关闭</p><p>服务端广播：{data?.security.serverBroadcast ? '开启' : '关闭'}</p><p>Analytics：关闭</p><p>导出校验：{data?.security.workerOnlyExportValidation ? '仅 Worker' : '未启用'}</p><p>密钥缓冲清零：{data?.security.zeroizedKeyBuffers ? '启用' : '未启用'}</p><p>HttpOnly 会话：{data?.security.httpOnlySession ? '启用' : '未启用'}</p><p>会话失效恢复：{data?.security.automaticSessionRecovery ? '启用' : '未启用'}</p><p>防跨站写保护：{data?.security.csrfProtection ? '启用' : '未启用'}</p><p>API 默认鉴权：{data?.security.defaultDenyApi ? '启用' : '未启用'}</p><p>内容安全策略：{data?.security.contentSecurityPolicy ? '启用' : '未启用'}</p><p>错误诊断：{data?.security.metadataOnlyDiagnostics ? '仅元数据' : '未启用'}</p><p>会话撤销：{data?.security.sessionRevocation ? '启用' : '未启用'}</p></div></section>
    </div>
  </>;
}
