import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function failedBoundary(mode?: 'application' | 'route') {
  const boundary = new ErrorBoundary({
    mode,
    recoveryPath: mode === 'route' ? '/home' : undefined,
    children: React.createElement('span', null, 'child'),
  });
  boundary.state = { failed: true };
  return renderToStaticMarkup(boundary.render() as React.ReactElement);
}

describe('error isolation', () => {
  it('keeps route failures inside the current application shell', () => {
    const html = failedBoundary('route');
    expect(html).toContain('class="panel route-failure"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('错误已隔离，侧边菜单和其他功能仍可继续使用');
    expect(html).not.toContain('class="fatal"');
  });

  it('retains a full application fallback for root render failures', () => {
    const html = failedBoundary();
    expect(html).toContain('class="fatal"');
    expect(html).toContain('页面暂时无法加载');
  });
});
