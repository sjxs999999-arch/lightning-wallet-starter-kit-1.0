import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleDollarSign, History, RefreshCw, ShieldCheck } from 'lucide-react';
import { ApiError, api } from '../api';
import { isPositiveDecimal, sumDecimals } from '../amount';
import { executeTask, getActiveSender } from '../batch-transfer/executor';
import { executeEvmBatch } from '../batch-transfer/evm-batch';
import { executeSolanaBatch } from '../batch-transfer/solana-batch';
import type { TransferChain, TransferTask } from '../batch-transfer/types';
import { exportCollectorResults, parseCollectorCsv } from './csv';
import { collectionPlanPayload, collectionResultPayload } from './persistence';
import type { CollectionJob } from './persistence';
import { buildCollectionPlan } from './planner';
import type { CollectorLog, CollectorTask, ScanInput, ScannedAsset } from './types';
import { loadLocalCollectionHistory, saveLocalCollectionJob } from './local-history';
import { collectorSenderCount, collectorTasksForActiveSender } from './sender-groups';
import { collectorTransferTask } from './transfer-task';
import { executeLocalVaultBatch, selectLocalWallet, walletsForChain } from '../batch-transfer/local-vault-executor';
import { useLocalWalletSession } from '../wallet-center/LocalWalletSession';

type SigningSource = 'extension' | 'local-vault';

function AssetRow({ item }: { item: ScannedAsset | CollectorTask }) {
  const task = 'executionStatus' in item ? item : undefined;
  return <div><b>{item.symbol} · 余额 {item.balance} · Gas {item.estimatedFee}</b><code>{item.address}</code>{task && <small>保留 {task.reserve} · 归集 {task.collectAmount} · {task.executionStatus}</small>}{item.error && <small>{item.error}</small>}</div>;
}

