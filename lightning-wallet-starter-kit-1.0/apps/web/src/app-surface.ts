export type AppSurface = 'client' | 'admin';

const CLIENT_HOSTS = new Set(['lightingwallet.com', 'www.lightingwallet.com']);
const ADMIN_HOSTS = new Set(['admin.lightingwallet.com']);

export function resolveAppSurface(input: {
  hostname: string;
  pathname: string;
  clientPaths: ReadonlySet<string>;
  override?: string;
}): AppSurface {
  const override = input.override?.trim().toLowerCase();
  if (override === 'client' || override === 'admin') return override;

  const hostname = input.hostname.trim().toLowerCase();
  if (ADMIN_HOSTS.has(hostname)) return 'admin';
  if (CLIENT_HOSTS.has(hostname) || hostname.endsWith('.vercel.app')) return 'client';

  // Local development keeps both surfaces available in one Vite process.
  return input.clientPaths.has(input.pathname) ? 'client' : 'admin';
}

export function adminLoginUrl(hostname: string, configured?: string): string {
  if (configured?.trim()) return configured.trim();
  const local = ['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname.toLowerCase());
  return local ? '/login' : 'https://admin.lightingwallet.com/login';
}
