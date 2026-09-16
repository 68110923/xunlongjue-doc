# 寻龙诀 · 技术指标实现口径考古报告

> 代码基线：`git HEAD = 44b69a6`（2026-09-16）。工作区另有一处未提交改动
> （`xunlongjue/references/xunlongjue-mind.md`，内容为输出语言约定，与指标无关）。
> 本文所有行号均为当前工作区文件行号。
> 原则：只报告代码事实；找不到的项明确写「未找到」，不做推测。

---

## 0. 全局结论（先给对拍者）

- 全项目 **没有使用 talib / pandas_ta**；`requirements.txt:1-4` 仅 `pandas/requests/akshare/baostock`。
- 所有指标都是 **纯 Python 自算公式**（`hermes_stock_lib.py` + `data_fetcher.py`），或直接读接口字段。
- **RSI、ATR、BIAS、均线多头排列 在整个仓库（含 git 全历史）从未出现**（`git log -S` 检索为空）。
- 指标全部物化为 `daily_kline` 的列，**没有独立的指标物化表**。
- `daily_kline` 价格是 **未复权原始价**（新浪/同花顺/Baostock 指数除外），只有「60日回撤/距低点」用
  自行构造的 **pct 递推伪复权链**（`_adj_chain`），不是标准前/后复权。
- 涨停判断存在 **两套互不一致的口径**：`daily_kline.is_limit_up = pct>=9.8`（全市场统一），
  与 `afternoon_review` 的「交易所公式」（30/68 用 1.20，其余 1.10，且排除 ST）。

---

## 1. 指标清单（按计算位置）

| 指标 | 文件:行 | 库/方式 | 所在函数 |
|---|---|---|---|
| MA5 / MA10 | `xunlongjue/scripts/data_fetcher.py:284-285` | 自写 SMA 公式 | `DataFetcher._incremental_indicators` |
| MA5 / MA10 | `xunlongjue/scripts/data_fetcher.py:329-330` | 自写 SMA 公式 | `DataFetcher._full_indicators` |
| MA5 / MA10 | `xunlongjue/scripts/data_fetcher.py:687-688` | 自写 SMA 公式 | `compute_indicators` |
| MA5 / MA10 | `xunlongjue/scripts/intraday_refresh.py:22-23` | 自写 SMA 公式 | `_compute_indicators` |
| volume_ma5（5日均量） | `xunlongjue/scripts/data_fetcher.py:331-336`、`690-697` | 自写，跳过 `is_intraday` 行 | `_full_indicators` / `compute_indicators` |
| KDJ（入库） | `xunlongjue/scripts/hermes_stock_lib.py:995-1045` | 自写公式 | `compute_kdj` |
| KDJ（即算，不落库） | `xunlongjue/scripts/hermes_stock_lib.py:310-337` | 自写公式 | `calc_kdj` |
| MACD（DIF/DEA/BAR） | `xunlongjue/scripts/hermes_stock_lib.py:932-991` | 自写 EMA 递推 | `compute_macd` |
| BOLL（中/上/下/带宽/%B） | `xunlongjue/scripts/hermes_stock_lib.py:637-653` | 自写（总体标准差 /n） | `compute_boll` |
| 量比 volume_ratio | `xunlongjue/scripts/data_fetcher.py:766-780` | 自写 | `compute_volume_ratio` |
| 量比 volume_ratio | `xunlongjue/scripts/intraday_refresh.py:45-51` | 自写（同一口径的另一份） | `_compute_indicators` |
| 量比 volume_ratio | `xunlongjue/scripts/setup_backfill.py:167-171` | 自写（同一口径的另一份） | `process_stock_sina` |
| 换手率（首板真实值） | `xunlongjue/scripts/data_fetcher.py:490` | 接口字段 `row['换手率']`（akshare 涨停池） | `save_first_board_row` |
| 换手率（估算） | `xunlongjue/scripts/hermes_stock_lib.py:537-561` | 自写 `volume/circulating_shares*100` | `score_turnover` |
| 流通股本 circulating_shares | `xunlongjue/scripts/weekly_refresh_stocks_info.py:74-114` | 东财 datacenter HTTP 接口 | `fetch_circulating_shares` |
| 振幅 amplitude | `xunlongjue/scripts/hermes_stock_lib.py:813-815` | 自写 | `score_candidates` 内联 |
| 涨停 is_limit_up | `xunlongjue/scripts/data_fetcher.py:431,448,787,944`；`intraday_refresh.py:126`；`setup_backfill.py:162` | 自写 `pct>=9.8` | 多处（见 §4.6） |
| 涨停总数（另一种口径） | `xunlongjue/scripts/afternoon_review.py:335-347` | 自写交易所公式 | `AfternoonReview._build_data_block` |
| N日涨停次数 | `xunlongjue/scripts/hermes_stock_lib.py:221-232` | 自写 SQL COUNT | `count_limit_ups_in_window` |
| 连板数 | `xunlongjue/scripts/hermes_stock_lib.py:202-219` | 自写日期交叉验证 | `count_consecutive_boards` |
| 60日最大回撤 | `xunlongjue/scripts/hermes_stock_lib.py:412-462` | 自写 pct 伪复权链 | `_adj_chain` + `calc_max_drawdown` |
| 距60日低点涨幅 | `xunlongjue/scripts/hermes_stock_lib.py:465-479` | 同上 | `rise_from_low` |
| 缺口 gap_open | `xunlongjue/scripts/data_fetcher.py:422,443,788,945`；`intraday_refresh.py:99`；`setup_backfill.py:158`；`morning_push.py:173` | 自写 | 多处（见 §4.7） |
| 竞价 Gap（C1/C2） | `xunlongjue/scripts/hermes_stock_lib.py:831-855` | 自写/读竞价表 | `score_candidates` |
| MA5/MA10 消费（大盘系数） | `xunlongjue/scripts/hermes_stock_lib.py:1048-1114` | 读 `daily_kline` 列 | `get_market_coeff` |
| MA/KDJ/MACD 消费（四维评分） | `xunlongjue/scripts/market_signal.py:43-142` | 读 `daily_kline` 列 | `compute_score` |

未找到：`talib`、`pandas_ta`、`RSI`、`ATR`、`BIAS`、`均线多头排列`（§2.16）。

---

## 2. 逐指标口径

### 2.1 移动平均 MA

