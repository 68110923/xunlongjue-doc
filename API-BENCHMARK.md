# Fuyao API 批量能力基准

> 全部为**真实调用实测**（2026-09-16，5 QPS 自限速）。
> 目的：回答「这套 API 能不能支撑盘中秒级 + 盘后 1 分钟 + 竞价一进二」。

---

## 0. 结论速览

| 场景 | 目标 | 实测 | 余量 |
|---|---|---|---|
| **盘中持仓更新** | 秒级 | **0.198 s**（20 只，1 请求） | 5× |
| **盘中全市场扫描** | — | **0.349 s**（5,573 只，1 请求） | — |
| **盘后日级增量** | ≤ 60 s | **下载 1.1 s（1.02 MB）+ 指标 36 s ≈ 37 s** | 1.6× |
| **竞价一进二（9:25）** | 秒级 | **1 + ⌈N/100⌉ 请求 × 0.2 s** | ✓ |

**关键发现：单请求延迟几乎与数据量无关** ——
20 只 198 ms，全市场 5,573 只 349 ms。地板是网络往返（约 200 ms）。
所以**该一次拿全市场，而不是逐只拿**。

---

## 1. 延迟地板

| 调用 | 行数 | 中位延迟 | 最大 |
|---|---|---|---|
| `prices_snapshot`（1 只） | 1 | 210 ms | — |
| `prices_snapshot`（20 只） | 20 | **198 ms** | 202 ms |
| `prices_snapshot`（`limit=10000`，**全市场**） | 5,573 | **349 ms** | 498 ms |
| `index_prices_snapshot`（4 个指数） | 4 | 222 ms | — |
| `hot_stock_list` | 30 | 196 ms | — |
| `valuations_snapshot`（100 只） | 100 | 198 ms | — |
| `limit_up_pool`（`size=200`） | 89 | 201 ms | 205 ms |
| `auction_snapshot`（100 只） | 100 | 189 ms | 214 ms |

> 全市场比 20 只只多 150 ms（多传 1.1 MB）。**逐只取是纯浪费。**

---

## 2. 各端点批量上限（实测确定）

| 端点 | 上限 | 依据 |
|---|---|---|
| `prices_snapshot` | **无上限**（`limit=10000` 可行） | 1 请求全市场 5,573 行 |
| `index_prices_snapshot` | 未见上限 | 指数只有几百个 |
| `auction_snapshot` | **100 只/请求** | 101 只 → `code=1003 thscodes count must not exceed 100` |
| `valuations_snapshot` | **100 只/请求** | 500 只 → 同上 |
| `limit_up_pool` | **size 1–200** | 300 → `code=1003 size must be between 1 and 200` |
| `limit_break_pool` | **size 1–200** | 同上 |
| `limit_down_pool` | **size 1–200** | 同上 |
| `hot_stock_list` | 固定 30（无参数） | 传 `size` 会被白名单拒 |
| `tickers_list` | `limit=10000` 可行 | 5,573 行 / 0.33 s |
| `ths_index_list` | 按 tag 全量 | industry 320 / cn_concept 390 / region 33 / tzs 105 |
| `ths_index_constituents` | **单个指数，不可批量** | 逗号 → `code=1002` |
| `dump_daily_k_10d` | 全市场 10 日增量 | **1.02 MB** |
| `dump_daily_k` | 全市场 10 年全量 | 约 181 MB（回填实测） |

**限速**：客户端自限 5 QPS。实测 `share_capital` 56 请求耗时 12.1 s
→ 有效 **4.6 QPS**。所以 `请求数 ÷ 4.6 ≈ 秒数`。

---

## 3. 场景实测

### 3.1 盘中：持仓 1 分钟级更新（要求秒级）✅

```
1 请求  prices_snapshot?thscodes=<持仓>      →  198 ms
```

**但更好的做法：一次拿全市场**（`limit=10000`，349 ms）。
理由：
- 持仓可能随时变（买入/卖出），逐只拼串要维护状态
- 全市场还顺带给了候选池、板块、指数的实时值
- 只多 150 ms

**盘中每分钟的完整方案**（1 + 1 请求 ≈ 0.6 s）：

```
prices_snapshot?limit=10000         349 ms   全市场个股
index_prices_snapshot?thscodes=…    222 ms   主要指数
```

> 不调 `auction_snapshot`（盘中无意义）、不调 `valuations_snapshot`
> （估值盘中不变）。

### 3.2 盘后：日级增量（要求 ≤ 1 分钟）✅

