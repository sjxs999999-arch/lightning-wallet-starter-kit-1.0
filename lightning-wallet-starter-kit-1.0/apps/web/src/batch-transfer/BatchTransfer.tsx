import { useCallback, useEffect, useRef, useState } from 'react';
import { History, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api';
import { downloadTransferTemplate, exportResults, parseTransferCsv, transferCsvExample } from './csv';
import { executeTask, getActiveSender } from './executor';
import { executeEvmBatch } from './evm-batch';
import { transferPlanPayload, transferResultPayload } from './persistence';
import type { TransferJob } from './persistence';
import type { TransferChain, TransferInput, TransferLog, TransferMode, TransferPlan, TransferTask } from './types';
import { executeSolanaBatch } from './solana-batch';
import { loadLocalTransferHistory, saveLocalTransferJob } from './local-history';
import { pendingSenderCount, senderCount, tasksForActiveSender } from './sender-groups';
import { validateAddress } from './validation';
import { executeLocalVaultBatch, selectLocalWallet, walletsForChain } from './local-vault-executor';
import { useLocalWalletSession } from '../wallet-center/LocalWalletSession';

type SigningSource = 'extension' | 'local-vault';

export function BatchTransfer() {
  const { vault, vaultKey, isKeyActive } = useLocalWalletSession();
  const [searchParams] = useSearchParams();
  const requestedChain = searchParams.get('chain');
  const initialChain: TransferChain = requestedChain === 'SOL' || requestedChain === 'TRON' ? requestedChain : 'EVM';
  const requestedSenderValue = searchParams.get('from')?.trim() ?? '';
  const requestedSender = validateAddress(initialChain, requestedSenderValue) ? requestedSenderValue : '';
  const [chain, setChain] = useState<TransferChain>(initialChain);
  const [mode, setMode] = useState<TransferMode>('one-to-many');
  const [dryRun, setDryRun] = useState(true);
  const [inputs, setInputs] = useState<TransferInput[]>([]);
  const [plan, setPlan] = useState<TransferPlan | null>(null);
  const [error, setError] = useState('');
  const [recordError, setRecordError] = useState('');
  const [logs, setLogs] = useState<TransferLog[]>([]);
  const [history, setHistory] = useState<TransferJob[]>([]);
  const [activeJob, setActiveJob] = useState<TransferJob | null>(null);
  const [progress, setProgress] = useState(0);
  const [planningMs, setPlanningMs] = useState(0);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showExample, setShowExample] = useState(false);
  const chainWallets = walletsForChain(vault, chain);
  const initialLocalWallet = chainWallets.find(wallet => requestedSender && (chain === 'EVM' ? wallet.address.toLowerCase() === requestedSender.toLowerCase() : wallet.address === requestedSender));
  const [signingSource, setSigningSource] = useState<SigningSource>(initialLocalWallet ? 'local-vault' : 'extension');
  const [localWalletId, setLocalWalletId] = useState(initialLocalWallet?.id ?? chainWallets[0]?.id ?? '');
  const workerRef = useRef<Worker | null>(null);
  const pausedRef = useRef(false);
  const stopRef = useRef(false);
  const tasksRef = useRef<TransferTask[]>([]);
  const jobIdRef = useRef<string | null>(null);

  const log = (message: string, level: TransferLog['level'] = 'info', taskId?: string) => setLogs(items => [...items, { at: new Date().toISOString(), message, level, ...(taskId ? { taskId } : {}) }]);
  const loadHistory = useCallback(async () => {
    const local = loadLocalTransferHistory();
    try { const remote=(await api<{ data: TransferJob[] }>('/transfers/history?limit=20')).data;setHistory([...remote,...local].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)).slice(0,50)); }
    catch (cause) { setHistory(local);if (!(cause instanceof ApiError && cause.status === 401)) setRecordError('服务器任务历史暂时无法读取，本地审计历史仍可使用'); }
  }, []);

  useEffect(() => {
    void loadHistory();
    return () => { workerRef.current?.terminate(); stopRef.current = true; };
  }, [loadHistory]);

  useEffect(() => {
    const available = walletsForChain(vault, chain);
    if (!available.some(wallet => wallet.id === localWalletId)) setLocalWalletId(available[0]?.id ?? '');
  }, [chain, localWalletId, vault]);

  async function persistPlan(nextPlan: TransferPlan) {
    setSaving(true);
    setRecordError('');
    jobIdRef.current = null;
    setActiveJob(null);
    try {
      const response = await api<{ data: TransferJob }>('/transfers/batch', { method: 'POST', body: JSON.stringify(transferPlanPayload(nextPlan, crypto.randomUUID())) });
      jobIdRef.current = response.data.id;
      setActiveJob(response.data);
      log(`任务记录已保存：${response.data.id.slice(0, 8)} · 私钥上传 0`, 'success');
      await loadHistory();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        const now = new Date().toISOString();
        const localJob: TransferJob = { id: `local-${crypto.randomUUID()}`, kind: 'batch-transfer', status: 'validated', payload: { chain: nextPlan.chain, mode: nextPlan.mode, dryRun: nextPlan.dryRun, count: nextPlan.tasks.length, totalAmount: nextPlan.totalAmount, totalEstimatedFee: nextPlan.totalEstimatedFee }, result: { dryRun: nextPlan.dryRun, serverSigning: false, serverBroadcast: false, confirmed: 0, failed: 0, pending: nextPlan.tasks.length }, created_at: now, updated_at: now };
        jobIdRef.current = localJob.id;
        setActiveJob(localJob);
        setHistory(saveLocalTransferJob(localJob));
        log('客户端本地审计已启用；未上传私钥或助记词', 'success');
      } else setRecordError('任务记录保存失败；为避免失去审计记录，执行按钮已锁定，请重试规划');
    } finally {
      setSaving(false);
    }
  }

  async function persistResults() {
    const id = jobIdRef.current;
    if (!id) return;
    if (id.startsWith('local-') && activeJob) {
      const confirmed=tasksRef.current.filter(task=>task.status==='confirmed').length,failed=tasksRef.current.filter(task=>task.status==='failed').length,skipped=tasksRef.current.filter(task=>task.status==='skipped').length,pending=tasksRef.current.length-confirmed-failed-skipped,status:TransferJob['status']=pending>0?'paused':failed===0?'completed':confirmed>0?'partial':'failed';
      const next:TransferJob={...activeJob,status,result:{...activeJob.result,broadcastByWallet:!activeJob.payload.dryRun&&confirmed>0,confirmed,failed,pending,skipped},updated_at:new Date().toISOString()};
      setActiveJob(next);setHistory(saveLocalTransferJob(next));return;
    }
    setSaving(true);
    setRecordError('');
    try {
      const response = await api<{ data: TransferJob }>(`/transfers/batch/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(transferResultPayload(tasksRef.current)) });
      setActiveJob(response.data);
      log(`审计结果已更新：${response.data.status} · 服务端签名 0`, 'success');
      await loadHistory();
    } catch {
      setRecordError('执行结果尚未写入任务历史，请勿关闭页面并再次点击失败重试或重新规划');
    } finally {
      setSaving(false);
    }
  }

  async function importCsv(file?: File) {
    if (!file) return;
    setError('');
    setRecordError('');
    try {
      const parsed = parseTransferCsv(await file.text());
      setInputs(parsed);
      setPlan(null);
      setActiveJob(null);
      jobIdRef.current = null;
      log(`已在客户端读取 ${parsed.length} 笔公开交易参数`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'CSV 导入失败'); }
  }

  function prepare() {
    if (!inputs.length) { setError('请先导入 CSV'); return; }
    setError('');
    setRecordError('');
    setPlan(null);
    setActiveJob(null);
    jobIdRef.current = null;
    setProgress(0);
    const worker = new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ type: string; plan?: TransferPlan; elapsed?: number; message?: string }>) => {
      if (event.data.type === 'planned' && event.data.plan) {
        setPlan(event.data.plan);
        tasksRef.current = event.data.plan.tasks;
        setPlanningMs(event.data.elapsed ?? 0);
        log(`规划完成：${event.data.plan.tasks.length} 笔，未广播`, 'success');
        void persistPlan(event.data.plan);
      } else setError(event.data.message ?? '规划失败');
      worker.terminate();
      workerRef.current = null;
    };
    worker.onerror = () => { setError('本地规划线程异常，请重试'); worker.terminate(); workerRef.current = null; };
    worker.postMessage({ chain, mode, inputs, dryRun });
  }

  async function execute(tasks = tasksRef.current.filter(task => task.status === 'pending' || task.status === 'failed')) {
    if (!plan || !activeJob || !tasks.length) return;
    let executionTasks = tasks;
    let localWallet = undefined;
    if (!dryRun && signingSource === 'local-vault') {
      if (!vaultKey) { setError('本地保险库已锁定；请先到钱包中心解锁，再返回本页执行');return; }
      try {
        const selected = selectLocalWallet(vault, plan.chain, localWalletId, tasks);
        localWallet = selected.wallet;
        executionTasks = selected.tasks;
        log(`已选择本地钱包的 ${executionTasks.length} 笔任务；其他发送账户保持待处理`, 'success');
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '无法选择本地钱包';
        setError(message);log(message, 'error');return;
      }
    } else if (!dryRun && senderCount(tasks) > 1) {
      if (!window.confirm(`当前任务包含 ${senderCount(tasks)} 个发送账户。\n将连接当前钱包并只执行与活动账户匹配的任务，完成后切换钱包继续。`)) return;
      try {
        const activeSender = await getActiveSender(plan.chain, tasks.map(task => task.from));
        executionTasks = tasksForActiveSender(tasks, activeSender);
        if (!executionTasks.length) throw new Error(`当前钱包账户 ${activeSender} 不在待执行发送地址中`);
        log(`已选择当前钱包对应的 ${executionTasks.length} 笔任务；其他发送账户保持待处理`, 'success');
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '无法识别当前钱包账户';
        setError(message);
        log(message, 'error');
        return;
      }
    }
    if (!dryRun && !window.confirm(signingSource === 'local-vault'
      ? `确认使用本地加密钱包执行 ${executionTasks.length} 笔测试网交易？\n\n只确认一次；每笔在一次性 Worker 内解密签名并按顺序广播。主网仍关闭。`
      : `即将请求当前钱包签名 ${executionTasks.length} 笔。确认开始？`)) return;
    setRunning(true);
    setPaused(false);
    pausedRef.current = false;
    stopRef.current = false;

    if (!dryRun && signingSource === 'local-vault' && localWallet && vaultKey) {
      try {
        await executeLocalVaultBatch(executionTasks, localWallet, vaultKey, {
          waitUntilResumed: async () => { while (pausedRef.current && !stopRef.current) await new Promise(resolve => setTimeout(resolve, 100)); },
          shouldStop: () => stopRef.current || !isKeyActive(vaultKey),
          onStart: index => {
            const task = executionTasks[index]!;task.status = 'running';task.attempts++;
            setPlan(current => current ? { ...current, tasks: [...tasksRef.current] } : current);
          },
          onResult: result => {
            const task = executionTasks[result.index]!;
            if (result.hash && result.state) { task.txHash = result.hash;task.status = result.state;delete task.error;log(result.state === 'confirmed' ? '本地钱包测试网交易已确认' : '本地钱包测试网交易已提交', 'success', task.id); }
            else { task.status = 'failed';task.error = result.error ?? '本地测试网执行失败';log(task.error, 'error', task.id); }
            setProgress(tasksRef.current.filter(item => item.status === 'confirmed' || item.status === 'submitted' || item.status === 'failed').length);
            setPlan(current => current ? { ...current, tasks: [...tasksRef.current] } : current);
          },
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '本地测试网批量执行失败';
        const current = executionTasks.find(task => task.status === 'running');
        if (current) { current.status = 'failed';current.error = message; }
        log(`${message}；整批已停止，页面与保险库保持安全`, 'error');
      } finally {
        setPlan(current => current ? { ...current, tasks: [...tasksRef.current] } : current);
        setRunning(false);
        await persistResults();
        const remaining = pendingSenderCount(tasksRef.current);
        if (remaining) log(`仍有 ${remaining} 个发送账户待执行或重试`, 'info');
      }
      return;
    }

    if (!dryRun && executionTasks.every(task => task.chain === 'EVM')) {
      try {
        executionTasks.forEach(task => { task.status = 'running'; task.attempts++; });
        setPlan(current => current ? { ...current, tasks: [...tasksRef.current] } : current);
        const results = await executeEvmBatch(executionTasks);
        if (results) {
          results.forEach((result, index) => { const task = executionTasks[index]!; task.txHash = result.hash; task.status = result.state; if (result.error) task.error = result.error; log(result.state === 'confirmed' ? 'EVM 批量调用已确认' : result.state === 'failed' ? result.error ?? 'EVM 批量调用失败' : 'EVM 批量调用已提交', result.state === 'failed' ? 'error' : 'success', task.id); });
          setProgress(tasksRef.current.filter(task => task.status === 'confirmed' || task.status === 'submitted' || task.status === 'failed').length);
          setPlan(current => current ? { ...current, tasks: [...tasksRef.current] } : current);
          setRunning(false);
          await persistResults();
          const remaining = pendingSenderCount(tasksRef.current);
          if (remaining) log(`当前账户任务完成；请切换钱包继续剩余 ${remaining} 个发送账户`, 'info');
          return;
        }
        executionTasks.forEach(task => { task.status = 'pending'; task.attempts--; });
        log('当前钱包不支持 EIP-5792 批量调用，已安全回退为逐笔钱包确认');
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'EVM 批量调用失败';
        executionTasks.forEach(task => { if (task.status === 'running') { task.status = 'failed'; task.error = message; } });
        log(`${message}；整批已停止`, 'error');
        setPlan(current => current ? { ...current, tasks: [...tasksRef.current] } : current);
        setRunning(false);
        await persistResults();
        return;
      }
    }

    if (!dryRun && executionTasks.every(task => task.chain === 'SOL')) {
      try {
        executionTasks.forEach(task => { task.status = 'running'; task.attempts++; });
        setPlan(current => current ? { ...current, tasks: [...tasksRef.current] } : current);
        const results = await executeSolanaBatch(executionTasks, {
          waitUntilResumed: async () => { while (pausedRef.current && !stopRef.current) await new Promise(resolve => setTimeout(resolve, 100)); },
          shouldStop: () => stopRef.current,
          onBroadcast: result => {
            const task = executionTasks[result.index]!;
            if (result.signature) { task.txHash = result.signature; task.status = 'submitted'; }
            else { task.status = 'failed'; task.error = result.error ?? '广播失败'; }
            setProgress(tasksRef.current.filter(item => item.status === 'confirmed' || item.status === 'submitted' || item.status === 'failed').length);
            setPlan(current => current ? { ...current, tasks: [...tasksRef.current] } : current);
          },
        });
        results.forEach((result, index) => {
          const task = executionTasks[index]!;
          if (result.signature) { task.txHash = result.signature; task.status = result.state; log(result.state === 'confirmed' ? '交易已确认' : '交易已提交，等待链上确认', 'success', task.id); }
          else { task.status = 'failed'; task.error = result.error ?? '广播失败'; log(task.error, 'error', task.id); }
        });
        setProgress(tasksRef.current.filter(task => task.status === 'confirmed' || task.status === 'submitted' || task.status === 'failed').length);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '批量执行失败';
        executionTasks.forEach(task => { if (task.status === 'running') { task.status = 'failed'; task.error = message; } });
        log(`${message}；整批已停止`, 'error');
      } finally {
        setPlan(current => current ? { ...current, tasks: [...tasksRef.current] } : current);
        setRunning(false);
        await persistResults();
        const remaining = pendingSenderCount(tasksRef.current);
        if (remaining) log(`仍有 ${remaining} 个发送账户待执行或重试；保持或切换到对应钱包后继续`, 'info');
      }
      return;
    }

    try {
      for (const task of executionTasks) {
        while (pausedRef.current && !stopRef.current) await new Promise(resolve => setTimeout(resolve, 100));
        if (stopRef.current) break;
        task.status = 'running';
        task.attempts++;
        setPlan(current => current ? { ...current, tasks: [...tasksRef.current] } : current);
        try {
          if (dryRun) { task.txHash = `DRY-RUN-${task.id.slice(2, 14)}`; task.status = 'confirmed'; }
          else { const result = await executeTask(task, { batchConfirmed: true }); task.txHash = result.hash; task.status = result.state; }
          log(dryRun ? '模拟验证通过' : task.status === 'confirmed' ? '交易已确认' : '交易已提交，等待链上确认', 'success', task.id);
        } catch (cause) {
          task.status = 'failed';
          task.error = cause instanceof Error ? cause.message : '执行失败';
          log(task.error, 'error', task.id);
          if (!dryRun) break;
        }
        setProgress(tasksRef.current.filter(item => item.status === 'confirmed' || item.status === 'submitted' || item.status === 'failed').length);
        setPlan(current => current ? { ...current, tasks: [...tasksRef.current] } : current);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally {
      setRunning(false);
      await persistResults();
      const remaining = pendingSenderCount(tasksRef.current);
      if (!dryRun && remaining) log(`仍有 ${remaining} 个发送账户待执行或重试；保持或切换到对应钱包后继续`, 'info');
    }
  }

  function togglePause() { pausedRef.current = !pausedRef.current; setPaused(pausedRef.current); log(pausedRef.current ? '任务已暂停' : '任务已恢复'); }
  function retry() { const failed = tasksRef.current.filter(task => task.status === 'failed'); failed.forEach(task => { task.status = 'pending'; delete task.error; }); void execute(failed); }

  const solBatch = chain === 'SOL' && Boolean(plan?.tasks.length);
  const unfinishedSenders = plan ? pendingSenderCount(plan.tasks) : 0;
  return <>
    <div className="page-head"><div><p className="eyebrow">CLIENT-SIDE BATCH ENGINE</p><h1>批量转账</h1><p>浏览器负责校验与钱包签名；服务器仅保存公开任务元数据和脱敏结果。</p></div></div>
    <div className="grid">
      <section className="panel form-panel">
        <h3>创建转账任务</h3>
        <label>网络<select value={chain} disabled={running} onChange={event => { setChain(event.target.value as TransferChain); setPlan(null); }}><option>EVM</option><option value="SOL">Solana</option><option>TRON</option></select></label>
        <label>模式<select value={mode} disabled={running} onChange={event => setMode(event.target.value as TransferMode)}><option value="one-to-many">一对多</option><option value="many-to-one">多对一</option><option value="many-to-many">多对多</option></select></label>
        <label>签名来源<select value={signingSource} disabled={running || !dryRun && saving} onChange={event => setSigningSource(event.target.value as SigningSource)}><option value="extension">浏览器扩展钱包</option><option value="local-vault">本地加密钱包（仅测试网）</option></select></label>
        {signingSource === 'local-vault' && <label>本地钱包<select value={localWalletId} disabled={running || !chainWallets.length} onChange={event => setLocalWalletId(event.target.value)}><option value="">{chainWallets.length ? '请选择钱包' : '当前网络没有本地钱包'}</option>{chainWallets.map(wallet => <option key={wallet.id} value={wallet.id}>{wallet.name} · {wallet.address.slice(0, 8)}…{wallet.address.slice(-6)}</option>)}</select></label>}
        {requestedSender && <div className="notice"><ShieldCheck size={18}/>已从钱包中心带入发送地址。下载当前网络模板后只需填写接收地址、金额和可选 Token。</div>}
        <div className="template-actions"><button onClick={() => downloadTransferTemplate('EVM',chain==='EVM'?requestedSender:undefined)}>下载 EVM 模板</button><button onClick={() => downloadTransferTemplate('SOL',chain==='SOL'?requestedSender:undefined)}>下载 Solana 模板</button><button onClick={() => downloadTransferTemplate('TRON',chain==='TRON'?requestedSender:undefined)}>下载 TRON 模板</button><button onClick={() => setShowExample(value => !value)}>{showExample ? '收起 CSV 示例' : '查看 CSV 格式示例'}</button></div>
        {showExample && <pre className="csv-example">{transferCsvExample(chain)}</pre>}
        <label>CSV 导入<input type="file" accept=".csv,text/csv" disabled={running} onChange={event => void importCsv(event.target.files?.[0])}/></label>
        <label className="dry-run"><input type="checkbox" checked={dryRun} disabled={running} onChange={event => setDryRun(event.target.checked)}/> Dry Run（默认开启，不广播）</label>
        <div className="notice"><ShieldCheck size={18}/>{signingSource === 'local-vault' ? `本地钱包模式固定使用 Sepolia / Solana Devnet / TRON Nile-Shasta；${vaultKey ? '保险库已解锁' : '保险库当前锁定'}。一次确认后由隔离 Worker 逐笔签名，主网不会开启。` : unfinishedSenders > 1 ? `检测到 ${unfinishedSenders} 个发送账户：每次只执行当前已连接钱包对应的任务，切换钱包后继续。` : solBatch ? 'Solana 原生币和 Token 都使用钱包批量签名：同一发送账户一次授权；私钥始终留在钱包。' : chain === 'EVM' ? '支持 EIP-5792 的钱包可整批授权；不支持时安全回退为逐笔确认。' : 'CSV 只允许公开地址、金额和 Token 地址；服务端会拒绝任何密钥字段。'}</div>
        {error && <div className="batch-error">{error}</div>}{recordError && <div className="batch-error">{recordError}</div>}
        <button onClick={prepare} disabled={running || saving || !inputs.length}>{saving ? '正在保存审计记录…' : `校验、估算并保存${inputs.length ? ` · ${inputs.length} 笔` : ''}`}</button>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>执行预览</h3><span>{plan?.tasks.length ?? 0} 笔</span></div>
        {plan ? <><div className="transfer-summary"><b>总金额 {plan.totalAmount}</b><b>预计手续费 {plan.totalEstimatedFee}</b><small>Worker 规划 {planningMs} ms</small><small>待处理发送账户：{unfinishedSenders}</small><small>任务记录：{activeJob ? `${activeJob.id.slice(0, 8)} · ${activeJob.status}` : saving ? '保存中' : '未保存'}</small>{signingSource === 'local-vault' && <small>⚠ 实际测试网手续费在每笔签名前重新估算</small>}{plan.risks.map(risk => <small key={risk}>⚠ {risk}</small>)}</div><div className="export-actions"><button onClick={() => void execute()} disabled={running || saving || !activeJob}>{dryRun ? '运行模拟并记录' : signingSource === 'local-vault' ? '一次确认并按序执行' : unfinishedSenders > 1 ? '执行当前钱包对应任务' : solBatch ? '开始批量签名（一次授权）' : '开始逐笔签名'}</button>{running && <button onClick={togglePause}>{paused ? '恢复' : '暂停'}</button>}<button onClick={retry} disabled={running || saving || !plan.tasks.some(task => task.status === 'failed')}>失败重试</button><button onClick={() => exportResults(plan.tasks)}>导出结果</button></div><div className="transfer-progress"><span style={{ width: `${plan.tasks.length ? progress / plan.tasks.length * 100 : 0}%` }}/></div><div className="wallet-list">{plan.tasks.slice(0, 100).map(task => <div key={task.id}><b>{task.row - 1}. {task.status} · {task.amount} {task.token ? 'Token' : '原生币'}</b><code>{task.from} → {task.to}</code>{task.error && <small>{task.error}</small>}</div>)}</div></> : <div className="mini-empty"><Send/><p>导入 CSV 后进行地址校验和 Dry Run</p></div>}
      </section>
    </div>
    <section className="panel transfer-history"><div className="panel-head"><div><p className="eyebrow">AUDIT TRAIL</p><h3><History size={16}/>最近任务历史</h3></div><button onClick={() => void loadHistory()} title="刷新任务历史"><RefreshCw size={15}/></button></div><div className="transfer-history-table"><div><b>创建时间</b><b>网络 / 模式</b><b>数量</b><b>结果</b><b>状态</b></div>{history.map(job => <div key={job.id}><span>{new Date(job.created_at).toLocaleString()}</span><span>{job.payload.chain} · {job.payload.mode}</span><span>{job.payload.count}</span><span>{job.result.confirmed ?? 0} 成功 / {job.result.failed ?? 0} 失败</span><em className={job.status}>{job.status}</em></div>)}</div>{!history.length && <p className="transfer-history-empty">尚无已保存的批量转账任务。</p>}</section>
    <section className="panel transfer-logs"><div className="panel-head"><h3>执行日志</h3><span>{logs.length} 条</span></div>{logs.slice(-200).map((item, index) => <code key={`${item.at}-${index}`} className={item.level}>{item.at} {item.taskId?.slice(0, 10) ?? '-'} {item.message}</code>)}</section>
  </>;
}
