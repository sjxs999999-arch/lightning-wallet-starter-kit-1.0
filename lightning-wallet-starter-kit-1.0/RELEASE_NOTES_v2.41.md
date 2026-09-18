# Lightning Wallet v2.41.0

## Swap quote correctness and safety

- TRON Token 精度改为从公开 TRON RPC 的 `decimals()` 常量调用自动读取；用户不能再手填错误精度后继续报价。
- SUN.io 报价区分执行所需的原子单位与用户可读数量，展示 Token symbol、预计收到与滑点后最低收到。
- SUN.io `impact` 按比例转换为百分比；超过现有 5% 风险上限的路线会在进入钱包签名前被拦截。
- 当路由缺少目标 Token 的可靠 USD 估值时，页面明确标记为池内兑换数量，不把它描述为美元市场价。
- EVM、Solana 与 TRON 的买卖两端精度均由对应链 RPC 独立验证；聚合器元数据只作一致性校验，不能决定签名确认页的金额单位。
- EVM 原生币哨兵按链安全映射为 18 位精度与 ETH/BNB/POL，不对无合约地址调用 `decimals()`。
- 主 API 和 Vercel 备用 API 保持相同的 decimals、显示金额与价格影响校验；公开元数据接口使用限流和有界缓存。
- 兼容仍在浏览器中打开的 v2.40 页面：缺少 `sellDecimals` 时由服务端链上补齐，不会在后端先发布期间全部返回 400。

## Verification

- 增加 TRC-20、ERC-20、SPL Token 精度解析测试。
- 增加 30 USDT 正确报价、错误 18 位输入拒绝、99.95% 价格影响阻断、最低收到格式化测试。
- 主网交易开关保持关闭，直到外部 Provider、钱包验收与链上意图验证全部满足生产门禁。