**周期**：只有 **5、10**（另有 20 用于 BOLL 中轨、5 用于 `volume_ma5`、300 仅作为 MACD EMA 回溯行数上限）。
没有 MA20/MA60 均线列（历史删除版 schema 曾有过 `ma20`，见 §4.10）。

**是否用 talib**：否。自写算术平均。

**不足周期时的处理**（各副本一致）：

- MA5：**用现有条数求均值**（不返回 None），公式为 `sum(最后 min(n,5) 根 close) / min(n,5)`。
  - `data_fetcher.py:284`：`ma5 = round(sum(closes[max(0,n-5):n])/min(n,5),2)`
  - `data_fetcher.py:329`、`data_fetcher.py:687`、`intraday_refresh.py:22` 同构。
- MA10：**不足 10 根返回 None**。
  - `data_fetcher.py:285`：`ma10 = round(...) if ti>=9 else None`
  - `data_fetcher.py:330`：`... if i>=9 else None`
  - `data_fetcher.py:688`：`... if i>=9 else None`
  - `intraday_refresh.py:23`：`... if n >= 10 else None`

**入库去重**：MA5 即使只有 1 根 K 线也会写入一个有值的结果；MA10 为 NULL。

---

### 2.2 KDJ

**参数**：RSV 窗口 `period=9`；K 平滑 `k_smooth=3`（即 α=1/3）；D 平滑 `d_smooth=3`（α=1/3）。
**初值**：`K=D=50.0`。J = `3K - 2D`。

**用到的库**：无，纯 Python。

**实现 A（入库主路径）** `compute_kdj`，`hermes_stock_lib.py:995-1045`：

```python
995  def compute_kdj(highs, lows, closes, mode="latest", prev_k=50.0, prev_d=50.0,
996                  period=9, k_smooth=3, d_smooth=3):
...
1012     n = len(highs)
1013     if n < period:
1014         if mode == "full":   return ([], [], [])
1016         elif mode == "latest": return (None, None, None)
1021     ak = 1 / k_smooth      # K 平滑系数
1022     ad = 1 / d_smooth      # D 平滑系数
1023     K_raw = prev_k
1024     D_raw = prev_d
...
1029     w = period - 1
1030     for i in range(w, n):
1031         h = max(highs[i - w:i + 1])
1032         l = min(lows[i - w:i + 1])
1033         rsv = (closes[i] - l) / (h - l) * 100 if h != l else 50.0
1034         K_raw = (1 - ak) * K_raw + ak * rsv
1035         D_raw = (1 - ad) * D_raw + ad * K_raw
1036         Ks[i] = round(K_raw, 2)
1037         Ds[i] = round(D_raw, 2)
1038         Js[i] = round(3 * K_raw - 2 * D_raw, 2)
```

- **RSV 分母为 0**（`h == l`）：**rsv = 50.0**（`hermes_stock_lib.py:1033`）。
- 不足 9 根：`full` 返回空 list，`latest` 返回 `(None,None,None)`（`:1013-1019`）。
- 增量模式由调用方传入前一日实际 K/D（`data_fetcher.py:288-294`、`intraday_refresh.py:28-35`）。

**实现 B（不落库、评分即算）** `calc_kdj`，`hermes_stock_lib.py:310-337`：

```python
316     if len(rows) < 9:  return None
326     if target_idx is None or target_idx < 8:  return None
328     K, D = 50.0, 50.0
329     for i in range(8, target_idx + 1):
330         window = rows[i-8:i+1]
331         high_9 = max(r['high'] for r in window)
332         low_9 = min(r['low'] for r in window)
333         close_val = window[-1]['close']
334         rsv = (close_val - low_9) / (high_9 - low_9) * 100 if high_9 != low_9 else 50.0
335         K = 2/3 * K + 1/3 * rsv
336         D = 2/3 * D + 1/3 * K
337     return round(K, 1), round(D, 1), round(3*K - 2*D, 1)
```

差异：实现 B **总是从 K=D=50 重新迭代**（不复用前日库值），且 **保留 1 位小数**（实现 A 是 2 位）。
评分函数 `score_kdj_reversal`（`hermes_stock_lib.py:340-367`）用的是实现 B。

**KDJ 闸门**（读库里的 `kdj_j` 列）：
- `gate_kdj_surge`：`hermes_stock_lib.py:370-392`，阈值 `GATE_KJ_CHG_MAX=30`（`:30`）。
- `gate_kdj_overbought`：`hermes_stock_lib.py:395-409`，J≥110 且增幅<2.5。
- 10:30 前封板豁免：`hermes_stock_lib.py:818-820`。

---

### 2.3 MACD

**参数**：`fast=12, slow=26, signal=9`（`hermes_stock_lib.py:932`）。
**BAR 是否乘 2**：**是**，`BAR = (DIF - DEA) * 2`（`:980-984`）。
**EMA 初值**：`ef = es = closes[0]`（即用首根收盘价作为快慢线共同起点，`:961-962`）。

`hermes_stock_lib.py:955-984`：

```python
955     # EMA 平滑系数
956     af = 2 / (fast + 1)
957     asl = 2 / (slow + 1)
958     asg = 2 / (signal + 1)
959
960     # EMA(fast) + EMA(slow) → DIF
961     ef = closes[0]
962     es = closes[0]
963     difs = [0.0] * m
964     for i in range(m):
965         if i > 0:
966             ef = closes[i] * af + ef * (1 - af)
967             es = closes[i] * asl + es * (1 - asl)
968         difs[i] = round(ef - es, 4)
969
970     # DEA = EMA(signal) of DIF，前 signal 个用简单均线初始化
971     deas: list[float | None] = [None] * m
972     for i in range(m):
973         if i >= signal - 1:
974             prev = deas[i - 1]
975             if prev is not None:
976                 deas[i] = round(difs[i] * asg + prev * (1 - asg), 4)
977             else:
978                 deas[i] = round(sum(difs[max(0, i - signal + 1):i + 1]) / signal, 4)
979
980     # BAR = (DIF - DEA) * 2
981     bars = []
982     for i in range(m):
983         d, de = difs[i], deas[i]
984         bars.append(round((d - de) * 2, 4) if d and de else None)
```

- 不足 `signal=9` 根：`full` 返回空，`latest` 返回 `(None,None,None)`（`:946-953`）。
- **DEA 初值**：DIF 序列的前 9 个做简单均线（`i == signal-1 == 8` 时 `deas[7]` 尚为 None，
  走 `:978` 的 SMA 分支），之后走 EMA 递推（`:975-976`）。
