# Fuyao API 使用经验准则

> 来源：**31 个端点全部真实调用实测**（2026-09-16，5 QPS 自限速）。
> 目的是把「怎么用这套 API」变成可执行的准则，而不是每次重新摸索。
>
> 配套文档：`FIELD-AUDIT.md`（字段适配）· `API-BENCHMARK.md`（场景对齐）·
> `DATA-SOURCING.md`（缺数据怎么补）

---

## 一、六条总则

### 准则 1：**延迟地板是 200 ms，与数据量无关**

| 调用 | 行数 | 延迟 |
|---|---|---|
| `prices_snapshot` 1 只 | 1 | 210 ms |
| `prices_snapshot` 20 只 | 20 | 198 ms |
| `prices_snapshot` **全市场** | **5,573** | **349 ms** |
| `tickers_list` 全市场 | 5,573 | 230 ms |

→ **围绕「减少请求数」设计，而不是「减少数据量」。该一次拿全市场。**

### 准则 2：**有效吞吐 4.6 QPS**

客户端自限 5 QPS。实测 56 个请求耗时 12.1 s。

> 估算公式：`耗时秒数 ≈ 请求数 ÷ 4.6`

### 准则 3：**能用 dump 就不用逐只**

| 方式 | 请求数 | 耗时 |
|---|---|---|
| `dump_daily_k_10d`（10 日增量，1.02 MB） | **1** | 1.1 s |
| `prices_historical` 逐只 | 5,573 | **≈ 20 分钟** |

`dump_*` 是全市场导出的唯一正确姿势。

### 准则 4：**批量上限必须记牢**（传多即 `code=1003`）

| 上限 | 端点 |
|---|---|
| **无上限**（`limit=10000`） | `prices_snapshot` · `tickers_list` |
| **100 只** | `auction_snapshot` · `valuations_snapshot` |
| **50 只** | `anomaly_analysis_stock` |
| **size ≤ 200** | `limit_up_pool` · `limit_break_pool` · `limit_down_pool` |
| **单只/单个** | `prices_historical` · `adjustment_factors` · `ths_index_constituents` · `financials_*` · `hot_stock_rank_trend` · `index_prices_historical` |

### 准则 5：**参数要实测，不能照文档抄**

实测踩到的坑：

| 端点 | 文档/直觉 | 实际 |
|---|---|---|
| `financials_*` | 只要 `thscode` | 还要 `period`；`indicators` 还要 `report`（`{yyyy}-{1\|2\|3\|4}`） |
| `hot_stock_rank_trend` | `start` / `end` | **`start_date` / `end_date`**，且都必需 |
| `hot_stock_list_history` | `date` 可选 | **`date` 必需**，且格式 `yyyy-MM-dd` |
| `ths_index_list` | — | 合法 tag **只有** `industry` / `cn_concept` / `region` / `tszs` |
| `prices_historical` | `start`/`end` 日期 | **毫秒时间戳**；传 `YYYYMMDD` **静默返回 0 行** |
| `auction_snapshot` | — | 单次 **100 只** |

> 这些已全部固化进 `endpoints.py` 的白名单与 `test_endpoints.py`。

### 准则 6：**响应结构不统一 —— 不要假设有 `item`**

| 结构 | 端点 |
|---|---|
| `item[]`（多数） | 行情、池、估值、日历… |
| **`stock_items[]` / `hot_money_items[]`** | **`dragon_tiger_list`** |
| `presigned_url` | `dump_*` |
| `item` 为空但 `pagination` 有信息 | `limit_break_pool` / `limit_down_pool` |

> ⚠️ `dragon_tiger_list` 的 `item` 恒为空。只读 `item` 会**永远拿到 0 行**，
> 而 HTTP 是成功的 —— 这类静默失败最难查。

---

## 二、全端点审计表

字段数 / 单请求行数 / 延迟 / 负载 为实测值；「全市场」列为覆盖全市场所需请求数。

### 行情类

| 端点 | 作用 | 字段 | 单请求行数 | 延迟 | 负载 | 全市场 | 建议频率 |
|---|---|---|---|---|---|---|---|
| `prices_snapshot` | 全市场实时行情 | 11 | **5,573**（无上限） | 349 ms | 1.3 MB | **1** | **每分钟** |
| `prices_historical` | 单只历史K线 | 7 | 1 | 200 ms | 0.3 KB | **5,573** ✗ | 仅抽查 |
| `index_prices_snapshot` | 指数实时行情 | 11 | 5 | 204 ms | 1.4 KB | 1 | 每分钟 |
| `index_prices_historical` | 指数历史K线 | 7 | 1 | 200 ms | 0.3 KB | 数百 | 按需 |

