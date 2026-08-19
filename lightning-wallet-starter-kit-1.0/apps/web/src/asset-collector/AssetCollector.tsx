import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleDollarSign, History, RefreshCw, ShieldCheck } from 'lucide-react';
import { ApiError, api } from '../api';
import { executeTask } from '../batch-transfer/executor';
import type { TransferChain, TransferTask } from '../batch-transfer/types';
import { exportCollectorResults, parseCollectorCsv } from './csv';
import { collectionPlanPayload, collectionResultPayload } from './persistence';
import type { CollectionJob } from './persistence';
import { buildCollectionPlan } from './planner';
import type { CollectorLog, CollectorTask, ScanInput, ScannedAsset } from './types';

function AssetRow({ item }: { item: ScannedAsset | CollectorTask }) {
  const task = 'executionStatus' in item ? item : undefined;
  return <div><b>{item.symbol} · 余额 {item.balance} · Gas {item.estimatedFee}</b><code>{item.address}</code>{task && <small>保留 {task.reserve} · 归集 {task.collectAmount} · {task.executionStatus}</small>}{item.error && <small>{item.error}</small>}</div>;
}

export function AssetCollector() {
  const [chain, setChain] = useState<TransferChain>('EVM');
  const [inputs, setInputs] = useState<ScanInput[]>([]);
  const [destination, setDestination] = useState('');
  const [reserve, setReserve] = useState('0');
  const [dryRun, setDryRun] = useState(true);
  const [assets, setAssets] = useState<ScannedAsset[]>([]);
  const [tasks, setTasks] = useState<CollectorTask[]>([]);
  const [scanProgress, setScanProgress] = useState(0);
  const [progress, setProgress] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState('');
  const [recordError, setRecordError] = useState('');
  const [logs, setLogs] = useState<CollectorLog[]>([]);
  const [history, setHistory] = useState<CollectionJob[]>([]);
  const [activeJob, setActiveJob] = useState<CollectionJob | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const pausedRef = useRef(false);
  const tasksRef = useRef<CollectorTask[]>([]);
  const jobIdRef = useRef<string | null>(null);

  const log = (message: string, level: CollectorLog['level'] = 'info', taskId?: string) => setLogs(items => [...items, { at: new Date().toISOString(), message, level, ...(taskId ? { taskId } : {}) }]);
  const loadHistory = useCallback(async () => {
    try { setHistory((await api<{ data: CollectionJob[] }>('/collections/history?limit=20')).data); setRecordError(''); }
    catch (cause) { if (!(cause instanceof ApiError && cause.status === 401)) setRecordError('归集历史暂时无法读取，本地扫描数据未受影响'); }
  }, []);

  useEffect(() => {
    void loadHistory();
    return () => workerRef.current?.terminate();
  }, [loadHistory]);

  function resetAudit() {
    setActiveJob(null);
    jobIdRef.current = null;
    setRecordError('');
  }

  async function persistPlan(nextTasks: CollectorTask[]) {
    setSaving(true);
    setRecordError('');
    jobIdRef.current = null;
    setActiveJob(null);
    try {
      const payload = collectionPlanPayload(nextTasks, dryRun, crypto.randomUUID());
      const response = await api<{ data: CollectionJob }>('/collections/batch', { method: 'POST', body: JSON.stringify(payload) });
      jobIdRef.current = response.data.id;
      setActiveJob(response.data);
      log(`归集记录已保存：${response.data.id.slice(0, 8)} · 私钥上传 0`, 'success');
      await loadHistory();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        const eligible = nextTasks.filter(task => Number(task.collectAmount) > 0);
        const now = new Date().toISOString();
        const localJob: CollectionJob = { id: `local-${crypto.randomUUID()}`, kind: 'asset-collection', status: 'validated', payload: { chain: eligible[0]!.chain, dryRun, destination: eligible[0]!.destination, count: eligible.length, nativeCount: eligible.filter(task => task.asset === 'native').length, tokenCount: eligible.filter(task => task.asset === 'token').length }, result: { dryRun, serverSigning: false, serverBroadcast: false, confirmed: 0, failed: 0, pending: eligible.length }, created_at: now, updated_at: now };
        setActiveJob(localJob);
        log('客户端本地归集审计已启用；未上传私钥或助记词', 'success');
      } else setRecordError('归集记录保存失败；为避免失去审计记录，执行按钮已锁定，请重新生成计划');
    } finally {
      setSaving(false);
    }
  }

  async function persistResults() {
    const id = jobIdRef.current;
    if (!id) return;
    setSaving(true);
    setRecordError('');
    try {
      const response = await api<{ data: CollectionJob }>(`/collections/batch/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(collectionResultPayload(tasksRef.current)) });
      setActiveJob(response.data);
      log(`归集审计已更新：${response.data.status} · 服务端签名 0`, 'success');
      await loadHistory();
    } catch {
      setRecordError('归集结果尚未写入历史；当前页面仍保留结果，可点击“同步审计结果”重试');
    } finally {
      setSaving(false);
    }
  }

  async function load(file?: File) {
    if (!file) return;
    setError('');
    resetAudit();
    try {
      const parsed = parseCollectorCsv(await file.text(), chain);
      if (!parsed.length) throw new Error(`文件中没有 ${chain} 钱包`);
      setInputs(parsed);
      setAssets([]);
      setTasks([]);
      tasksRef.current = [];
      log(`已导入 ${parsed.length} 个公开钱包地址`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'CSV 导入失败'); }
  }

  function scan() {
    if (!inputs.length || scanning) return;
    setError('');
    resetAudit();
    setScanning(true);
    setAssets([]);
    setTasks([]);
    tasksRef.current = [];
    setScanProgress(0);
    const worker = new Worker(new URL('./scanner.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ type: string; assets?: ScannedAsset[]; completed: number }>) => {
      if (event.data.type === 'batch' && event.data.assets) {
        setAssets(items => [...items, ...event.data.assets!]);
        setScanProgress(event.data.completed);
      } else {
        setScanning(false);
        worker.terminate();
        workerRef.current = null;
        log(`扫描完成：${event.data.completed} 个钱包`, 'success');
      }
    };
    worker.onerror = () => { setScanning(false); setError('RPC 扫描线程异常；页面其他功能不受影响'); worker.terminate(); workerRef.current = null; };
    worker.postMessage({ chain, inputs });
  }

  function prepare() {
    try {
      const plan = buildCollectionPlan(chain, assets, destination, reserve);
      const eligible = plan.filter(task => Number(task.collectAmount) > 0);
      if (!eligible.length) throw new Error('扣除保留余额和手续费后，没有可归集任务');
      setTasks(plan);
      tasksRef.current = plan;
      setProgress(0);
      setError('');
      log(`归集计划生成：${eligible.length} 笔可归集，未请求钱包`, 'success');
      void persistPlan(plan);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '归集计划失败'); }
  }

  async function execute(list = tasksRef.current.filter(task => (task.executionStatus === 'pending' || task.executionStatus === 'failed') && Number(task.collectAmount) > 0)) {
    if (!activeJob || !list.length) return;
    if (!dryRun && !window.confirm(`即将逐笔请求钱包签名 ${list.length} 次，确认开始归集？`)) return;
    setRunning(true);
    pausedRef.current = false;
    setPaused(false);
    try {
      for (const task of list) {
        while (pausedRef.current) await new Promise(resolve => setTimeout(resolve, 100));
        task.executionStatus = 'running';
        task.attempts++;
        setTasks([...tasksRef.current]);
        try {
          const transfer: TransferTask = { id: task.id, row: task.attempts + 1, chain: task.chain, assetKind: task.asset, from: task.address, to: task.destination, amount: task.collectAmount, status: 'running', attempts: task.attempts, estimatedFee: task.estimatedFee, ...(task.token ? { token: task.token } : {}), ...(task.decimals !== undefined ? { decimals: task.decimals } : {}) };
          if (dryRun) { task.txHash = `DRY-COLLECT-${task.id.slice(2, 14)}`; task.executionStatus = 'confirmed'; }
          else { const result = await executeTask(transfer, { batchConfirmed: true }); task.txHash = result.hash; task.executionStatus = result.state; }
          log(dryRun ? '模拟归集通过' : task.executionStatus === 'confirmed' ? '归集交易已确认' : '归集交易已提交，等待链上确认', 'success', task.id);
        } catch (cause) {
          task.executionStatus = 'failed';
          task.error = cause instanceof Error ? cause.message : '归集失败';
          log(task.error, 'error', task.id);
        }
        setProgress(tasksRef.current.filter(item => Number(item.collectAmount) > 0 && (item.executionStatus === 'confirmed' || item.executionStatus === 'submitted' || item.executionStatus === 'failed')).length);
        setTasks([...tasksRef.current]);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally {
      setRunning(false);
      await persistResults();
    }
  }

  function toggle() { pausedRef.current = !pausedRef.current; setPaused(pausedRef.current); log(pausedRef.current ? '归集已暂停' : '归集已恢复'); }
  function retry() { const failed = tasksRef.current.filter(task => task.executionStatus === 'failed' && Number(task.collectAmount) > 0); failed.forEach(task => { task.executionStatus = 'pending'; delete task.error; }); void execute(failed); }

  const eligible = tasks.filter(task => Number(task.collectAmount) > 0);
  const assetGroups = new Set(eligible.map(task => `${task.symbol}:${task.token ?? 'native'}`));
  const total = eligible.reduce((sum, task) => sum + Number(task.collectAmount), 0);
  const totalLabel = assetGroups.size === 1 && eligible[0] ? `${total.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')} ${eligible[0].symbol}` : `${assetGroups.size} 种资产`;

  return <>
    <div className="page-head"><div><p className="eyebrow">CLIENT-SIDE ASSET COLLECTOR</p><h1>资产归集</h1><p>客户端扫描与钱包签名；服务器只保存公开计划和脱敏审计结果。</p></div></div>
    <div className="grid">
      <section className="panel form-panel">
        <h3>归集配置</h3>
        <label>网络<select value={chain} disabled={scanning || running || saving} onChange={event => { setChain(event.target.value as TransferChain); setInputs([]); setAssets([]); setTasks([]); tasksRef.current = []; resetAudit(); }}><option>EVM</option><option value="SOL">Solana</option><option>TRON</option></select></label>
        <label>钱包 CSV<input type="file" accept=".csv,text/csv" disabled={scanning || running || saving} onChange={event => void load(event.target.files?.[0])}/></label>
        <label>归集目标地址<input value={destination} disabled={scanning || running || saving} onChange={event => { setDestination(event.target.value.trim()); resetAudit(); }} placeholder="公开接收地址"/></label>
        <label>每个钱包最低余额保留<input value={reserve} disabled={scanning || running || saving} inputMode="decimal" onChange={event => { setReserve(event.target.value); resetAudit(); }}/></label>
        <label className="dry-run"><input type="checkbox" checked={dryRun} disabled={scanning || running || saving} onChange={event => { setDryRun(event.target.checked); resetAudit(); }}/> Dry Run（默认开启）</label>
        <div className="notice"><ShieldCheck size={18}/>{chain==='SOL'?'Solana 会自动发现原生币、SPL Token 与 Token-2022；':'EVM/TRON 自动扫描原生币；Token 可在 CSV 的 token、decimals 列明确加入。'} 私钥不进入 API、数据库或日志。</div>
        {error && <div className="batch-error">{error}</div>}{recordError && <div className="batch-error">{recordError}</div>}
        <div className="collector-actions"><button onClick={scan} disabled={!inputs.length || scanning || running || saving}>{scanning ? `扫描中 · ${scanProgress}/${inputs.length}` : `扫描钱包${inputs.length ? ` · ${scanProgress}/${inputs.length}` : ''}`}</button><button onClick={prepare} disabled={!assets.length || scanning || running || saving}>{saving ? '正在保存…' : '生成并保存归集计划'}</button></div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>资产与计划</h3><span>{assets.length} 个钱包</span></div>
        {assets.length ? <><div className="transfer-summary"><b>可归集任务 {eligible.length}</b><b>预计归集 {totalLabel}</b><small>失败扫描 {assets.filter(item => item.status === 'failed').length} · RPC 错误不会中断页面</small><small>任务记录：{activeJob ? `${activeJob.id.slice(0, 8)} · ${activeJob.status}` : saving ? '保存中' : '未保存'}</small></div>{tasks.length > 0 && <><div className="export-actions"><button onClick={() => void execute()} disabled={running || saving || !activeJob}>{dryRun ? '运行模拟并记录' : '开始逐笔归集'}</button>{running && <button onClick={toggle}>{paused ? '恢复' : '暂停'}</button>}<button onClick={retry} disabled={running || saving || !activeJob || !tasks.some(item => item.executionStatus === 'failed' && Number(item.collectAmount) > 0)}>失败重试</button><button onClick={() => void persistResults()} disabled={running || saving || !activeJob}>同步审计结果</button><button onClick={() => exportCollectorResults(tasks)}>导出 CSV</button></div><div className="transfer-progress"><span style={{ width: `${eligible.length ? progress / eligible.length * 100 : 0}%` }}/></div></>}<div className="wallet-list">{(tasks.length ? tasks : assets).slice(0, 100).map(item => <AssetRow key={item.id} item={item}/>)}</div></> : <div className="mini-empty"><CircleDollarSign/><p>导入钱包 CSV 后扫描链上资产</p></div>}
      </section>
    </div>
    <section className="panel transfer-history"><div className="panel-head"><div><p className="eyebrow">AUDIT TRAIL</p><h3><History size={16}/>最近归集历史</h3></div><button onClick={() => void loadHistory()} title="刷新归集历史"><RefreshCw size={15}/></button></div><div className="transfer-history-table"><div><b>创建时间</b><b>网络 / 模式</b><b>数量</b><b>结果</b><b>状态</b></div>{history.map(job => <div key={job.id}><span>{new Date(job.created_at).toLocaleString()}</span><span>{job.payload.chain} · {job.payload.dryRun ? 'Dry Run' : '钱包签名'}</span><span>{job.payload.count}</span><span>{job.result.confirmed ?? 0} 成功 / {job.result.failed ?? 0} 失败</span><em className={job.status}>{job.status}</em></div>)}</div>{!history.length && <p className="transfer-history-empty">尚无已保存的资产归集任务。</p>}</section>
    <section className="panel transfer-logs"><div className="panel-head"><h3>归集日志</h3><span>{logs.length} 条</span></div>{logs.slice(-200).map((item, index) => <code key={`${item.at}-${index}`} className={item.level}>{item.at} {item.taskId?.slice(0, 10) ?? '-'} {item.message}</code>)}</section>
  </>;
}