- **注意 `:984` 的 `if d and de`**：当 DIF 或 DEA 恰为 `0.0` 时，BAR 写 NULL（浮点真值判断）。
- 调用点与回溯窗口（口径差异见 §4.3）：
  - 全量历史：`data_fetcher.py:326`（`_full_indicators`）、`:683`（`compute_indicators`）——无行数上限。
  - 增量：`data_fetcher.py:295-301`——`LIMIT 300`。
  - 盘中：`intraday_refresh.py:12,37-39`——`MACD_LIMIT=300`。

---

### 2.4 RSI

**未找到**。全仓库无 RSI 实现、无调用、无字段（含 git 全历史 `git log -S"RSI"` 为空）。

---

### 2.5 BOLL

**周期 `n=20`、倍数 `k=2`**。标准差 **除以 n（总体标准差），不是 n-1**。

`hermes_stock_lib.py:637-653`：

```python
637  def compute_boll(closes, n=20, k=2):
638      """标准布林带计算。返回 (mid, upper, lower, width, pct_b)。
639      closes 按日期升序，需 ≥ n 条。不足返回全 None。"""
640      if not closes or len(closes) < n:
641          return None, None, None, None, None
642      cs = closes[-n:]
643      mid = sum(cs) / n
644      variance = sum((c - mid) ** 2 for c in cs) / n
645      std = variance ** 0.5
646      upper = mid + k * std
647      lower = mid - k * std
648      width = (upper - lower) / mid if mid else None
649      last = cs[-1]
650      pct_b = (last - lower) / (upper - lower) * 100 if upper != lower else None
651      return (round(mid, 2), round(upper, 2), round(lower, 2),
652              round(width, 4) if width is not None else None,
653              round(pct_b, 4) if pct_b is not None else None)
```

- 不足 20 条：全部返回 `None`（`:640-641`）。
- 只取 **最后 20 根**收盘价（`:642`），因此四条调用路径（全量/增量/盘中）结果一致。
- 评分 `score_boll`：`hermes_stock_lib.py:656-699`（读 `boll_width/boll_pct_b/boll_mid` 列）。

---

### 2.6 ATR

**未找到**。全仓库无 ATR 实现或字段（含 git 全历史）。

---

### 2.7 BIAS

**未找到**。全仓库无 BIAS 实现或字段（含 git 全历史）。

---

### 2.8 量比 volume_ratio

**分母是前 N 日均量，不含今日；N = 5。** 公式 `今日成交量 / 前5个交易日成交量均值`。

同一口径三份实现：

1. **主入库路径** `compute_volume_ratio`，`data_fetcher.py:766-780`：

```python
766  def compute_volume_ratio(db, codes, target_date):
767      """计算5日均量比，UPDATE daily_kline。多文件共用。仅算 volume_ratio IS NULL 的行。"""
768      for code in codes:
769          rows = db.execute(
770              "SELECT date, volume, volume_ratio FROM daily_kline WHERE code=? ORDER BY date", (code,)
771          ).fetchall()
772          for idx in range(5, len(rows)):
773              if rows[idx][2] is not None:  # volume_ratio 已有值，跳过
774                  continue
775              prev5_avg = sum(rows[j][1] for j in range(idx - 5, idx)) / 5
776              if prev5_avg > 0:
777                  db.execute(
778                      "UPDATE daily_kline SET volume_ratio=? WHERE code=? AND date=?",
779                      (round(rows[idx][1] / prev5_avg, 2), code, rows[idx][0]),
780                  )
```

2. 盘中 `intraday_refresh.py:45-51`：`vols = hist_rows[-5:]`（不含当日），`vr = today_volume / prev5_avg`。
3. 回填 `setup_backfill.py:167-171`：`prev5_vol = sum(enriched[j][6] for j in range(i-5,i))/5`。

- 只对表内已有的“前一连 5 行”求均值（按该股行序，非严格交易日历）。
- 三处都 **不过滤 `is_intraday`**（只有 `volume_ma5` 过滤）。
- 消费点：`score_volume_ratio`，`hermes_stock_lib.py:506-513`；硬闸 `GATE_VR_MIN=0.55`（`:27`）、
  `GATE_TURN_MIN=8.0`（`:28`），复合判定在 `:810-811`。

---

### 2.9 换手率 turnover_rate

**两条来源**：

1. **首板真实换手率**（评分/闸门用）：来自 akshare 涨停池接口字段 **`换手率`**，写入
   `first_boards.turnover`：`data_fetcher.py:490`（`row.get('换手率')`），写库语句 `:482-495`。
2. **估算换手率**（无 `first_boards` 时，回测兜底）：`score_turnover`，`hermes_stock_lib.py:537-561`：

```python
543     if turnover is not None:
544         t = float(turnover)
545     else:
546         if not volume or not close or close == 0: return 0
547         if code:
548             r = StockDB.query_one(
549                 "SELECT circulating_shares FROM stocks_info WHERE code=?", (code,))
550             if r and r[0]:
551                 t = volume / r[0] * 100
552             else:
553                 t = volume / close / 1e6
554         else:
555             t = volume / close / 1e6
```

**流通股本来源**：`stocks_info.circulating_shares`，由 **东方财富 datacenter 接口**批量拉取，
`weekly_refresh_stocks_info.py:74-114`：

```python
77      url = 'https://datacenter.eastmoney.com/securities/api/data/v1/get'
84          params = {
85              'reportName': 'RPT_F10_EH_EQUITY',
86              'columns': 'SECUCODE,TOTAL_SHARES,UNLIMITED_SHARES,LISTED_A_SHARES',
87              'filter': f'(SECUCODE+like+"{prefix}%.{exchange}")',
...
105                     'circulating_shares': (d.get('LISTED_A_SHARES')
106                                            or d.get('UNLIMITED_SHARES')),
```

- 具体字段名：**`SECUCODE`、`TOTAL_SHARES`（总股本）、`UNLIMITED_SHARES`（无限售）、
  `LISTED_A_SHARES`（流通 A 股）**；`circulating_shares` 优先取 `LISTED_A_SHARES`，缺失回退 `UNLIMITED_SHARES`。
