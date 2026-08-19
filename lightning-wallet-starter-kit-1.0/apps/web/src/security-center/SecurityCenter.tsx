import { useCallback, useEffect, useState } from 'react';
import { Clock3, Copy, ExternalLink, History, KeyRound, RefreshCw, ShieldCheck, ShieldOff, Users } from 'lucide-react';
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
  mfa: { enabled: boolean; manageable: boolean; recoveryCodesRemaining: number; source: 'none' | 'database' | 'environment' };
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
    totpEnabled: boolean;
  };
  events: AuditEvent[];
};

const actionNames: Record<string, string> = {
  'auth.login': '管理员登录',
  'auth.login.failed': '登录失败',
  'auth.logout': '安全退出',
  'auth.sessions.revoke_others': '撤销其他会话',
  'auth.mfa.enrollment_started': '开始注册二次验证',
  'auth.mfa.enabled': '启用二次验证',
  'auth.mfa.disabled': '停用二次验证',
  'automation.rule.create': '创建自动化规则',
  'transfer.batch.validate': '验证批量转账',
  'client.error': '前端错误隔离',
};

export function SecurityCenter() {
  const [data, setData] = useState<SecurityOverview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [factor, setFactor] = useState('');
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUri: string; expiresAt: string } | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
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

  async function beginEnrollment() {
    if (!password) return;
    setBusy(true); setError(''); setNotice(''); setRecoveryCodes([]);
    try {
      const result = await api<{ data: { secret: string; otpauthUri: string; expiresAt: string } }>('/security/mfa/enrollment', { method: 'POST', body: JSON.stringify({ password }) });
      setEnrollment(result.data); setPassword(''); setNotice('注册信息已生成，请在 10 分钟内用身份验证器添加并输入动态验证码。');
    } catch {
      setError('无法开始注册。请确认当前密码正确且服务器已配置二次验证加密密钥。');
    } finally { setBusy(false); }
  }

  async function confirmEnrollment() {
    if (!/^\d{6}$/.test(factor)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{ data: { enabled: boolean; recoveryCodes: string[] } }>('/security/mfa/confirm', { method: 'POST', body: JSON.stringify({ code: factor }) });
      setRecoveryCodes(result.data.recoveryCodes); setEnrollment(null); setFactor(''); setNotice('Authenticator 已启用。请立即离线保存下面的一次性恢复码。'); await load();
    } catch { setError('验证码无效或注册已超时，二次验证尚未启用。'); }
    finally { setBusy(false); }
  }

  async function disableMfa() {
    if (!password || !factor || !window.confirm('确认停用 Authenticator 二次验证？其他登录会话将被撤销。')) return;
    const normalized = factor.trim().toUpperCase(), body = /^\d{6}$/.test(normalized) ? { password, totpCode: normalized } : { password, recoveryCode: normalized };
    setBusy(true); setError(''); setNotice('');
    try {
      await api('/security/mfa/disable', { method: 'POST', body: JSON.stringify(body) });
      setPassword(''); setFactor(''); setRecoveryCodes([]); setNotice('Authenticator 已停用，其他登录会话已撤销。'); await load();
    } catch { setError('停用失败，请检查当前密码和动态验证码或恢复码。'); }
    finally { setBusy(false); }
  }

  async function copyText(value: string, message: string) {
    try { await navigator.clipboard.writeText(value); setNotice(message); }
    catch { setError('浏览器禁止写入剪贴板，请手动复制。'); }
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
        <div className="policy-list"><Policy name="Authenticator 二次验证" enabled={Boolean(data?.policies.totpEnabled)}/><Policy name="浏览器密钥隔离" enabled={Boolean(data?.policies.clientKeyIsolation)}/><Policy name="导出密码仅 Worker 校验" enabled={Boolean(data?.policies.workerOnlyExportValidation)}/><Policy name="明文密钥缓冲清零" enabled={Boolean(data?.policies.zeroizedKeyBuffers)}/><Policy name="HttpOnly 安全会话" enabled={Boolean(data?.policies.httpOnlySession)}/><Policy name="会话失效自动恢复" enabled={Boolean(data?.policies.automaticSessionRecovery)}/><Policy name="防跨站写保护" enabled={Boolean(data?.policies.csrfProtection)}/><Policy name="API 默认拒绝未登录" enabled={Boolean(data?.policies.defaultDenyApi)}/><Policy name="内容安全策略" enabled={Boolean(data?.policies.contentSecurityPolicy)}/><Policy name="仅元数据错误诊断" enabled={Boolean(data?.policies.metadataOnlyDiagnostics)}/><Policy name="服务端签名" enabled={Boolean(data?.policies.serverSigning)} safeOff/><Policy name="自动主网广播" enabled={Boolean(data?.policies.mainnetBroadcast)} safeOff/><Policy name="登录限流" enabled detail={`${data?.policies.loginAttempts ?? 10} 次 / ${data?.policies.rateLimitMinutes ?? 15} 分钟`}/></div>
        <div className="mfa-manager">
          <div><KeyRound size={18}/><span><b>Authenticator 管理</b><small>{data?.mfa.enabled ? `已启用 · 剩余 ${data.mfa.recoveryCodesRemaining} 个恢复码` : '未启用 · 注册后登录需要第二因素'}</small></span></div>
          {!data?.mfa.enabled && data?.mfa.manageable && !enrollment && <><label>确认当前密码<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} minLength={12}/></label><button disabled={busy || password.length < 12} onClick={() => void beginEnrollment()}>开始安全注册</button></>}
          {!data?.mfa.enabled && !data?.mfa.manageable && <p>服务器尚未配置二次验证加密密钥；当前不会生成或保存 Authenticator 密钥。</p>}
          {enrollment && <div className="mfa-enrollment"><p>在 Google Authenticator、1Password 或其他 TOTP 应用中手动输入：</p><code>{enrollment.secret}</code><div className="mfa-actions"><button onClick={() => void copyText(enrollment.secret, '注册密钥已复制。')}><Copy size={14}/>复制密钥</button><a href={enrollment.otpauthUri}><ExternalLink size={14}/>打开身份验证器</a></div><small>有效期至 {new Date(enrollment.expiresAt).toLocaleTimeString()}；只有验证码确认成功后才会启用。</small><label>6 位动态验证码<input value={factor} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} onChange={event => setFactor(event.target.value.replace(/\D/g, ''))}/></label><button disabled={busy || !/^\d{6}$/.test(factor)} onClick={() => void confirmEnrollment()}>确认并启用</button></div>}
          {data?.mfa.enabled && data.mfa.manageable && <><label>确认当前密码<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} minLength={12}/></label><label>动态验证码或恢复码<input value={factor} autoComplete="one-time-code" onChange={event => setFactor(event.target.value)} maxLength={14}/></label><button className="danger-outline" disabled={busy || password.length < 12 || factor.length < 6} onClick={() => void disableMfa()}>停用二次验证</button></>}
          {data?.mfa.source === 'environment' && <p>当前由服务器环境变量管理，只能通过受控部署流程更改。</p>}
        </div>
        {recoveryCodes.length > 0 && <div className="mfa-recovery"><div><b>一次性恢复码</b><button onClick={() => void copyText(recoveryCodes.join('\n'), '恢复码已复制，请离线保存。')}><Copy size={14}/>复制全部</button></div><p>每个恢复码只能使用一次，API 只保存带密钥的哈希；离开页面后不会再次显示。</p><code>{recoveryCodes.join('\n')}</code></div>}
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