### 全市场导出（dump）

| 端点 | 作用 | 单请求 | 延迟 | 大小 | 全市场 | 建议频率 |
|---|---|---|---|---|---|---|
| `dump_daily_k_10d` | 10 日增量日K | URL | 249 ms | **1.02 MB** | **1** | **每日** |
| `dump_daily_k` | 10 年全量日K | URL | 70 ms | ≈181 MB | 1 | 一次性 |
| `dump_adjustment_factors` | 全量复权事件 | URL | 69 ms | 0.5 MB | 1 | 每月 |

> 预签名 URL 有有效期（实测约 5 分钟），**取到就立刻下载**。

### 竞价类

| 端点 | 作用 | 字段 | 单请求行数 | 延迟 | 负载 | 全市场 | 建议频率 |
|---|---|---|---|---|---|---|---|
| `auction_snapshot` | 竞价快照（含**流通市值**） | 15 | **100**（上限） | 202 ms | 38 KB | **56** | 竞价时段每分钟 |
| `auction_short_term_benchmark` | 竞价短线基准 | — | 0（非竞价时段空） | 177 ms | 0.1 KB | 1 | 9:25 后 |

> `auction_snapshot` 是**唯一**提供股本/市值的端点（`float_market_cap`）——
> 流通股本反推就靠它，见 `FIELD-AUDIT.md`。

### 特殊数据（池类）

| 端点 | 作用 | 字段 | 单请求行数 | 延迟 | 负载 | 全市场 | 建议频率 |
|---|---|---|---|---|---|---|---|
| `limit_up_pool` | 涨停池（**权威连板数**+涨停原因） | 13 | 89（`size≤200`） | 191 ms | 28 KB | **1** | 每日 |
| `limit_break_pool` | 炸板池（**含换手率**） | 8 | 0~200 | 200 ms | — | **1** | 每日 |
| `limit_down_pool` | 跌停池（**含换手率**） | 8 | 0~200 | 200 ms | — | **1** | 每日 |
| `limit_up_ladder` | 连板梯队 | 2 | 30 | 209 ms | 49 KB | **1** | 每日 |
| `hot_stock_list` | 人气榜 | 7 | 30（无参数） | 198 ms | 3.9 KB | **1** | 每日 |
| `hot_stock_list_history` | 人气榜历史 | — | 30 | 200 ms | — | 1/日 | 按需 |
| `hot_stock_rank_trend` | 单只人气趋势 | 5 | 16 | 200 ms | — | 逐只 | 按需 |
| `skyrocket_list` | 飙升榜 | 7 | 30 | 200 ms | 3.9 KB | **1** | 每日 |
| `anomaly_analysis_list` | 异动列表 | — | 0~ | 201 ms | — | 1 | 按需 |
| `anomaly_analysis_stock` | 个股异动 | — | **≤50 只** | 200 ms | — | **112** | 按需 |
| **`dragon_tiger_list`** | 龙虎榜（**含结构化 `concept_list`**） | 14 | **73** | 197 ms | 25 KB | **1** | 每日 |

> ⚠️ `dragon_tiger_list` 数据在 `stock_items[]`，不是 `item`。

### 元信息 / 分类

| 端点 | 作用 | 字段 | 单请求行数 | 延迟 | 负载 | 全市场 | 建议频率 |
|---|---|---|---|---|---|---|---|
| `tickers_list` | 证券列表 | 10 | **5,573**（无上限） | 230 ms | 1.2 MB | **1** | 每周 |
| `tickers_search` | 代码/名称搜索 | 10 | 1 | 184 ms | 0.3 KB | — | 交互 |
| `calendar_trading_days` | 交易日历 | 2 | 243 | 192 ms | 11 KB | **1** | 每年 |
| `ths_index_list` | 指数目录（4 个 tag） | 2 | 320 | 203 ms | 13 KB | **4** | 每月 |
| `ths_index_constituents` | 指数成分股 | 3 | 30 | 201 ms | 1.9 KB | **848** | 每月 |
| `valuations_snapshot` | 估值（PE/PB/PS/PCF） | 8 | **≤100 只** | 209 ms | 16 KB | **56** | 每日 |
| `adjustment_factors` | 单只复权事件 | 4 | 32 | 217 ms | 3.2 KB | **5,573** ✗ | 用 dump |
| `financials_income` | 利润表 | 21 | 4 | 203 ms | 2.3 KB | 逐只 | 按需 |
| `financials_balance` | 资产负债表 | 15 | 4 | 197 ms | 1.6 KB | 逐只 | 按需 |
| `financials_cashflow` | 现金流量表 | 14 | 4 | 197 ms | 1.8 KB | 逐只 | 按需 |
| `financials_indicators` | 财务指标 | 0 | **0（实测不可用）** | 205 ms | 1.8 KB | — | ✗ 不用 |

