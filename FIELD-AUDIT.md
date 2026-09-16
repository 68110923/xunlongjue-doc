# 字段适配审计：声明的 schema vs Fuyao 接口实际返回

> 方法：逐个端点真实调用，把返回字段与 `schema.py` 声明做**双向差集**。
> 触发原因：`limit_up_pool.turnover_ratio_pct` 等字段是**凭文档想象出来的**，
> 接口并不返回。白名单能防「参数名写错」，但防不住「字段名编造」。

## 一、结论：股本 / 市值，Fuyao 能给什么

**Fuyao 全部 31 个端点的实测结果**：

| 端点 | 批量能力 | 含股本/市值？ |
|---|---|---|
| `prices/snapshot` | ✅ 1 请求全市场 5,573 行 | ❌ 11 字段，无 |
| `valuations/snapshot` | ✅ 批量 | ❌ 只有 PE/PB/PS/PCF |
| `tickers/list` | ✅ 批量 | ❌ 10 字段，无 |
| `financials/balance-sheets` | 逐只 | ❌ 15 个**汇总**字段，无股本 |
| `financials/indicators` | 逐只 | ❌ 实测**全部报表期返回 0 字段**（不可用） |
| **`auction/snapshot`** | ⚠️ **限 100 只/请求** | ✅ **有 `float_market_cap`** |

**所以：Fuyao 不直接给股本，但给流通市值。按 `DATA-SOURCING.md` 的优先级：**

```
① Fuyao 批量取   auction/snapshot.float_market_cap     ← 直接就是「流通市值」
② 批量算         流通股本 = float_market_cap / last_price
                 换手率  = 成交量 / 流通股本 × 100
                 市值    = 股本(as of t) × 收盘(t)      ← 用时算，不落库
```

**精度**：`float_market_cap / last_price` 反推流通股本实测 **1,250,081,601 股**
vs 真实 1,256,197,800 股 → **差 0.49%**。
原因是接口计算市值用的价格与同一条记录里的 `last_price` 不同步。

> 0.49% 的误差对**换手率**（阈值 8%）与**市值闸**（55亿/1000亿）可接受，
> 但**不能用它做精确对账**。股本只在送转/增发时变，可用
> `adjust_events.per_share_bonus` 校正（`DATA-SOURCING.md` §实战推演）。

**请求量**：全市场 5,573 只 ÷ 100 = **56 请求 ≈ 12 秒**（5 QPS）。
只取持仓 20 只则 **1 个请求**。

## 二、修正的字段（实测依据）

| 表 | 问题 | 修正 |
|---|---|---|
| `auction` | `auction_phase` / `data_status` **接口不返回**（编造） | 删除；补 `ticker` / `name` |
| `snapshot` | 漏 `ticker` | 补 |
| `index_snapshot` | 漏 `ticker` / `price_change` / `prev_price` / `turnover` | 补 4 个 |
| `limit_down_pool` | 漏 `turnover_ratio_pct` / `first_limit_time` / `last_limit_time` | 补 3 个 |
| `symbol` | 漏 `last_delivery_date` | 补 |
| `limit_up_pool` | 原声明有 `turnover_ratio_pct` —— **实测接口不返回** | 保留字段但加注释说明需「算」；见 §三 |

## 三、⚠️ 涨停池没有换手率（与炸板池/跌停池不对称）

实测：

| 端点 | 字段数 | 有 `turnover_ratio_pct`？ |
|---|---|---|
| `limit_up_pool` | 13 | ❌ **没有**（换 `date_ms`/`size` 都没有） |
| `limit_break_pool` | 8 | ✅ 有 |
| `limit_down_pool` | 8 | ✅ 有 |

旧项目的换手率来自 akshare 涨停池（`first_boards.turnover`）。
**Fuyao 涨停池没有这个字段**，所以必须按优先级自己算：

```
换手率 = 当日成交量 ÷ 流通股本 × 100
         ① kline_daily（盘后）或 prices/snapshot（盘中，1 请求全市场）
         ② auction.float_market_cap / last_price（1 请求 / 100 只）
```

## 四、白名单的两个盲区（都要补）

1. **字段名编造**：白名单只管**参数**，不管**返回字段**。
   → 本审计脚本应常态化（或至少在灌入后断言「实际字段 ⊇ 声明字段」）
2. **参数白名单不全**：`financials_*` 系列漏了必需的 `period`
   （`financials_indicators` 还漏 `report`，格式 `{yyyy}-{1|2|3|4}`），
   导致**端点被自己的白名单锁死**。
   → 白名单必须**以实测为准**，不能只照文档抄

## 五、未验证项

| 端点 | 状态 |
|---|---|
| `dragon_tiger_list` | `date=YYYY-MM-DD` 合法但**全部日期返回 0 行**；`board_type=1` 非法。字段集待定 |
| `limit_up_ladder` | 参数待查（`size`/`date_ms` 均非法） |
| `anomaly_analysis_list` | 参数待查 |
| `financials_indicators` | 实测不可用（0 字段） |
