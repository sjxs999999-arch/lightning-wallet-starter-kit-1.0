import Fastify from 'fastify';
import { get as httpGet } from 'node:http';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { chains } from '@lightning/core';
import { operationId } from './adapters.js';
import { config } from './config.js';
import { fetchSwapCandidates } from './swap.js';
import { flashLoanSessionClaims } from './flash-loan.js';
import { evaluateVipPolicy, gasEstimateSchema, HttpPaymasterAdapter, rpcGasEstimate, sponsorRequestSchema } from './gasfree.js';
import { createDeploymentPlan } from './launchpad.js';
import pg from 'pg';import { listProjects, projectDetails, projectQuerySchema } from './projects.js';
import{holderData,marketChain,marketHistory,marketTrades,searchMarket,tokenMarket}from'./market.js';
import{createChannelSchema,createRule,dispatchNotification,ensureAutomationSchema,executeRule,healthSnapshot,publicChannel,runDueRules,validateChannel}from'./automation.js';
import{createClient}from'redis';
import{rpcEndpoints}from'./resilience.js';

const app = Fastify({ logger: {level:config.NODE_ENV==='production'?'info':'debug',redact:['req.headers.authorization','req.headers.cookie','body.privateKey','body.mnemonic','body.seedPhrase','body.password','body.token']}, requestIdHeader: 'x-request-id' });
const projectDb=new pg.Pool({connectionString:config.DATABASE_URL,max:5});
const cache=createClient({url:config.REDIS_URL});cache.on('error',error=>app.log.error({error},'redis error'));await cache.connect().catch(error=>app.log.error({error},'redis startup degraded'));
await ensureAutomationSchema(projectDb);
const scheduler=setInterval(()=>void runDueRules(projectDb).catch(error=>app.log.error(error,'automation scheduler failed')),30_000);scheduler.unref();
await app.register(helmet,{contentSecurityPolicy:{directives:{defaultSrc:["'self'"],frameAncestors:["'none'"]}}}); await app.register(cors, { origin: config.CORS_ORIGIN.split(',') }); await app.register(jwt, { secret: config.JWT_SECRET });await app.register(rateLimit,{max:config.RATE_LIMIT_MAX,timeWindow:'1 minute'});
let requestCount=0,errorCount=0;const startedAt=Date.now();app.addHook('onRequest',async()=>{requestCount++});app.addHook('onError',async()=>{errorCount++});
app.setErrorHandler((error, _req, reply) => { const err=error as Error & {statusCode?:number}; app.log.error(err); reply.status(err.statusCode ?? 500).send({ error: 'REQUEST_FAILED', message: config.NODE_ENV === 'production' ? 'Request could not be completed' : err.message }); });
app.get('/health', async () => ({ status: 'ok', service: 'lightning-api', version: '2.1.0', uptimeSeconds:Math.floor((Date.now()-startedAt)/1000),time: new Date().toISOString() }));
app.get('/health/ready',async(_req,reply)=>{try{await projectDb.query('SELECT 1');if(!cache.isReady)throw new Error('redis unavailable');await cache.ping();return{status:'ready',postgres:'ok',redis:'ok'}}catch{return reply.status(503).send({status:'not-ready',postgres:'unknown',redis:cache.isReady?'ok':'unavailable'})}});
app.get('/metrics',async(_req,reply)=>{reply.type('text/plain; version=0.0.4');return`# HELP lightning_uptime_seconds Process uptime\n# TYPE lightning_uptime_seconds gauge\nlightning_uptime_seconds ${Math.floor((Date.now()-startedAt)/1000)}\n# HELP lightning_http_requests_total HTTP requests\n# TYPE lightning_http_requests_total counter\nlightning_http_requests_total ${requestCount}\n# HELP lightning_http_errors_total HTTP errors\n# TYPE lightning_http_errors_total counter\nlightning_http_errors_total ${errorCount}\n`});
app.post('/api/v1/errors/report',async(req,reply)=>{await req.jwtVerify();const body=z.object({name:z.string().max(100),message:z.string().max(500),route:z.string().max(200),stack:z.string().max(4000).optional(),release:z.string().max(50).optional()}).strict().parse(req.body);app.log.error({crash:{...body,stack:body.stack?.replace(/(token|key|secret|mnemonic)[^\s]*/gi,'[redacted]')}},'client crash report');return reply.status(202).send({data:{accepted:true}})});
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
app.post('/api/v1/gasfree/estimate',async(req,reply)=>{await req.jwtVerify();try{return{data:await rpcGasEstimate(rpcEndpoints(config.GASFREE_EVM_RPC_URL,config.EVM_RPC_FALLBACK_URLS),gasEstimateSchema.parse(req.body))}}catch(error){return reply.status(503).send({error:'GAS_ESTIMATE_UNAVAILABLE',message:error instanceof Error?error.message:'Gas estimate unavailable'})}});
app.post('/api/v1/gasfree/sponsor',async(req,reply)=>{await req.jwtVerify();let input;try{input=sponsorRequestSchema.parse(req.body)}catch{return reply.status(400).send({error:'INVALID_SPONSOR_REQUEST',message:'Only Sepolia sponsor requests without sensitive material are accepted'})}const policy=evaluateVipPolicy(input);if(input.dryRun||!policy.eligible||!config.GASFREE_PROVIDER_URL)return{data:{...policy,dryRun:true,signatureRequired:true,broadcast:false}};try{return{data:{...await new HttpPaymasterAdapter(config.GASFREE_PROVIDER_URL).sponsor(input),dryRun:false,signatureRequired:true,broadcast:false}}}catch{return reply.status(502).send({error:'PAYMASTER_UNAVAILABLE',message:'Paymaster provider unavailable; no transaction was broadcast'})}});
app.get('/api/v1/projects',async(req,reply)=>{await req.jwtVerify();try{return{data:await listProjects(projectDb,projectQuerySchema.parse(req.query))}}catch(error){app.log.error(error);return reply.status(503).send({error:'PROJECT_CENTER_UNAVAILABLE',message:'Project metadata is temporarily unavailable'})}});
app.get('/api/v1/projects/:id',async(req,reply)=>{await req.jwtVerify();try{const id=z.object({id:z.string()}).parse(req.params).id,result=await projectDetails(projectDb,id);return result?{data:result}:reply.status(404).send({error:'PROJECT_NOT_FOUND',message:'Project not found'})}catch(error){app.log.error(error);return reply.status(400).send({error:'INVALID_PROJECT_REQUEST',message:'Project identifier is invalid'})}});
app.get('/api/v1/market/search',async(req,reply)=>{await req.jwtVerify();try{const q=z.object({q:z.string().trim().min(2).max(100),chain:marketChain.optional()}).parse(req.query);return{data:await searchMarket(q.q,q.chain)}}catch(error){app.log.warn({error},'market search failed');return reply.status(503).send({error:'MARKET_SEARCH_UNAVAILABLE',message:'行情搜索暂时不可用，请稍后重试'})}});
app.get('/api/v1/market/token',async(req,reply)=>{await req.jwtVerify();try{const q=z.object({chain:marketChain,address:z.string().trim().min(10).max(100)}).parse(req.query),market=await tokenMarket(q.chain,q.address);if(!market)return reply.status(404).send({error:'MARKET_NOT_FOUND',message:'未找到该代币的公开交易池'});return{data:{...market,holders:await holderData(q.chain,q.address)}}}catch(error){app.log.warn({error},'token market failed');return reply.status(503).send({error:'MARKET_PROVIDER_UNAVAILABLE',message:'行情提供方暂时不可用，请稍后重试'})}});
app.get('/api/v1/market/history',async(req,reply)=>{await req.jwtVerify();try{const q=z.object({chain:marketChain,pool:z.string().trim().min(10).max(150)}).parse(req.query);return{data:await marketHistory(q.chain,q.pool)}}catch(error){app.log.warn({error},'market history failed');return reply.status(503).send({error:'MARKET_HISTORY_UNAVAILABLE',message:'价格历史暂时不可用'})}});
app.get('/api/v1/market/trades',async(req,reply)=>{await req.jwtVerify();try{const q=z.object({chain:marketChain,pool:z.string().trim().min(10).max(150)}).parse(req.query);return{data:await marketTrades(q.chain,q.pool)}}catch(error){app.log.warn({error},'market trades failed');return reply.status(503).send({error:'MARKET_TRADES_UNAVAILABLE',message:'交易记录暂时不可用'})}});
app.get('/api/v1/automation/overview',async(req,reply)=>{await req.jwtVerify();try{const[rules,channels,jobs,queue]=await Promise.all([projectDb.query('SELECT * FROM automation_rules ORDER BY created_at DESC LIMIT 100'),projectDb.query('SELECT * FROM notification_channels ORDER BY created_at DESC LIMIT 100'),projectDb.query('SELECT * FROM automation_jobs ORDER BY created_at DESC LIMIT 100'),projectDb.query("SELECT count(*)::int AS count FROM automation_jobs WHERE status IN ('queued','failed')")]);return{data:{rules:rules.rows,channels:channels.rows.map(publicChannel),jobs:jobs.rows,retryQueue:Number(queue.rows[0]?.count??0),deliveryEnabled:config.AUTOMATION_ENABLE_DELIVERY}}}catch{return reply.status(503).send({error:'AUTOMATION_UNAVAILABLE',message:'自动化数据暂时不可用'})}});
app.post('/api/v1/automation/rules',async(req,reply)=>{await req.jwtVerify();try{return{data:await createRule(projectDb,req.body)}}catch(error){return reply.status(400).send({error:'INVALID_AUTOMATION_RULE',message:error instanceof Error?error.message:'规则无效'})}});
app.patch('/api/v1/automation/rules/:id',async(req,reply)=>{await req.jwtVerify();try{const id=z.object({id:z.string().uuid()}).parse(req.params).id,body=z.object({enabled:z.boolean()}).strict().parse(req.body),result=await projectDb.query('UPDATE automation_rules SET enabled=$2,updated_at=now() WHERE id=$1 RETURNING *',[id,body.enabled]);return result.rows[0]?{data:result.rows[0]}:reply.status(404).send({error:'RULE_NOT_FOUND',message:'规则不存在'})}catch{return reply.status(400).send({error:'INVALID_RULE_UPDATE',message:'规则更新无效'})}});
app.post('/api/v1/automation/rules/:id/run',async(req,reply)=>{await req.jwtVerify();try{const id=z.object({id:z.string().uuid()}).parse(req.params).id;return{data:await executeRule(projectDb,id)}}catch{return reply.status(400).send({error:'RULE_RUN_FAILED',message:'只读检查执行失败'})}});
app.post('/api/v1/automation/jobs/:id/retry',async(req,reply)=>{await req.jwtVerify();try{const id=z.object({id:z.string().uuid()}).parse(req.params).id,job=(await projectDb.query('SELECT rule_id,attempt FROM automation_jobs WHERE id=$1',[id])).rows[0];if(!job?.rule_id)return reply.status(404).send({error:'JOB_NOT_FOUND',message:'任务不存在或不可重试'});return{data:await executeRule(projectDb,String(job.rule_id),Number(job.attempt)+1)}}catch{return reply.status(400).send({error:'RETRY_FAILED',message:'重试未执行，未触发任何交易'})}});
app.post('/api/v1/automation/channels',async(req,reply)=>{await req.jwtVerify();try{const value=validateChannel(createChannelSchema.parse(req.body)),result=await projectDb.query('INSERT INTO notification_channels(kind,name,destination,enabled) VALUES($1,$2,$3,$4) RETURNING *',[value.kind,value.name,value.destination,value.enabled]);return{data:publicChannel(result.rows[0]!)}}catch(error){return reply.status(400).send({error:'INVALID_NOTIFICATION_CHANNEL',message:error instanceof Error?error.message:'通知通道无效'})}});
app.post('/api/v1/automation/notify',async(req,reply)=>{await req.jwtVerify();try{return{data:await dispatchNotification(projectDb,req.body)}}catch(error){return reply.status(503).send({error:'NOTIFICATION_FAILED',message:error instanceof Error?error.message:'通知发送失败'})}});
app.get('/api/v1/automation/health',async(req,reply)=>{await req.jwtVerify();try{return{data:await healthSnapshot(projectDb)}}catch{return reply.status(503).send({error:'HEALTH_CHECK_FAILED',message:'健康检查暂时不可用'})}});
app.post('/api/v1/launchpad/plan',async(req,reply)=>{await req.jwtVerify();try{return{data:createDeploymentPlan(req.body)}}catch{return reply.status(400).send({error:'INVALID_LAUNCHPAD_DRAFT',message:'Token draft or deployment network is invalid'})}});
app.listen({port:config.API_PORT,host:'0.0.0.0'}).catch(err=>{app.log.error(err);process.exit(1)});
