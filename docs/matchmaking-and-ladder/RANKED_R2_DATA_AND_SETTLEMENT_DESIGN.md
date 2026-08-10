# 赛季排位 R2 数据与结算核心设计

> 文档类型：设计文档
> 适用范围：赛季排位数据模型、竞技环境、环境统计、事务结算、重建和生命周期
> 当前状态：首个生产赛季已开放并使用 V3；V4 已实现且只供未来新赛季使用
> 最后更新：2026-08-09

## 1. 本阶段范围

当前实现以下服务端与产品基础：

- 独立的全局卡牌目录哈希和完整竞技环境身份；
- 赛季草稿、开始、候场准入、收口和封存的服务契约；
- 权威 `RANKED` 对局与赛季环境绑定；
- 每局双方原子排位结算：V1–V3 为纯 Glicko-1，V4 为纯 Glicko-1 后叠加冻结成长池；
- `matchId` 初始结算幂等；
- 追加式作废/替代事件；
- 作废/替代后的确定性全赛季重放与当前积分投影重建；
- V3/V4 受限评分参数修订的签名预览、不可变审计身份与维护期全量回算；
- 独立排位票据、确认、房间引导和赛季环境隔离；
- 首场显示积分、赛季可配置参榜场次门槛、个人赛季资料、最近对局与排行榜读取；
- 新赛季软重置种子与基于种子的确定性重建；
- 权威终局自动结算、失败重试、自动收口和最长收口期限；
- `FREE` 使用、断线弃权和平台无结果的结构化分类；
- 管理员运行健康与经营概览、对局状态筛选、双方加减分及长期主卡组核查；
- 当前及历史公开赛季按玩家等权计算的卡牌使用率 Top 30、样本量与数据覆盖率；
- 数据库迁移、约束和 focused tests。

当前首版明确不做：

- 修改当前 V3 赛季或追溯回填历史公共牌桌积分。
- 全天开放、按 rating 匹配、段位、奖励和多个排位池；
- 对旧公共牌桌对局追溯生成正式积分。

## 2. 竞技环境身份

`ranked-environment.ts` 从最终发布卡牌运行时数据构建：

```text
cardCatalogHash =
  sha256(PUBLISHED_RUNTIME_CARD_CATALOG_V1 + 按 cardCode 排序的规则相关卡牌字段)
```

哈希包含编号、类型、名称/团体/小组、卡文、费用、BLADE、Heart、分数和必要 Heart 等会影响卡组合法性或规则结果的字段；不包含图片文件名、图片来源和同步审计标记。它保存赛季创建/激活时的发布卡池审计快照，但活动赛季的玩家准入不会重新比较当前卡池哈希；赛季期间新增卡牌或修订卡牌数据不关闭候场。

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

- `competitiveEnvironmentId`：全局、赛季级，保存草稿确认时的环境快照并隔离候场上下文；
- `match_records.cardDataHash`：本局双方卡组快照、用于重放完整性。

赛季从 `DRAFT` 开始时保存环境身份；进入 `ACTIVE` 前再次计算当前部署身份，任一字段不同都拒绝开始。进入 `ACTIVE` 后，规则、卡池政策与评分配置继续冻结；发布卡池允许变化，不作为玩家候场准入门槛。

按官方日期生效的全局 PT 限制表不属于上述赛季内部 `deckPolicyVersion`：它是平台对所有新候场和新开局统一执行的外部构筑合法性边界。因此活动赛季可以跨越 PT 生效日，但生效后尚未开局的候场卡组需按新表重验；每局卡组快照另行冻结实际 PT 版本、总点数与上限，不通过改写 `competitiveEnvironmentId` 表达。

## 3. 数据模型

### `ranked_seasons`

保存：

- `DRAFT -> ACTIVE -> FINALIZING -> CLOSED` 生命周期；
- 独立的 `OPEN / PAUSED` 候场准入；
- 平台时区与每周分钟级开放窗口；
- 开始、计划结束、最长收口和实际封存时间；
- 规则、全局卡牌目录、卡组政策和 rating 算法完整配置；
- 参榜场次门槛；V1–V3 允许运营调整，V4 强制与 5 场定级一致；
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

### `ranked_deck_observations`

每场排位注册时在同一个可串行化事务中从已经锁定的 `match_deck_snapshots` 捕获 FIRST、SECOND 两席长期事实。主键为 `matchId + seat`，每席保存：

