export const TRON_NATIVE_TOKEN = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
const TRON_MAINNET_CHAIN_ID = '0x2b6653dc';

type TronBroadcast = { result?: boolean; txid?: string; message?: string };
type TronTx = { txID?: string; transaction?: unknown } | Record<string, unknown>;
type BalanceValue = string | number | bigint | { toString(radix?: number): string; _hex?: string };

export interface InjectedTronWeb {
  defaultAddress?: { base58?: string; hex?: string };
  fullNode?: { host?: string };
  trx: {
    sign(tx: unknown): Promise<TronTx>;
    sendRawTransaction(tx: unknown): Promise<TronBroadcast>;
    getTransactionInfo?(txId: string): Promise<{ id?: string; receipt?: { result?: string } }>;
    getBalance?(address: string): Promise<BalanceValue>;
    signTypedData?(domain: Record<string, unknown>, types: Record<string, unknown>, value: Record<string, unknown>): Promise<string>;
    _signTypedData?(domain: Record<string, unknown>, types: Record<string, unknown>, value: Record<string, unknown>): Promise<string>;
    signMessageV2?(message: string): Promise<string>;
  };
  address?: { toHex?(value: string): string };
  transactionBuilder?: {
    triggerConfirmedConstantContract(address: string, selector: string, options: Record<string, unknown>, parameters: { type: string; value: string }[], issuer: string): Promise<{ constant_result?: string[] }>;
    triggerSmartContract(address: string, selector: string, options: Record<string, unknown>, parameters: { type: string; value: unknown }[], issuer?: string): Promise<Record<string, unknown>>;
  };
  contract?(): { at(address: string): Promise<{ balanceOf(owner: string): { call(): Promise<BalanceValue> } }> };
}

export interface SunSwapWallet {
  readonly type: string;
  getAddress(): Promise<string>;
  getTronWeb(network?: string): Promise<unknown>;
  signAndBroadcast(unsignedTx: Record<string, unknown>, network?: string): Promise<{ result: boolean; txid: string }>;
  signMessage(message: string): Promise<string>;
  signTypedData(primaryType: string, domain: Record<string, unknown>, types: Record<string, unknown>, message: Record<string, unknown>): Promise<string>;
}

export interface InjectedTronProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  tronWeb?: InjectedTronWeb | false;
}

type TronWindow = Window & {
  tron?: InjectedTronProvider;
  tronLink?: InjectedTronProvider;
  tronWeb?: InjectedTronWeb;
  okxwallet?: { tronLink?: InjectedTronProvider };
};

function responseCode(value: unknown) {
  return value !== null && typeof value === 'object' && 'code' in value ? Number((value as { code?: unknown }).code) : undefined;
}

export async function connectInjectedTron(root: TronWindow = window as TronWindow) {
  const provider = root.tron ?? root.okxwallet?.tronLink ?? root.tronLink;
  if (provider) {
    const method = provider === root.tron ? 'eth_requestAccounts' : 'tron_requestAccounts';
    const result = await provider.request({ method });
    const code = responseCode(result);
    if (code === 4001) throw new Error('用户拒绝连接 TRON 钱包');
    if (code !== undefined && code !== 200) throw new Error('TRON 钱包连接失败');
  }
  const tronWeb = provider?.tronWeb || root.tronWeb;
  if (!tronWeb || !tronWeb.defaultAddress?.base58) throw new Error('未检测到已授权的 TronLink 或 OKX Wallet');
  return { provider, tronWeb, address: tronWeb.defaultAddress.base58 };
}

export async function assertTronMainnet(tronWeb: InjectedTronWeb, provider?: InjectedTronProvider) {
  if (provider) {
    try {
      const chainId = await provider.request({ method: 'eth_chainId' });
      if (typeof chainId === 'string') {
        if (chainId.toLowerCase() !== TRON_MAINNET_CHAIN_ID) throw new Error('请将 TRON 钱包切换到 Mainnet');
        return;
      }
    } catch (error) {
      if (error instanceof Error && error.message === '请将 TRON 钱包切换到 Mainnet') throw error;
    }
  }
  const host = String(tronWeb.fullNode?.host ?? '').toLowerCase();
  if (host.includes('nile') || host.includes('shasta')) throw new Error('请将 TRON 钱包切换到 Mainnet');
  if (!/^https:\/\/(api\.)?trongrid\.io(?:\/|$)/.test(host)) throw new Error('无法验证 TRON Mainnet RPC，已停止签名');
}

function asBigInt(value: BalanceValue) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('钱包返回了不安全的余额数值');
    return BigInt(value);
  }
  if (typeof value === 'object' && typeof value._hex === 'string') return BigInt(value._hex);
  const text = typeof value === 'string' ? value : value.toString(10);
  if (!/^\d+$/.test(text)) throw new Error('钱包返回了无效余额');
  return BigInt(text);
}

export async function assertTronSellBalance(tronWeb: InjectedTronWeb, owner: string, token: string, requiredAmount: string) {
  const required = BigInt(requiredAmount);
  let balance: bigint;
  if (token === TRON_NATIVE_TOKEN) {
    if (!tronWeb.trx.getBalance) throw new Error('TRON 钱包不支持余额检查');
    balance = asBigInt(await tronWeb.trx.getBalance(owner));
  } else {
    if (!tronWeb.contract) throw new Error('TRON 钱包不支持 TRC-20 余额检查');
    const contract = await tronWeb.contract().at(token);
    balance = asBigInt(await contract.balanceOf(owner).call());
  }
  if (balance < required) throw new Error('TRON 卖出余额不足，已停止签名');
  return balance;
}

export function createSunSwapWallet(tronWeb: InjectedTronWeb, address: string): SunSwapWallet {
  return {
    type: 'injected-tron-wallet',
    async getAddress() { return address; },
    async getTronWeb(network = 'mainnet') {
      if (network !== 'mainnet') throw new Error('仅允许 SUN.io Mainnet 路由');
      return tronWeb as never;
    },
    async signAndBroadcast(unsignedTx: Record<string, unknown>, network = 'mainnet') {
      if (network !== 'mainnet') throw new Error('仅允许 SUN.io Mainnet 路由');
      const transaction = unsignedTx.transaction ?? unsignedTx;
      const signed = await tronWeb.trx.sign(transaction);
      const broadcast = await tronWeb.trx.sendRawTransaction(signed);
      const txid = String(broadcast.txid ?? signed.txID ?? '');
      if (!broadcast.result || !txid) throw new Error('TRON 钱包广播失败');
      return { result: true, txid };
    },
    async signMessage(message: string) {
      if (!tronWeb.trx.signMessageV2) throw new Error('TRON 钱包不支持消息签名');
      return tronWeb.trx.signMessageV2(message);
    },
    async signTypedData(_primaryType: string, domain: Record<string, unknown>, types: Record<string, unknown>, message: Record<string, unknown>) {
      const signer = tronWeb.trx.signTypedData ?? tronWeb.trx._signTypedData;
      if (!signer) throw new Error('当前 TRON 钱包不支持 Permit2 类型化签名');
      const signature = await signer.call(tronWeb.trx, domain, types, message);
      return signature.replace(/^0x/i, '');
    },
  };
}
