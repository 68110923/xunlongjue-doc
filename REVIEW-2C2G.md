# 整体 Review：2 核 2G 运行基线

> 触发原因：**「最终目标需支持 2C2G 服务器流畅运行」** 是一个此前从未写进
> 设计文档的约束（`xunlongjue-pro-PLAN.md`、`REFACTOR-REVIEW.md`、
> 旧项目 `DEPLOY.md` 都没有任何服务器规格要求）。
> 因此本实现的内存/CPU 从未按预算校验过。本文件是最新一次实测的结果。
>
> 结论：**当前实现在 2C2G 上跑不起来**，但有低代价且同时能修掉
> 「版本累积」问题的解法。

---

## 1. 实测：2C2G 约束下的失败矩阵

约束模拟：进程 `RLIMIT_AS = 1.5 GB`（留 0.5 GB 给 OS），DuckDB
`threads=2` / `memory_limit=900MB`（2 核）。

| 工作负载 | 结果 |
|---|---|
| 全市场单日指标 | ✗ DuckDB OOM（**1.7 秒就挂**） |
| 全市场近 1 月 | ✗ DuckDB OOM |
| 复权因子构建 | ✗ DuckDB OOM |
| `SELECT DISTINCT thscode FROM v_daily_qfq` | ✗ DuckDB OOM |
| `SELECT count(*) FROM v_kline_daily` | ✗ 0.95 G（顶到限额，随时可能崩） |

**第一步 `_universe()` 就挂** —— 后面的指标计算根本没机会跑。

---

## 2. 四个架构级问题

### 问题 1（最严重）：读时去重是内存杀手

`v_kline_daily` 用 `QUALIFY row_number() OVER (PARTITION BY thscode, date
ORDER BY ingested_at DESC)=1` 做读时去重 —— **任何**查询都要先把 1,029 万行排序。

| 查询 | 耗时 | 峰值内存 |
|---|---|---|
| 裸扫 `read_parquet` | 0.0 s | **0.07 G** |
| 加读时去重 | 3.5 s | **0.95 G** |
| `DISTINCT thscode` 裸扫 | 0.1 s | 0.08 G |
| `DISTINCT thscode` 经去重视图 | 3.3 s | 0.95 G |

**内存 13 倍、耗时从 0 秒变 3.5 秒**，而且这是每一次查询的固定代价。

**根因是设计层面的**：Parquet 不能 upsert，所以把「幂等」推到了读时。
但代价被低估了 —— 它把一个 O(1) 内存的流式扫描变成了全表排序。

**修法：把去重从读时搬到写时（压实）。**

单年分区只有 17~24 MB，重写整年代价极低。实测把 10 年全量压实一遍
**22.4 秒 / 180.6 MB**。

压实后 `v_kline_daily` 退化为纯 `read_parquet`：

| | 修前 | 修后（实测） |
|---|---|---|
| `DISTINCT thscode` | 3.3 s / 0.95 G | **0.08 s / 0.08 G** |

**这一步同时解决另一个问题**：版本累积导致的读放大（实测 201 个版本 →
16.6 倍慢）也不存在了，因为物理行 == 逻辑行。

> 设计文档 `REFACTOR-REVIEW.md` §6.4 已写「Parquet 小文件：按周/月 compact」，
> 但把它定位成**性能优化**。实际上它是 **2C2G 能否运行的前提**，
> 而且与「读时去重」是**互斥的两种方案**——两者同时存在等于白做压实。

### 问题 2：复权因子按日物化 → 每次查询重做 1,029 万行 JOIN

`calc/adjust_factor_daily` 是**每个 (股票, 交易日) 一行** = 10,292,420 行。
`v_daily_qfq` 于是要 JOIN 10.29M × 10.29M。

实测（压实湖上）：`SELECT DISTINCT thscode FROM v_daily_qfq` = **2.09 s**，
而 `v_kline_daily` 只要 0.08 s。

**修法：只烘焙「累计缩放」`cum_scale`，不烘焙因子。**

