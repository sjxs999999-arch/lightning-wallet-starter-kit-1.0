import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, ShieldCheck } from "lucide-react";
import { parseUnits } from "ethers";
import { executeSwap } from "./executor";
import { validateImpact, validateSlippage } from "./guard";
import { loadSwapHistory, saveSwapHistory } from "./history";
import { bestRoute } from "./routing";
import type {
  SwapCandidate,
  SwapChain,
  SwapHistory,
  SwapRequest,
} from "./types";
export function Swap() {
  const [chain, setChain] = useState<SwapChain>("EVM"),
    [taker, setTaker] = useState(""),
    [sellToken, setSellToken] = useState(""),
    [buyToken, setBuyToken] = useState(""),
    [amount, setAmount] = useState(""),
    [decimals, setDecimals] = useState(18),
    [slippage, setSlippage] = useState(0.5),
    [dryRun, setDryRun] = useState(true),
    [autoRefresh, setAutoRefresh] = useState(true),
    [quotes, setQuotes] = useState<SwapCandidate[]>([]),
    [selected, setSelected] = useState<SwapCandidate | null>(null),
    [history, setHistory] = useState<SwapHistory[]>(loadSwapHistory),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [lastUpdated, setLastUpdated] = useState("");
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => () => workerRef.current?.terminate(), []);
  function request(): SwapRequest {
    return {
      chain,
      ...(chain === "EVM" ? { chainId: 1 } : {}),
      sellToken,
      buyToken,
      sellAmount: parseUnits(amount, decimals).toString(),
      taker,
      slippageBps: validateSlippage(slippage),
    };
  }
  function quote() {
    setError("");
    setQuotes([]);
    setSelected(null);
    try {
      const input = request(),
        started = performance.now(),
        worker = new Worker(new URL("./quote.worker.ts", import.meta.url), {
          type: "module",
        });
      workerRef.current = worker;
      setBusy(true);
      worker.onmessage = (event: MessageEvent) => {
        setBusy(false);
        worker.terminate();
        workerRef.current = null;
        if (event.data.type === "error") {
          setError(event.data.message);
          return;
        }
        try {
          const candidates = event.data.candidates as SwapCandidate[],
            best = bestRoute(candidates);
          validateImpact(best.priceImpactPct);
          setQuotes(candidates);
          setSelected(best);
          setElapsed(Math.round(performance.now() - started));
          setLastUpdated(new Date().toLocaleTimeString());
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "报价验证失败");
        }
      };
      worker.onerror = () => {
        setBusy(false);
        setError("报价 Worker 异常；页面其他功能不受影响");
        worker.terminate();
        workerRef.current = null;
      };
      worker.postMessage(input);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Swap 参数无效");
    }
  }
  useEffect(() => {
    if (!autoRefresh || !selected) return;
    const timer = setInterval(quote, 30_000);
    return () => clearInterval(timer);
  }, [
    autoRefresh,
    selected?.provider,
    chain,
    taker,
    sellToken,
    buyToken,
    amount,
    decimals,
    slippage,
  ]);
  async function run() {
    if (!selected) return;
    let item: SwapHistory;
    try {
      const input = request();
      validateImpact(selected.priceImpactPct);
      if (dryRun)
        item = {
          at: new Date().toISOString(),
          chain,
          provider: selected.provider,
          sellToken,
          buyToken,
          amountIn: selected.amountIn,
          amountOut: selected.amountOut,
          dryRun: true,
          status: "simulated",
        };
      else {
        const txHash = await executeSwap(input, selected);
        item = {
          at: new Date().toISOString(),
          chain,
          provider: selected.provider,
          sellToken,
          buyToken,
          amountIn: selected.amountIn,
          amountOut: selected.amountOut,
          dryRun: false,
          status: "submitted",
          txHash,
        };
      }
      setHistory(saveSwapHistory(item));
      setError("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Swap 失败";
      setError(message);
      setHistory(
        saveSwapHistory({
          at: new Date().toISOString(),
          chain,
          provider: selected.provider,
          sellToken,
          buyToken,
          amountIn: selected.amountIn,
          amountOut: selected.amountOut,
          dryRun,
          status: "failed",
          error: message,
        }),
      );
    }
  }
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">MULTICHAIN ROUTE AGGREGATOR</p>
          <h1>闪电兑换</h1>
          <p>比较聚合报价、价格影响与滑点后，由钱包完成签名。</p>
        </div>
      </div>
      <div className="grid">
        <section className="panel form-panel">
          <h3>Swap 参数</h3>
          <label>
            网络
            <select
              value={chain}
              onChange={(e) => {
                setChain(e.target.value as SwapChain);
                setQuotes([]);
                setSelected(null);
              }}
            >
              <option>EVM</option>
              <option value="SOL">Solana</option>
              <option>TRON</option>
            </select>
          </label>
          <label>
            钱包地址
            <input
              value={taker}
              onChange={(e) => setTaker(e.target.value.trim())}
              placeholder="公开签名地址"
            />
          </label>
          <label>
            卖出 Token
            <input
              value={sellToken}
              onChange={(e) => setSellToken(e.target.value.trim())}
              placeholder="Token 地址或 Mint"
            />
          </label>
          <label>
            买入 Token
            <input
              value={buyToken}
              onChange={(e) => setBuyToken(e.target.value.trim())}
              placeholder="Token 地址或 Mint"
            />
          </label>
          <div className="swap-pair">
            <label>
              卖出数量
              <input
                value={amount}
                inputMode="decimal"
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label>
              Decimals
              <input
                type="number"
                min="0"
                max="30"
                value={decimals}
                onChange={(e) => setDecimals(Number(e.target.value))}
              />
            </label>
          </div>
          <label>
            滑点：{slippage}%
            <input
              type="range"
              min="0.1"
              max="5"
              step="0.1"
              value={slippage}
              onChange={(e) => setSlippage(Number(e.target.value))}
            />
          </label>
          <label className="dry-run">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
            />{" "}
            Dry Run（默认开启）
          </label>
          <label className="dry-run">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />{" "}
            每 30 秒自动刷新报价 · 最后更新 {lastUpdated || "尚未报价"}
          </label>
          <div className="notice">
            <ShieldCheck size={18} />
            不接收私钥；Approve 使用精确卖出量，真实 Swap 必须由钱包确认。
          </div>
          {error && <div className="batch-error">{error}</div>}
          <button
            onClick={quote}
            disabled={busy || !taker || !sellToken || !buyToken || !amount}
          >
            {busy ? "聚合报价中…" : "获取最优报价"}
          </button>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h3>聚合报价</h3>
            <span>
              {quotes.length} 条 · {elapsed} ms
            </span>
          </div>
          {selected ? (
            <>
              <div className="best-route">
                <small>BEST ROUTE · {selected.provider}</small>
                <strong>{selected.amountOut}</strong>
                <p>最低收到 {selected.minReceived}</p>
                <p>价格影响 {selected.priceImpactPct.toFixed(4)}%</p>
                <code>{selected.route.join(" → ") || "Direct"}</code>
              </div>
              <div className="quote-list">
                {quotes.map((item, index) => (
                  <button
                    className={item === selected ? "selected" : ""}
                    key={`${item.provider}-${index}`}
                    onClick={() => {
                      try {
                        validateImpact(item.priceImpactPct);
                        setSelected(item);
                      } catch (cause) {
                        setError(
                          cause instanceof Error ? cause.message : "高风险报价",
                        );
                      }
                    }}
                  >
                    <b>{item.provider}</b>
                    <span>{item.amountOut}</span>
                    <small>{item.priceImpactPct.toFixed(3)}%</small>
                  </button>
                ))}
              </div>
              <button className="swap-submit" onClick={() => void run()}>
                {dryRun ? "运行 Dry Run" : "Approve 并 Swap"}
              </button>
            </>
          ) : (
            <div className="mini-empty">
              <ArrowLeftRight />
              <p>输入 Token 和数量获取实时聚合报价</p>
            </div>
          )}
        </section>
      </div>
      <section className="panel swap-history">
        <div className="panel-head">
          <h3>Swap 历史</h3>
          <span>{history.length} 条</span>
        </div>
        {history.map((item, index) => (
          <div key={`${item.at}-${index}`}>
            <b>
              {item.chain} · {item.provider} · {item.status}
            </b>
            <code>
              {item.amountIn} → {item.amountOut}
            </code>
            <small>{item.txHash ?? item.error ?? item.at}</small>
          </div>
        ))}
      </section>
    </>
  );
}
