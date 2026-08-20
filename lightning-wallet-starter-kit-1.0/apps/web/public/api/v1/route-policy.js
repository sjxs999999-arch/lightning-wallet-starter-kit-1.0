export const PUBLIC_API_ROUTES = new Set([
  'GET health',
  'GET chains',
  'GET solana/latest-blockhash',
  'GET gasfree/status',
  'GET integrations/flash-loan/health',
  'GET swap/status',
  'GET system/capabilities',
  'POST auth/login',
  'POST errors/report',
  'POST wallets/batch-generate',
  'POST collections/plan',
  'POST launchpad/validate',
  'POST swap/quotes',
]);

export const routeRequiresAuth = (method, route) => method !== 'OPTIONS' && !PUBLIC_API_ROUTES.has(`${method} ${route}`);