- `total_cap/float_cap = 股数 × 最新非盘中收盘价`：`weekly_refresh_stocks_info.py:184-188`
  （最新价取自 `fetch_latest_close`，`:58-71`，条件是 `is_intraday=0`）。
- **`daily_kline.turnover` 实际上是空的**：实时行情 `fetch_realtime` 里 `'turnover':None`
  （`data_fetcher.py:228-229`），写库 `q.get('turnover')`（`:430`）。这与 README 旧更新日志
  “新浪实时自带换手率”矛盾（见 §5）。
- 文档佐证：`references/mingri-guancha-workflow.md:286` 明确写“⚠️ turnover 不可靠（有异常值）换手用 first_boards”。

---

### 2.10 振幅 amplitude

**公式**：`振幅% = (首板日最高价 - 首板日最低价) / 首板日前收盘价 × 100`。

`hermes_stock_lib.py:813-815`（`score_candidates` 内联）：

```python
813             if fb_high and fb_low and fb_prev and fb_prev > 0:
814                 amp = (fb_high - fb_low) / fb_prev * 100
815                 if amp > GATE_AMP_MAX: continue
```

- 数据源是 `daily_kline` 首板日的 `high/low/prev_close`（`:797-803`），**不是** `first_boards`。
- 阈值 `GATE_AMP_MAX = 13.6`（`:29`）。无独立函数，仅此一处实现。

---

### 2.11 涨停判断 is_limit_up

**自算为主（统一 9.8%），另有一处接口/交易所口径**。

自算副本（全部 `pct >= 9.8`）：

| 位置 | 代码 |
|---|---|
| `data_fetcher.py:431` | `1 if pct>=9.8 else 0`（实时批量写） |
| `data_fetcher.py:448` | `1 if pct>=9.8 else 0`（单股K线写） |
| `data_fetcher.py:787` | `is_limit_up = CASE WHEN pct >= 9.8 THEN 1 ELSE 0 END` |
| `data_fetcher.py:944` | `is_limit_up = CASE WHEN pct >= 9.8 THEN 1 ELSE 0 END` |
| `intraday_refresh.py:126` | `1 if pct >= 9.8 else 0` |
| `setup_backfill.py:162` | `is_lu = 1 if pct >= 9.8 else 0` |

另一套（仅用于复盘“涨停总数/跌停”统计）`afternoon_review.py:335-347`：

```python
335         # 涨停总数（交易所公式：close >= ROUND(prev_close × 涨幅限制, 2)）
336         _zt_limit = (
337             "CASE WHEN dk.code LIKE '30%' OR dk.code LIKE '68%' THEN 1.20 "
338             "ELSE 1.10 END"
339         )
340         zt_count = StockDB.query_one(
341             f"SELECT COUNT(DISTINCT dk.code) FROM daily_kline dk "
342             f"JOIN stocks_info si ON dk.code = si.code "
343             f"WHERE dk.date=? AND dk.close >= ROUND(dk.prev_close * {_zt_limit}, 2) "
344             f"AND dk.prev_close > 0 AND si.name NOT LIKE '%ST%'",
345             (review_date,)
346         )[0]
```

跌停同理 `afternoon_review.py:349-366`：`30%/68% → 0.80`，其余 `0.90`，排除 ST。

**逐项回答**：

- 是自算还是来自接口：`first_boards` 整体来自 akshare 涨停池接口（`data_fetcher.py:161-175`）；
  `daily_kline.is_limit_up` 是自算。
- 涨停比例怎么定：`daily_kline` 一律 **9.8%**；复盘统计用 **1.20 / 1.10**。**没有 5%（ST）、30%（北交所）**。
- 是否区分 ST：**`is_limit_up` 不区分**；仅 `afternoon_review` 统计时 `si.name NOT LIKE '%ST%'`（`:344`），
  以及 `weekly_refresh_stocks_info.py:117-119,176` 把 ST 标 `is_active=0`。
- 是否区分创业板/科创板/北交所：`is_limit_up` **不区分**（全部 9.8%）；仅复盘统计区分 30/68（1.20）。
  **北交所完全未覆盖**：`_codes()` 只取 `60/00/30/68`（`data_fetcher.py:45-58`），
  `first_boards` 只存 `60/00`（`data_fetcher.py:173`）。
- 是否处理新股首日：**未处理**。`ipo_date` 只被 `weekly_refresh_stocks_info.py` 写入/统计
  （`:38,175,207,219,247`），任何指标/闸门计算都未读取。

---

### 2.12 N 日涨停次数

**唯一实现**：`count_limit_ups_in_window`，`hermes_stock_lib.py:221-232`。

```python
221  def count_limit_ups_in_window(code, end_date, db, window=GATE_LU_DENSE_WINDOW):
222      """统计 end_date 往前 window 个交易日（含 end_date）内涨停天数。
223      用于涨停密集闸：断板反包型高标（窗口内多次涨停）直接排除。
224      """
225      start = prev_trading_day(end_date, window - 1)
226      if not start:
227          return 0
228      r = db.execute(
229          "SELECT COUNT(*) FROM daily_kline WHERE code=? AND date>=? AND date<=? AND is_limit_up=1",
230          (code, start, end_date),
231      ).fetchone()
232      return r[0] if r else 0
```

- **N = `GATE_LU_DENSE_WINDOW = 4`**（`:34`）；**窗口含今日**（`date<=end_date`，起点是往前 3 个交易日）。
- 计数口径：`daily_kline.is_limit_up=1`（允许中间断板）。
- 闸门判定：窗口内 ≥ `GATE_LU_DENSE_MIN = 3` → 杀（`hermes_stock_lib.py:829`）。

---

### 2.13 距 N 日高低点

**只有“距低点”，没有“距高点”函数。** `rise_from_low`，`hermes_stock_lib.py:465-479`：

```python
465  def rise_from_low(code, fb_date, db, lookback=GATE_DRAWDOWN_LOOKBACK):
466      """首板收盘价相对 lookback 个交易日内最低点的涨幅（%）。
...
471      """
472      chain = _adj_chain(code, fb_date, db, lookback)
473      if not chain:
474          return 999.0
475      lo = min(x[3] for x in chain)
476      cur = chain[-1][1]
477      if not lo:
478          return 999.0
479      return round((cur - lo) / lo * 100, 1)
```

