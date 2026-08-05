import type { TransferInput } from './types';
export function parseTransferCsv(text:string):TransferInput[]{
  const rows=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(line=>line.split(',').map(cell=>cell.trim()));
  if(!rows.length)throw new Error('CSV 为空');
  const header=rows.shift()!.map(x=>x.toLowerCase()); const at=(name:string)=>header.indexOf(name);
  if(header.some(name=>['privatekey','private_key','mnemonic','seed','secret'].includes(name)))throw new Error('CSV 禁止包含私钥、助记词或其他密钥字段');
  const walletExport=['name','chain','address','publickey','derivationpath','index','createdat'];if(walletExport.every(name=>header.includes(name)))throw new Error('检测到“批量钱包”导出的地址清单。该文件只有钱包地址，不能直接用于转账；请下载批量转账模板并填写 from、to、amount。');
  const missing=['from','to','amount'].filter(name=>at(name)<0);if(missing.length)throw new Error(`CSV 缺少必填字段：${missing.join('、')}。必填表头为 from,to,amount；token、decimals 可选。`);
  return rows.map((row,index)=>{const from=row[at('from')]??'',to=row[at('to')]??'',amount=row[at('amount')]??'',token=at('token')>=0?(row[at('token')]??''):'',rawDecimals=at('decimals')>=0?(row[at('decimals')]??''):'';const empty=[!from?'from':'',!to?'to':'',!amount?'amount':''].filter(Boolean);if(empty.length)throw new Error(`第 ${index+2} 行缺少：${empty.join('、')}`);const decimals=rawDecimals?Number(rawDecimals):undefined;if(decimals!==undefined&&(!Number.isInteger(decimals)||decimals<0||decimals>30))throw new Error(`第 ${index+2} 行 decimals 无效`);return{from,to,amount,...(token?{token}:{}) ,...(decimals!==undefined?{decimals}:{})}});
}
const examples={EVM:'from,to,amount,token,decimals\n0x0000000000000000000000000000000000000001,0x0000000000000000000000000000000000000002,0.01,,',SOL:'from,to,amount,token,decimals\n11111111111111111111111111111111,Vote111111111111111111111111111111111111111,0.01,,',TRON:'from,to,amount,token,decimals\nT9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb,TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj,1,,6'} as const;
export type TemplateChain=keyof typeof examples;
export const transferCsvExample=(chain:TemplateChain)=>examples[chain];
export function downloadTransferTemplate(chain:TemplateChain){const blob=new Blob([`\ufeff${examples[chain]}\n`],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`batch-transfer-${chain.toLowerCase()}-template.csv`;a.click();URL.revokeObjectURL(url)}
export function exportResults(tasks:{id:string;from:string;to:string;amount:string;token?:string;status:string;txHash?:string;error?:string}[]){const q=(v:string)=>`"${v.replaceAll('"','""')}"`;const csv=['id,from,to,amount,token,status,txHash,error',...tasks.map(t=>[t.id,t.from,t.to,t.amount,t.token??'',t.status,t.txHash??'',t.error??''].map(x=>q(String(x))).join(','))].join('\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`batch-transfer-${Date.now()}.csv`;a.click();URL.revokeObjectURL(url)}
