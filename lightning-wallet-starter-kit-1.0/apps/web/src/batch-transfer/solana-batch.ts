import{Buffer}from'buffer';
import{PublicKey,SystemProgram,Transaction,TransactionInstruction}from'@solana/web3.js';
import{api}from'../api';
import{assertSolanaTokenBatch,reserveMainnetCanaryExecution}from'../mainnet-canary';
import{getSolanaProvider}from'./executor';
import type{TransferTask}from'./types';

const TOKEN_2022=new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),ASSOCIATED=new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
type SignedTransaction={serialize():Uint8Array};
type BatchProvider=ReturnType<typeof getSolanaProvider>&{signAllTransactions?(transactions:Transaction[]):Promise<SignedTransaction[]>};
export type SolanaBatchResult={index:number;signature?:string;error?:string};
const ata=(wallet:PublicKey,mint:PublicKey)=>PublicKey.findProgramAddressSync([wallet.toBuffer(),TOKEN_2022.toBuffer(),mint.toBuffer()],ASSOCIATED)[0];

export async function executeSolanaTokenBatch(tasks:TransferTask[]):Promise<SolanaBatchResult[]>{
  const network=import.meta.env.VITE_SOLANA_NETWORK||'devnet';assertSolanaTokenBatch(tasks,network);
  const provider=getSolanaProvider()as BatchProvider;if(!provider?.signAllTransactions)throw new Error('当前 OKX Wallet 不支持批量签名，请更新扩展后重试');
  const connected=provider.connect?await provider.connect():undefined,address=connected?.publicKey?.toString()??provider.publicKey?.toString();if(address!==tasks[0]?.from)throw new Error(`当前 Solana 账户 ${address??'未知'} 与 CSV 发送钱包不一致`);
  const latest=(await api<{data:{blockhash:string;lastValidBlockHeight:number}}>('/solana/latest-blockhash')).data,owner=new PublicKey(tasks[0]!.from),mint=new PublicKey(tasks[0]!.token!),source=ata(owner,mint);
  const transactions=tasks.map(task=>{const recipient=new PublicKey(task.to),destination=ata(recipient,mint),amount=BigInt(task.amount)*1_000_000n,bytes=new Uint8Array(8);new DataView(bytes.buffer).setBigUint64(0,amount,true);return new Transaction({feePayer:owner,recentBlockhash:latest.blockhash}).add(new TransactionInstruction({programId:ASSOCIATED,keys:[{pubkey:owner,isSigner:true,isWritable:true},{pubkey:destination,isSigner:false,isWritable:true},{pubkey:recipient,isSigner:false,isWritable:false},{pubkey:mint,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},{pubkey:TOKEN_2022,isSigner:false,isWritable:false}],data:Buffer.from([1])}),new TransactionInstruction({programId:TOKEN_2022,keys:[{pubkey:source,isSigner:false,isWritable:true},{pubkey:mint,isSigner:false,isWritable:false},{pubkey:destination,isSigner:false,isWritable:true},{pubkey:owner,isSigner:true,isWritable:false}],data:Buffer.from([12,...bytes,6])}))});
  reserveMainnetCanaryExecution();
  const signed=await provider.signAllTransactions(transactions);if(signed.length!==transactions.length)throw new Error('OKX Wallet 返回的签名交易数量不完整，未广播');
  const encoded=signed.map(transaction=>Buffer.from(transaction.serialize()).toString('base64'));
  return(await api<{data:SolanaBatchResult[]}>('/solana/send-signed-batch',{method:'POST',body:JSON.stringify({transactions:encoded})})).data;
}
