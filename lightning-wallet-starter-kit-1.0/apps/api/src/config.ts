import 'dotenv/config';
import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development','test','production']).default('development'), API_PORT: z.coerce.number().default(3001),
  JWT_SECRET: z.string().min(32).default('development-only-secret-change-me-123456'),
  CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:4173,http://localhost:32104'),
  DATABASE_URL: z.string().default('postgresql://lightning:lightning_dev@localhost:5432/lightning_wallet'), REDIS_URL: z.string().default('redis://localhost:6379'),
  FLASH_LOAN_URL: z.string().url().default('http://localhost:5174'), FLASH_LOAN_API_URL: z.string().url().default('http://localhost:3002/api'),
  GASFREE_PROVIDER_URL: z.preprocess(value=>value===''?undefined:value,z.string().url().optional()), GASFREE_EVM_RPC_URL:z.string().url().default('https://ethereum-sepolia-rpc.publicnode.com'), ZEROX_API_KEY: z.string().optional(), TRON_SWAP_PROVIDER_URL: z.string().url().optional(), SWAP_PROVIDER_URLS: z.string().optional()
});
export const config = schema.parse(process.env);
