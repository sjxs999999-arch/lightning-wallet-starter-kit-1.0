import { describe, expect, it } from 'vitest';
import { portfolioErrorMessage } from './WalletPortfolio';

describe('wallet portfolio error copy', () => {
  it('turns browser network failures into an actionable local error', () => {
    expect(portfolioErrorMessage(new TypeError('Failed to fetch'))).toContain('测试网 RPC 暂时不可用');
  });

  it('preserves exact network-attestation failures', () => {
    expect(portfolioErrorMessage(new Error('本地钱包归集扫描 RPC 不是 Sepolia，已停止扫描'))).toContain('不是 Sepolia');
  });
});