export function ClientSecurityCenter() {
  const [checks] = useState(() => {
    let storage = false;
    try { const key = 'lightning-security-check'; sessionStorage.setItem(key, '1'); sessionStorage.removeItem(key); storage = true; } catch { /* blocked browser storage */ }
    return { secureContext: window.isSecureContext, webCrypto: Boolean(window.crypto?.subtle), worker: typeof Worker !== 'undefined', storage };
  });
  const ready = Object.values(checks).every(Boolean);
  return <>
    <div className="page-head"><div><p className="eyebrow">NON-CUSTODIAL CLIENT SECURITY</p><h1>安全中心</h1><p>检查当前浏览器是否满足本地生成、加密、签名与隔离执行要求。</p></div></div>
    <div className="security-stats">
      <section className="panel security-stat"><ShieldCheck/><span>客户端状态</span><strong>{ready ? '安全能力就绪' : '需要处理'}</strong><small>实时浏览器检查</small></section>
      <section className="panel security-stat"><KeyRound/><span>私钥上传</span><strong>0</strong><small>API 不接收私钥或助记词</small></section>
      <section className="panel security-stat"><Users/><span>服务端签名</span><strong>关闭</strong><small>真实交易必须由钱包确认</small></section>
      <section className="panel security-stat"><Clock3/><span>后台会话</span><strong>独立域名</strong><small>客户端无需管理员密码</small></section>
    </div>
    <div className="security-layout">
      <section className="panel"><div className="panel-head"><div><p className="eyebrow">BROWSER CHECKS</p><h3>本机安全能力</h3></div></div><div className="policy-list"><Policy name="HTTPS 安全上下文" enabled={checks.secureContext}/><Policy name="Web Crypto 加密" enabled={checks.webCrypto}/><Policy name="Web Worker 隔离执行" enabled={checks.worker}/><Policy name="会话存储可用" enabled={checks.storage}/><Policy name="服务端私钥存储" enabled={false} safeOff/><Policy name="服务端自动签名" enabled={false} safeOff/></div></section>
      <section className="panel audit-panel"><div className="panel-head"><div><p className="eyebrow">SECURITY BOUNDARIES</p><h3>不可绕过的边界</h3></div><ShieldCheck size={18}/></div><div className="audit-list"><SecurityBoundary title="密钥只在本地" detail="生成、解密与控制权验证只在浏览器内存和 Worker 中进行。"/><SecurityBoundary title="交易由用户签名" detail="API 只处理公开参数、报价或审计元数据，不持有签名能力。"/><SecurityBoundary title="错误不会白屏" detail="路由错误边界隔离模块故障，RPC 失败只显示当前操作错误。"/><SecurityBoundary title="后台完全分离" detail="运营登录、会话和写操作只在独立后台域名使用。"/></div></section>
    </div>
  </>;
}

function SecurityBoundary({ title, detail }: { title: string; detail: string }) {
  return <div><span className="audit-ok"><ShieldCheck size={15}/></span><div><b>{title}</b><small>{detail}</small></div></div>;
}
