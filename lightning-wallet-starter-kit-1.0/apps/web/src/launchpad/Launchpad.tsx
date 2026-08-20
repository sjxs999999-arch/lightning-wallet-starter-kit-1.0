import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ExternalLink, FileText, Image, Link, LockKeyhole, Rocket, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { localProjectFromDraft, recordLocalDeployment, saveLocalProject } from '../project-center/local-projects';
import { deployLaunchToken, prepareLaunchDeployment } from './deployer';
import type { DeploymentEstimate, DeploymentResult } from './deployer';
import { validateMedia } from './media';
import { isMainnetLaunchNetwork, launchNetworkOptions } from './types';
import type { DeploymentPlan, LaunchChain, LaunchDraft, LiquidityPlan, MediaDescriptor } from './types';

const defaults: Record<LaunchChain, number> = { EVM: 18, SOL: 9, TRON: 6 };
const initial: LaunchDraft = {
  chain: 'EVM', network: 'sepolia', name: '', symbol: '', decimals: 18, supply: '1000000', description: '', website: '',
  socials: { x: '', telegram: '', discord: '' }, media: {},
  liquidity: { tokenAmount: '100000', quoteSymbol: 'USDC', quoteAmount: '10000', lockDays: 90 }, dryRun: true,
};

export function Launchpad() {
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState(initial);
  const [liquidity, setLiquidity] = useState<LiquidityPlan | null>(null);
  const [deployment, setDeployment] = useState<DeploymentPlan | null>(null);
  const [estimate, setEstimate] = useState<DeploymentEstimate | null>(null);
  const [result, setResult] = useState<DeploymentResult | null>(null);
  const [previews, setPreviews] = useState<{ logo?: string; banner?: string }>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const previewRef = useRef<string[]>([]);

  useEffect(() => () => {
    workerRef.current?.terminate();
    previewRef.current.forEach(url => URL.revokeObjectURL(url));
  }, []);

  const checklist = useMemo(() => [
    { label: 'Token 参数', ok: Boolean(draft.name && draft.symbol && draft.supply) },
    { label: 'Metadata', ok: Boolean(draft.description) },
    { label: 'Logo', ok: Boolean(draft.media.logo) },
    { label: 'Banner', ok: Boolean(draft.media.banner) },
    { label: '官网或社交链接', ok: Boolean(draft.website || Object.values(draft.socials).some(Boolean)) },
    { label: 'Whitepaper', ok: Boolean(draft.media.whitepaper) },
    { label: '流动性计划', ok: Boolean(liquidity) },
  ], [draft, liquidity]);

  function resetDeployment() { setDeployment(null); setEstimate(null); setResult(null); }
  function patch<K extends keyof LaunchDraft>(key: K, value: LaunchDraft[K]) {
    setDraft(current => ({ ...current, [key]: value })); resetDeployment();
  }
  function chain(value: LaunchChain) {
    setDraft(current => ({ ...current, chain: value, network: launchNetworkOptions[value][0]!.value, decimals: defaults[value] })); resetDeployment();
  }
  function upload(kind: 'logo' | 'banner' | 'whitepaper', file?: File) {
    if (!file) return;
    setError('');
    try {
      const descriptor = validateMedia(file, kind);
      patch('media', { ...draft.media, [kind]: descriptor });
      if (kind !== 'whitepaper') {
        const old = previews[kind]; if (old) URL.revokeObjectURL(old);
        const url = URL.createObjectURL(file); previewRef.current.push(url);
        setPreviews(current => ({ ...current, [kind]: url }));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '文件无效'); }
  }
  function plan() {
    setError(''); setLiquidity(null);
    const worker = new Worker(new URL('./planner.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ type: string; plan?: LiquidityPlan; message?: string }>) => {
      worker.terminate(); workerRef.current = null;
      if (event.data.plan) setLiquidity(event.data.plan); else setError(event.data.message || '流动性规划失败');
    };
    worker.onerror = () => { worker.terminate(); workerRef.current = null; setError('Launchpad Worker 异常，页面其他功能不受影响'); };
    worker.postMessage(draft);
  }
  async function validate() {
    setBusy(true); setError(''); setEstimate(null); setResult(null);
    try {
      const response = await api<{ data: Omit<DeploymentPlan, 'projectId'> }>('/launchpad/validate', { method: 'POST', body: JSON.stringify(draft) });
      const project = localProjectFromDraft(draft, response.data.planId); saveLocalProject(project);
      setDeployment({ ...response.data, projectId: project.id }); setStep(5);
    } catch { setError('Token 草稿校验失败，请检查必填字段、链接和网络'); }
    finally { setBusy(false); }
  }
  async function prepare() {
    if (draft.dryRun || !deployment) return;
    setBusy(true); setError(''); setEstimate(null); setResult(null);
    try { setEstimate(await prepareLaunchDeployment(draft)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '部署估算失败'); }
    finally { setBusy(false); }
  }
  async function deploy() {
    if (draft.dryRun || !deployment || !estimate) return;
    setError('');
    const mainnet = isMainnetLaunchNetwork(draft.network);
    if (!window.confirm(`确认由当前钱包部署到 ${estimate.network}？\n钱包：${estimate.walletAddress}\n费用：${estimate.feeLabel}\n\n${mainnet ? '这是主网真实资产操作，将产生真实费用。' : '这会广播真实测试网交易。'}`)) return;
    setBusy(true);
    try {
      const completed = await deployLaunchToken(draft);
      recordLocalDeployment(deployment.projectId, {
        id: completed.transactionHash, chain: completed.chain, network: completed.network,
        contract_address: completed.contractAddress, transaction_hash: completed.transactionHash,
        status: completed.status, deployed_at: new Date().toISOString(),
      });
      setResult(completed);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '钱包拒绝或部署失败'); }
    finally { setBusy(false); }
  }

  return <>
    <div className="page-head"><div><p className="eyebrow">MULTICHAIN TOKEN LAUNCH</p><h1>闪电发射台</h1><p>创建 Token 资料、规划初始流动性，并由用户钱包完成选定网络的部署。</p></div></div>
    <div className="launch-steps">{['Token', 'Metadata', 'Media', 'Liquidity', 'Review'].map((name, index) => <button className={step === index + 1 ? 'active' : ''} onClick={() => setStep(index + 1)} key={name}><span>{index + 1}</span>{name}</button>)}</div>
    <div className="launch-layout">
      <section className="panel launch-form">
        {step === 1 && <TokenStep draft={draft} onChain={chain} patch={patch} />}
        {step === 2 && <MetadataStep draft={draft} patch={patch} />}
        {step === 3 && <><h3>3. Media & Whitepaper</h3><Upload icon={<Image />} label="Logo · PNG/JPEG/WebP · 最大 2MB" accept="image/png,image/jpeg,image/webp" value={draft.media.logo} onFile={file => upload('logo', file)} /><Upload icon={<Image />} label="Banner · 最大 5MB" accept="image/png,image/jpeg,image/webp" value={draft.media.banner} onFile={file => upload('banner', file)} /><Upload icon={<FileText />} label="Whitepaper · PDF · 最大 10MB" accept="application/pdf" value={draft.media.whitepaper} onFile={file => upload('whitepaper', file)} /><div className="notice"><ShieldCheck size={18} />文件仅在当前浏览器预览；API 只接收名称、类型和大小，不接收文件内容。</div></>}
        {step === 4 && <LiquidityStep draft={draft} liquidity={liquidity} patch={patch} onPlan={plan} />}
        {step === 5 && <ReviewStep draft={draft} checklist={checklist} deployment={deployment} estimate={estimate} result={result} busy={busy} onDryRun={value => patch('dryRun', value)} onValidate={validate} onPrepare={prepare} onDeploy={deploy} />}
        {error && <div className="batch-error">{error}</div>}
        <div className="launch-nav"><button disabled={step === 1} onClick={() => setStep(value => Math.max(1, value - 1))}>上一步</button><button disabled={step === 5} onClick={() => setStep(value => Math.min(5, value + 1))}>下一步</button></div>
      </section>
      <TokenPreview draft={draft} previews={previews} />
    </div>
  </>;
}

