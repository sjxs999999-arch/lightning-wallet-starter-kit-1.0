import { useCallback, useEffect, useState } from 'react';
import { Activity, Bell, Clock3, History, Mail, Play, RefreshCw, RotateCcw, Send, ShieldCheck, Webhook } from 'lucide-react';
import { api } from '../api';
import { safeRulePayload } from './guard';
import type { AutomationJob, AutomationOverview, ChannelKind, Health, JobKind, NotificationChannel, RuleKind } from './types';

const ruleLabels: Record<RuleKind, string> = {
  price: '价格提醒',
  watchlist: '地址监控',
  portfolio: '资产变化',
  gas: 'Gas 监控',
  health: '系统健康',
};
const jobLabels: Record<JobKind, string> = { ...ruleLabels, notification: '通知审计' };
const empty: AutomationOverview = { rules: [], channels: [], jobs: [], retryQueue: 0, deliveryEnabled: false };

type ActionResult = { id?: string; attempt?: number; jobId?: string; status?: string; delivered?: boolean };
type SuccessMessage = string | ((result: ActionResult) => string);
type Action = (path: string, init?: RequestInit, success?: SuccessMessage) => Promise<ActionResult | null>;

export function AutomationCenter() {
  const [data, setData] = useState(empty);
  const [health, setHealth] = useState<Health | null>(null);
  const [tab, setTab] = useState<'rules' | 'channels' | 'history'>('rules');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [overview, status] = await Promise.all([
        api<{ data: AutomationOverview }>('/automation/overview'),
        api<{ data: Health }>('/automation/health'),
      ]);
      setData(overview.data);
      setHealth(status.data);
    } catch {
      setError('自动化服务暂时不可用，页面不会执行任何任务或交易');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const action: Action = async (path, init, success = '操作已完成并写入可审计记录') => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await api<{ data: ActionResult }>(path, init);
      setNotice(typeof success === 'function' ? success(response.data) : success);
      await load();
      return response.data;
    } catch {
      setError('操作失败；没有发送通知、没有调用钱包、没有签名或广播交易');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const schedulerReady = health?.scheduler === 'running' || health?.scheduler === 'dry-run';
  return <>
    <div className="page-head">
      <div><p className="eyebrow">READ-ONLY OPERATIONS AUTOMATION</p><h1>自动化中心</h1><p>调度监控任务、通知通道、重试队列与完整执行历史。</p></div>
      <button disabled={busy} onClick={() => void load()}><RefreshCw size={16}/>刷新状态</button>
    </div>
    <div className="automation-security"><ShieldCheck size={17}/>默认只读监控 · 通知默认 Dry Run · 无密钥 · 无自动签名 · 无交易广播</div>
    <section className="automation-stats">
      <Stat label="调度规则" value={data.rules.length} icon={<Clock3/>}/>
      <Stat label="启用规则" value={data.rules.filter(rule => rule.enabled).length} icon={<Activity/>}/>
      <Stat label="通知通道" value={data.channels.length} icon={<Bell/>}/>
      <Stat label="重试队列" value={data.retryQueue} icon={<RotateCcw/>}/>
      <Stat label="系统健康" value={health?.status ?? '检查中'} icon={<ShieldCheck/>}/>
    </section>
    <section className="panel automation-health">
      <span><i className={health?.api === 'online' ? 'ok' : ''}/>API {health?.api ?? '—'}</span>
      <span><i className={health?.postgres === 'online' ? 'ok' : ''}/>PostgreSQL {health?.postgres ?? '—'}</span>
      <span><i className={schedulerReady ? 'ok' : ''}/>Scheduler {health?.scheduler ?? '—'}</span>
      <span>延迟 {health?.latencyMs ?? '—'} ms</span>
      <span>真实通知：{data.deliveryEnabled ? '已启用' : '关闭'}</span>
    </section>
    {error && <div className="batch-error automation-message">{error}</div>}
    {notice && <div className="automation-notice">{notice}</div>}
    <div className="automation-tabs">
      <button className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}>任务与提醒</button>
      <button className={tab === 'channels' ? 'active' : ''} onClick={() => setTab('channels')}>通知中心</button>
      <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>任务历史</button>
    </div>
    {tab === 'rules' && <Rules data={data} busy={busy} action={action}/>}
    {tab === 'channels' && <Channels channels={data.channels} busy={busy} action={action}/>}
    {tab === 'history' && <Jobs jobs={data.jobs} busy={busy} action={action}/>}
  </>;
}

