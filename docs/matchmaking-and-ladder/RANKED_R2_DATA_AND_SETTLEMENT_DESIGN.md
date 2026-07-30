# 赛季排位 R2 数据与结算核心设计

> 文档类型：设计文档
> 适用范围：赛季排位数据模型、竞技环境、事务结算、重建和生命周期
> 当前状态：R2 核心、排位候场、玩家页面与管理员页面已实现，尚未部署生产
> 最后更新：2026-07-30

## 1. 本阶段范围

当前实现以下服务端与产品基础：

- 独立的全局卡牌目录哈希和完整竞技环境身份；
- 赛季草稿、开始、候场准入、收口和封存的服务契约；
- 权威 `RANKED` 对局与赛季环境绑定；
- 每局双方原子 Glicko-1 结算；
- `matchId` 初始结算幂等；
- 追加式作废/替代事件；
- 作废/替代后的确定性全赛季重放与当前积分投影重建；
- 独立排位票据、确认、房间引导和赛季环境隔离；
- 首场显示积分、赛季可配置参榜场次门槛、个人赛季资料、最近对局与排行榜读取；
- 新赛季软重置种子与基于种子的确定性重建；
- 权威终局自动结算、失败重试、自动收口和最长收口期限；
- `FREE` 使用、断线弃权和平台无结果的结构化分类；
- 数据库迁移、约束和 focused tests。

当前首版明确不做：

- 生产迁移或历史公共牌桌积分回填。
- 全天开放、按 rating 匹配、段位、奖励和多个排位池；
- 对旧公共牌桌对局追溯生成正式积分。

## 2. 竞技环境身份

`ranked-environment.ts` 从最终发布卡牌运行时数据构建：

```text
cardCatalogHash =
  sha256(PUBLISHED_RUNTIME_CARD_CATALOG_V1 + 按 cardCode 排序的规则相关卡牌字段)
```

哈希包含编号、类型、名称/团体/小组、卡文、费用、BLADE、Heart、分数和必要 Heart 等会影响卡组合法性或规则结果的字段；不包含图片文件名、图片来源和同步审计标记。换图不会切换赛季环境，修改费用或卡效数据会切换。

完整环境身份再组合：

```text
competitiveEnvironmentId = sha256(
  rulesVersion
  + cardCatalogVersion/cardCatalogHash
  + deckPolicyVersion
  + 完整 ratingConfig
)
```

它与现有 `match_records.cardDataHash` 职责不同：

- `competitiveEnvironmentId`：全局、赛季级、用于候场和部署校验；
- `match_records.cardDataHash`：本局双方卡组快照、用于重放完整性。

赛季从 `DRAFT` 开始时保存环境身份；进入 `ACTIVE` 前再次计算当前部署身份，任一字段不同都拒绝开始。

## 3. 数据模型

### `ranked_seasons`

保存：

- `DRAFT -> ACTIVE -> FINALIZING -> CLOSED` 生命周期；
- 独立的 `OPEN / PAUSED` 候场准入；
- 平台时区与每周分钟级开放窗口；
- 开始、计划结束、最长收口和实际封存时间；
- 规则、全局卡牌目录、卡组政策和 rating 算法完整配置；
- 独立于评分算法的参榜场次门槛，允许管理员在草稿或进行中赛季调整；
- 单调递增的 `ledgerRevision`。

平台同时只能存在一个 `ACTIVE / FINALIZING` 赛季，避免玩家入口与单一 FIFO 排位池在
不同竞技环境或算法间分叉。

### `ranked_matches`

一条记录把权威 `match_records` 对局绑定到：

- 赛季；
- 固定的双方用户；
- 赛季环境快照；
- `PENDING / SETTLED / VOIDED` 计分状态；
- 权威胜者、结果类型、是否曾使用 `FREE` 和结算时间。

绑定只接受 `origin_kind=RANKED`、`FULL`、正在进行且规则版本一致的权威对局。结算只接受完整封存的 `COMPLETED / SURRENDERED` 结果，不能读取客户端自报胜负。

### `ranked_rating_events`

这是不可变的结算意图流水：

- `SETTLEMENT`：一局首次结算；
- `VOID`：有审计依据的平台故障作废；
- `REPLACEMENT`：权威结果被确认错误后的替代结果。

每个事件保存赛季内单调序号、幂等键、对局、双方、胜者、算法版本和结算时间。更正必须指向该局最新事件，唯一约束禁止从旧事件产生分叉。

### `ranked_rating_event_steps`

这是每次事件产生的可审计物化：

- 普通顺序结算保存当前一局的一步；
- 迟到结算、`VOID` 或 `REPLACEMENT` 保存重放后的完整有效步骤；
- 每一步在同一行保存双方 before/after rating、RD、场次和最近结算时间。

因此不存在“先写胜者、后写败者”的半局状态。

### `ranked_player_ratings`

这是可重建的当前投影，用于个人资料和排行榜查询。首场结算后即可向本人显示 rating；
只有 `ratedMatchCount` 达到赛季的 `leaderboardMinimumMatchCount` 才计算公开名次并进入
排行榜。普通结算 upsert 双方；作废/替代时允许在事务内清空该赛季投影并从有效事件
重建。

