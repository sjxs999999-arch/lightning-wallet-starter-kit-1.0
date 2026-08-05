import Fastify from 'fastify';
import { get as httpGet } from 'node:http';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import { z } from 'zod';
import { chains } from '@lightning/core';
import type { ChainId, QuoteRequest } from '@lightning/core';
import { adapters, familyFor, operationId, swapQuote } from './adapters.js';
import { config } from './config.js';

const app = Fastify({ logger: true, requestIdHeader: 'x-request-id' });
await app.register(helmet); await app.register(cors, { origin: config.CORS_ORIGIN.split(',') }); await app.register(jwt, { secret: config.JWT_SECRET });
app.setErrorHandler((error, _req, reply) => { const err=error as Error & {statusCode?:number}; app.log.error(err); reply.status(err.statusCode ?? 500).send({ error: 'REQUEST_FAILED', message: config.NODE_ENV === 'production' ? 'Request could not be completed' : err.message }); });
app.get('/health', async () => ({ status: 'ok', service: 'lightning-api', version: '1.0.0', time: new Date().toISOString() }));
app.get('/api/v1/chains', async () => ({ data: chains }));
app.post('/api/v1/auth/login', async (req, reply) => { const body=z.object({email:z.string().email(),password:z.string().min(8)}).parse(req.body); return { data: { token: await reply.jwtSign({sub:body.email,role:'operator'}, {expiresIn:'8h'}), user:{email:body.email,name:'运营管理员'} } }; });
app.get('/api/v1/dashboard', async () => ({ data: { portfolioUsd: 128450.32, wallets: 128, operationsToday: 46, alerts: 2, networks: 7 } }));
app.post('/api/v1/wallets/batch-generate', async req => { const b=z.object({chain:z.enum(['ethereum','bsc','polygon','base','arbitrum','solana','tron']),count:z.number().int().min(1).max(100),labelPrefix:z.string().max(30).default('Wallet')}).parse(req.body); const adapter=adapters[familyFor(b.chain as ChainId)]!; return {data:Array.from({length:b.count},(_,i)=>({id:operationId(),chain:b.chain,label:`${b.labelPrefix} ${i+1}`,...adapter.generate()})),warning:'Secret material must be encrypted or imported into an HSM before production use.'}; });
app.post('/api/v1/transfers/batch', async req => { const b=z.object({mode:z.enum(['one-to-many','many-to-one','many-to-many']),dryRun:z.boolean().default(true),transfers:z.array(z.object({chain:z.string(),fromWalletId:z.string(),to:z.string(),asset:z.string(),amount:z.string(),idempotencyKey:z.string()})).min(1).max(500)}).parse(req.body); return {data:{jobId:operationId(),status:b.dryRun?'validated':'queued',count:b.transfers.length,mode:b.mode}}; });
app.post('/api/v1/collections/plan', async req => { const b=z.object({chain:z.string(),walletIds:z.array(z.string()).min(1),destination:z.string(),asset:z.string()}).parse(req.body); return {data:{planId:operationId(),status:'estimated',walletCount:b.walletIds.length,estimatedGasUsd:Math.max(1,b.walletIds.length*.18)}}; });
app.post('/api/v1/swap/quote', async req => ({data:await swapQuote(z.object({chain:z.string(),sellToken:z.string(),buyToken:z.string(),amount:z.string(),slippageBps:z.number().int().min(1).max(500)}).parse(req.body) as QuoteRequest)}));
app.get('/api/v1/integrations/flash-loan', async () => ({data:{appUrl:config.FLASH_LOAN_URL,apiUrl:config.FLASH_LOAN_API_URL,mode:'external'}}));
app.get('/api/v1/integrations/flash-loan/health', async (_req, reply) => {
  try {
    const target=new URL(config.FLASH_LOAN_URL);
    const httpStatus=await new Promise<number>((resolve,reject)=>{const request=httpGet({hostname:target.hostname,port:target.port,path:target.pathname,headers:{host:`localhost:${target.port}`} },response=>{response.resume();resolve(response.statusCode??503)});request.setTimeout(3000,()=>request.destroy(new Error('timeout')));request.on('error',reject)});
    return {data:{status:httpStatus>=200&&httpStatus<400?'ready':'degraded',httpStatus,appUrl:config.FLASH_LOAN_URL,network:'sepolia',mainnetEnabled:false}};
  } catch {
    return reply.status(503).send({error:'FLASH_LOAN_UNAVAILABLE',message:'闪电贷应用暂时不可用，请稍后重试',data:{status:'offline',appUrl:config.FLASH_LOAN_URL,network:'sepolia',mainnetEnabled:false}});
  }
});
app.get('/api/v1/gasfree/status', async () => ({data:{configured:Boolean(config.GASFREE_PROVIDER_URL),capabilities:['sponsor','gas-detection','gas-topup','monitoring'],status:config.GASFREE_PROVIDER_URL?'ready':'adapter-required'}}));
app.get('/api/v1/projects', async () => ({data:[{id:'prj_1',name:'Lightning Demo',chain:'ethereum',status:'draft',version:1}]}));
app.listen({port:config.API_PORT,host:'0.0.0.0'}).catch(err=>{app.log.error(err);process.exit(1)});
