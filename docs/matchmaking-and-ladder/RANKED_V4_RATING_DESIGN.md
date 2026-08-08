# 赛季排位 V4 评分设计

> 文档类型：设计文档
> 适用范围：`GLICKO1_PER_MATCH_V4` 的冻结参数、成长池、结算边界和新赛季创建约束
> 当前状态：V4 代码已实现，仅供未来新赛季使用；不改写已有 V1–V3 赛季
> 最后更新：2026-08-08

## 1. 产品目标

V4 保留 Glicko-1 对双方相对实力和不确定性的判断，同时将可见排位分调整为更适合轻量赛季激励的节奏：完成定级后，双方赛前平均分低于 1800 时每局注入少量正积分，在 1800 时回到纯 Glicko，高于 1800 时逐步回收积分。这不把 1800 当作段位硬边界，只是整个对局的平滑成长中心。

## 2. 冻结参数

`GLICKO1_PER_MATCH_V4` 使用：

```text
initialRating = 1500
initialRatingDeviation = 300
ratingScale = 800
minimumRatingDeviation = 100
maximumRatingDeviation = 350
placementMatchCount = 5
ratingPeriodMode = PER_MATCH
```

V4 的新赛季排行榜门槛必须与 `placementMatchCount` 一致，固定为 5 场。管理端默认填入并锁定该值，服务端在草稿创建、激活和进行中运营修改边界均再次校验。V1–V3 的历史配置与参榜规则保持不变。

## 3. 成长池

只有双方在本局开始前都已完成 5 场定级时，才在纯 Glicko 结果上叠加成长池。任一方的赛前 `ratedMatchCount < 5` 时，本局成长池为 0。

```text
averageRating = (firstBefore.rating + secondBefore.rating) / 2
T = 16 * tanh((1800 - averageRating) / 250)
```

- `T >= 0` 时，双方各获得 `T / 2`；
- `T < 0` 时，胜方承担 `75% * T`，败方承担 `25% * T`；
- 成长池只改变 rating，不改变 Glicko 计算出的 RD、场次和最近结算时间；
- 评分投影保留小数精度，玩家显示层继续按 `displayDecimalPlaces=0` 取整。

成长池参数作为 `rating_config` 的可选扩展与竞技环境一起冻结。旧 V1–V3 JSON 不含该字段仍可正常读取，但服务端明确禁止 V1–V3 携带成长池，也禁止 V4 改写已发布的评分或成长参数。只有软重置策略仍按既有草稿边界可配置。

## 4. 结算和重放边界

`glicko.ts` 继续只实现纯 Glicko-1。`ranked-rating.ts` 是持久排位的唯一算法调度入口，先计算 Glicko，再按版本应用成长池。正常实时结算、迟到结算、`VOID / REPLACEMENT` 和 ledger 全量重放全部调用该入口，因此同一事件序列可确定性重建。

V4 只面向新赛季，不修改 V3 迁移工具、旧影子报告脚本或旧赛季冻结配置。现有 `rating_config` JSONB 和双方 before/after 流水已能完整保存 V4 结果，因此不需要数据库 schema 迁移。

## 5. 新赛季重置

新赛季默认 `RESET_TO_INITIAL`，因此 V3 中已低于 100 的 RD 不会被带入 V4，而是直接生成 `1500 / RD 300`。若草稿改为 `RETAIN_TOWARD_CENTER`，源赛季状态先作为跨赛季输入读取，结果 RD 再按 V4 的重置下限和最大 RD 夹取；不会用 V4 的 `minimumRatingDeviation=100` 反向否定合法的旧赛季状态。