- **N = `GATE_DRAWDOWN_LOOKBACK = 60`**（`:31`）。
- 公式：`(首板日复权收盘 - 窗口内最低复权 low) / 最低复权 low × 100`。
  由于复权链把区间末收盘定为 100，`cur` 恒为 100（见 §2.14）。
- 数据不足（<10 根）返回 **999.0**。
- 消费：`hermes_stock_lib.py:825-826`——回撤>48% 时，若距低涨幅>25%（`GATE_RISE_MAX`）则杀，否则豁免。

另有回测里的“7 日最佳涨幅”（不是本项）：`backtest.py:256-279`（`_calc_7d_best`，竞价开盘→未来 7 个交易日内最高收盘）。

---

### 2.14 60 日最大回撤（重点）

**定义（代码事实）**：在 `[首板日往前 60 个交易日, 首板日]` 区间（含首板日，实际最多 61 根 K 线）内，
用 **pct 递推伪复权链** 把区间末收盘归一为 100，然后
**先在复权 high 上取全窗口最高点 D1，再在 D1 之后取复权 low 的最低点 D2**，
回撤 = `(1 - adj_low[D2] / adj_high[D1]) × 100`。
即 **“窗口内最高点到其后最低点的跌幅”**，不是“当前价相对窗口最高点”，也不是逐日滑窗。
峰值取 **日内最高价**、谷值取 **日内最低价**（日内极值，不是收盘）；**若最高点落在窗口最后一根则返回 0.0**。
基于 **伪复权链**（原始 OHLC 按 pct 递推缩放），非标准前/后复权，也不是完全原始价。

**完整实现**（`hermes_stock_lib.py:412-479`）：

```python
412  def _adj_chain(code, end_date, db, lookback):
413      """pct复权链：返回 [(date, adj_close, adj_high, adj_low)] 或 None。
414
415      以区间最后一根收盘为基准100，逐日按 pct 递推，除权跳变被 pct 自动消化。
416      先算日期区间（prev_trading_day 保证 lookback 个交易日），禁止 LIMIT 直取。
417      不足10根K线返回 None。
418      """
419      start = prev_trading_day(end_date, lookback)
420      if not start:
421          return None
422      rows = db.execute(
423          "SELECT date, high, low, close, pct FROM daily_kline "
424          "WHERE code=? AND date>=? AND date<=? AND is_intraday=0 "
425          "AND close > 0 AND high > 0 AND low > 0 ORDER BY date",
426          (code, start, end_date)
427      ).fetchall()
428      if len(rows) < 10:
429          return None
430      n = len(rows)
431      P = [0.0] * n
432      P[-1] = 100.0
433      for i in range(n - 2, -1, -1):
434          pct = rows[i + 1][4]
435          if pct is not None and pct > -90:
436              P[i] = P[i + 1] / (1 + pct / 100)
437          else:
438              P[i] = P[i + 1]
439      return [(rows[i][0], P[i], P[i] * rows[i][1] / rows[i][3], P[i] * rows[i][2] / rows[i][3])
440              for i in range(n)]
441
442
443  def calc_max_drawdown(code, fb_date, db, lookback=GATE_DRAWDOWN_LOOKBACK):
444      """首板日前 lookback 个交易日内的最大回撤（%）。
445
446      口径（pct 复权链 + 三段连乘，自动消化除权）：
447        1. 复权日内最高价找最高点 D1，D1 之后复权日内最低价找最低点 D2
448        2. 回撤 = 1 - (close[D1]/high[D1])          ← 最高点日 高→收
449                     × Π(1+pct[t]) t∈(D1+1..D2-1)  ← 中间逐日连乘
450                     × (low[D2]/close[D2-1])        ← 最低点日 前收→低
451          三段连乘化简 = 复权最低/复权最高，比例在复权下不变。
452      数据不足/最高点在末尾时返回 0。
453      """
454      chain = _adj_chain(code, fb_date, db, lookback)
455      if not chain:
456          return 0.0
457      n = len(chain)
458      d1 = max(range(n), key=lambda i: chain[i][2])
459      if d1 >= n - 1:
460          return 0.0  # 最高点在窗口末尾，无后续下跌段
461      d2 = min(range(d1 + 1, n), key=lambda i: chain[i][3])
462      return round((1 - chain[d2][3] / chain[d1][2]) * 100, 1)
463
464
465  def rise_from_low(code, fb_date, db, lookback=GATE_DRAWDOWN_LOOKBACK):
...
472      chain = _adj_chain(code, fb_date, db, lookback)
473      if not chain:
474          return 999.0
475      lo = min(x[3] for x in chain)
476      cur = chain[-1][1]
477      if not lo:
478          return 999.0
479      return round((cur - lo) / lo * 100, 1)
```

**对拍要点**：

- 算法：**一次 `max`/`min` 极值扫描（纯 Python 循环 + 列表推导），非滑窗逐日、非 numpy、非累积最大值**。
- 窗口：`start = prev_trading_day(fb_date, 60)`，查询 `date>=start AND date<=fb_date`，
  **含首板日本身 → 最多 61 根**。`_adj_chain` docstring（`:416-417`）与 `strategy.md:189`
  均表述为“前 60 个交易日”，实际实现含端点，共 61 格，需按端点对齐。
- 最低 10 根 K 线：不足 → `_adj_chain` 返回 None → 回撤返回 **0.0**（闸门放行），距低返回 **999.0**。
- 过滤：`is_intraday=0`，且 `close/high/low > 0`。
- 复权链递推：`P[i] = P[i+1] / (1 + pct[i+1]/100)`；`pct <= -90` 或 NULL 时 `P[i]=P[i+1]`（不缩放）。
- 缩放后：`adj_high = P[i] · high[i] / close[i]`，`adj_low = P[i] · low[i] / close[i]`，`adj_close = P[i]`。
- 峰值 `d1` 取 **第一个** 最大值（`max` 返回首个）；`d1 == n-1` → 0.0。
- 谷值只在 `d1` **严格之后** 搜索（`range(d1+1, n)`），取 **第一个** 最小值。
- 阈值：`GATE_MAX_DRAWDOWN = 48`（`:32`）；豁免 `GATE_RISE_MAX = 25`（`:33`）。
- 消费：`score_candidates`，`hermes_stock_lib.py:825-826`；实盘/回测同源（文档 `strategy.md:192`）。

---

### 2.15 缺口 gap

有 **两个不同含义的 gap**，均为百分比：