function Stat({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return <div className="panel automation-stat"><span>{icon}{label}</span><b>{value}</b></div>;
}

function Rules({ data, busy, action }: { data: AutomationOverview; busy: boolean; action: Action }) {
  const [name, setName] = useState('ETH 价格提醒');
  const [kind, setKind] = useState<RuleKind>('price');
  const [minutes, setMinutes] = useState(15);
  const [threshold, setThreshold] = useState(3000);
  const [chain, setChain] = useState('EVM');

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const payload = safeRulePayload({ name, kind, schedule_minutes: minutes, condition: { chain, metric: kind === 'gas' ? 'gasPrice' : 'price', operator: 'above', threshold }, channels: [] });
    void action('/automation/rules', { method: 'POST', body: JSON.stringify(payload) }, '只读调度规则已创建');
  }

  return <div className="automation-grid">
    <form className="panel automation-form" onSubmit={submit}>
      <h3>新建调度任务</h3>
      <label>任务名称<input required minLength={2} maxLength={80} value={name} onChange={event => setName(event.target.value)}/></label>
      <label>监控类型<select value={kind} onChange={event => setKind(event.target.value as RuleKind)}>{Object.entries(ruleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>网络<select value={chain} onChange={event => setChain(event.target.value)}><option>EVM</option><option>SOL</option><option>TRON</option></select></label>
      <label>阈值<input required type="number" value={threshold} onChange={event => setThreshold(Number(event.target.value))}/></label>
      <label>执行间隔（分钟）<input required type="number" min="1" max="10080" value={minutes} onChange={event => setMinutes(Number(event.target.value))}/></label>
      <div className="notice"><ShieldCheck size={16}/>调度器只读取公开指标并写入任务历史，不调用钱包。</div>
      <button disabled={busy}>创建只读任务</button>
    </form>
    <section className="panel automation-list">
      <div className="panel-head"><h3>Task Scheduler</h3><span>{data.rules.length} 条规则</span></div>
      {data.rules.map(rule => <div className="automation-row" key={rule.id}>
        <span className={`automation-kind ${rule.kind}`}>{ruleLabels[rule.kind].slice(0, 2)}</span>
        <div><b>{rule.name}</b><small>{ruleLabels[rule.kind]} · 每 {rule.schedule_minutes} 分钟 · 下次 {formatDate(rule.next_run_at)}</small></div>
        <label className="switch"><input disabled={busy} type="checkbox" checked={rule.enabled} onChange={event => void action(`/automation/rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: event.target.checked }) }, event.target.checked ? '规则已启用' : '规则已暂停')}/><span/></label>
        <button disabled={busy} title="立即 Dry Run" onClick={() => void action(`/automation/rules/${rule.id}/run`, { method: 'POST' }, result => `Dry Run 已执行并写入历史${result.attempt ? `（第 ${result.attempt} 次）` : ''}`)}><Play size={15}/></button>
      </div>)}
      {!data.rules.length && <p className="automation-empty">尚未创建自动化规则。</p>}
    </section>
  </div>;
}

function Channels({ channels, busy, action }: { channels: NotificationChannel[]; busy: boolean; action: Action }) {
  const [name, setName] = useState('运营通知');
  const [kind, setKind] = useState<ChannelKind>('telegram');
  const [destination, setDestination] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await action('/automation/channels', { method: 'POST', body: JSON.stringify({ name, kind, destination, enabled: false }) }, '禁用状态的通知通道已安全保存');
    if (result) setDestination('');
  }

  return <div className="automation-grid">
    <form className="panel automation-form" onSubmit={event => void submit(event)}>
      <h3>Webhook Manager</h3>
      <label>通道名称<input required minLength={2} maxLength={80} value={name} onChange={event => setName(event.target.value)}/></label>
      <label>通道类型<select value={kind} onChange={event => setKind(event.target.value as ChannelKind)}><option value="telegram">Telegram</option><option value="email">Email</option><option value="webhook">Webhook</option></select></label>
      <label>{kind === 'telegram' ? 'Chat ID' : kind === 'email' ? 'Email' : 'HTTPS Webhook URL'}<input required maxLength={500} type={kind === 'email' ? 'email' : kind === 'webhook' ? 'url' : 'text'} value={destination} onChange={event => setDestination(event.target.value)} placeholder={kind === 'telegram' ? '-1001234567890' : kind === 'email' ? 'ops@example.com' : 'https://alerts.example.com/hook'}/></label>
      <div className="notice"><ShieldCheck size={16}/>新通道默认禁用；敏感 Provider 凭据仅允许通过服务器环境变量配置。</div>
      <button disabled={busy || !destination}>保存禁用通道</button>
    </form>
    <section className="panel automation-list">
      <div className="panel-head"><h3>Notification Center</h3><span>Telegram · Email · Webhook</span></div>
      {channels.map(channel => <div className="automation-row" key={channel.id}>
        <span className="channel-icon">{channel.kind === 'telegram' ? <Send/> : channel.kind === 'email' ? <Mail/> : <Webhook/>}</span>
        <div><b>{channel.name}</b><small>{channel.kind} · {channel.destination}</small></div>
        <em>{channel.enabled ? '启用' : '默认禁用'}</em>
        <button disabled={busy} onClick={() => void action('/automation/notify', { method: 'POST', body: JSON.stringify({ channelId: channel.id, subject: 'Lightning Wallet 测试', message: 'Dry Run notification', dryRun: true }) }, result => `通知 Dry Run 已写入审计历史${result.jobId ? ` · ${shortId(result.jobId)}` : ''}`)}>Dry Run</button>
      </div>)}
      {!channels.length && <p className="automation-empty">尚未配置通知通道。</p>}
    </section>
  </div>;
}

function Jobs({ jobs, busy, action }: { jobs: AutomationJob[]; busy: boolean; action: Action }) {
  return <section className="panel automation-jobs">
    <div className="panel-head"><h3><History size={17}/> Job History & Retry Queue</h3><span>{jobs.length} 条</span></div>
    <div className="automation-table">
      <div><b>任务</b><b>类型</b><b>状态</b><b>尝试</b><b>时间</b><b>操作</b></div>
      {jobs.map(job => {
        const retryable = Boolean(job.rule_id) && (job.status === 'queued' || job.status === 'failed');
        return <div key={job.id}>
          <span title={job.id}>{job.rule_name}</span>
          <span>{jobLabels[job.kind] ?? job.kind}</span>
          <span className={job.status}>{job.status}{job.dry_run ? ' · Dry Run' : ''}</span>
          <span>#{job.attempt}</span>
          <span>{formatDate(job.created_at)}</span>
          <button disabled={busy || !retryable} title={retryable ? '创建新的 Dry Run 重试记录' : '仅失败或排队中的规则任务可重试'} onClick={() => void action(`/automation/jobs/${job.id}/retry`, { method: 'POST' }, result => `已创建第 ${result.attempt ?? job.attempt + 1} 次 Dry Run 重试，并写入历史`)}><RotateCcw size={14}/>重试</button>
        </div>;
      })}
    </div>
    {!jobs.length && <p className="automation-empty">尚无执行记录。</p>}
  </section>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}