type Patch = <K extends keyof LaunchDraft>(key: K, value: LaunchDraft[K]) => void;
function TokenStep({ draft, onChain, patch }: { draft: LaunchDraft; onChain(value: LaunchChain): void; patch: Patch }) {
  return <><h3>1. Token Creation Wizard</h3><label>链<select value={draft.chain} onChange={event => onChain(event.target.value as LaunchChain)}><option>EVM</option><option value="SOL">Solana</option><option>TRON</option></select></label><label>部署网络<select value={draft.network} onChange={event => patch('network', event.target.value as LaunchDraft['network'])}>{launchNetworkOptions[draft.chain].map(item => <option value={item.value} key={item.value}>{item.label}{item.mainnet ? ' · 主网' : ''}</option>)}</select></label><div className="launch-pair"><label>Token 名称<input value={draft.name} maxLength={50} onChange={event => patch('name', event.target.value)} /></label><label>Symbol<input value={draft.symbol} maxLength={12} onChange={event => patch('symbol', event.target.value.toUpperCase())} /></label></div><div className="launch-pair"><label>总供应量<input inputMode="numeric" value={draft.supply} onChange={event => patch('supply', event.target.value.replace(/\D/g, ''))} /></label><label>Decimals<input type="number" min="0" max={draft.chain === 'SOL' ? 9 : 18} value={draft.decimals} onChange={event => patch('decimals', Number(event.target.value))} /></label></div></>;
}
function MetadataStep({ draft, patch }: { draft: LaunchDraft; patch: Patch }) {
  return <><h3>2. Metadata Editor</h3><label>项目说明<textarea value={draft.description} maxLength={1000} onChange={event => patch('description', event.target.value)} /></label><label>官网<input type="url" value={draft.website} onChange={event => patch('website', event.target.value)} /></label>{(['x', 'telegram', 'discord'] as const).map(key => <label key={key}>{key.toUpperCase()}<input type="url" value={draft.socials[key]} onChange={event => patch('socials', { ...draft.socials, [key]: event.target.value })} /></label>)}</>;
}
function LiquidityStep({ draft, liquidity, patch, onPlan }: { draft: LaunchDraft; liquidity: LiquidityPlan | null; patch: Patch; onPlan(): void }) {
  return <><h3>4. Liquidity Initialization Planner</h3><div className="launch-pair"><label>Token 数量<input value={draft.liquidity.tokenAmount} onChange={event => patch('liquidity', { ...draft.liquidity, tokenAmount: event.target.value.replace(/\D/g, '') })} /></label><label>报价资产<input value={draft.liquidity.quoteSymbol} onChange={event => patch('liquidity', { ...draft.liquidity, quoteSymbol: event.target.value.toUpperCase() })} /></label></div><div className="launch-pair"><label>报价资产数量<input value={draft.liquidity.quoteAmount} onChange={event => patch('liquidity', { ...draft.liquidity, quoteAmount: event.target.value.replace(/\D/g, '') })} /></label><label>锁仓天数<input type="number" min="0" max="3650" value={draft.liquidity.lockDays} onChange={event => patch('liquidity', { ...draft.liquidity, lockDays: Number(event.target.value) })} /></label></div><button onClick={onPlan}>使用 Worker 生成计划</button>{liquidity && <div className="liquidity-result"><b>初始价格（×10⁶）：{liquidity.initialPrice}</b><span>供应量占比：{(liquidity.tokenShareBps / 100).toFixed(2)}%</span><span>锁仓：{liquidity.lockDays} 天</span><small>{liquidity.warnings.join(' · ') || '未发现流动性风险'}</small></div>}</>;
}
function ReviewStep({ draft, checklist, deployment, estimate, result, busy, onDryRun, onValidate, onPrepare, onDeploy }: { draft: LaunchDraft; checklist: { label: string; ok: boolean }[]; deployment: DeploymentPlan | null; estimate: DeploymentEstimate | null; result: DeploymentResult | null; busy: boolean; onDryRun(value: boolean): void; onValidate(): void; onPrepare(): void; onDeploy(): void }) {
  const mainnet = isMainnetLaunchNetwork(draft.network);
  const mainnetLocked = mainnet && (import.meta.env.VITE_MAINNET_EXECUTION_ENABLED !== 'true' || import.meta.env.VITE_ENABLE_MAINNET_LAUNCHPAD !== 'true');
  return <><h3>5. Deployment Checklist</h3><div className="deployment-list">{checklist.map(item => <div key={item.label}><CheckCircle2 className={item.ok ? 'ok' : 'pending'} /><span>{item.label}</span><b>{item.ok ? '完成' : '待补充'}</b></div>)}</div><label className="dry-run"><input type="checkbox" checked={draft.dryRun} onChange={event => onDryRun(event.target.checked)} />Dry Run（默认开启，不连接钱包、不广播）</label><div className="notice"><LockKeyhole size={18} />{draft.dryRun ? `当前仅校验 ${draft.network} 计划，不连接钱包。` : mainnetLocked ? '主网部署保持关闭：必须同时通过全局主网与 Launchpad 独立生产开关。' : `部署交易在浏览器构造并发送到 ${draft.network}；由当前钱包确认、签名和广播，服务器不接触私钥，也不代签。`}</div><button disabled={busy} onClick={onValidate}><Rocket size={16} />{busy ? '处理中…' : '生成部署计划'}</button>{deployment && <div className="deployment-ready"><b>{deployment.status}</b><code>{deployment.planId}</code><span>计划已保存到当前浏览器 · Server signing: false</span><a href={`/projects?project=${encodeURIComponent(deployment.projectId)}`}>查看项目详情</a>{!draft.dryRun && !result && <button disabled={busy || mainnetLocked} onClick={onPrepare}>{mainnetLocked ? '主网部署未启用' : estimate ? '重新估算' : '连接钱包并估算费用'}</button>}{estimate && !result && <div className="launch-estimate"><b>{estimate.network} · {estimate.feeLabel}</b><span>{estimate.walletAddress}</span><small>{estimate.feeDetail}</small><button disabled={busy || mainnetLocked} onClick={onDeploy}>{busy ? '等待钱包或链上确认…' : `确认并部署到${mainnet ? '主网' : '测试网'}`}</button></div>}{result && <div className="launch-result"><CheckCircle2 /><b>链上部署已确认</b><span>{result.network}</span><code>{result.contractAddress}</code><code>{result.transactionHash}</code><a href={result.explorerUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />在区块浏览器查看</a></div>}</div>}</>;
}
function TokenPreview({ draft, previews }: { draft: LaunchDraft; previews: { logo?: string; banner?: string } }) {
  return <section className="panel token-preview"><div className="preview-banner" style={previews.banner ? { backgroundImage: `url(${previews.banner})` } : {}}>{previews.logo ? <img src={previews.logo} alt="Token logo preview" /> : <span>{draft.symbol.slice(0, 2) || '⚡'}</span>}</div><p className="eyebrow">TOKEN PREVIEW</p><h2>{draft.name || '未命名 Token'} <small>{draft.symbol || 'SYMBOL'}</small></h2><p>{draft.description || '在 Metadata 步骤填写项目说明。'}</p><dl><div><dt>Chain</dt><dd>{draft.chain}</dd></div><div><dt>Network</dt><dd>{draft.network}</dd></div><div><dt>Supply</dt><dd>{draft.supply}</dd></div><div><dt>Decimals</dt><dd>{draft.decimals}</dd></div></dl>{/^https?:\/\//i.test(draft.website) && <a href={draft.website} target="_blank" rel="noreferrer"><Link size={14} />{draft.website}</a>}</section>;
}
function Upload({ icon, label, accept, value, onFile }: { icon: React.ReactNode; label: string; accept: string; value?: MediaDescriptor; onFile(file?: File): void }) {
  return <label className="upload-box">{icon}<span>{label}</span><small>{value ? `${value.name} · ${Math.ceil(value.size / 1024)} KB` : '选择本地文件'}</small><input type="file" accept={accept} onChange={event => onFile(event.target.files?.[0])} /></label>;
}