1. **开盘缺口 `gap_open`**（存库列）：`(open - prev_close) / prev_close × 100`。
   - `data_fetcher.py:422`（实时批量）、`:443`（单股K线）、`:788`（`compute_derived_fields`）、
     `:945`（`_ensure_kline_impl`）
   - `intraday_refresh.py:99`、`setup_backfill.py:158`、`morning_push.py:173`
   - 未使用“是否回补缺口”的逻辑，只是当日开盘跳空百分比。
2. **竞价 Gap（C1/C2 判定用）**：`score_candidates`，`hermes_stock_lib.py:831-855`：
   - 优先用 `auction_snapshots.gap`（`:834-836`）；
   - 否则用竞价日 `daily_kline` 的 `(open-prev_close)/prev_close`（`:837-846`）；
   - 否则退回首板日 `gap_open`（`:847-851`）。
   - C2（未直接封死涨停）：`open < round(prev_close × 1.1, 2) - 0.01`（`:836,844,849`）。
   - 分区：一区 `4.80<=gap<=7.9`，二区 `2.83<=gap<4.80`（`:853-855`）。

---

### 2.16 均线多头排列

**未找到**。全仓库（含 git 全历史 `git log -S"多头排列"`）无任何“均线多头排列/多头排列”实现、
字段或判定。`market_signal.py:240` 的“多头强势”只是评分文案，不是均线排列判定。

---

### 2.17 连板数

**自算为主（日期交叉验证），`stat` 字段被明确标注为不可靠**。

`count_consecutive_boards`，`hermes_stock_lib.py:202-219`：

```python
202  def count_consecutive_boards(code, target_date, db):
203      """日期交叉验证真实连板数（含target_date当日）。
204      往前推到不在first_boards为止，返回连续涨停天数。
205      """
206      boards = 0
207      check_date = target_date
208      while True:
209          r = db.execute(
210              "SELECT 1 FROM first_boards WHERE date=? AND code=? AND pct>9.5",
211              (check_date, code)
212          ).fetchone()
213          if not r:
214              break
215          boards += 1
216          check_date = prev_trading_day(check_date, 1)
217          if not check_date:
218              break
219      return boards
```

- 数据源：`first_boards`（接口派生的涨停池），判定用 **`pct>9.5`**（不是 `daily_kline.is_limit_up`）。
- 消费：`morning_push.py:254-258`（板块龙头高度）、`:370`（multi_board）、
  `afternoon_review.py:266`（三分类）。
- 接口 `stat` 字段来自 akshare `涨停统计`（`data_fetcher.py:492`），仅作展示
  （`morning_push.py:363` 用 `SUBSTR(stat,1,1)>='2'` 粗筛，`:372` 展示）。
- 文档明确踩坑：`SKILL.md:30`、`references/mingri-guancha-workflow.md:317`、
  `references/cron-prompt-templates.md:274-281`（`stat='6/3'` 被错误解析的实例）。

---

## 3. 数据来源

### 3.1 输入表与接口

| 表 | 内容 | 写入来源 | 位置 |
|---|---|---|---|
| `daily_kline` | 日 K + 全部指标列 | 新浪 K 线接口（主）/ 同花顺（兜底）/ Baostock（指数） | `data_fetcher.py:452-466`、`:874-896`、`:509-541`、`:550-594` |
| `first_boards` | 每日首板池 | akshare `stock_zt_pool_em(date=...)` | `data_fetcher.py:164-175`；`setup_backfill.py:245-258` |
| `stocks_info` | 名称/行业/股本/市值 | Baostock（basic/industry）+ 东财 datacenter（股本） | `weekly_refresh_stocks_info.py:22-114` |
| `auction_snapshots` | 竞价快照 | 新浪实时（`hq.sinajs.cn`）/ 由 daily_kline 回填 | `morning_push.py:170-188`；`setup_backfill.py:360-377` |
| `daily_screen` | 推送桥接表 | `morning_push._analyze_and_score` | `morning_push.py:266-293` |

**具体接口/字段**：

- 新浪 K 线：`https://quotes.sina.cn/cn/api/jsonp_v2.php/.../getKLineData?symbol=...&scale=240&ma=no&datalen=150`
  （`data_fetcher.py:452-464`，默认 `DATALEN=150`，`:33`）。
  回填脚本用另一个域名 `money.finance.sina.com.cn/.../CN_MarketData.getKLineData?...datalen=600`
  （`setup_backfill.py:99-126`，`SINA_DATALEN=600`，`:33`）。
- 新浪实时：`https://hq.sinajs.cn/list=...`，33 字段顺序见 `SINA_FIELDS`（`data_fetcher.py:189-197`）；
  **注释明确新浪实时无换手率字段**（`:186-188`）。
- 同花顺：`http://d.10jqka.com.cn/v2/line/hs_{code}/01/last.js`（`data_fetcher.py:509-541`）。
- Baostock 指数：`query_history_k_data_plus(code,'date,open,high,low,close,volume,amount',
  start_date='2023-01-01', frequency='d', adjustflag='2')`（`data_fetcher.py:556-560`），注释“前复权”。
- akshare 涨停池：`ak.stock_zt_pool_em(date=date)`（`data_fetcher.py:166`；`setup_backfill.py:246`）。
- 东财流通股本：`https://datacenter.eastmoney.com/securities/api/data/v1/get`，
  `reportName=RPT_F10_EH_EQUITY`（`weekly_refresh_stocks_info.py:77-107`）。
- 交易日历：akshare `tool_trade_date_hist_sina()`，缓存 `.trade_cal.json`（`hermes_stock_lib.py:163-176`）。

**日期范围（实盘库快照）**：`daily_kline` 为 `19960716 ~ 20260916`（5593 个不同日期）；
`first_boards` 为 `20250103 ~ 20260916`；`auction_snapshots` / `daily_screen` / `stocks_info` 行数
分别约 117701 / 1640 / 5557。指标计算不设全局日期下限，按 `prev_trading_day` 动态取窗。

### 3.2 价格复权

- `daily_kline` 的 `open/high/low/close` 来自新浪/同花顺/Baostock 指数，**均为原始未复权价**
  （Baostock 指数用 `adjustflag='2'`＝前复权，`data_fetcher.py:560`）。
- **全项目没有标准前复权/后复权计算函数**（无 `qfq/hfq/adjust` 关键字）。
- 唯一“复权”是 §2.14 的自建 **pct 递推伪复权链** `_adj_chain`（`hermes_stock_lib.py:412-440`），
  仅用于 `calc_max_drawdown` / `rise_from_low`，以区间末收盘=100 向前递推。