---

## 三、请求量预算（每日）

| 任务 | 频率 | 请求/次 | 每日请求 |
|---|---|---|---|
| 盘中全市场行情 | **每分钟 × 240 分钟** | 1 | **240** |
| 盘中指数行情 | 每分钟 | 1 | 240 |
| 盘后日增 dump + 下载 | 每日 | 1 | 1 |
| 盘后池类（涨停/炸板/跌停/梯队/人气/飙升/龙虎榜） | 每日 | 7 | 7 |
| 竞价（涨停池 + 竞价快照） | 每日 | 2 | 2 |
| 估值（全市场） | 每日 | 56 | 56 |
| **每日合计** | | | **≈ 546** |

按 4.6 QPS 摊开：盘中每分钟 2 个请求 ≈ 0.6 s，其余 66 个请求 ≈ 14 s，
**完全在预算内**（旧项目盘中 15 分钟一轮，本项目可做到每分钟）。

**低频任务**（不是每日）：

| 任务 | 频率 | 请求 |
|---|---|---|
| 标签 `stock_tag` | 每月 | **516** |
| 股本校准 | 每季 | **56** |
| 交易日历 | 每年 | 1 |
| 证券列表 | 每周 | 1 |

---

## 四、反模式清单

| ✗ 不要 | ✓ 应该 |
|---|---|
| `prices_historical` 逐只拉全市场（5,573 请求 ≈ 20 min） | `dump_daily_k_10d`（1 请求 ≈ 1 s） |
| 逐只拉行情（每只 200 ms） | `prices_snapshot?limit=10000`（全市场 349 ms） |
| `size=500` 给池类端点 | `size≤200`（否则 `code=1003`） |
| 把 6,000 只塞进 `auction_snapshot` | 分批 100 只（否则 `code=1003`） |
| 只读响应的 `item` | 先看 `dumps()` / `stock_items` / `pagination` |
| 假设 `date` 是 `YYYYMMDD` | `hot_stock_list_history`/`dragon_tiger` 要 `yyyy-MM-dd`；`prices_historical` 要**毫秒** |
| 用 `financials_indicators` | 实测 0 字段，不可用 |
| 逐只算股本（5,573 请求） | `auction_snapshot` 56 请求反推，且**每季一次**即可 |

---

## 五、仍待验证（诚实标注）

| 端点 | 状态 |
|---|---|
| `anomaly_analysis_list` | 返回 0 行，参数语义未探明（`date`/`limit`/`offset`） |
| `auction_short_term_benchmark` | 非竞价时段返回空；字段集未取到 |
| `hot_money_items` | `dragon_tiger_list` 里恒为 0（可能需 `board_type`） |
| `dragon_tiger_list` 的 `board_type` 取值 | 只试过 `all`；其它值未探明 |
| `limit_break_pool` / `limit_down_pool` | 实测当日 0 行（当日无炸板/跌停），字段集取自文档 |

---

## 六、与需求的对照

| 需求 | 目标 | 实测方案 | 结果 |
|---|---|---|---|
| 盘中持有票 1 分钟更新 | **秒级** | `prices_snapshot?limit=10000` 1 请求 | **0.35 s** ✅ |
| 盘后日级数据 | **≤ 1 分钟** | dump 1.1 s + 指标 36 s | **≈ 37 s** ✅ |
| 竞价 9:25 一进二 | 秒级 | 涨停池 + 竞价快照（2 请求） | **0.4 s** ✅ |
| 盘中全市场扫描 | — | 1 请求 | **0.35 s** ✅ |
| 概念/板块共振 | — | 本地 `stock_tag`（每月 516 请求刷新） | 读取 0 请求 ✅ |