- `season_id / match_id / seat / user_id / observed_at`；
- `main_deck_cards`：按基础卡号合并罕度后的主卡组数组，每项只含 `baseCardCode / cardCode / name / cardType / count / imageFilename?`，其中 `cardCode` 是稳定代表印刷编号；
- `deck_fingerprint`：由排序后的 `{ baseCardCode, count }` 生成的稳定 SHA-256 构筑指纹。

捕获时要求双方身份与排位绑定一致、主卡组各 60 张、卡牌摘要类型合法；幂等重试只能复用完全一致的事实，不能覆盖冲突记录。观察记录会在对局后续 `PENDING / SETTLED / VOIDED` 状态间保留，公开统计只读取最终 `SETTLED`。

该表不是回放卡组快照：不保存能量卡、卡文、逐张实例、玩家卡组名、来源卡组 ID、初始牌序或隐藏信息，不能恢复对局。`match_deck_snapshots` 的卡组明细仍按完整回放策略在 10 天后清空；精简观察独立长期保留，服务赛季统计、管理员历史核查和未来匿名构筑聚类。常规回放清理只有确认双方观察完整且身份一致后才可清空排位快照，未来删除观察事实必须建立独立的排位统计保留政策。

### `ranked_rating_events`

这是不可变的结算意图流水：

- `SETTLEMENT`：一局首次结算；
- `VOID`：有审计依据的平台故障作废；
- `REPLACEMENT`：权威结果被确认错误后的替代结果。

每个事件保存赛季内单调序号、幂等键、对局、双方、胜者、结果类型、算法版本和结算
时间。`VOID` 固定为 `PLATFORM_NO_CONTEST`，初始结算和替代结算只接受
`NORMAL / SURRENDER / DISCONNECT_FORFEIT`。更正必须指向该局最新事件，唯一约束
禁止从旧事件产生分叉。

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

赛季激活时从最近一个 `CLOSED` 赛季读取参赛玩家，并按新赛季冻结配置执行软重置。
默认 `RESET_TO_INITIAL` 直接使用新赛季的 `initialRating / initialRatingDeviation`；
管理员也可在草稿期选择 `RETAIN_TOWARD_CENTER`，并配置中心值、原积分保留比例和
重置后最小 RD。策略与参数保存在 `rating_config`、参与竞技环境哈希，激活后不可修改。
种子保存来源赛季、重置后 rating 和 RD；新赛季投影以 `ledgerRevision=0`、场次 0
开始，但玩家侧在首场结算前不展示种子积分。迟到结算和管理员更正重放都从同一组种子
开始，不能绕过该赛季冻结策略退回其他默认值。

### 排位票据与预留

现有 `public_table_tickets / public_table_reservations` 增加 `queueKind` 和 `seasonId`。休闲票据固定为 `CASUAL + NULL`，排位票据固定为 `RANKED + seasonId`，数据库约束禁止混合形态。配对仍使用稳定 FIFO，但只能在相同队列、赛季和竞技环境内认领；`gameplay_participations` 使用独立 `RANKED_QUEUE` 占用种类继续保证跨模式互斥。

预留从双方确认进入 `CREATING_ROOM` 时取得短租约并记录创建尝试次数。房间创建和数据库
绑定以租约时间作为 fencing token；清理任务只接管过期租约，有限重试后释放预留，并
按心跳恢复无过错票据。这样 API 在确认事务提交后崩溃也不会让预留永久停在创建中，
旧创建者也不能覆盖新租约已经绑定的房间。

## 4. 赛季环境统计与玩家读取

登录玩家通过 `GET /api/ranked/environment?seasonId=<uuid>` 读取当前或历史公开赛季环境。接口独立于会被候场页面频繁轮询的 overview，返回前 30 张卡及以下样本字段：

- `settledMatchCount`：该赛季最终 `SETTLED` 对局总数；
- `analyzedMatchCount`：其中双方观察完整且座位、玩家身份一致的对局数；
- `deckObservationCount / playerCount`：实际参与聚合的卡组观察数和去重玩家数；
- `coverageRate = analyzedMatchCount / settledMatchCount`，无已结算对局时为 0。

已结算总数与可分析观察必须由同一条 PostgreSQL 语句、同一语句快照计算；如果聚合结果出现 `analyzedMatchCount > settledMatchCount`，服务端应拒绝返回，不能通过把覆盖率截断为 100% 隐藏异常。