- 其余评分（`market_signal.compute_score`、`score_boll`、`score_macd`、`score_kdj_reversal` 等）
  直接使用库中原始价，**不跨除权处理**。

### 3.3 物化表

- **没有独立指标物化表**。指标全部作为列落在 `daily_kline`，由 `schema.sql` 定义：

```
schema.sql:12-46   daily_kline
  schema.sql:25-27   volume_ratio, raw_json, turnover
  schema.sql:29-30   ma5, ma10
  schema.sql:31-33   kdj_k, kdj_d, kdj_j
  schema.sql:34-36   macd_dif, macd_dea, macd_bar
  schema.sql:37-38   volume_ma5, is_intraday
  schema.sql:40-44   boll_mid, boll_upper, boll_lower, boll_width, boll_pct_b
  schema.sql:23-24   is_limit_up, gap_open
```

- 建表唯一真源是 `schema.sql`：`data_fetcher.py:23-27,378-403`（`ensure_all_tables`）、
  `setup_backfill.py:43-58`（`ensure_schema`）。
- **实盘 DB 里存在两张 schema.sql 未定义、README 声称已删除的表**：`daily_review`、
  `strategy_optimizations`（README.md:441「删除 `daily_review`+`strategy_optimizations`」）。
  两者与指标无关，但新项目对拍 schema 时会遇到。
- 指标刷新入口：`_full_indicators`（`data_fetcher.py:311-356`，仅供 `setup_backfill.py:383` 首次部署）、
  `_incremental_indicators`（`:268-309`）、`compute_indicators`（`:625-723`）、
  `intraday_refresh.main`（`:56-132`）、`compute_volume_ratio`（`:766-780`）。

---

## 4. 重复实现

### 4.1 MA5 / MA10 —— 4 份副本

| # | 位置 | 函数 | 差异 |
|---|---|---|---|
| 1 | `data_fetcher.py:284-285` | `_incremental_indicators` | ma5 部分均值；ma10 `if ti>=9 else None`；只取最近 20 行 |
| 2 | `data_fetcher.py:329-330` | `_full_indicators` | ma5 部分均值；ma10 `if i>=9 else None`；全历史 |
| 3 | `data_fetcher.py:687-688` | `compute_indicators` | 同上 |
| 4 | `intraday_refresh.py:22-23` | `_compute_indicators` | ma5 部分均值；ma10 `if n>=10 else None` |

口径 **一致**（公式等价，仅取值窗口/行数不同）。注意 ma5 在不足 5 根时是部分均值，不是 None。

### 4.2 KDJ —— 2 份副本（口径有差异）

| # | 位置 | 函数 | 初值 | 小数位 | 用途 |
|---|---|---|---|---|---|
| 1 | `hermes_stock_lib.py:995-1045` | `compute_kdj` | 可传 `prev_k/prev_d`（默认 50） | 2 位 | 写库 |
| 2 | `hermes_stock_lib.py:310-337` | `calc_kdj` | 固定 50，总是重算 | 1 位 | 评分 |

RSV 分母为 0 的处理两处一致（都取 50.0）。**差异会体现在小数位上**（例如 K=52.345：
实现 A 存 52.35，实现 B 参与评分为 52.3）。

### 4.3 MACD —— 1 份函数、3 种输入窗口（口径潜在差异）

唯一函数 `compute_macd`（`hermes_stock_lib.py:932-991`），但 EMA 是递归且以 `closes[0]` 为种子，
不同调用传入的起始行不同：

- 全量：`data_fetcher.py:326`、`:683` —— **无 LIMIT，含全部历史**（部分指数自 1996 年）。
- 增量：`data_fetcher.py:295-301` —— `LIMIT 300`。
- 盘中：`intraday_refresh.py:12,38` —— `MACD_LIMIT=300`。

理论上 300 根后 EMA 已收敛，但严格逐值对拍时 **新上市不足 300 根的股票** 或在早期行上，
全量与增量/盘中的 DIF/DEA 可能不等。

### 4.4 BOLL —— 1 份函数、4 个调用点（口径一致）

`compute_boll` 在 `data_fetcher.py:286,344,704` 与 `intraday_refresh.py:43` 调用；
因为函数内部固定取 `closes[-20:]`，结果一致。

### 4.5 volume_ratio —— 3 份副本（口径一致）

`data_fetcher.py:766-780`、`intraday_refresh.py:45-51`、`setup_backfill.py:167-171`。
分母都是前 5 个交易日（不含今日）。
差异：`compute_volume_ratio` 跳过已非空行（`:773`）；另两处总是计算/仅在插入新行时计算。

### 4.6 is_limit_up —— 6 份同口径 + 1 份不同口径

同口径 `pct>=9.8`：`data_fetcher.py:431,448,787,944`；`intraday_refresh.py:126`；`setup_backfill.py:162`。
不同口径：`afternoon_review.py:335-347`（30/68→1.20，其余 1.10，排除 ST）与 `:349-366`（跌停 0.80/0.90）。
**同一个“涨停”概念在项目里有两种互斥定义。**

### 4.7 gap_open —— 7 份副本（口径一致）

`data_fetcher.py:422,443,788,945`；`intraday_refresh.py:99`；`setup_backfill.py:158`；`morning_push.py:173`。
公式统一 `(open-prev_close)/prev_close*100`。另有评分用竞价 Gap（`hermes_stock_lib.py:831-855`）语义不同。

### 4.8 换手率 —— 2 条不同来源

`first_boards.turnover`（接口 `换手率`，`data_fetcher.py:490`）
vs `score_turnover` 估算（`hermes_stock_lib.py:537-561`，`volume/circulating_shares*100`，
兜底 `volume/close/1e6`）。`daily_kline.turnover` 仍存在但实为 NULL。

### 4.9 连板数 —— 3 条路径

1. `count_consecutive_boards`（`hermes_stock_lib.py:202-219`，`first_boards.pct>9.5`，当前真源）。
2. akshare `stat` 字段（`data_fetcher.py:492`；`morning_push.py:363`）。
3. 复盘 DATA_BLOCK 用 `count_consecutive_boards`（`afternoon_review.py:266`）。
文档明确要求禁用 `stat` 解析（`cron-prompt-templates.md:274-281`）。

