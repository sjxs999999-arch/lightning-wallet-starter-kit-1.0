import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FlaskConical, ShieldCheck, WalletCards, Zap } from 'lucide-react';
import { formatEther } from 'ethers';
import type { FlashLoanEthereumProvider } from './bridge';
import type { FlashLoanHistoryItem } from './types';
import {
  AAVE_V3_SEPOLIA,
  buildAaveV3FlashLoanPlan,
  flashLoanPreflightEnabled,
  parseReceiverAllowlist,
  preflightAaveV3FlashLoan,
  type AaveFlashLoanPlan,
  type AaveFlashLoanPreflight,
  type AaveV3SepoliaAsset,
} from './aave-v3';

type Props = {
  walletAddress?: string;
  walletProvider?: FlashLoanEthereumProvider;
  onConnect(): Promise<void>;
  onRecord(item: FlashLoanHistoryItem): Promise<void>;
};

const ASSETS = Object.keys(AAVE_V3_SEPOLIA.assets) as AaveV3SepoliaAsset[];

export function AaveV3PreflightPanel({ walletAddress, walletProvider, onConnect, onRecord }: Props) {
  const enabled = flashLoanPreflightEnabled(import.meta.env.VITE_ENABLE_AAVE_FLASH_LOAN_PREFLIGHT);
  const receiverAllowlist = useMemo(() => parseReceiverAllowlist(import.meta.env.VITE_AAVE_FLASH_LOAN_RECEIVERS), []);
  const [receiver, setReceiver] = useState(receiverAllowlist[0] ?? '');
  const [asset, setAsset] = useState<AaveV3SepoliaAsset>('USDC');
  const [amount, setAmount] = useState('100');
  const [result, setResult] = useState<{ plan: AaveFlashLoanPlan; preflight: AaveFlashLoanPreflight }>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const configured = enabled && receiverAllowlist.length > 0;

  async function runPreflight() {
    setError(''); setResult(undefined);
    if (!walletAddress || !walletProvider) { setError('请先连接浏览器钱包；只读取公开地址和 Sepolia 网络，不会请求签名。'); return; }
    setRunning(true);
    try {
      const chainId = await walletProvider.request({ method: 'eth_chainId' });
      const plan = buildAaveV3FlashLoanPlan({
        enabled,
        chainId: String(chainId),
        account: walletAddress,
        receiver,
        receiverAllowlist,
        asset,
        amount,
      });
      const preflight = await preflightAaveV3FlashLoan(walletProvider, plan);
      setResult({ plan, preflight });
      await onRecord({
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        network: 'sepolia',
        walletAddress,
        status: 'dry-run',
        protocol: 'Aave V3',
        asset,
        amount,
      });
    } catch (cause) {
      setError(preflightError(cause));
    } finally { setRunning(false); }
  }

  return <section className="panel aave-preflight">
    <div className="panel-head"><div><p className="eyebrow">AAVE V3 · SEPOLIA INTERNAL TEST</p><h2>真实交易预检</h2></div><span className={`integration-status ${configured?'ready':'offline'}`}>{configured?'已配置':'默认关闭'}</span></div>
    <p className="aave-summary">按 Aave V3 官方 <code>flashLoanSimple</code> 接口生成真实 calldata，并依次验证 Pool、资产、接收器合约、接收器绑定、完整 <code>eth_call</code> 模拟和 Gas。此步骤不会打开钱包签名，也不会广播。</p>
    {!configured&&<div className="aave-gate"><ShieldCheck size={18}/><div><b>发布闸门保持关闭</b><p>{!enabled?'构建参数 VITE_ENABLE_AAVE_FLASH_LOAN_PREFLIGHT 尚未启用。':'尚未配置经审计的 VITE_AAVE_FLASH_LOAN_RECEIVERS 接收器白名单。'} 两项都满足后才允许 Sepolia 预检。</p></div></div>}
    <div className="aave-fields">
      <label>接收器合约<input value={receiver} onChange={event=>setReceiver(event.target.value.trim())} placeholder="0x… 经审计并已部署的 Receiver" spellCheck={false}/></label>
      <label>资产<select value={asset} onChange={event=>setAsset(event.target.value as AaveV3SepoliaAsset)}>{ASSETS.map(symbol=><option key={symbol} value={symbol}>{symbol}</option>)}</select></label>
      <label>数量<input value={amount} onChange={event=>setAmount(event.target.value)} inputMode="decimal" placeholder="100"/></label>
    </div>
    <div className="aave-actions">
      <button onClick={()=>void onConnect()}><WalletCards size={16}/>{walletAddress?`${walletAddress.slice(0,6)}…${walletAddress.slice(-4)}`:'连接 Sepolia 钱包'}</button>
      <button className="primary" disabled={!configured||running||!walletAddress} onClick={()=>void runPreflight()}><FlaskConical size={16}/>{running?'正在模拟…':'生成并完整模拟'}</button>
    </div>
    <div className="aave-risk"><AlertTriangle size={17}/><div><b>高风险操作边界</b><p>闪电贷必须由已审计 Receiver 在同一笔交易内归还本金和实时手续费。预检通过不等于盈利、安全或主网批准；下一步仍必须由用户在钱包中核对 Pool、Receiver、资产、数量和 Gas 后单独签名。</p></div></div>
    {error&&<div className="batch-error aave-message">{error}</div>}
    {result&&<div className="aave-result">
      <div className="aave-pass"><CheckCircle2 size={20}/><div><b>完整模拟通过</b><p>Receiver 成功执行并可在同一交易内归还本金与手续费；尚未请求签名，尚未广播。</p></div></div>
      <div className="aave-metrics">
        <span>Pool<b>{short(result.plan.pool)}</b></span><span>Receiver<b>{short(result.plan.receiver)}</b></span><span>实时手续费<b>{result.preflight.premiumBps} bps · {result.preflight.premiumAmount} {result.plan.asset}</b></span><span>Gas 上限<b>{result.preflight.gasLimit.toString()}</b></span><span>当前 Gas 估算<b>{formatEther(result.preflight.estimatedGasCostWei)} Sepolia ETH</b></span><span>广播状态<b>未广播</b></span>
      </div>
      <details><summary><Zap size={14}/> 查看待签名 calldata</summary><code>{result.plan.data}</code></details>
    </div>}
  </section>;
}

