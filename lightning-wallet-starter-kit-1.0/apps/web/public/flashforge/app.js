let context=null;
const parentOrigin=new URL(location.href).origin;
const session=document.querySelector('#session'),wallet=document.querySelector('#wallet'),run=document.querySelector('#run');
parent.postMessage({type:'FLASH_LOAN_READY'},parentOrigin);
addEventListener('message',event=>{if(event.origin!==parentOrigin||event.source!==parent||event.data?.type!=='LIGHTNING_FLASH_LOAN_CONTEXT')return;context=event.data;session.textContent=context.sessionToken?'已授权':'等待';wallet.textContent=context.walletAddress?`${context.walletAddress.slice(0,6)}…${context.walletAddress.slice(-4)}`:'未连接';run.disabled=!context.sessionToken});
run.addEventListener('click',()=>{if(!context)return;const item={id:crypto.randomUUID(),createdAt:new Date().toISOString(),status:'dry-run',transactionHash:'',protocol:'FlashForge',asset:'ETH',amount:'0'};parent.postMessage({type:'FLASH_LOAN_HISTORY',payload:item},parentOrigin);run.textContent='模拟通过 · 未签名 · 未广播'});
