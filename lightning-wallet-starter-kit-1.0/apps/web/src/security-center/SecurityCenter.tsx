import { useCallback, useEffect, useState } from 'react';
import { Clock3, History, KeyRound, RefreshCw, ShieldCheck, ShieldOff, Users } from 'lucide-react';
import { api } from '../api';

type AuditEvent = {
  id: number;
  action: string;
  resource_type: string;
  resource_id?: string;
  detail: Record<string, unknown>;
  created_at: string;
};

type SecurityOverview = {
  currentSession: { email: string; createdAt: string; expiresAt: string };
  activeSessions: number;
  failedLogins24h: number;
  policies: {
    sessionHours: number;
    loginAttempts: number;
    rateLimitMinutes: number;
    clientKeyIsolation: boolean;
    serverSigning: boolean;
    mainnetBroadcast: boolean;
    httpOnlySession: boolean;
    csrfProtection: boolean;
    defaultDenyApi: boolean;
    contentSecurityPolicy: boolean;
    metadataOnlyDiagnostics: boolean;
    automaticSessionRecovery: boolean;
    workerOnlyExportValidation: boolean;
    zeroizedKeyBuffers: boolean;
  };
  events: AuditEvent[];
};

const actionNames: Record<string, string> = {
  'auth.login': '管理员登录',
  'auth.login.failed': '登录失败',
  'auth.logout': '安全退出',
  'auth.sessions.revoke_others': '撤销其他会话',
  'automation.rule.create': '创建自动化规则',
  'transfer.batch.validate': '验证批量转账',
  'client.error': '前端错误隔离',
};

export function SecurityCenter() {
  const [data, setData] = useState<SecurityOverview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setError('');
    try {
      const result = await api<{ data: SecurityOverview }>('/security/overview');
      setData(result.data);
    } catch {
      setError('安全状态暂时无法读取，请重新登录后重试。');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function revokeOthers() {
    if (!window.confirm('撤销除当前浏览器外的全部登录会话？')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{ data: { revoked: number } }>('/auth/revoke-others', { method: 'POST', body: '{}' });
      setNotice(`已撤销 ${result.data.revoked} 个其他会话。`);
      await load();
    } catch {
      setError('会话撤销失败，当前会话未受影响。');
    } finally { setBusy(false); }
  }

  const expires = data ? new Date(data.currentSession.expiresAt).toLocaleString() : '读取中';
  return <>
    <div className="page-head"><div><p className="eyebrow">SECURITY OPERATIONS</p><h1>安全中心</h1><p>管理生产会话、访问防护、密钥隔离策略与审计事件。</p></div><button onClick={() => void load()}><RefreshCw size={16}/>刷新</button></div>
    {error && <div className="batch-error">{error}</div>}{notice && <div className="security-notice">{notice}</div>}
    <div className="security-stats">
      <section className="panel security-stat"><Users/><span>活动会话</span><strong>{data?.activeSessions ?? '—'}</strong><small>数据库实时状态</small></section>
      <section className="panel security-stat"><Clock3/><span>当前会话到期</span><strong className="security-date">{expires}</strong><small>{data?.policies.sessionHours ?? 8} 小时有效期</small></section>
      <section className="panel security-stat"><ShieldOff/><span>24 小时失败登录</span><strong>{data?.failedLogins24h ?? '—'}</strong><small>{data?.policies.loginAttempts ?? 10} 次后限流</small></section>
      <section className="panel security-stat"><KeyRound/><span>私钥上传</span><strong>0</strong><small>仅浏览器 Worker</small></section>
    </div>
    <div className="security-layout">
      <section className="panel"><div className="panel-head"><div><p className="eyebrow">POLICIES</p><h3>强制安全策略</h3></div></div>
        <div className="policy-list"><Policy name="浏览器密钥隔离" enabled={Boolean(data?.policies.clientKeyIsolation)}/><Policy name="导出密码仅 Worker 校验" enabled={Boolean(data?.policies.workerOnlyExportValidation)}/><Policy name="明文密钥缓冲清零" enabled={Boolean(data?.policies.zeroizedKeyBuffers)}/><Policy name="HttpOnly 安全会话" enabled={Boolean(data?.policies.httpOnlySession)}/><Policy name="会话失效自动恢复" enabled={Boolean(data?.policies.automaticSessionRecovery)}/><Policy name="防跨站写保护" enabled={Boolean(data?.policies.csrfProtection)}/><Policy name="API 默认拒绝未登录" enabled={Boolean(data?.policies.defaultDenyApi)}/><Policy name="内容安全策略" enabled={Boolean(data?.policies.contentSecurityPolicy)}/><Policy name="仅元数据错误诊断" enabled={Boolean(data?.policies.metadataOnlyDiagnostics)}/><Policy name="服务端签名" enabled={Boolean(data?.policies.serverSigning)} safeOff/><Policy name="自动主网广播" enabled={Boolean(data?.policies.mainnetBroadcast)} safeOff/><Policy name="登录限流" enabled detail={`${data?.policies.loginAttempts ?? 10} 次 / ${data?.policies.rateLimitMinutes ?? 15} 分钟`}/></div>
        <button className="danger-outline" disabled={busy || (data?.activeSessions ?? 0) < 2} onClick={() => void revokeOthers()}>{busy ? '正在撤销…' : '撤销其他登录会话'}</button>
      </section>
      <section className="panel audit-panel"><div className="panel-head"><div><p className="eyebrow">AUDIT TRAIL</p><h3>最近审计事件</h3></div><History size={18}/></div>
        <div className="audit-list">{data?.events.length ? data.events.map(event => <div key={event.id}><span className={event.action.includes('failed') ? 'audit-warn' : 'audit-ok'}><ShieldCheck size={15}/></span><div><b>{actionNames[event.action] ?? event.action}</b><small>{event.resource_type} · {event.resource_id || '—'}</small></div><time>{new Date(event.created_at).toLocaleString()}</time></div>) : <p className="muted">暂无审计事件。</p>}</div>
      </section>
    </div>
  </>;
}

function Policy({ name, enabled, safeOff, detail }: { name: string; enabled: boolean; safeOff?: boolean; detail?: string }) {
  const secure = safeOff ? !enabled : enabled;
  return <div><span>{name}</span><b className={secure ? 'policy-secure' : 'policy-warning'}>{detail ?? (enabled ? '已启用' : safeOff ? '已关闭' : '未启用')}</b></div>;
}
