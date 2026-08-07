import 'dotenv/config';
import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'), API_PORT: z.coerce.number().default(3001),
  JWT_SECRET: z.string().min(32).default('development-only-secret-change-me-123456'),
  ADMIN_EMAIL: z.string().email().default('admin@lightning.local'),
  ADMIN_PASSWORD_HASH: z.string().default(''),
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:4173,http://localhost:32104'),
  DATABASE_URL: z.string().default('postgresql://lightning:lightning_dev@localhost:5432/lightning_wallet'), REDIS_URL: z.string().default('redis://localhost:6379'),
  FLASH_LOAN_URL: z.string().url().default('http://localhost:5174'), FLASH_LOAN_API_URL: z.string().url().default('http://localhost:3002/api'),
  GASFREE_PROVIDER_URL: z.preprocess(value=>value===''?undefined:value,z.string().url().optional()), GASFREE_EVM_RPC_URL:z.string().url().default('https://ethereum-sepolia-rpc.publicnode.com'), ZEROX_API_KEY: z.string().optional(), TRON_SWAP_PROVIDER_URL:z.preprocess(value=>value===''?undefined:value,z.string().url().optional()), SWAP_PROVIDER_URLS: z.string().optional(),
  MARKET_DEXSCREENER_URL:z.string().url().default('https://api.dexscreener.com'), MARKET_GECKOTERMINAL_URL:z.string().url().default('https://api.geckoterminal.com/api/v2'), MARKET_HOLDER_PROVIDER_URL:z.preprocess(value=>value===''?undefined:value,z.string().url().optional()),
  AUTOMATION_ENABLE_DELIVERY:z.string().default('false').transform(value=>value==='true'),TELEGRAM_BOT_TOKEN:z.string().optional(),EMAIL_PROVIDER_URL:z.preprocess(value=>value===''?undefined:value,z.string().url().optional()),EMAIL_API_KEY:z.string().optional(),WEBHOOK_SIGNING_SECRET:z.preprocess(value=>value===''?undefined:value,z.string().min(32).optional()),
  EVM_RPC_FALLBACK_URLS:z.string().optional(),SOLANA_RPC_URL:z.string().url().default('https://solana-rpc.publicnode.com'),SOLANA_RPC_FALLBACK_URLS:z.string().default('https://solana.drpc.org,https://api.mainnet-beta.solana.com'),TRON_RPC_FALLBACK_URLS:z.string().optional(),RATE_LIMIT_MAX:z.coerce.number().int().positive().default(120),CRASH_REPORT_DSN:z.preprocess(value=>value===''?undefined:value,z.string().url().optional())
}).superRefine((value,ctx)=>{
  if(value.NODE_ENV==='production'&&!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/i.test(value.ADMIN_PASSWORD_HASH)){
    ctx.addIssue({code:'custom',path:['ADMIN_PASSWORD_HASH'],message:'A valid scrypt admin password hash is required in production'});
  }
});
export const config = schema.parse(process.env);