### 4.10 历史已删除的重复实现（git 考古）

| 文件 | 删除提交 | 与现状的口径差异 |
|---|---|---|
| `xunlongjue/scripts/_backfill_boll.py` | `8312be0`「删除 _backfill_boll.py」 | 独立 BOLL 全量补算循环，复用 `compute_boll`，口径一致；已被 `_full_indicators` 取代 |
| `scripts/backtest_hist.py` | `280cd1a`「统一回测脚本 + 删重复代码」 | 自带 `calc_kdj`（同公式、±3 封顶）、`score_gap`（阈值 2.85/4.0/6.0/8.0）、`score_volume_ratio`（≤0.8→+10）、`score_turnover_est`、振幅<12%、股价<50。**与现行口径全部不同** |
| `scripts/backtest_one_to_two.py` | `280cd1a` | 早期一进二回测，重复评分/闸门 |
| `scripts/backfill_data.py` | `f36f8fd` 等 | 自带 `is_limit_up=CASE pct>=9.8`、`gap_open`、`volume_ratio` SQL 更新 |
| `scripts/backfill_historical.py` | `f36f8fd` 等 | 自带 `is_limit_up`/`gap_open`/`volume_ratio`；旧 schema 曾含 **`ma20`** 列（现 schema 已无） |
| `scripts/retry_failed.py` | `f36f8fd` 等 | 失败重试回填 |

`xunlongjue/scripts/__pycache__/` 仍留有上述脚本的 `.pyc`（`_backfill_boll`、`backfill_data`、
`backfill_historical`、`backtest_hist`、`backtest_one_to_two`、`retry_failed`），源码已删。

> 另注：`first_boards` 写入存在口径不一致——实时路径只存 `60/00`
> （`data_fetcher.py:173`），回填路径 `setup_backfill.backfill_first_boards` 不过滤（`:238-260`）。

---

## 5. 已知问题（与指标计算相关）

### 5.1 代码注释/文档中明确的缺陷

1. **回测 `_calc_pct` 跨除权失真**
   - `SKILL.md:44`：「回测 `_calc_pct` 用全局最新收盘价，跨除权日会失真」。
   - 对应代码 `backtest.py:247-253`（总涨跌 = 全局 `latest_close` ÷ 竞价开盘价，不做复权）。
   - **引用失效**：该行指向的 `references/known-issues.md` 在仓库中不存在
     （`git log --all -- '*known-issues.md'` 为空）；`SKILL.md:54` 引用的
     `references/gate-checklist.md` 同样不存在。
2. **`daily_kline.turnover` 不可靠**
   - `references/mingri-guancha-workflow.md:286`：「⚠️ turnover 不可靠（有异常值）换手用 first_boards」。
   - `references/mingri-guancha-workflow.md:317` 踩坑清单第 4 条同义。
3. **`stat` 字段不可靠**
   - `SKILL.md:30`、`references/mingri-guancha-workflow.md:317`、
     `references/cron-prompt-templates.md:274-281`（含 `stat='6/3'` 误判实例）。
4. **实时行情换手率字段错位（历史 bug，已修）**
   - `README.md:336`：「修复盘中行情换手率字段错位问题（原误读盘口挂单量）」。
   - 现行代码 `data_fetcher.py:186-188,228-229` 注释明确新浪实时无换手率，直接置 `None`。
5. **文档与代码不一致（对拍时以代码为准）**：
   - `references/strategy.md:38` `ANALYSIS_WINDOW_DAYS=30` vs 代码 `hermes_stock_lib.py:58` **60**；
     `strategy.md:11` 也写「30 天」。
   - `references/strategy.md:98-101` 封板时间评分写 `≤9:35 +20` 等，代码 `score_seal_time`
     `hermes_stock_lib.py:613-622` 是 **-15~+15**。
   - `references/strategy.md:224-232` 换手率评分表 vs 代码 `score_turnover`
     `hermes_stock_lib.py:556-561`（代码实际：3~20→+5；20~25 且 VR<1.5→+5，否则 -5；其余 -5）。
   - `references/strategy.md:292` 写 `s_boll` 范围「-20 ~ +10」，代码 `score_boll`
     `hermes_stock_lib.py:656-699` 实际可到 +14 / -14。
   - `references/strategy.md:1` 标注「最后更新 2026-08-21」，晚于其后的阈值调整
     （README.md:330-331、:479、:512）。
6. **README 旧更新日志与代码矛盾**
   - `README.md:557`：「`fetch_realtime()` 捕获新浪行情自带的换手率并入库」；
     现行代码 `data_fetcher.py:228-229` 明确写「新浪实时不提供换手率，置 None」。
   - `README.md:441`：「删除 `daily_review` + `strategy_optimizations`」；
     实盘 DB 仍存在这两张表（`.schema` 可查），且不在 `schema.sql` 中。
7. **未收口的 TODO/FIXME**：全仓库 `*.py` **无 TODO/FIXME/XXX/HACK 注释**（grep 为空），
   已知缺陷只存在于上述 Markdown 文档与代码注释中。
8. **盘中数据污染面**：只有 `volume_ma5` 显式跳过 `is_intraday=1`
   （`data_fetcher.py:324-336,690-697`），`_adj_chain` 显式过滤（`hermes_stock_lib.py:424`），
   而 `compute_volume_ratio`（`:766-780`）、MA/KDJ/MACD/BOLL 的全量/增量路径 **都不过滤 `is_intraday`**；
   `references/mingri-guancha-workflow.md:319` 提醒「盘中数据是快照，收盘定局前会变，标注盘中口径」。

### 5.2 口径层面的结构性风险（代码事实，非主观建议）

- 涨停定义二义性（§4.6）：`is_limit_up=1`（9.8%）与复盘统计（1.20/1.10、排 ST）会对同一日给出不同涨停集合。
- 北交所（4xx/8xx/920）完全未纳入取数与首板池（`data_fetcher.py:45-58,173`），涨停比例无 30% 分支。
- 新股首日无特殊处理（`ipo_date` 仅入库未参与计算）。
- 回撤窗口端点：代码含首板日、最多 61 根，文档写“前 60 个交易日”（`strategy.md:189`、`_adj_chain` docstring `:416`）。
- MACD EMA 种子随回溯窗口变化（§4.3）。
- KDJ 两实现小数位不同（§4.2）。
