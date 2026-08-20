import { describe, expect, it, vi } from 'vitest';
import { fetchLiFiEvmCandidate, normalizeExternalEvmCandidate, normalizeLiFiEvmQuote, type SwapQuoteInput } from './swap.js';

const input: SwapQuoteInput = {
  chain: 'EVM', chainId: 1, sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', sellAmount: '1000000',
  taker: '0x42BAe181b2Fbd5cc8F04762770942C719Dd4d30a', slippageBps: 50,
};

const quote = {
  id: 'quote-1', tool: 'sushiswap', toolDetails: { name: 'SushiSwap Aggregator' },
  action: {
    fromChainId: 1, toChainId: 1, fromAmount: input.sellAmount, fromAddress: input.taker, toAddress: input.taker,
    fromToken: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC' },
    toToken: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH' },
  },
  estimate: {
    fromAmount: '1000000', toAmount: '436232556501834', toAmountMin: '434051393719324',
    approvalAddress: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', fromAmountUSD: '0.9993', toAmountUSD: '0.9960',
    feeCosts: [{ amountUSD: '0.0025' }, { amountUSD: '0.0010' }], gasCosts: [{ amountUSD: '0.7592' }],
  },
  includedSteps: [{ tool: 'feeCollection' }, { tool: 'sushiswap' }],
  transactionRequest: { chainId: 1, from: input.taker, to: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', data: '0x1234', value: '0', gasLimit: '651253', gasPrice: '663729965' },
};

describe('LI.FI same-chain EVM Swap', () => {
  it('normalizes only a matching executable route and discloses provider costs', () => {
    expect(normalizeLiFiEvmQuote(input, quote, 1_700_000_000_000)).toEqual({
      provider: 'LI.FI / SushiSwap Aggregator', amountIn: '1000000', amountOut: '436232556501834', minReceived: '434051393719324',
      priceImpactPct: expect.closeTo((1 - 0.9960 / 0.9993) * 100, 8), route: ['sushiswap', 'feeCollection'],
      allowanceTarget: quote.estimate.approvalAddress,
      transaction: { to: quote.transactionRequest.to, data: '0x1234', value: '0x0', gas: '0x9eff5', gasPrice: '0x278fb72d' },
      feeUsd: '0.0035', gasCostUsd: '0.7592', expiresAt: '2023-11-14T22:14:15.000Z',
      raw: { source: 'LI.FI', quoteId: 'quote-1', tool: 'sushiswap', chainId: 1, sameChain: true },
    });
  });

  it('rejects changed wallet, chain, amount, token, minimum or transaction fields', () => {
    for (const value of [
      { ...quote, action: { ...quote.action, fromAddress: '0x1311897252Bd6D7E5705443D9e7c32eE22E73067' } },
      { ...quote, action: { ...quote.action, toChainId: 56 } },
      { ...quote, estimate: { ...quote.estimate, fromAmount: '999999' } },
      { ...quote, action: { ...quote.action, toToken: { ...quote.action.toToken, address: '0x1111111111111111111111111111111111111111' } } },
      { ...quote, estimate: { ...quote.estimate, toAmountMin: '999999999999999' } },
      { ...quote, transactionRequest: { ...quote.transactionRequest, data: 'not-hex' } },
    ]) expect(() => normalizeLiFiEvmQuote(input, value)).toThrow(/LI\.FI/);
  });

  it('requests a same-chain quote using only public wallet and trade parameters', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(quote), { status: 200 }));
    await expect(fetchLiFiEvmCandidate(input, fetcher)).resolves.toMatchObject({ provider: 'LI.FI / SushiSwap Aggregator' });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toContain('https://li.quest/v1/quote?');
    expect(String(url)).toContain('fromChain=1&toChain=1');
    expect(String(url)).toContain('fromAddress=0x42BA');
    expect(String(url)).not.toMatch(/privateKey|mnemonic|seed|signature/i);
    expect(JSON.stringify(init)).not.toMatch(/privateKey|mnemonic|seed|signature/i);
  });

  it('accepts only bounded HTTPS custom-provider transaction data', () => {
    const external = { provider: 'Private Aggregator', amountIn: input.sellAmount, amountOut: '436232556501834', minReceived: '434051393719324', priceImpactPct: 0.3, route: ['Uniswap V3'], allowanceTarget: quote.estimate.approvalAddress, transaction: { chainId: 1, from: input.taker, to: quote.transactionRequest.to, data: '0x1234', value: '0', gas: '500000' } };
    expect(normalizeExternalEvmCandidate(input, external, 'https://swap.example/api')).toMatchObject({ provider: 'Private Aggregator', amountIn: input.sellAmount, transaction: { data: '0x1234', value: '0x0' }, raw: { source: 'swap.example' } });
    expect(() => normalizeExternalEvmCandidate(input, external, 'http://swap.example/api')).toThrow(/HTTPS/);
    expect(() => normalizeExternalEvmCandidate(input, { ...external, transaction: { ...external.transaction, chainId: 56 } }, 'https://swap.example/api')).toThrow(/invalid route/);
  });
});