卡牌使用率采用玩家等权口径：先对每名玩家计算“其被分析卡组中包含该基础卡号的比例”，再对全部样本玩家求平均；没有采用该卡的玩家贡献 0。这样一名玩家打 10 场、另一名玩家打 1 场时，两人权重仍各为一半。不同罕度按基础卡号合并，最终按玩家等权使用率、原始卡组搭载率和基础卡号稳定排序，只公开前 30 张。接口同时保留原始搭载率、搭载玩家数、卡组数和平均张数供审计，首批页面不展示这些附加指标。

已变为 `VOIDED`、平台无结果、仍为 `PENDING`，或只有单席观察的对局不进入榜单。历史回填的完整性和 10 天清理保护按 `drizzle/migration-notes/ranked-season-environment.md` 执行；如果早期卡组已经不可恢复，页面必须通过覆盖率如实表现，不得伪造观察事实。

## 5. 事务与幂等

所有赛季状态变化和积分写入使用 PostgreSQL `SERIALIZABLE` 事务。

结算顺序：

1. 锁定赛季、排位绑定和权威对局记录；
2. 校验赛季仍可结算、环境完全一致、结果完整封存；
3. 检查该局是否已经有初始 `SETTLEMENT`；
4. 使用双方同一份结算前快照调用统一排位算法边界；纯 Glicko 与 V4 成长池都在该边界内完成；
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

## 6. 作废与替代

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

`VOID` 后该局不进入胜负和 rating；`REPLACEMENT` 可以在 `VOID` 后恢复为可靠结果。
管理员路由要求先只读预览全赛季重放影响，再携带预览时的 `ledgerRevision`、目标事件
和服务端签名令牌执行。令牌绑定动作、替代胜方和结果类型；若参数被改写、目标事件改变
或期间流水推进，则拒绝执行并要求重新预览。接口契约见
[赛季排位管理员 API](./RANKED_ADMIN_API.md)。

## 7. 赛季服务边界

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
- `close` 只允许 `FINALIZING -> CLOSED`，并要求没有 `PENDING` 对局，也没有已经形成
  但尚未写入 `matchId` 的排位预留。

运行时任务会在计划结束后自动进入 `FINALIZING + PAUSED`，停止新候场，但允许此前
已经形成的配对继续确认、创建房间并绑定正式排位对局；未开局预留消化完之前不能封存。
任务先分批排空已经完整封存但仍为 `PENDING` 的可靠结算；单批满载时继续读取下一批，
避免积压结果被最长收口期限误判。到达期限后，完整封存且有可靠胜方的结果继续保持
`PENDING` 等待重试；其他对局只有在权威内存运行态已终止后，才显式记为
`VOIDED / PLATFORM_NO_CONTEST` 并写结构化日志。封存不会静默丢弃配对或对局。

## 8. 正式算法门槛

`GLICKO1_PER_MATCH_SHADOW_V1/V2` 只用于离线报告。赛季服务和持久结算服务都会拒绝算法版本名中包含 `SHADOW` 的配置。

代码显式保留 V1/V2 的 `ratingScale=400` 和 V3 的 `ratingScale=800 / minimumRD=30 / 10 场定级`，以重建旧流水。未来新赛季默认 V4：`1500 / RD 300 / ratingScale 800 / minimumRD 100 / 5 场定级`，定级后按冻结规则叠加 1800 中心成长池，详见 [V4 评分设计](RANKED_V4_RATING_DESIGN.md)。V2→V3 迁移工具和 runbook 只保留为历史审计与重现资料，V4 不参与该迁移。旧事件可保留不同算法版本，但每个对局的最新指令必须全部为当前赛季算法，否则重放拒绝。`SHADOW_V2` 只用于复现报告，不能创建赛季或写入正式流水；正式版本只能来自服务端注册表。

## 9. 下一步

1. 在预发布环境执行 `0017 / 0018 / 0019 / 0020` 迁移，并分别完成参数修订、赛季公告、首届纪念徽章补发和赛季环境历史观察回填演练；环境回填必须先 dry-run，按报告处理硬阻塞或受保护的不可恢复历史分支；
2. 用历史对局验证 V4 默认值及候选修订参数的排行榜分布、单局极值和玩家时段净变化；
3. 在已有基础运营概览上补齐生产外部告警、跨日趋势与更细结算延迟分桶，并持续验证参数修订、异常更正、自动收口和封存。
