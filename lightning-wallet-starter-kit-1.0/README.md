# ⚡ 闪电钱包（Lightning Wallet）Starter Kit 1.0

可直接交付开发团队的稳定基线：React + TypeScript + Vite 控制台、Node/TypeScript API、PostgreSQL、Redis 与 Docker Compose。它保留旧业务模块的适配入口，不假装已经实现真实资金签名或生产托管。

## 快速启动

要求 Node.js 20+、npm 10+。复制环境变量后安装并启动：

```bash
cp .env.example .env
npm install
npm run dev
```

- 控制台：http://localhost:5173
- 登录页：http://localhost:5173/login
- API 健康检查：http://localhost:3001/health

首次可直接进入演示控制台。生产登录接口已预留，必须接数据库用户、密码哈希、限流和企业身份认证后再上线。

## Docker 启动

```bash
cp .env.example .env
./scripts/deploy.sh
```

Docker 控制台地址为 http://localhost:4173。数据库首次启动自动执行 `database/init.sql`。

## 项目结构

```text
apps/web       React 控制台、路由与错误边界
apps/api       Fastify API 与各业务接口层
packages/core  多链类型、配置和共享契约
database       PostgreSQL 初始化结构
docker         前后端镜像
scripts        部署入口
```

## 已具备的模块边界

- EVM、Solana、TRON 统一钱包适配接口
- 批量钱包生成（开发适配器）、批量转账任务、资产归集计划
- Swap 报价接口和 GasFree 服务状态接口
- 闪电贷旧应用的 `FLASH_LOAN_URL` / `FLASH_LOAN_API_URL` 配置接入
- 项目中心、控制台、登录路由和全局错误边界
- PostgreSQL 用户、钱包、项目、任务、审计表；Redis 为任务队列与缓存预留
- API 错误统一处理、输入校验、幂等键契约和基础安全响应头

## 旧项目恢复方式

不要重写已完成模块。把最后可用版本挂入对应适配器：

1. 闪电贷：设置 `FLASH_LOAN_URL` 和 `FLASH_LOAN_API_URL`。
2. Swap：在 `apps/api/src/adapters.ts` 替换 `swapQuote`，凭据只放服务端。
3. 钱包：实现 `WalletAdapter`；生产环境严禁把私钥返回浏览器，应接 HSM/MPC/KMS。
4. GasFree：配置服务地址，并在 API 内完成鉴权、限额和审计。
5. 批处理：将 API 返回的 `queued` 任务接 Redis 队列 worker，用幂等键保证重试安全。

## 上线前安全门槛

当前钱包生成器仅用于展示适配器契约，`encryptedMaterial` 不是安全密文。接触真实资产前必须替换为审计过的链 SDK 与 HSM/MPC/KMS，并补齐：真实认证、RBAC、2FA、请求限流、CSRF/会话策略、密钥轮换、交易模拟、人工审批阈值、审计日志持久化、备份恢复和第三方安全审计。

## 验证

```bash
npm run typecheck
npm run build
curl http://localhost:3001/health
```

任何新页面都应位于 `ErrorBoundary` 内。未知路由会回到控制台，单模块异常不会造成全站白屏。
