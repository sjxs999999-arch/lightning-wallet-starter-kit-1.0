import { useCallback, useEffect, useRef, useState } from 'react';
import { Fuel, RefreshCw, ShieldCheck } from 'lucide-react';
import { formatEther, ZeroHash } from 'ethers';
import { ApiError, api } from '../api';
import { loadLocalGasHistory, saveLocalGasJob } from './local-history';
import type { GasAuditJob, GasEstimate, GasPlan, VipTier } from './types';

const empty = '0x0000000000000000000000000000000000000000';
type EthereumProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

function provider(): EthereumProvider | undefined {
  const root = window as typeof window & { ethereum?: EthereumProvider; okxwallet?: EthereumProvider };
  return root.okxwallet ?? root.ethereum;
}

export function GasFree() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [value, setValue] = useState('0');
  const [tier, setTier] = useState<VipTier>('standard');
  const [reserve, setReserve] = useState('1000000000000000');
  const [monitor, setMonitor] = useState(false);
  const [estimate, setEstimate] = useState<GasEstimate | null>(null);
  const [plan, setPlan] = useState<GasPlan | null>(null);
  const [history, setHistory] = useState<GasAuditJob[]>([]);
  const [status, setStatus] = useState('检查中');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  const loadHistory = useCallback(async () => {
    const local = loadLocalGasHistory();
    try {
      const response = await api<{ data: GasAuditJob[] }>('/gasfree/history?limit=20');
      setHistory([...response.data, ...local].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50));
    } catch (cause) {
      if (!(cause instanceof ApiError&&cause.status===401)) throw cause;
      setHistory(local);
    }
  }, []);

  useEffect(() => {
    void api<{ data: { status: string } }>('/gasfree/status').then(response => setStatus(response.data.status)).catch(() => setStatus('不可用'));
    void loadHistory().catch(()=>undefined);
    return () => workerRef.current?.terminate();
  }, [loadHistory]);

  const run = useCallback(async (record = true) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await api<{ data: GasEstimate }>('/gasfree/estimate', {
        method: 'POST',
        body: JSON.stringify({ from, to, value, data: '0x', audit: false }),
      });
      setEstimate(response.data);
      const worker = new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<{ type: string; plan?: GasPlan; message?: string }>) => {
        worker.terminate();
        workerRef.current = null;
        setBusy(false);
        if (event.data.type === 'error' || !event.data.plan) {
          setError(event.data.message || 'Gas 规划失败');
          return;
        }
        setPlan(event.data.plan);
        if (record) {
          const now = new Date().toISOString();
          const job: GasAuditJob = { id: `local-${crypto.randomUUID()}`, kind: 'gas-estimate', status: 'completed', payload: { network: 'Sepolia', from, to, estimatedCostWei: response.data.estimatedCostWei, dryRun: true }, result: { estimatedCostWei: response.data.estimatedCostWei, dryRun: true, serverSigning: false, serverBroadcast: false }, created_at: now, updated_at: now };
          setHistory(saveLocalGasJob(job));
          setNotice('Gas 估算完成并保存到当前浏览器；客户端仅处理公开交易参数。');
        }
      };
      worker.onerror = () => {
        worker.terminate();
        workerRef.current = null;
        setBusy(false);
        setError('Gas Worker 异常，页面其他功能不受影响');
      };
      worker.postMessage({ estimate: response.data, tier, minReserveWei: reserve });
    } catch {
      setBusy(false);
      setError('Gas RPC 或审计服务不可用；没有签名、没有广播交易');
    }
  }, [from, loadHistory, reserve, tier, to, value]);

  useEffect(() => {
    if (!monitor || !from || !to) return;
    const timer = window.setInterval(() => void run(false), 30_000);
    return () => window.clearInterval(timer);
  }, [monitor, from, to, run]);

  async function sponsor() {
    if (!estimate || !plan) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await api<{ data: { eligible: boolean; reason: string; broadcast: boolean; signatureRequired: boolean; dryRun: boolean; jobId?: string } }>('/gasfree/sponsor', {
        method: 'POST',
        body: JSON.stringify({ chainId: 11155111, sender: from, userOperationHash: ZeroHash, estimatedCostWei: estimate.estimatedCostWei, vipTier: tier, dryRun: true }),
      });
      const now = new Date().toISOString();
      const job: GasAuditJob = { id: `local-${crypto.randomUUID()}`, kind: 'gas-sponsor', status: response.data.eligible ? 'completed' : 'failed', payload: { network: 'Sepolia', sender: from, vipTier: tier, estimatedCostWei: estimate.estimatedCostWei, dryRun: true }, result: { eligible: response.data.eligible, reason: response.data.reason, dryRun: true, serverSigning: false, serverBroadcast: false }, created_at: now, updated_at: now };
      setHistory(saveLocalGasJob(job));
      setNotice(`${response.data.eligible ? '赞助策略验证通过' : `赞助策略未通过：${response.data.reason}`}；本次为无签名、无广播 Dry Run。`);
    } catch {
      setError('Paymaster 策略验证失败；没有提交 UserOperation、没有签名或广播');
    } finally {
      setBusy(false);
    }
  }

  async function topUp() {
    if (!plan || BigInt(plan.topUpWei) <= 0n) return;
    if (!window.confirm(`确认由当前浏览器钱包向 ${from} 补充 ${formatEther(plan.topUpWei)} Sepolia ETH？钱包将显示最终交易明细。`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const wallet = provider();
      if (!wallet) throw new Error('未检测到 EVM 钱包');
      const accounts = await wallet.request({ method: 'eth_requestAccounts' });
      const account = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : '';
      if (!account) throw new Error('钱包未授权');
      const chainId = String(await wallet.request({ method: 'eth_chainId' }));
      if (chainId.toLowerCase() !== '0xaa36a7') throw new Error('请先将钱包切换到 Sepolia（Chain ID 11155111）');
      const txHash = String(await wallet.request({ method: 'eth_sendTransaction', params: [{ from: account, to: from, value: `0x${BigInt(plan.topUpWei).toString(16)}` }] }));
      if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('钱包未返回有效交易哈希');
      const now = new Date().toISOString();
      const job: GasAuditJob = { id: `local-${crypto.randomUUID()}`, kind: 'gas-topup', status: 'submitted', payload: { network: 'Sepolia', from: account, to: from, topUpWei: plan.topUpWei, dryRun: false }, result: { txHash, serverSigning: false, serverBroadcast: false, broadcastByWallet: true }, created_at: now, updated_at: now };
      setHistory(saveLocalGasJob(job));
      setNotice(`补 Gas 交易已由钱包广播：${txHash}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '补 Gas 未执行；没有服务器签名'); }
    finally { setBusy(false); }
  }

  return <>
    <div className="page-head"><div><p className="eyebrow">SPONSORED TRANSACTION CONTROL</p><h1>GasFree</h1><p>Sepolia Gas 估算、VIP 赞助策略与自动补 Gas 规划。</p></div></div>
    <div className="gasfree-status"><span>Paymaster：{status}</span><span>网络：Sepolia</span><span>主网：关闭</span><span>监控：{monitor ? '运行中' : '已停止'}</span><span>历史：浏览器公开元数据</span></div>
    {notice && <div className="automation-notice">{notice}</div>}
    <div className="grid">
      <section className="panel form-panel">
        <h3>Gas 任务</h3>
        <label>发送地址<input required maxLength={42} value={from} onChange={event => setFrom(event.target.value.trim())} placeholder={empty}/></label>
        <label>目标地址<input required maxLength={42} value={to} onChange={event => setTo(event.target.value.trim())} placeholder={empty}/></label>
        <label>发送数量（Wei）<input inputMode="numeric" maxLength={78} value={value} onChange={event => setValue(event.target.value.trim())}/></label>
        <label>VIP 策略<select value={tier} onChange={event => setTier(event.target.value as VipTier)}><option value="standard">Standard</option><option value="silver">Silver</option><option value="gold">Gold</option></select></label>
        <label>最低 Gas 保留（Wei）<input inputMode="numeric" maxLength={78} value={reserve} onChange={event => setReserve(event.target.value.trim())}/></label>
        <label className="dry-run"><input type="checkbox" checked readOnly/>仅 Dry Run 策略验证（固定开启）</label>
        <label className="dry-run"><input type="checkbox" checked={monitor} onChange={event => setMonitor(event.target.checked)}/>每 30 秒监控 Gas（监控刷新不写入历史）</label>
        <div className="notice"><ShieldCheck size={18}/>不接收密钥；不提交 UserOperation；服务端不签名、不广播。占位哈希仅用于本地 Dry Run 策略上下文。</div>
        {error && <div className="batch-error">{error}</div>}
        <button disabled={busy || !from || !to} onClick={() => void run()}><RefreshCw size={16}/>{busy ? 'RPC 估算中…' : '估算并记录'}</button>
      </section>
      <section className="panel gasfree-result">
        <div className="panel-head"><h3>Dry Run 结果</h3><span>Worker + 审计</span></div>
        {estimate && plan ? <>
          <div className="gas-metric"><span>Gas Limit</span><b>{estimate.gasLimit}</b></div>
          <div className="gas-metric"><span>Gas Price</span><b>{formatEther(estimate.gasPriceWei)} ETH</b></div>
          <div className="gas-metric"><span>预计费用</span><b>{formatEther(estimate.estimatedCostWei)} ETH</b></div>
          <div className="gas-metric"><span>建议补充</span><b>{formatEther(plan.topUpWei)} ETH</b></div>
          <div className="gas-action"><Fuel/><div><b>{plan.action === 'sponsor' ? 'VIP Paymaster 可赞助' : plan.action === 'top-up' ? '需要补充 Gas' : 'Gas 余额充足'}</b><p>{plan.risk.join(' · ') || '未发现策略风险'}</p></div></div>
          <button disabled={busy} onClick={() => void sponsor()}>验证并记录 Sponsor 策略</button>
          {BigInt(plan.topUpWei) > 0n && <button className="gas-topup" disabled={busy} onClick={() => void topUp()}>由钱包补充 Sepolia Gas</button>}
        </> : <div className="mini-empty"><Fuel/><p>输入公开地址后执行真实 RPC Gas 估算。</p></div>}
      </section>
    </div>
    <section className="panel gas-history">
      <div className="panel-head"><h3>GasFree 审计历史</h3><button disabled={busy} onClick={() => void loadHistory()}>刷新历史</button><span>{history.length} 条</span></div>
      {history.map(item => <div className="gas-history-row" key={item.id}>
        <span>{formatDate(item.created_at)}</span>
        <code title={item.payload.from ?? item.payload.sender}>{item.payload.from ?? item.payload.sender ?? '—'}</code>
        <b>{historyLabel(item)}</b>
        <span>{item.result.estimatedCostWei ?? item.payload.estimatedCostWei ?? '—'} Wei</span>
      </div>)}
      {!history.length && <p className="muted">暂无服务器审计记录。</p>}
    </section>
  </>;
}

function historyLabel(item: GasAuditJob) {
  if (item.kind === 'gas-estimate') return '估算完成 · Dry Run';
  if (item.kind === 'gas-topup') return item.status === 'submitted' ? '钱包已广播补 Gas' : '补 Gas 未完成';
  return item.result.eligible ? 'Sponsor 合格 · Dry Run' : `Sponsor 未通过 · ${item.result.reason ?? 'POLICY_REJECTED'}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}
