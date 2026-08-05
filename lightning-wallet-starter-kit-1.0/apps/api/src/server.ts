import Fastify from 'fastify';
import { get as httpGet } from 'node:http';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import { z } from 'zod';
import { chains } from '@lightning/core';
import { operationId } from './adapters.js';
import { config } from './config.js';
import { fetchSwapCandidates } from './swap.js';
import { flashLoanSessionClaims } from './flash-loan.js';
import { evaluateVipPolicy, gasEstimateSchema, HttpPaymasterAdapter, rpcGasEstimate, sponsorRequestSchema } from './gasfree.js';
import { createDeploymentPlan } from './launchpad.js';

const app = Fastify({ logger: true, requestIdHeader: 'x-request-id' });
await app.register(helmet); await app.register(cors, { origin: config.CORS_ORIGIN.split(',') }); await app.register(jwt, { secret: config.JWT_SECRET });
app.setErrorHandler((error, _req, reply) => { const err=error as Error & {statusCode?:number}; app.log.error(err); reply.status(err.statusCode ?? 500).send({ error: 'REQUEST_FAILED', message: config.NODE_ENV === 'production' ? 'Request could not be completed' : err.message }); });
app.get('/health', async () => ({ status: 'ok', service: 'lightning-api', version: '1.0.0', time: new Date().toISOString() }));
app.get('/api/v1/chains', async () => ({ data: chains }));
app.post('/api/v1/auth/login', async (req, reply) => { const body=z.object({email:z.string().email(),password:z.string().min(8)}).parse(req.body); return { data: { token: await reply.jwtSign({sub:body.email,role:'operator'}, {expiresIn:'8h'}), user:{email:body.email,name:'运营管理员'} } }; });
app.get('/api/v1/dashboard', async () => ({ data: { portfolioUsd: 128450.32, wallets: 128, operationsToday: 46, alerts: 2, networks: 7 } }));
app.post('/api/v1/wallets/batch-generate', async (_req, reply) => reply.status(410).send({error:'CLIENT_ONLY_OPERATION',message:'钱包密钥只能在本地客户端生成，不允许发送至 API'}));
app.post('/api/v1/transfers/batch', async req => { const b=z.object({mode:z.enum(['one-to-many','many-to-one','many-to-many']),dryRun:z.boolean().default(true),transfers:z.array(z.object({chain:z.string(),fromWalletId:z.string(),to:z.string(),asset:z.string(),amount:z.string(),idempotencyKey:z.string()})).min(1).max(500)}).parse(req.body); return {data:{jobId:operationId(),status:b.dryRun?'validated':'queued',count:b.transfers.length,mode:b.mode}}; });
app.post('/api/v1/collections/plan', async req => { const b=z.object({chain:z.string(),walletIds:z.array(z.string()).min(1),destination:z.string(),asset:z.string()}).parse(req.body); return {data:{planId:operationId(),status:'estimated',walletCount:b.walletIds.length,estimatedGasUsd:Math.max(1,b.walletIds.length*.18)}}; });
app.post('/api/v1/swap/quotes', async req => ({data:await fetchSwapCandidates(z.object({chain:z.enum(['EVM','SOL','TRON']),chainId:z.number().int().positive().optional(),sellToken:z.string().min(1),buyToken:z.string().min(1),sellAmount:z.string().regex(/^\d+$/),taker:z.string().min(20),slippageBps:z.number().int().min(1).max(500)}).parse(req.body))}));
app.get('/api/v1/integrations/flash-loan', async () => ({data:{appUrl:config.FLASH_LOAN_URL,apiUrl:config.FLASH_LOAN_API_URL,mode:'external'}}));
app.post('/api/v1/integrations/flash-loan/session', async (req, reply) => {
  await req.jwtVerify();
  let claims: ReturnType<typeof flashLoanSessionClaims>;
  try { claims=flashLoanSessionClaims(req.body,req.user); }
  catch { return reply.status(400).send({error:'INVALID_FLASH_LOAN_SESSION',message:'Only authenticated Sepolia dry-run sessions are allowed'}); }
  return {data:{token:await reply.jwtSign(claims,{expiresIn:'5m'}),expiresIn:300}};
});
app.get('/api/v1/integrations/flash-loan/health', async (_req, reply) => {
  try {
    const target=new URL(config.FLASH_LOAN_URL);
    const httpStatus=await new Promise<number>((resolve,reject)=>{const request=httpGet({hostname:target.hostname,port:target.port,path:target.pathname,headers:{host:`localhost:${target.port}`} },response=>{response.resume();resolve(response.statusCode??503)});request.setTimeout(3000,()=>request.destroy(new Error('timeout')));request.on('error',reject)});
    return {data:{status:httpStatus>=200&&httpStatus<400?'ready':'degraded',httpStatus,appUrl:config.FLASH_LOAN_URL,network:'sepolia',mainnetEnabled:false}};
  } catch {
    return reply.status(503).send({error:'FLASH_LOAN_UNAVAILABLE',message:'闪电贷应用暂时不可用，请稍后重试',data:{status:'offline',appUrl:config.FLASH_LOAN_URL,network:'sepolia',mainnetEnabled:false}});
  }
});
app.get('/api/v1/gasfree/status', async () => ({data:{configured:Boolean(config.GASFREE_PROVIDER_URL),network:'sepolia',chainId:11155111,mainnetEnabled:false,capabilities:['sponsor','paymaster','gas-estimation','gas-topup','vip-policy','monitoring'],status:config.GASFREE_PROVIDER_URL?'ready':'dry-run-only'}}));
app.post('/api/v1/gasfree/estimate',async(req,reply)=>{await req.jwtVerify();try{return{data:await rpcGasEstimate(config.GASFREE_EVM_RPC_URL,gasEstimateSchema.parse(req.body))}}catch(error){return reply.status(503).send({error:'GAS_ESTIMATE_UNAVAILABLE',message:error instanceof Error?error.message:'Gas estimate unavailable'})}});
app.post('/api/v1/gasfree/sponsor',async(req,reply)=>{await req.jwtVerify();let input;try{input=sponsorRequestSchema.parse(req.body)}catch{return reply.status(400).send({error:'INVALID_SPONSOR_REQUEST',message:'Only Sepolia sponsor requests without sensitive material are accepted'})}const policy=evaluateVipPolicy(input);if(input.dryRun||!policy.eligible||!config.GASFREE_PROVIDER_URL)return{data:{...policy,dryRun:true,signatureRequired:true,broadcast:false}};try{return{data:{...await new HttpPaymasterAdapter(config.GASFREE_PROVIDER_URL).sponsor(input),dryRun:false,signatureRequired:true,broadcast:false}}}catch{return reply.status(502).send({error:'PAYMASTER_UNAVAILABLE',message:'Paymaster provider unavailable; no transaction was broadcast'})}});
app.get('/api/v1/projects', async () => ({data:[{id:'prj_1',name:'Lightning Demo',chain:'ethereum',status:'draft',version:1}]}));
app.post('/api/v1/launchpad/plan',async(req,reply)=>{await req.jwtVerify();try{return{data:createDeploymentPlan(req.body)}}catch{return reply.status(400).send({error:'INVALID_LAUNCHPAD_DRAFT',message:'Token draft or deployment network is invalid'})}});
app.listen({port:config.API_PORT,host:'0.0.0.0'}).catch(err=>{app.log.error(err);process.exit(1)});
