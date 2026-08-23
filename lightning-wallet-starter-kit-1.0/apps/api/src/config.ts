import 'dotenv/config';
import { z } from 'zod';
import { validMfaEncryptionKey } from './operator-mfa.js';
const DEVELOPMENT_CHAT_SECRET='development-chat-secret-change-me-123456';
const booleanFlag=z.preprocess(value=>typeof value==='boolean'?String(value):value,z.enum(['true','false']).default('false')).transform(value=>value==='true');
export const configSchema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'), API_PORT: z.coerce.number().default(3001),
  JWT_SECRET: z.string().min(32).default('development-only-secret-change-me-123456'),
  CHAT_JWT_SECRET: z.string().min(32).default(DEVELOPMENT_CHAT_SECRET),
  ADMIN_EMAIL: z.string().email().default('admin@lightning.local'),
  ADMIN_PASSWORD_HASH: z.string().default(''),
  ADMIN_TOTP_SECRET: z.preprocess(value=>value===''?undefined:value,z.string().min(16).max(128).regex(/^[A-Z2-7=\s-]+$/i).optional()),
  OPERATOR_MFA_ENCRYPTION_KEY: z.preprocess(value=>value===''?undefined:value,z.string().optional()),
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:4173,http://localhost:32104'),
  DATABASE_URL: z.string().default('postgresql://lightning:lightning_dev@localhost:5432/lightning_wallet'), REDIS_URL: z.string().default('redis://localhost:6379'),
  FLASH_LOAN_URL: z.string().url().default('http://localhost:5174'), FLASH_LOAN_API_URL: z.string().url().default('http://localhost:3002/api'), FLASH_LOAN_PROVIDER_APPROVED:booleanFlag,
  GASFREE_PROVIDER_URL: z.preprocess(value=>value===''?undefined:value,z.string().url().optional()), GASFREE_EVM_RPC_URL:z.string().url().default('https://ethereum-sepolia-rpc.publicnode.com'), LIFI_API_KEY:z.string().optional(), ZEROX_API_KEY: z.string().optional(), SWAP_PROVIDER_URLS: z.string().optional(),
  MARKET_DEXSCREENER_URL:z.string().url().default('https://api.dexscreener.com'), MARKET_GECKOTERMINAL_URL:z.string().url().default('https://api.geckoterminal.com/api/v2'), MARKET_HOLDER_PROVIDER_URL:z.preprocess(value=>value===''?undefined:value,z.string().url().optional()),
  AUTOMATION_ENABLE_DELIVERY:booleanFlag,TELEGRAM_BOT_TOKEN:z.string().optional(),EMAIL_PROVIDER_URL:z.preprocess(value=>value===''?undefined:value,z.string().url().optional()),EMAIL_API_KEY:z.string().optional(),WEBHOOK_SIGNING_SECRET:z.preprocess(value=>value===''?undefined:value,z.string().min(32).optional()),
  VITE_WALLETCONNECT_PROJECT_ID:z.preprocess(value=>value===''?undefined:value,z.string().regex(/^[a-fA-F0-9]{32}$/).optional()),VITE_MAINNET_EXECUTION_ENABLED:booleanFlag,VITE_ENABLE_MAINNET_SWAP:booleanFlag,VITE_ENABLE_MAINNET_LAUNCHPAD:booleanFlag,VITE_ENABLE_MAINNET_BRIDGE:booleanFlag,FINAL_WALLET_ACCEPTANCE_APPROVED:booleanFlag,FINAL_WALLET_ACCEPTANCE_EVIDENCE_SHA256:z.preprocess(value=>value===''?undefined:value,z.string().regex(/^[a-fA-F0-9]{64}$/).optional()),
  EVM_RPC_FALLBACK_URLS:z.string().optional(),SOLANA_RPC_URL:z.string().url().default('https://solana-rpc.publicnode.com'),SOLANA_RPC_FALLBACK_URLS:z.string().default('https://solana.drpc.org,https://api.mainnet-beta.solana.com'),TRON_RPC_FALLBACK_URLS:z.string().optional(),RATE_LIMIT_MAX:z.coerce.number().int().positive().default(120),METRICS_TOKEN:z.preprocess(value=>value===''?undefined:value,z.string().min(32).max(256).optional())
}).superRefine((value,ctx)=>{
  if(value.NODE_ENV==='production'&&!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/i.test(value.ADMIN_PASSWORD_HASH)){
    ctx.addIssue({code:'custom',path:['ADMIN_PASSWORD_HASH'],message:'A valid scrypt admin password hash is required in production'});
  }
  if(value.NODE_ENV==='production'&&(value.CHAT_JWT_SECRET===DEVELOPMENT_CHAT_SECRET||value.CHAT_JWT_SECRET===value.JWT_SECRET)){
    ctx.addIssue({code:'custom',path:['CHAT_JWT_SECRET'],message:'A distinct production chat signing secret is required'});
  }
  if(!validMfaEncryptionKey(value.OPERATOR_MFA_ENCRYPTION_KEY)){
    ctx.addIssue({code:'custom',path:['OPERATOR_MFA_ENCRYPTION_KEY'],message:'Operator MFA encryption key must be exactly 32 bytes encoded as base64 or hex'});
  }
  if(value.FINAL_WALLET_ACCEPTANCE_APPROVED&&!value.FINAL_WALLET_ACCEPTANCE_EVIDENCE_SHA256){
    ctx.addIssue({code:'custom',path:['FINAL_WALLET_ACCEPTANCE_EVIDENCE_SHA256'],message:'Wallet acceptance approval requires a verified evidence digest'});
  }
});
export const config = configSchema.parse(process.env);