```
cum_scale(t) = C_t                    ← 只在除权日变化，历史值永不改变
qfq(t)       = raw(t) × C_last / C_t  ← C_last 是每股一个数（5,564 行）
```

把 `cum_scale` 作为**一列**烘焙进压实后的 kline Parquet（写时算一次），
`C_last` 用一张 5,564 行的小表。于是：

- `v_daily_qfq` 变成 `kline JOIN last_scale USING (thscode)` —— 10.29M × **5,564**
- 新事件到达时**历史行不需要重写**（`cum_scale` 不变），只有 `C_last` 变
- 前复权「每次新除权都重算全历史」的问题也一并消失

### 问题 3：ASOF JOIN 的输入太大

`AdjustFactorBuilder._compute_events` 用
`src_events ASOF JOIN src_kline`（5.7 万 × 1,029 万行），在 2C2G 下 OOM。

**修法**：先用**小表**求「除权日的前一交易日」，再等值 JOIN 回 kline：

```sql
cal  AS (SELECT date, lag(date) OVER (ORDER BY date) AS prev_date
         FROM (SELECT DISTINCT date FROM src_kline)),        -- 约 2,400 行
need AS (SELECT e.*, c.prev_date
         FROM src_events e ASOF JOIN cal c ON e.ex_date >= c.date)  -- 5.7 万 × 2,400
SELECT ... FROM need JOIN src_kline k
  ON k.thscode = need.thscode AND k.date = need.prev_date        -- 等值 hash join
```

### 问题 4：DuckDB 从未设过内存/线程上限

全代码库 `grep memory_limit` 为空 —— **默认会用满所有内存、所有核**。
在 15 GB 的开发机上没暴露，在 2C2G 上必然被 OOM killer 杀。

另外 `AdjustFactorBuilder.build()` 自建 `duckdb.connect()`，**不接受调用方的限额**。

**修法**：把 `memory_limit` / `threads` 变成一等配置（按 `CPU 核数 × 内存`
自动推导），所有 `duckdb.connect()` 统一走一个工厂函数。

---

## 3. 与旧项目的对比：该借鉴什么

旧项目用 **SQLite（712 MB，带索引）**。在 2C2G 上它反而更稳：

| | 旧项目 SQLite | 本实现 Parquet + 读时去重 |
|---|---|---|
| `SELECT DISTINCT code` | 索引扫描，O(1) 内存 | 全表排序，0.95 G |
| 单行查询 | 索引，毫秒 | 取决于视图 |
| 追加写入 | INSERT，事务 | append 文件（快，但产生版本） |
| 磁盘 | 679~712 MB | 180 MB |

**该借鉴的是「读取代价预先付掉」这个思路**，不是 SQLite 本身：

- 旧项目靠**索引**把重活挡在写入时
- 我们应靠**压实 + 烘焙**达到同样效果

本实现在归档（不可变 Parquet）和复权正确性上明显优于旧项目，
但**缺了旧项目那层「预计算的读取服务」**。

> ⚠️ 不要照搬的部分：旧项目的 `daily_kline` 把指标物化成列
> （`ma5/kdj_*/macd_*/boll_*`），改参数就要全表重写。我们用视图按需算，
> 这一点保持。

---

## 4. 逐层 review

### 4.1 入库逻辑

| 环节 | 现状 | 问题 |
|---|---|---|
| dump 下载 | 181 MB 落 `downloads/` 缓存 | **缓存从不清理**，实测占 173 MB（近一半磁盘） |
| 转换 → Parquet | 按 `dt=YYYY` 分区 | 每次写入产生新版本，**无压实** |
| 幂等 | 读时按主键取最新 | 见问题 1 |
| 摄入校验 | 未实现 | §6.6 要求「行数在预期区间」，M2 对账只做了一次性比对，**未做成常驻校验** |

### 4.2 取数逻辑

| 环节 | 现状 | 评价 |
|---|---|---|
| 限流 | 5 QPS + 指数退避 | ✓ |
| 参数校验 | 名字白名单 + 取值白名单 + 毫秒格式 | ✓（已修两个静默陷阱） |
| 缓存 | 仅 dump 有本地缓存 | 盘中每轮 1 请求，无需缓存 ✓ |
| 降级 | 未见 fallback | 设计 §6.10 要求「保留新浪/东财作 fallback」，**未实现** |