function short(value:string){return `${value.slice(0,8)}…${value.slice(-6)}`}

function preflightError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : '';
  const known: Record<string,string> = {
    AAVE_PREFLIGHT_DISABLED: 'Aave V3 预检功能尚未通过构建开关启用。',
    AAVE_SEPOLIA_ONLY: '只允许 Sepolia 内测，已拒绝其他网络。',
    AAVE_ACCOUNT_CHANGED: '预检期间钱包账户发生变化，请重新连接后再试。',
    AAVE_RECEIVER_INVALID: 'Receiver 地址格式无效。',
    AAVE_RECEIVER_NOT_ALLOWLISTED: 'Receiver 不在发布时固定的审计白名单中。',
    AAVE_AMOUNT_INVALID: '数量无效或小数位超过资产精度。',
    AAVE_AMOUNT_OVER_SAFETY_CAP: '数量超过当前内测安全上限。',
    AAVE_RECEIVER_CODE_MISSING: 'Receiver 地址没有已部署合约代码。',
    AAVE_RECEIVER_POOL_MISMATCH: 'Receiver 绑定的 Aave Pool 与官方 Sepolia Pool 不一致。',
    AAVE_RECEIVER_PROVIDER_MISMATCH: 'Receiver 绑定的 PoolAddressesProvider 不一致。',
    AAVE_PREMIUM_UNAVAILABLE: '无法从 Aave Pool 读取实时闪电贷手续费。',
    AAVE_GAS_ESTIMATE_UNAVAILABLE: '完整模拟后仍无法取得 Gas 估算，已阻止继续。',
  };
  const key = Object.keys(known).find(item=>message.startsWith(item));
  if (key) return known[key]!;
  if (message.startsWith('AAVE_SIMULATION_REVERTED')) return 'Aave 完整模拟已回滚：Receiver 策略、流动性、授权或手续费余额尚未满足；不会请求签名。';
  return 'Aave V3 预检失败；未请求签名，也未广播任何交易。';
}
