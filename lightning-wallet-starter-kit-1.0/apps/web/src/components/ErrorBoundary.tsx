import React from 'react';
import { api } from '../api';
import { buildClientCrashReport } from './diagnostics';

type ErrorBoundaryProps = React.PropsWithChildren<{
  mode?: 'application' | 'route';
  recoveryPath?: string;
}>;

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    void buildClientCrashReport(error, info.componentStack ?? '', location.pathname)
      .then(report => api('/errors/report', { method: 'POST', body: JSON.stringify(report) }))
      .catch(() => undefined);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.mode === 'route') {
      return <section className="panel route-failure" role="alert">
        <span className="logo-mark">ϟ</span>
        <div><h2>当前模块暂时无法加载</h2><p>错误已隔离，侧边菜单和其他功能仍可继续使用。不会发送错误正文、钱包地址或密钥。</p></div>
        <div className="route-failure-actions">
          <button onClick={() => location.reload()}>重新加载模块</button>
          <button onClick={() => location.assign(this.props.recoveryPath ?? '/home')}>返回安全入口</button>
        </div>
      </section>;
    }
    return <main className="fatal"><div><span className="logo-mark">ϟ</span><h1>页面暂时无法加载</h1><p>系统已保护其他功能不受影响。仅错误类型、页面和匿名指纹会进入限流聚合，不发送错误正文或堆栈。</p><button onClick={() => location.reload()}>重新加载</button><button onClick={() => location.assign('/wallets')}>返回钱包客户端</button></div></main>;
  }
}
