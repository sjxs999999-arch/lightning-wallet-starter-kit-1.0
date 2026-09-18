import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const RELEASE_VERSION = '2.41.0';
const releaseManifest = (environment: Record<string, string>): Plugin => ({
  name: 'lightning-release-manifest',
  generateBundle() {
    const enabled = (key: string) => environment[key] === 'true';
    const commit = environment.VITE_RELEASE_COMMIT || environment.VERCEL_GIT_COMMIT_SHA || 'uncommitted';
    this.emitFile({
      type: 'asset',
      fileName: 'release.json',
      source: `${JSON.stringify({
        format: 'lightning-wallet-client-release-v1',
        version: RELEASE_VERSION,
        commit,
        mainnet: {
          execution: enabled('VITE_MAINNET_EXECUTION_ENABLED'),
          swap: enabled('VITE_ENABLE_MAINNET_SWAP'),
          launchpad: enabled('VITE_ENABLE_MAINNET_LAUNCHPAD'),
          bridge: enabled('VITE_ENABLE_MAINNET_BRIDGE'),
        },
      })}\n`,
    });
  },
});

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), releaseManifest(environment)],
    server: { port: 5173, host: '0.0.0.0' },
    preview: { port: 4173, host: '0.0.0.0' },
    worker: { format: 'es' },
    build: {
      target: 'es2022', sourcemap: false, cssCodeSplit: true, chunkSizeWarningLimit: 550,
      rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], ethers: ['ethers'], solana: ['@solana/web3.js'], walletconnect: ['@walletconnect/ethereum-provider'] } } },
    },
  };
});