### 4.3 计算指标逻辑

口径正确性已充分验证（见 `INDICATORS.md` §8）：独立实现对拍 214,588 点零差异、
复权保收益 0.0000pp、参考价与交易所吻合到分。

**问题只在内存**：全市场单日 45.1 s / 1.08 GB。压实 + 烘焙后需重测。

### 4.4 功能现状

| 阶段 | 状态 |
|---|---|
| M0 脚手架 / M1 数据层 / M2 灌入+对账 / M3 计算层 | ✅ 完成 |
| M4 策略层 / M5 作业调度 / M6 代理契约 / M7 备份演练 / M8 切流 | ⬜ 未开始 |
| D1 交付文档 / T1~T5 交易模块 / W1~W8 网站 | ⬜ 未开始 |

**约 4 / 12 个阶段。**

---

## 5. 设计文档需要的修改

| # | 文档 | 修改 |
|---|---|---|
| 1 | **全部** | 新增「**运行环境基线**」章节：2 核 / 2 GB / 磁盘下限 / 峰值内存预算 |
| 2 | `REFACTOR-REVIEW.md` §6.4 | 压实从「优化」升级为「**运行前提**」；写明「压实 ⟺ 可去掉读时去重」 |
| 3 | `REFACTOR-REVIEW.md` D1 | DuckDB 内存引擎**必须**配 `memory_limit`/`threads`，否则 2C2G 必崩 |
| 4 | `xunlongjue-pro-PLAN.md` §5.3 | 复权因子改为**烘焙 `cum_scale` + `C_last` 小表**，不再按日物化 1,029 万行 |
| 5 | `xunlongjue-pro-PLAN.md` M5 | 新增**压实作业**（日K按年、快照按日）并纳入 cron |
| 6 | `xunlongjue-pro-PLAN.md` 里程碑 | 新增 **M3.5 性能基线**（2C2G 实测门禁），不通过不进 M4 |
| 7 | `REFACTOR-REVIEW.md` §6.6 | 摄入校验从「一次性」改为**每次入库后自动断言**（常驻） |
| 8 | **新增** | `docs/PERFORMANCE.md`：内存预算表 + 各作业峰值内存上限 + 回归基准 |

---

## 6. 建议的修复顺序（都是小改动、大收益）

| 序 | 动作 | 预期收益 | 估时 |
|---|---|---|---|
| 1 | DuckDB 连接工厂（`memory_limit`/`threads` 按核数与内存推导） | 避免 OOM 被杀 | 0.2 d |
| 2 | 压实作业：`dt=YYYY` 重写为单文件 + 去重 | 内存 13x↓、耗时 40x↓ | 0.5 d |
| 3 | 视图去掉读时去重（压实后不再需要） | 同上 | 0.2 d |
| 4 | `cum_scale` 烘焙进 kline + `C_last` 小表 | 去掉 1,029 万行 JOIN | 0.5 d |
| 5 | ASOF JOIN 改为「小表 ASOF + 等值 JOIN」 | 因子构建可跑 | 0.3 d |
| 6 | 下载缓存清理 + 保留策略配置项 | 省 ~170 MB | 0.2 d |
| 7 | **2C2G 实测门禁脚本**（CI 或本地回归基准） | 防止再次退化 | 0.3 d |
| | **合计** | | **≈ 2.2 d** |

> 建议在 **M4 之前**完成 1~5 —— 否则 M4 的策略回测会在同一批内存问题上反复踩坑。

---

## 7. 待确认

1. **目标服务器的磁盘与内存确切规格**：2 GB 内存是硬上限还是可升？磁盘多大？
2. **是否需要「网站 + 数据 + 策略」同机运行**？若是，2C2G 要同时扛
   `xunlongjue-web`（FastAPI）+ 定时作业 + DuckDB 查询 —— 需要更紧的预算。
3. 盘中指标的候选池规模上限（决定是否必须物化）。
