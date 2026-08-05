import { z } from 'zod';

const requestSchema=z.object({network:z.literal('sepolia'),dryRun:z.literal(true)});
const userSchema=z.object({sub:z.string().min(1),role:z.literal('operator')});

export function flashLoanSessionClaims(body: unknown, user: unknown) {
  const request=requestSchema.parse(body);
  const identity=userSchema.parse(user);
  return {sub:identity.sub,aud:'flash-loan',scope:['wallet:public','history:metadata'],network:request.network,dryRun:true as const};
}