删除派生投影不等于删除流水。业务代码不得删除 `ranked_rating_events` 或 `ranked_rating_event_steps`。

### `ranked_player_seeds`

赛季激活时从最近一个 `CLOSED` 赛季读取最终投影，并按新赛季冻结配置执行软重置。种子保存来源赛季、初始 rating 和 RD；新赛季投影以 `ledgerRevision=0`、场次 0 开始。迟到结算和管理员更正重放都从同一组种子开始，不能退回统一 `1500 / 350`。

### 排位票据与预留

现有 `public_table_tickets / public_table_reservations` 增加 `queueKind` 和 `seasonId`。休闲票据固定为 `CASUAL + NULL`，排位票据固定为 `RANKED + seasonId`，数据库约束禁止混合形态。配对仍使用稳定 FIFO，但只能在相同队列、赛季和竞技环境内认领；`gameplay_participations` 使用独立 `RANKED_QUEUE` 占用种类继续保证跨模式互斥。

## 4. 事务与幂等

所有赛季状态变化和积分写入使用 PostgreSQL `SERIALIZABLE` 事务。

结算顺序：

1. 锁定赛季、排位绑定和权威对局记录；
2. 校验赛季仍可结算、环境完全一致、结果完整封存；
3. 检查该局是否已经有初始 `SETTLEMENT`；
4. 使用双方同一份结算前快照计算 Glicko；
5. 追加事件和双方物化步骤；
6. 更新双方当前投影和对局状态；
7. 最后推进赛季 `ledgerRevision`；
8. 同一事务提交。

幂等边界：

- 每局初始 `SETTLEMENT` 唯一；
- `settle:<matchId>` 是内部稳定幂等键；
- 管理更正必须提供稳定幂等键；
- 赛季事件序号唯一；
- 一个事件最多被一个后继更正，防止更正链分叉。

如果一局因为恢复重试而晚于后续对局结算，服务不会把它直接插到当前分数尾部；它会按 `ratedAt + matchId + eventSequence` 重放整个有效结果集，保证与离线重建一致。

## 5. 作废与替代

更正不修改或删除旧流水：

```text
SETTLEMENT(match A)
  -> VOID(target=SETTLEMENT)
  -> REPLACEMENT(target=VOID, corrected winner)
```

每次更正必须：

- 由管理员身份发起；
- 提供非空原因与幂等键；
- 保持原对局、双方和结算时间不变；
- 使用赛季冻结的同一算法版本；
- 追加新事件；
- 重放当前所有有效结果；
- 写入完整物化步骤并替换当前投影。

`VOID` 后该局不进入胜负和 rating；`REPLACEMENT` 可以在 `VOID` 后恢复为可靠结果。首批管理员路由要求先只读预览全赛季重放影响，再携带预览时的 `ledgerRevision` 执行；若期间流水发生变化则拒绝执行并要求重新预览。接口契约见 [赛季排位管理员 API](./RANKED_ADMIN_API.md)。

## 6. 赛季服务边界

赛季创建要求：

- 合法时区；
- 至少一个开放窗口；
- 周一至周日使用 `1～7`；
- `startMinute` 包含、`endMinute` 不包含；
- 首版窗口不能跨日或互相重叠；
- `startsAt < scheduledEndsAt <= finalizingDeadlineAt`；
- 完整竞技环境身份；
- 非 `SHADOW` 算法版本。

生命周期操作：

- 新赛季始终以 `DRAFT + PAUSED` 创建；
- `activate` 只允许 `DRAFT -> ACTIVE`，并重新校验部署环境；
- `OPEN` 只允许在 `ACTIVE` 中设置；实际候场还必须位于配置窗口内，因此可以提前恢复运营准入；
- `beginFinalizing` 同时强制 `PAUSED`；
- `close` 只允许 `FINALIZING -> CLOSED`，并要求没有 `PENDING` 对局。

运行时任务会在计划结束后自动进入 `FINALIZING + PAUSED`，重试已经完整封存但仍为 `PENDING` 的结算；到达最长收口期限后，把仍无法形成可靠结果的对局显式记为 `VOIDED / PLATFORM_NO_CONTEST` 并写结构化日志。封存仍要求没有 `PENDING` 对局，不会静默丢弃。

## 7. 正式算法门槛

`GLICKO1_PER_MATCH_SHADOW_V1/V2` 只用于离线报告。赛季服务和持久结算服务都会拒绝算法版本名中包含 `SHADOW` 的配置。

测试环境闭环验证完成后，代码已显式保留 `GLICKO1_PER_MATCH_V1` 并发布新赛季默认
`GLICKO1_PER_MATCH_V2`。V2 只把新玩家初始 RD 从 350 调整为 300，既有 V1 赛季
继续使用冻结配置确定性重建；`SHADOW_V2` 继续保留用于复现报告，但不能创建赛季或
写入正式流水。正式版本只能来自服务端注册表，不能由管理员请求上传参数。

## 8. 下一步

1. 在预发布环境验证单一 `0010_add_ranked_system.sql` 停机迁移；
2. 演练赛季生命周期、异常更正、自动收口和封存；
3. 补齐生产告警渠道与更细的运营指标；
4. 冻结首季 POC 周期、开放窗口和评估口径；
5. 取得独立发布授权后再执行生产迁移、部署和首季创建。
