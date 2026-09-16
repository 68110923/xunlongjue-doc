# 从旧项目借用的**已验证方案**

> 原则（2026-09-16 明确）：**遇事不决就看老版本**。代码写得烂，但方案思路
> 经过时间与真实场景验证。**借鉴方案，不照搬实现。**
>
> 旧项目来源：`/root/xunlongjue`，调度见 `DEPLOY.md:123-239`。

---

## 1. 指标物化 —— 旧项目一直在做

`data_fetcher.py` 把指标**直接算成 `daily_kline` 的列**
（`ma5/ma10/kdj_k/d/j/macd_dif/dea/bar/boll_*/volume_ma5/volume_ratio/gap_open`）。

**借鉴**：盘后算一次、物化，消费方直接读。
**不照搬**：不物化进事实表 —— 旧项目因此「改个参数就要全表重写」。
本项目落独立表 `calc/indicator_daily`（按日分区，重跑只重写当天）。

## 2. 盘中重算需要多少历史 —— 旧项目给了答案

`intraday_refresh.py`：

```
MACD_LIMIT = 300      # MACD EMA 所需历史行数
KDJ_WINDOW = 8        # KDJ 9 日窗口
VR_DAYS = 5           # 量比前 5 日均量
BATCH = 800           # 实时行情批量
```

流程：**拉实时行情 → 读一次历史K线 → 内存算今日一根 → 一次性写库**。

**借鉴**：`warmup_bars=250`（旧项目用 300，本实现 250 已足够，误差 <1e-9）。
**验证**：「盘中重算只需数百根，不是全量」——本文档与 `INDICATORS.md` §7.2 的结论一致。

## 3. 「临时日K」的正确语义 —— **同主键 upsert**

```sql
INSERT INTO daily_kline (...) ON CONFLICT(code,date) DO UPDATE SET ...
```

```
盘中：写同日期的临时值 + is_intraday=1
收盘：官方值 upsert 覆盖同一条，is_intraday=0
```

**借鉴**：临时日K 不是**追加**，是**同主键覆盖**。消费者查到的永远是「该日最新状态」。
**本项目的等价实现**：Parquet 不能 upsert → 用**压实**（`lake/compact.py`）达到同样效果。
但**盘中每 15 分钟压一次当年分区太浪费**（每次重写 17~24 MB）→
改为**当日 staging + 收盘一次合并**（`TRADING-MODULE-DESIGN.md` §6.2 已如此设计）。

**不照搬的教训**：旧项目虽写了 `is_intraday=1`，但 MA/KDJ/MACD/BOLL 的计算路径
**都不过滤它**（只有 `volume_ma5` 过滤）→ 盘中行污染指标。本项目用
`is_intraday` 等价机制时，**必须让读取路径显式选状态**，否则就是同一个坑。

## 4. 维表是「只读静态表，写入口唯一」

`README.md:549`：「stocks_info 重构 — 统一为**只读静态表**，写入口唯一：
`weekly_refresh_stocks_info.py`（每周六全量刷新）」

调度：`0 0 * * 6`（每周六 0 点全量刷新）。

**借鉴**：`symbol` 表照此办理 —— 单一写入口、只读消费、每周刷新。
**改进**：旧项目把 `total_cap`/`float_cap` 也塞进这张静态表
（`total_cap = 总股本 × 最新非盘中收盘`）。实盘够用，但
**回测拿今天的市值判 2020 年的票 = 前视偏差**。

本项目改为：
- `symbol` **只放慢变维度**（身份 / 生命周期 / 行业 / 地域）
- **股本** → `share_capital`（带 `effective_date` 的点对点序列）
- **市值** → 不落库，`股本(as of t) × 收盘(t)` 现算

## 5. 股本数据来源 —— 东财批量，约 20 秒

`weekly_refresh_stocks_info.py::fetch_circulating_shares`：

```python
reportName = 'RPT_F10_EH_EQUITY'
columns = 'SECUCODE,TOTAL_SHARES,UNLIMITED_SHARES,LISTED_A_SHARES'
# 按前缀 60/688/00/30 分 4 批，pageSize=5000，按 END_DATE 倒序取最新
circulating = LISTED_A_SHARES or UNLIMITED_SHARES
```

**借鉴**：直接可用。全市场约 20 秒（4 个请求）。
**改进**：旧项目只取**最新一期**（快照）→ 本项目落成带 `effective_date` 的序列，
送转变化由 `adjust_events.per_share_bonus` **自动派生**（0 请求），
季度用东财校准一次。详见 `DATA-SOURCING.md`。

## 6. 调度节奏（已验证）

| 任务 | cron | 说明 |
|---|---|---|
| 盘中实时K线刷新 | `*/15 9-11,13-14 * * 1-5` | 每 15 分钟 |
| 每日一进二推送 | `25 9 * * 1-5` | 竞价出结果后 |
| 收盘复盘 | `2 15 * * 1-5` | |
| 维表全量刷新 | `0 0 * * 6` | 每周六 |

**借鉴**：M5 的 cron 设计直接沿用这套节奏。注意 `*/15 9-11,13-14` 的写法
（避开 11:30–13:00 休市与 15:00 后）。

## 7. 不要照搬清单

| 旧项目做法 | 为什么不学 |
|---|---|
| 指标物化进 `daily_kline` 列 | 改参数要全表重写 |
| `stocks_info` 存市值 | 快变量当慢变量 → 回测前视偏差 |
| `is_intraday` 标记了但读取不过滤 | 盘中行污染指标（已知缺陷） |
| 60 日回撤用 pct 伪复权链 | 实际未复权，实测最大偏差 34pp |
| 涨停用 `pct >= 9.8` 全市场一刀切 | 创业板/科创板/北交所/ST 全错 |
| 同一指标 4 处副本 | MA5 有 4 份、量比 3 份、is_limit_up 6+1 份 |