```
① dump_daily_k_10d 取 URL            0.32 s
② 下载 1.02 MB                       0.80 s   (1.3 MB/s)
③ 解析 + 压实                        ~2 s
④ 全市场指标重算 + 物化              36 s      ← 主成本
⑤ 参考数据（股本/标签，非每日）        —
────────────────────────────────────────────
合计                                ≈ 39 s     ✅ 余量 1.6×
```

**为什么用 10 日增量而不是「逐只拉当天」**：
- 增量 dump 自带 **10 交易日重叠窗口** → 漏跑自动补、重复跑靠主键去重
- 1 个请求 vs 5,573 个请求

> ⚠️ 重叠窗口意味着每次写入产生 10 个版本 —— **必须压实**，
> 否则读取线性变慢（实测 201 版本 → 16.6 倍）。

### 3.3 竞价 9:25：一进二 ✅

```
① limit_up_pool?size=200           201 ms   昨日涨停池（89 行，含权威连板数）
② auction_snapshot?thscodes=<候选>  189 ms   候选的竞价数据
   （候选 > 100 只时每 100 只加 1 个请求）
────────────────────────────────────────────
典型（候选 ≤ 100）                 ≈ 0.4 s
```

竞价快照字段（15 个，实测）：`auction_price` / `auction_pct` /
`auction_volume` / `auction_amount` / `auction_unmatched` /
**`auction_turnover_pct`**（竞价换手率）/ `auction_yesterday_ratio_pct` /
`auction_volume_ratio` / `pre_close_price` / `open_price` / `last_price` /
**`float_market_cap`** / `ticker` / `name` / `thscode`

> ⚠️ 9:15–9:25 是集合竞价，9:25 出结果 —— 一进二决策窗口是
> **9:25–9:30 这 5 分钟**。上表 0.4 s 完全够反复拉。

### 3.4 盘中需要全市场时（若策略要扫描）

```
prices_snapshot?limit=10000   349 ms   → 5,573 行
```

**不要**用 `prices_historical` 逐只（5,573 请求 ≈ 20 分钟，见 §5）。

---

## 4. 请求量总表（各任务）

| 任务 | 频率 | 请求数 | 耗时 | 备注 |
|---|---|---|---|---|
| 盘中行情（全市场） | **每分钟** | **2** | 0.6 s | 个股 + 指数 |
| 盘后日增 dump | 每日 | **1** | 0.3 s | URL |
| + 下载 | 每日 | — | 0.8 s | 1.02 MB |
| 盘后指标物化 | 每日 | **0** | 36 s | 纯本地计算 |
| 竞价一进二 | 每日 | **2** | 0.4 s | 涨停池 + 竞价 |
| 股本校准 `share_capital` | **每季** | **56** | 12.1 s | auction 反推 |
| 标签 `stock_tag` | **每月** | **516** | 110 s | 反向接口不存在，无法再降 |
| 证券列表 `symbol` | 每周 | **1** | 0.3 s | |

**每日合计请求 ≈ 5 次**（含盘中 240 次 × 2 = 480 次/日）——
远低于限速，且每分钟只占 0.6 s。

---

## 5. 不可用 / 慎用的端点

| 端点 | 问题 |
|---|---|
| `prices_historical` | **只接受单只** thscode；`start`/`end` 是毫秒戳；全市场需 5,573 请求 ≈ 20 分钟。**只用于抽查校验** |
| `financials_*` | 逐只；`financials_indicators` 实测全部报表期返回 0 字段（不可用） |
| `ths_index_constituents` | 单指数、不可批量 → 标签摄入 516 请求的原因 |
| `dragon_tiger_list` | 全部日期返回 0 行；字段集待验证 |
| `limit_up_ladder` / `anomaly_analysis_*` | 参数未探明 |

---

## 6. 与 2C2G 的关系

| 项 | 值 | 说明 |
|---|---|---|
| 盘中常驻进程内存 | **~25 MB** | 只要不 import pandas/duckdb（见 `RUNTIME-BASELINE.md` R5） |
| 每分钟 CPU | **< 1 ms** | 只是比大小（浮盈 / 距止损线 / 破板） |
| 盘后批作业峰值 | ~904 MB | 与其他常驻服务错峰 |
| 磁盘/日 | 1.02 MB(dump) + ~1.5 MB(快照) | 见 §7 |

**结论：单请求延迟是网络地板（200 ms），与数据量无关 —— 方案要围绕
「减少请求数」而非「减少数据量」设计。**
