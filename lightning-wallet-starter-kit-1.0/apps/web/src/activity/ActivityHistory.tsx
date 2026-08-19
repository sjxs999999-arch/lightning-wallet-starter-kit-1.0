import { useEffect, useMemo, useState } from 'react';
import { Download, History, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import { downloadActivityCsv, loadLocalActivity, type ActivityItem } from './history';

export function ActivityHistory({ includeServer = false }: { includeServer?: boolean }) {
  const [items, setItems] = useState(loadLocalActivity);
  const [module, setModule] = useState('');
  const [search, setSearch] = useState('');
  const modules = useMemo(() => [...new Set(items.map(item => item.module))], [items]);
  const filtered = useMemo(() => { const query = search.trim().toLowerCase(); return items.filter(item => (!module || item.module === module) && (!query || Object.values(item).some(value => value.toLowerCase().includes(query)))); }, [items, module, search]);
  useEffect(() => { if (!includeServer) return; void api<{ data: ActivityItem[] }>('/operations/history?limit=500').then(response => setItems(response.data)).catch(() => undefined); }, [includeServer]);
  return <>
    <div className="page-head"><div><p className="eyebrow">LOCAL PUBLIC AUDIT TRAIL</p><h1>交易记录</h1><p>统一查看当前浏览器的钱包连接、批量任务、兑换、闪电贷和 GasFree 公开记录。</p></div></div>
    <div className="activity-security"><ShieldCheck size={17}/>仅公开元数据 · 不包含私钥、助记词或签名内容 · 可导出 CSV</div>
    <section className="panel activity-toolbar"><input aria-label="搜索记录" placeholder="搜索网络、状态或交易哈希" value={search} onChange={event => setSearch(event.target.value)}/><select aria-label="模块筛选" value={module} onChange={event => setModule(event.target.value)}><option value="">全部模块</option>{modules.map(value => <option key={value}>{value}</option>)}</select><button onClick={() => setItems(loadLocalActivity())}><RefreshCw size={15}/>刷新</button><button onClick={() => downloadActivityCsv(filtered)} disabled={!filtered.length}><Download size={15}/>导出 CSV</button></section>
    <section className="panel activity-list"><div className="activity-head"><b>时间</b><b>模块 / 网络</b><b>操作</b><b>金额</b><b>状态</b><b>公开引用</b></div>{filtered.map(item => <div className="activity-row" key={`${item.module}-${item.id}`}><span>{formatDate(item.at)}</span><span><b>{item.module}</b><small>{item.network}</small></span><span>{item.operation}</span><span>{item.amount || '—'}</span><em>{item.status}</em><code title={item.reference}>{item.reference}</code></div>)}{!filtered.length && <div className="activity-empty"><History/><p>当前筛选下暂无公开交易记录。</p></div>}</section>
  </>;
}

function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(); }