export function AssetCollector() {
  const { vault, vaultKey, isKeyActive } = useLocalWalletSession();
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
  const [signingSource, setSigningSource] = useState<SigningSource>('extension');
  const chainWallets = walletsForChain(vault, chain);
  const [localWalletId, setLocalWalletId] = useState(chainWallets[0]?.id ?? '');
  const workerRef = useRef<Worker | null>(null);
  const pausedRef = useRef(false);
  const stopRef = useRef(false);
  const tasksRef = useRef<CollectorTask[]>([]);
  const jobIdRef = useRef<string | null>(null);

  const log = (message: string, level: CollectorLog['level'] = 'info', taskId?: string) => setLogs(items => [...items, { at: new Date().toISOString(), message, level, ...(taskId ? { taskId } : {}) }]);
  const loadHistory = useCallback(async () => {
    const local=loadLocalCollectionHistory();
    try { const remote=(await api<{ data: CollectionJob[] }>('/collections/history?limit=20')).data;setHistory([...remote,...local].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,50));setRecordError(''); }
    catch (cause) { setHistory(local);if (!(cause instanceof ApiError && cause.status === 401)) setRecordError('服务器归集历史暂时无法读取，本地审计历史仍可使用'); }
  }, []);

  useEffect(() => {
    void loadHistory();
    return () => { stopRef.current = true; workerRef.current?.terminate(); };
  }, [loadHistory]);

  useEffect(() => {
    const available = walletsForChain(vault, chain);
    if (!available.some(wallet => wallet.id === localWalletId)) setLocalWalletId(available[0]?.id ?? '');
  }, [chain, localWalletId, vault]);

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
        const eligible = nextTasks.filter(task => isPositiveDecimal(task.collectAmount));
        const now = new Date().toISOString();
        const localJob: CollectionJob = { id: `local-${crypto.randomUUID()}`, kind: 'asset-collection', status: 'validated', payload: { chain: eligible[0]!.chain, dryRun, destination: eligible[0]!.destination, count: eligible.length, nativeCount: eligible.filter(task => task.asset === 'native').length, tokenCount: eligible.filter(task => task.asset === 'token').length }, result: { dryRun, serverSigning: false, serverBroadcast: false, confirmed: 0, failed: 0, pending: eligible.length }, created_at: now, updated_at: now };
        jobIdRef.current = localJob.id;
        setActiveJob(localJob);
        setHistory(saveLocalCollectionJob(localJob));
        log('客户端本地归集审计已启用；未上传私钥或助记词', 'success');
      } else setRecordError('归集记录保存失败；为避免失去审计记录，执行按钮已锁定，请重新生成计划');
    } finally {
      setSaving(false);
    }
  }

  async function persistResults() {
    const id = jobIdRef.current;
    if (!id) return;
    if (id.startsWith('local-') && activeJob) {
      const eligible=tasksRef.current.filter(task=>isPositiveDecimal(task.collectAmount)),confirmed=eligible.filter(task=>task.executionStatus==='confirmed').length,failed=eligible.filter(task=>task.executionStatus==='failed').length,skipped=eligible.filter(task=>task.executionStatus==='skipped').length,pending=eligible.length-confirmed-failed-skipped,status:CollectionJob['status']=pending>0?'paused':failed===0?'completed':confirmed>0?'partial':'failed';
      const next:CollectionJob={...activeJob,status,result:{...activeJob.result,broadcastByWallet:!activeJob.payload.dryRun&&confirmed>0,confirmed,failed,pending,skipped},updated_at:new Date().toISOString()};
      setActiveJob(next);setHistory(saveLocalCollectionJob(next));return;
    }
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
    worker.onmessage = (event: MessageEvent<{ type: string; assets?: ScannedAsset[]; completed: number; message?: string }>) => {
      if (event.data.type === 'batch' && event.data.assets) {
        setAssets(items => [...items, ...event.data.assets!]);
        setScanProgress(event.data.completed);
      } else if (event.data.type === 'done') {
        setScanning(false);
        worker.terminate();
        workerRef.current = null;
        log(`扫描完成：${event.data.completed} 个钱包`, 'success');
      } else {
        setScanning(false);
        worker.terminate();
        workerRef.current = null;
        setError(event.data.message ?? '归集扫描网络验证失败；页面其他功能不受影响');
      }
    };
    worker.onerror = () => { setScanning(false); setError('RPC 扫描线程异常；页面其他功能不受影响'); worker.terminate(); workerRef.current = null; };
    worker.postMessage({ chain, inputs, profile: signingSource === 'local-vault' ? 'local-testnet' : 'configured' });
  }

  function prepare() {
    try {
      const plan = buildCollectionPlan(chain, assets, destination, reserve);
      const eligible = plan.filter(task => isPositiveDecimal(task.collectAmount));
      if (!eligible.length) throw new Error('扣除保留余额和手续费后，没有可归集任务');
      setTasks(plan);
      tasksRef.current = plan;
      setProgress(0);
      setError('');
      log(`归集计划生成：${eligible.length} 笔可归集，未请求钱包`, 'success');
      void persistPlan(plan);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '归集计划失败'); }
  }

  async function execute(list = tasksRef.current.filter(task => (task.executionStatus === 'pending' || task.executionStatus === 'failed') && isPositiveDecimal(task.collectAmount))) {
    if (!activeJob || !list.length) return;
    let executionList = list;
    let localWallet = undefined;
    if (!dryRun && signingSource === 'local-vault') {
      if (!vaultKey) { setError('本地保险库已锁定；请先到钱包中心解锁，再返回本页执行');return; }
      try {
        const transfers = list.map((task, index) => collectorTransferTask(task, index + 2));
        const selected = selectLocalWallet(vault, chain, localWalletId, transfers);
        localWallet = selected.wallet;
        const ids = new Set(selected.tasks.map(task => task.id));
        executionList = list.filter(task => ids.has(task.id));
        log(`已选择本地钱包的 ${executionList.length} 项资产；其他钱包保持待处理`, 'success');
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '无法选择本地钱包';
        setError(message);log(message, 'error');return;
      }
    } else if (!dryRun && collectorSenderCount(list) > 1) {
      if (!window.confirm(`当前归集计划包含 ${collectorSenderCount(list)} 个发送账户。\n将连接当前钱包并只归集该活动账户的资产，完成后切换钱包继续。`)) return;
      try {
        const activeSender = await getActiveSender(chain, list.map(task => task.address));
        executionList = collectorTasksForActiveSender(list, activeSender);
        if (!executionList.length) throw new Error(`当前钱包账户 ${activeSender} 不在待归集地址中`);
        log(`已选择当前钱包的 ${executionList.length} 项资产；其他钱包保持待处理`, 'success');
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '无法识别当前钱包账户';
        setError(message);
        log(message, 'error');
        return;
      }
    }
    if (!dryRun && !window.confirm(signingSource === 'local-vault'
      ? `确认使用本地加密钱包归集 ${executionList.length} 项测试网资产？\n\n只确认一次；每笔在一次性 Worker 内解密签名并按顺序广播。主网仍关闭。`
      : `即将请求当前钱包签名 ${executionList.length} 次，确认开始归集？`)) return;
    setRunning(true);
    pausedRef.current = false;
    stopRef.current = false;
    setPaused(false);

    if (!dryRun && signingSource === 'local-vault' && localWallet && vaultKey) {
      const transfers = executionList.map((task, index) => collectorTransferTask(task, index + 2));
      try {
        await executeLocalVaultBatch(transfers, localWallet, vaultKey, {
          waitUntilResumed: async () => { while (pausedRef.current && !stopRef.current) await new Promise(resolve => setTimeout(resolve, 100)); },
          shouldStop: () => stopRef.current || !isKeyActive(vaultKey),
          onStart: index => {
            const task = executionList[index]!;task.executionStatus = 'running';task.attempts++;
            setTasks([...tasksRef.current]);
          },
          onResult: result => {
            const task = executionList[result.index]!;
            if (result.hash && result.state) { task.txHash = result.hash;task.executionStatus = result.state;delete task.error;log(result.state === 'confirmed' ? '本地钱包测试网归集已确认' : '本地钱包测试网归集已提交', 'success', task.id); }
            else { task.executionStatus = 'failed';task.error = result.error ?? '本地测试网归集失败';log(task.error, 'error', task.id); }
            setProgress(tasksRef.current.filter(item => isPositiveDecimal(item.collectAmount) && (item.executionStatus === 'confirmed' || item.executionStatus === 'submitted' || item.executionStatus === 'failed')).length);
            setTasks([...tasksRef.current]);
          },
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '本地测试网归集失败';
        const current = executionList.find(task => task.executionStatus === 'running');
        if (current) { current.executionStatus = 'failed';current.error = message; }
        log(`${message}；当前钱包分组已停止，页面与保险库保持安全`, 'error');
      } finally {
        setTasks([...tasksRef.current]);setRunning(false);await persistResults();
        const remaining = tasksRef.current.filter(task => (task.executionStatus === 'pending' || task.executionStatus === 'failed') && isPositiveDecimal(task.collectAmount));
        if (remaining.length) log(`仍有 ${collectorSenderCount(remaining)} 个钱包待归集或重试`, 'info');
      }
      return;
    }

    if (!dryRun && chain === 'EVM') {
      try {
        executionList.forEach(task => { task.executionStatus = 'running'; task.attempts++; });
        setTasks([...tasksRef.current]);
        const results = await executeEvmBatch(executionList.map((task, index) => collectorTransferTask(task, index + 2)));
        if (results) {
          results.forEach((result, index) => {
            const task = executionList[index]!;
            task.txHash = result.hash;
            task.executionStatus = result.state;
            if (result.error) task.error = result.error;
            log(result.state === 'confirmed' ? 'EVM 批量归集已确认' : result.state === 'failed' ? result.error ?? 'EVM 批量归集失败' : 'EVM 批量归集已提交', result.state === 'failed' ? 'error' : 'success', task.id);
          });
          setProgress(tasksRef.current.filter(item => isPositiveDecimal(item.collectAmount) && (item.executionStatus === 'confirmed' || item.executionStatus === 'submitted' || item.executionStatus === 'failed')).length);
          setTasks([...tasksRef.current]);
          setRunning(false);
          await persistResults();
          const remaining = tasksRef.current.filter(task => (task.executionStatus === 'pending' || task.executionStatus === 'failed') && isPositiveDecimal(task.collectAmount));
          if (remaining.length) log(`仍有 ${collectorSenderCount(remaining)} 个钱包待归集或重试；保持或切换到对应钱包后继续`, 'info');
          return;
        }
        executionList.forEach(task => { task.executionStatus = 'pending'; task.attempts--; });
        log('当前 EVM 钱包不支持 EIP-5792 批量归集，已安全回退逐笔确认');
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'EVM 批量归集失败';
        executionList.forEach(task => { if (task.executionStatus === 'running') { task.executionStatus = 'failed'; task.error = message; } });
        log(`${message}；当前钱包分组已停止`, 'error');
        setTasks([...tasksRef.current]);
        setRunning(false);
        await persistResults();
        return;
      }
    }

    if (!dryRun && chain === 'SOL') {
      try {
        executionList.forEach(task => { task.executionStatus = 'running'; task.attempts++; });
        setTasks([...tasksRef.current]);
        const results = await executeSolanaBatch(executionList.map((task, index) => collectorTransferTask(task, index + 2)), {
          waitUntilResumed: async () => { while (pausedRef.current && !stopRef.current) await new Promise(resolve => setTimeout(resolve, 100)); },
          shouldStop: () => stopRef.current,
          onBroadcast: result => {
            const task = executionList[result.index]!;
            if (result.signature) { task.txHash = result.signature; task.executionStatus = 'submitted'; }
            else { task.executionStatus = 'failed'; task.error = result.error ?? '广播失败'; }
            setProgress(tasksRef.current.filter(item => isPositiveDecimal(item.collectAmount) && (item.executionStatus === 'confirmed' || item.executionStatus === 'submitted' || item.executionStatus === 'failed')).length);
            setTasks([...tasksRef.current]);
          },
        });
        results.forEach((result, index) => {
          const task = executionList[index]!;
          if (result.signature) { task.txHash = result.signature; task.executionStatus = result.state; log(result.state === 'confirmed' ? 'Solana 批量归集已确认' : 'Solana 批量归集已提交', 'success', task.id); }
          else { task.executionStatus = 'failed'; task.error = result.error ?? '广播失败'; log(task.error, 'error', task.id); }
        });
        setProgress(tasksRef.current.filter(item => isPositiveDecimal(item.collectAmount) && (item.executionStatus === 'confirmed' || item.executionStatus === 'submitted' || item.executionStatus === 'failed')).length);
        setTasks([...tasksRef.current]);
        setRunning(false);
        await persistResults();
        const remaining = tasksRef.current.filter(task => (task.executionStatus === 'pending' || task.executionStatus === 'failed') && isPositiveDecimal(task.collectAmount));
        if (remaining.length) log(`仍有 ${collectorSenderCount(remaining)} 个钱包待归集或重试；保持或切换到对应钱包后继续`, 'info');
        return;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Solana 批量归集失败';
        if (/signAllTransactions/.test(message)) {
          executionList.forEach(task => { task.executionStatus = 'pending'; task.attempts--; });
          log('当前 Solana 钱包不支持批量签名，已安全回退逐笔确认');
        } else {
          executionList.forEach(task => { if (task.executionStatus === 'running') { task.executionStatus = 'failed'; task.error = message; } });
          log(`${message}；当前钱包分组已停止`, 'error');
          setTasks([...tasksRef.current]);
          setRunning(false);
          await persistResults();
          return;
        }
      }
    }

    try {
      for (const [index, task] of executionList.entries()) {
        while (pausedRef.current && !stopRef.current) await new Promise(resolve => setTimeout(resolve, 100));
        if (stopRef.current) break;
        task.executionStatus = 'running';
        task.attempts++;
        setTasks([...tasksRef.current]);
        try {
          const transfer: TransferTask = collectorTransferTask(task, index + 2);
          if (dryRun) { task.txHash = `DRY-COLLECT-${task.id.slice(2, 14)}`; task.executionStatus = 'confirmed'; }
          else { const result = await executeTask(transfer, { batchConfirmed: true }); task.txHash = result.hash; task.executionStatus = result.state; }
          log(dryRun ? '模拟归集通过' : task.executionStatus === 'confirmed' ? '归集交易已确认' : '归集交易已提交，等待链上确认', 'success', task.id);
        } catch (cause) {
          task.executionStatus = 'failed';
          task.error = cause instanceof Error ? cause.message : '归集失败';
          log(task.error, 'error', task.id);
        }
        setProgress(tasksRef.current.filter(item => isPositiveDecimal(item.collectAmount) && (item.executionStatus === 'confirmed' || item.executionStatus === 'submitted' || item.executionStatus === 'failed')).length);
        setTasks([...tasksRef.current]);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally {
      setRunning(false);
      await persistResults();
      const remaining = tasksRef.current.filter(task => (task.executionStatus === 'pending' || task.executionStatus === 'failed') && isPositiveDecimal(task.collectAmount));
      if (!dryRun && remaining.length) log(`仍有 ${collectorSenderCount(remaining)} 个钱包待归集或重试；保持或切换到对应钱包后继续`, 'info');
    }
  }

  function toggle() { pausedRef.current = !pausedRef.current; setPaused(pausedRef.current); log(pausedRef.current ? '归集已暂停' : '归集已恢复'); }
  function retry() { const failed = tasksRef.current.filter(task => task.executionStatus === 'failed' && isPositiveDecimal(task.collectAmount)); failed.forEach(task => { task.executionStatus = 'pending'; delete task.error; }); void execute(failed); }

  const eligible = tasks.filter(task => isPositiveDecimal(task.collectAmount));
  const unfinished = eligible.filter(task => task.executionStatus === 'pending' || task.executionStatus === 'failed');
  const unfinishedWallets = collectorSenderCount(unfinished);
  const assetGroups = new Set(eligible.map(task => `${task.symbol}:${task.token ?? 'native'}`));
  const totalLabel = assetGroups.size === 1 && eligible[0] ? `${sumDecimals(eligible.map(task => task.collectAmount))} ${eligible[0].symbol}` : `${assetGroups.size} 种资产`;

  return <>
    <div className="page-head"><div><p className="eyebrow">CLIENT-SIDE ASSET COLLECTOR</p><h1>资产归集</h1><p>客户端扫描与钱包签名；服务器只保存公开计划和脱敏审计结果。</p></div></div>
    <div className="grid">
      <section className="panel form-panel">
        <h3>归集配置</h3>
        <label>网络<select value={chain} disabled={scanning || running || saving} onChange={event => { setChain(event.target.value as TransferChain); setInputs([]); setAssets([]); setTasks([]); tasksRef.current = []; resetAudit(); }}><option>EVM</option><option value="SOL">Solana</option><option>TRON</option></select></label>
        <label>签名来源<select value={signingSource} disabled={scanning || running || saving} onChange={event => setSigningSource(event.target.value as SigningSource)}><option value="extension">浏览器扩展钱包</option><option value="local-vault">本地加密钱包（仅测试网）</option></select></label>
        {signingSource === 'local-vault' && <label>本地钱包<select value={localWalletId} disabled={scanning || running || saving || !chainWallets.length} onChange={event => setLocalWalletId(event.target.value)}><option value="">{chainWallets.length ? '请选择钱包' : '当前网络没有本地钱包'}</option>{chainWallets.map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name} · {wallet.address.slice(0, 8)}…{wallet.address.slice(-6)}</option>)}</select></label>}
        <label>钱包 CSV<input type="file" accept=".csv,text/csv" disabled={scanning || running || saving} onChange={event => void load(event.target.files?.[0])}/></label>
        <label>归集目标地址<input value={destination} disabled={scanning || running || saving} onChange={event => { setDestination(event.target.value.trim()); resetAudit(); }} placeholder="公开接收地址"/></label>
        <label>每个钱包最低余额保留<input value={reserve} disabled={scanning || running || saving} inputMode="decimal" onChange={event => { setReserve(event.target.value); resetAudit(); }}/></label>
        <label className="dry-run"><input type="checkbox" checked={dryRun} disabled={scanning || running || saving} onChange={event => { setDryRun(event.target.checked); resetAudit(); }}/> Dry Run（默认开启）</label>
        <div className="notice"><ShieldCheck size={18}/>{signingSource === 'local-vault' ? `本地钱包模式固定使用 Sepolia / Solana Devnet / TRON Nile-Shasta；${vaultKey ? '保险库已解锁' : '保险库当前锁定'}。一次确认后由隔离 Worker 逐笔签名，主网不会开启。` : unfinishedWallets > 1 ? `检测到 ${unfinishedWallets} 个待归集钱包：每次只归集当前已连接账户，切换钱包后继续。` : chain==='SOL'?'Solana 会自动发现原生币、SPL Token 与 Token-2022；':'EVM/TRON 自动扫描原生币；Token 可在 CSV 的 token、decimals 列明确加入。'} 私钥不进入 API、数据库或日志。</div>
        {error && <div className="batch-error">{error}</div>}{recordError && <div className="batch-error">{recordError}</div>}
        <div className="collector-actions"><button onClick={scan} disabled={!inputs.length || scanning || running || saving}>{scanning ? `扫描中 · ${scanProgress}/${inputs.length}` : `扫描钱包${inputs.length ? ` · ${scanProgress}/${inputs.length}` : ''}`}</button><button onClick={prepare} disabled={!assets.length || scanning || running || saving}>{saving ? '正在保存…' : '生成并保存归集计划'}</button></div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>资产与计划</h3><span>{assets.length} 个钱包</span></div>
        {assets.length ? <><div className="transfer-summary"><b>可归集任务 {eligible.length}</b><b>预计归集 {totalLabel}</b><small>待处理钱包 {unfinishedWallets}</small><small>失败扫描 {assets.filter(item => item.status === 'failed').length} · RPC 错误不会中断页面</small><small>任务记录：{activeJob ? `${activeJob.id.slice(0, 8)} · ${activeJob.status}` : saving ? '保存中' : '未保存'}</small>{signingSource === 'local-vault' && <small>⚠ 实际测试网手续费在每笔签名前重新估算</small>}</div>{tasks.length > 0 && <><div className="export-actions"><button onClick={() => void execute()} disabled={running || saving || !activeJob}>{dryRun ? '运行模拟并记录' : signingSource === 'local-vault' ? '一次确认并按序归集' : unfinishedWallets > 1 ? '批量归集当前钱包资产' : chain === 'EVM' || chain === 'SOL' ? '开始批量归集' : '开始逐笔归集'}</button>{running && <button onClick={toggle}>{paused ? '恢复' : '暂停'}</button>}<button onClick={retry} disabled={running || saving || !activeJob || !tasks.some(item => item.executionStatus === 'failed' && isPositiveDecimal(item.collectAmount))}>失败重试</button><button onClick={() => void persistResults()} disabled={running || saving || !activeJob}>同步审计结果</button><button onClick={() => exportCollectorResults(tasks)}>导出 CSV</button></div><div className="transfer-progress"><span style={{ width: `${eligible.length ? progress / eligible.length * 100 : 0}%` }}/></div></>}<div className="wallet-list">{(tasks.length ? tasks : assets).slice(0, 100).map(item => <AssetRow key={item.id} item={item}/>)}</div></> : <div className="mini-empty"><CircleDollarSign/><p>导入钱包 CSV 后扫描链上资产</p></div>}
      </section>
    </div>
    <section className="panel transfer-history"><div className="panel-head"><div><p className="eyebrow">AUDIT TRAIL</p><h3><History size={16}/>最近归集历史</h3></div><button onClick={() => void loadHistory()} title="刷新归集历史"><RefreshCw size={15}/></button></div><div className="transfer-history-table"><div><b>创建时间</b><b>网络 / 模式</b><b>数量</b><b>结果</b><b>状态</b></div>{history.map(job => <div key={job.id}><span>{new Date(job.created_at).toLocaleString()}</span><span>{job.payload.chain} · {job.payload.dryRun ? 'Dry Run' : '钱包签名'}</span><span>{job.payload.count}</span><span>{job.result.confirmed ?? 0} 成功 / {job.result.failed ?? 0} 失败</span><em className={job.status}>{job.status}</em></div>)}</div>{!history.length && <p className="transfer-history-empty">尚无已保存的资产归集任务。</p>}</section>
    <section className="panel transfer-logs"><div className="panel-head"><h3>归集日志</h3><span>{logs.length} 条</span></div>{logs.slice(-200).map((item, index) => <code key={`${item.at}-${index}`} className={item.level}>{item.at} {item.taskId?.slice(0, 10) ?? '-'} {item.message}</code>)}</section>
  </>;
}
