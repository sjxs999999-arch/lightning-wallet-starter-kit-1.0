import type { TransferInput } from './types';
export function parseTransferCsv(text:string):TransferInput[]{
  const rows=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(line=>line.split(',').map(cell=>cell.trim()));
  if(!rows.length)throw new Error('CSV 为空');
  const header=rows.shift()!.map(x=>x.toLowerCase()); const at=(name:string)=>header.indexOf(name);
  if(header.some(name=>['privatekey','private_key','mnemonic','seed','secret'].includes(name)))throw new Error('CSV 禁止包含私钥、助记词或其他密钥字段');
  if(at('from')<0||at('to')<0||at('amount')<0)throw new Error('CSV 必须包含 from,to,amount，可选 token');
  return rows.map((row,index)=>{const from=row[at('from')]??'',to=row[at('to')]??'',amount=row[at('amount')]??'',token=at('token')>=0?(row[at('token')]??''):'',rawDecimals=at('decimals')>=0?(row[at('decimals')]??''):'';if(!from||!to||!amount)throw new Error(`第 ${index+2} 行缺少必填字段`);const decimals=rawDecimals?Number(rawDecimals):undefined;if(decimals!==undefined&&(!Number.isInteger(decimals)||decimals<0||decimals>30))throw new Error(`第 ${index+2} 行 decimals 无效`);return{from,to,amount,...(token?{token}:{}) ,...(decimals!==undefined?{decimals}:{})}});
}
export function exportResults(tasks:{id:string;from:string;to:string;amount:string;token?:string;status:string;txHash?:string;error?:string}[]){const q=(v:string)=>`"${v.replaceAll('"','""')}"`;const csv=['id,from,to,amount,token,status,txHash,error',...tasks.map(t=>[t.id,t.from,t.to,t.amount,t.token??'',t.status,t.txHash??'',t.error??''].map(x=>q(String(x))).join(','))].join('\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`batch-transfer-${Date.now()}.csv`;a.click();URL.revokeObjectURL(url)}
