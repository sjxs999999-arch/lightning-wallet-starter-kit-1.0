import { z } from 'zod';

export const clientCrashReportSchema=z.object({
  name:z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  code:z.literal('RENDER_FAILURE'),
  route:z.string().regex(/^\/[A-Za-z0-9/_-]{0,199}$/),
  fingerprint:z.string().regex(/^[a-f0-9]{24}$/),
  release:z.string().regex(/^\d+\.\d+\.\d+$/).max(20),
}).strict();
