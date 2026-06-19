# Loveca 对局记录与回放 E0-P3 实施计划

> 文档类型：实施计划
> 适用范围：管理员调试回放包 E0，以及对局记录 P0-P3 的落地顺序、服务改造、逻辑数据模型、读取 API 和测试安排
> 当前状态：阶段性实施记录 v0.6；E0-P1 已落地，P2 已起步至 P2c
> 最后更新：2026-06-18

## 1. 目标与边界

第一阶段长期目标是让正式联机对局从开始起形成可持久化记录，并在对局结束后支持玩家以自己的当时视角查看历史节点。

E0 管理员专用调试回放包已用于验证 recorder 和 replay 读模型；E0 不写入正式历史表，不开放普通用户，不承诺长期跨版本兼容。

本计划只覆盖记录式回放，不实现完整确定性重演。普通用户版第一版交付边界以 P0-P1 为基础，当前已继续接入部分 P2：

- E0：管理员专用调试回放包导出 / 导入，已用于开发调试和格式验证。

- P0：开始即创建历史记录，锁定参与者、座位、卡组快照、初始检查点，并能在结束或清理前封存。
- P1：持续追加时间线、命令、事件、检查点，提供历史列表、详情和玩家视角只读回放读取。

P2-P3 属于第一阶段增强：

- P2：已起步记录 active effect、部分玩家命令和待处理能力顺序选择；手动处理原因、完整随机记录和确定性重演仍未完成。
- P3：补回放 UI 体验、关键节点索引、部分记录提示和审计辅助导出。

## 2. 当前代码事实

当前可复用基础：

- `src/application/game-session.ts` 已在内存中维护 `publicEvents`、`privateEventsBySeat`、`sealedAuditRecords`、`commandLog`、`snapshotHistory` 和 `authoritySnapshots`。
- `GameState.eventLog` / `GameEvent` 已开始记录规则层事件事实，例如登场、离场、成员状态变化、成员槽位移动、LIVE 开始、LIVE 成功和声援；它与 `PublicEvent` 职责不同，前者服务规则事实和触发匹配，后者服务双方可见展示与同步。
- 纯 `trigger-matcher` 已在 `src/application/effects/trigger-matcher.ts` 落地，但尚未接入 runner；`enqueueTriggeredCardEffects` 仍按事件类型分支承担来源扫描、eventId 绑定、pending 入队、去重和 fallback。
- `src/online/projector.ts` 已能从权威 `GameState` 生成 `PlayerViewState`。
- `src/online/types.ts` 已定义 `PublicEvent`、`PrivateEvent`、`SealedAuditRecord`、`MatchCommandRecord` 和 recovery frame 类型。
- `src/server/services/online-match-service.ts` 当前持有运行中 match，运行中权威会话仍存在内存 `Map`；历史记录持久化由 recorder 追加写入，不等同于进程重启后恢复运行中 match。
- `GameSession` 当前的 `authoritySnapshots` 以运行时恢复为目标，身份更接近 `publicSeq`；持久历史检查点必须另建 `checkpointSeq`，不能直接复用该 map 的 key。
- `GameSession` 当前已有 `getPublicEventsSince` / `getPrivateEventsSince` / `getSealedAuditSince` / `getCommandLogSince` / `getGameEventsSince` 等增量读取入口，recorder 已用于命令/系统 frame 的 public/private 事件明细落库；玩家回放读取已有基本过滤与读模型，后续仍需补节点范围读取、完整 UI 与长期兼容策略。
- `online-room-service` 当前锁卡后保留 `deckId`、`deckName` 和运行时 `DeckConfig`，并在开局时把运行时卡牌摘要写入历史卡组快照；这仍标记为 `ONLINE_RUNTIME_DECK` / `RUNTIME_ACCEPTED`，不是最终的 `PUBLISHED_CARDS_SNAPSHOT` 链路。
- `src/server/db/schema.ts` 与 `docker/init.sql` 已新增 P0/P1 历史对局记录模型和 P2 decision record 表；P1c-P1e 已提供普通用户历史入口、timeline、authority checkpoint 投影读取、public/private event 明细读取，P2a-P2c 已记录 active effect、部分玩家命令和待处理能力顺序选择。sealed audit 普通读取不会开放，decision record 仍是 partial，尚未覆盖自由拖拽/手动处理原因、完整随机记录与确定性重演。

因此第一阶段的关键仍不是新增一套 replay engine，而是沉淀记录事实边界和只读回放读取模型；E0/P0/P1 已完成基础落地，后续围绕 P2 的决策、随机、手动原因和 P3 UI / 审计能力收束。

## 3. 实施原则

- 正式联机对局开始前必须能创建历史根记录；创建失败时不应静默开启无记录正式对局。
- 记录事实来自服务端权威状态、命令和投影，不能来自前端动画或本地 UI 状态。
- 普通玩家回放接口返回玩家视角或公共视角数据，不返回权威 `GameState` 后再让前端隐藏。
- `timelineSeq` 是历史记录主顺序；`checkpointSeq` 是历史检查点身份；`PublicEvent.seq`、`commandSeq`、运行时 snapshot public seq 只能作为关联字段。
- 时间线写入应以 `RecordFrame` 或等价账本节点统一排序；命令、公共事件、私密事件、审计、规则事件、决策、随机事实和 checkpoint 不应各自形成互不对齐的回放顺序。
- `MatchRecorder` 负责生成并持久化 `timelineSeq` / `checkpointSeq`，不得把现有 `authoritySnapshots` 的 `publicSeq` key 作为持久 checkpoint 主键。
- 需要保存同一 `publicSeq` 下的多个历史节点时，recorder 应从命令提交后的权威状态或显式 transition frame 采集 checkpoint payload；现有 `authoritySnapshots: Map<publicSeq, GameState>` 只能作为恢复辅助，不能保证保留同一公共事件序号下的多个中间状态。
- checkpoint、debug bundle、payload envelope、序列化、复水、hash 校验、压缩和权限边界必须遵守 [checkpoint / bundle 序列化与复水契约](serialization-contract.md)；不得直接保存裸 `GameState` JSON。
- 锁卡结果必须变成可持久化快照输入；仅保存运行时牌组列表不足以满足历史展示和数据版本隔离。
- 记录状态和完整性分开表达：`status` 表示生命周期，`completeness` 表示记录是否完整。P0 硬写入失败时正式对局不进入 `IN_GAME`；P1 增量追加失败时允许对局继续，但必须同步或尽最大努力把 `completeness` 降级为 `PARTIAL` / `INCOMPLETE` 并留下服务端错误。
- 记录层应同时采集可用的 `GameEvent` 与 `PublicEvent`：`GameEvent` 作为规则事实输入，`PublicEvent` 作为公开展示事实输入，二者通过 timeline 关联而不是混写为同一类事件。
- 存储格式不应绑定卡效 runner 的内部结构；P2 决策记录保存语义化字段和 `decisionSchemaVersion`，不要直接保存未版本化的 `pendingAbilities` / `activeEffect` 原始对象。
- E0 调试导出包是管理员高权限材料，可以包含权威状态、隐藏信息和密封审计；普通玩家不可访问。E0 格式允许迭代，不形成用户数据 migration 承诺。
- P0-P1 优先保证可用性和隐私边界；存储压缩、公共分享和确定性重演延后。
- P2 开始补决策和手动原因，但不能阻塞 P0-P1 首版上线。
- 正式联机环境应把 recorder 视为启动前置：P0 硬写入失败时不进入 `IN_GAME`。若开发/本地调试需要无 recorder 启动，必须使用显式配置开关并在 UI/日志中标明，不得作为正式联机默认路径。

## 4. E0 实施计划：管理员专用调试回放包

E0 目标是在不建立正式历史表的前提下，先导出当前运行时可获得的权威事实，并能由管理员只读导入查看。

E0 应拆成三个可独立验收的小步，避免一开始就实现半套正式 replay 系统：

- E0a：导出 `DebugReplayBundle`。首版只要求从运行中或刚结束 match 导出当前可获得的权威事实，允许 `gameEvents` 标记为 `GAME_EVENTS_SNAPSHOT`。
- E0b：导入 bundle 并只读查看 authority checkpoint。导入结果仍是管理员临时调试材料，不进入正式历史列表。
- E0c：基于 bundle 内 `recordFrames` / checkpoint 游标查看节点。若没有稳定 recorder timeline，使用 bundle 内单调 `bundleTimelineSeq`，并在 `capabilities` / `limitations` 中说明。

E0a 完成后即可用于卡效 bug 复现和格式审查；E0b / E0c 再逐步验证 replay 读模型。

### 4.1 Bundle 逻辑模型

`DebugReplayBundle` 至少包含：

- `recordSchemaVersion`
- `exportedAt`
- `appVersion` / `gitCommit`
- `rulesVersion`
- `cardDataVersion` / `cardDataHash`
- `capabilities`
- `sourceMatch`：`matchId`、`roomCode`、导出时状态、回合、阶段、是否完整
- `participants`：座位、用户 ID、显示名、对局内 playerId
- `deckSnapshots`：来源 deck ID / 名称、主卡组、能量卡组、卡牌摘要、validation 结论
- `recordFrames`：bundle 内时间线账本；若尚未有持久 `timelineSeq`，可使用 bundle 内单调 `bundleTimelineSeq`
- `checkpoints`：首版至少支持 `AUTHORITY`，包含导出时当前权威状态的 serialized payload envelope；能拿到初始权威状态时也一并导出
- `timelineSummary`：由 `recordFrames` 派生的轻量展示摘要；不得作为独立主顺序来源
- `commands`：`GameSession` command log
- `publicEvents`
- `privateEventsBySeat`
- `sealedAudit`
- `gameEvents`：可用的 `GameState.eventLog` 事实；若尚未有稳定增量接口，E0 可以从导出时权威 state 读取并标记为 `GAME_EVENTS_SNAPSHOT`
- `decisions`：已能采集的语义化决策记录；未采集时标记 capability 缺失

E0 bundle 可以包含双方隐藏信息与牌库顺序，因此只能作为管理员 / 开发审计材料。E0a 若只能导出单点或有限 checkpoint，必须在 `capabilities` / `limitations` 中标记 `SINGLE_CHECKPOINT_ONLY`、`LIMITED_TIMELINE`、`NO_DETERMINISTIC_REPLAY` 与 `NOT_USER_HISTORY_RECORD` 或等价能力边界。

### 4.2 服务与接口

建议新增管理员接口，具体路径按现有在线路由风格调整。当前 E0 实现已使用 `/api/online/admin/...` 前缀；后续文档和代码应保持这个口径，避免再引入平行 `/api/admin/...` 路由。

- `POST /api/online/admin/matches/:matchId/debug-replay/export`
- `POST /api/online/admin/debug-replay/import`
- `GET /api/online/admin/debug-replay/:bundleId/timeline`
- `GET /api/online/admin/debug-replay/:bundleId/checkpoints/:checkpointSeq`

首版可以不持久化导入结果，直接把上传 bundle 放在内存或 `/tmp` 级临时存储；若需要跨进程调试，再另行引入受控文件存储。

导出规则：

- 只能管理员调用。
- 导出失败不影响运行中对局。
- 导出接口、服务日志和错误日志不得打印完整 bundle payload，尤其不得打印双方手牌、牌库顺序、sealed audit payload 或私密事件正文。
- 导出包必须明确 `capabilities`，例如 `AUTHORITY_CHECKPOINT`、`PUBLIC_EVENTS`、`PRIVATE_EVENTS`、`SEALED_AUDIT`、`GAME_EVENTS_SNAPSHOT`、`DECISION_RECORDS_PARTIAL`。
- 如果某类事实只能从 snapshot 采集而非稳定增量接口采集，应写入 `limitations`，避免被误认为完整持久 timeline。

导入规则：

- 校验 `recordSchemaVersion`、项目版本或兼容范围、卡牌数据 hash。
- 不兼容时拒绝导入，或只允许打开审计摘要。
- 导入后的 bundle 仍绑定管理员权限；不能因为已经导入到服务器临时存储，就通过普通 replay API 暴露。
- 导入后只读查看，不允许提交 `GameCommand`，不允许回写线上 match。
- 导入后的临时存储应有过期或显式删除机制；E0 不承诺长期保存或跨版本迁移。
- 普通用户接口不能读取 E0 bundle。

### 4.3 E0 验收

- 管理员可以从运行中或已结束 match 导出 debug replay bundle。
- bundle 包含版本、卡牌数据 hash、参与者、deck snapshot、authority checkpoint、命令和事件事实。
- 管理员可以导入兼容 bundle 并打开只读回放节点。
- 普通用户不能访问导出、导入或导入后的隐藏信息。
- 版本不兼容时有明确错误或降级行为。
- E0 不创建正式用户历史记录，不写入 `match_records` 长期表。

## 5. P0 实施计划：记录创建与封存

P0 不应一次性吞下“建表、开局写入、初始 checkpoint、封存、清理、读取”等所有工作。建议拆成三个小闭环：

- P0a：数据库 schema / 初始化脚本 / recorder 空服务。先落地 `match_records`、participants、deck snapshots、checkpoints、timeline frames 的最小结构和唯一约束，并实现 `beginMatch` / `markPartial` / 游标读取的空链路。
- P0b：开局写入闭环。`online-room-service.startMatch` 与 `online-match-service.createMatch` 改为可等待 recorder 的 async 流程，先创建 record / participants / deck snapshots，再初始化 `GameSession` 并写入初始 authority checkpoint；任一硬写入失败时不进入 `IN_GAME`。
- P0c：封存闭环。规则进入 `GAME_END`、`deleteMatch`、过期清理和房间销毁都走同一个 `sealMatch` / `markPartial` 入口，至少覆盖正常完成与清理前部分封存。

### 5.1 逻辑数据模型

P0 最少需要以下逻辑对象。物理表可以合并，但 payload 内部要保留这些边界。

`match_records`：

- `id` / `matchId`
- `roomCode`
- `status`：`IN_PROGRESS` / `COMPLETED` / `SURRENDERED` / `INTERRUPTED` / `CORRUPTED`
- `completeness`：`FULL` / `PARTIAL` / `INCOMPLETE`
- `startedAt` / `endedAt` / `sealedAt`
- `firstUserId` / `secondUserId`
- `winnerSeat` / `endReason`
- `turnCount`
- `lastTimelineSeq` / `currentTimelineSeq`：根记录上的游标摘要；具体节点身份仍以 `match_timeline_entries.timelineSeq` 为准
- `recordVersion` / `rulesVersion` / `cardDataVersion`
- `replayCapabilities`
- `partialReason` / `lastRecorderError` / `appendFailureAt`：记录不完整或追加失败时的服务端可排查摘要，普通玩家只展示脱敏后的部分记录状态

`match_participants`：

- `matchId`
- `userId`
- `seat`
- `displayName`
- `playerId`
- `deckSnapshotId`
- `replayAccess`

`match_deck_snapshots`：

- `snapshotId`
- `matchId`
- `seat`
- `sourceDeckId`
- `sourceDeckName`
- `source`
- `mainDeck`
- `energyDeck`
- `cardSummaries`
- `validationState`
- `cardDataVersion` / `cardDataHash`
- `lockedAt`

`cardSummaries` 首版至少保存历史展示和兼容判断所需字段：`cardCode`、`name`、`cardType`、`cost`、`score`、`imageFilename`、`rare`、`product`、必要的 `cardText` 摘要或全文。历史回放展示不得依赖用户当前 deck 或当前 `cards` 表还能查到同一内容。

`match_checkpoints`：

- `checkpointSeq`
- `matchId`
- `timelineSeq`
- `checkpointType`：P0 至少支持 `AUTHORITY`
- `publicSeq`
- `commandSeq`
- `schemaVersion`
- `payload`：遵守序列化与复水契约的 serialized payload envelope，不保存裸 `GameState`
- `payloadCompression`
- `payloadHash`
- `createdAt`

`match_timeline_entries` / `record_frames`：

- `timelineSeq`
- `matchId`
- `frameType` / `entryType`
- `visibilityScope`
- `relatedCheckpointSeq`
- `relatedPublicSeq`
- `relatedPrivateSeq`
- `relatedPrivateSeqBySeat`：按 `FIRST` / `SECOND` 保存该 frame 结算后的私密事件游标，普通读取只使用当前用户所属 seat 的游标派生 self private event 摘要
- `relatedAuditSeq`
- `relatedCommandSeq`
- `relatedGameEventSeq`
- `relatedDecisionId`
- `dedupeKey`
- `turnCount`
- `phase`
- `subPhase`
- `summary`
- `createdAt`

`match_record_public_events`：

- `matchId`
- `timelineSeq`
- `eventSeq`
- `eventId`
- `eventType`
- `source`
- `actorSeat`
- `summary`
- `payload`：只保存 `PublicEvent`，可返回给双方普通玩家
- `createdAt`

`match_record_private_events`：

- `matchId`
- `seat`
- `timelineSeq`
- `eventSeq`
- `eventId`
- `eventType`
- `relatedPublicSeq`
- `summary`
- `payload`：只允许当前用户所属 seat 读取
- `createdAt`

物理 schema 必须同步维护 `src/server/db/schema.ts` 与 `docker/init.sql`。P0 首版至少需要以下唯一约束或等价幂等键：

- `match_participants(match_id, seat)` 与 `match_participants(match_id, user_id)`。
- `match_deck_snapshots(match_id, seat)`。
- `match_checkpoints(match_id, checkpoint_seq)`。
- `match_timeline_entries(match_id, timeline_seq)`。
- 若 `dedupeKey` 用于重试幂等，应为 `match_timeline_entries(match_id, dedupe_key)` 建唯一约束或在 recorder 内保证同等语义。
- 用户历史列表需要按 `user_id + started_at / sealed_at` 查询的索引，避免后续读取 API 扫描全量记录。

### 5.2 服务改造

新增 `MatchRecorder` 服务，建议放在 `src/server/services/match-recorder-service.ts` 或等价位置。

P0 前置改造：

1. 扩展 `OwnedDeckSummary` / 房间成员锁卡状态，让锁卡结果包含 deck 元数据、runtime deck、validation 结论、卡牌摘要、锁定时间和 card data version 或等价来源标记。当前卡牌表没有独立数据版本字段时，首版可以用锁卡时规范化后的卡牌摘要计算 `cardDataHash`，并把来源标记写成 `published-cards-snapshot` 或等价枚举；后续若引入正式卡牌数据版本，再与该 hash 并存。
2. 将 `online-room-service.startMatch`、`online-match-service.createMatch` 以及调用链改为可等待 recorder 写入的 async 流程；不要在历史根记录和初始检查点成功前把房间切到 `IN_GAME`。
3. 为 recorder 定义持久游标状态：`lastTimelineSeq`、`lastCheckpointSeq`、`lastPublicSeq`、`lastPrivateSeqBySeat`、`lastAuditSeq`、`lastCommandSeq`。
4. 补齐 recorder 可用的 checkpoint 采集来源：至少能拿到当前权威状态克隆；若要保存同一 `publicSeq` 下的阶段、窗口或纯私密节点，则优先增加 `GameSession` transition hook 或显式 `recordCheckpointFromState` 输入，而不是回读 `authoritySnapshots` map。
5. recorder 生成 `timelineSeq` / `checkpointSeq`；`publicSeq` 只作为关联字段写入 checkpoint 和 timeline。
6. 对局结束检测先覆盖规则流程进入 `GAME_END` 与房间 / match 清理；投降状态先在 schema 和 seal API 中预留，若当前没有投降命令，不作为 P0 首版阻塞项。

记录边界前置 API：

- `GameSession.getGameEventsSince(seq)`：按稳定递增序号返回新增 `GameEvent`，不得要求 recorder 直接读取可变的 `session.state.eventLog`。
- `GameSession.getCurrentGameEventSeq()`：返回当前规则事件游标，用于 recorder 保存 `lastGameEventSeq`。
- `GameSession.getAuthoritySnapshotForRecord()` 或等价接口：返回权威状态克隆，作为 checkpoint payload 输入；不能暴露可变引用。
- 若要记录命令内部的阶段切换、窗口打开、私密选择等中间节点，应新增 `onAuthorityTransition(frame)` 或显式 recorder hook。没有 hook 前，不应声称可以从 `authoritySnapshots` 还原这些中间节点。

P0 入口：

1. `online-room-service.startMatch` 传递完整 deck snapshot 输入，而不只是 runtime deck。
2. `online-match-service.createMatch` 生成 `matchId` / player IDs 后，先调用 `recorder.beginMatch` 创建 `match_records`、participants 和 deck snapshots。
3. `GameSession.createGame` / `initializeGame` 成功后，调用 `recorder.recordInitialCheckpoint` 保存初始权威检查点和 `MATCH_INITIALIZED` 时间线节点。该 checkpoint 必须使用 recorder 分配的 `checkpointSeq`。
4. 对局进入 `GAME_END` 后调用 `recorder.sealMatch` 标记正常完成；房间销毁或 match 清理前调用 `recorder.sealMatch` 标记部分封存。投降入口后续加入时也走同一 seal API。

写入失败策略：

- `beginMatch`、participants 与 deck snapshots 应放在同一事务或等价幂等写入单元里；不能留下缺参与者或缺卡组快照的 `IN_PROGRESS` 根记录。
- `beginMatch` 失败：正式对局不启动，返回可读错误。
- `beginMatch` 成功但 `GameSession.createGame` / `initializeGame` 失败：正式对局不启动；必须回滚该历史根记录，或将其封存为 `INTERRUPTED` / `CORRUPTED` 且 `completeness=INCOMPLETE`，并记录初始化失败原因，不能留下无检查点的 `IN_PROGRESS` 记录。
- `recordInitialCheckpoint` 失败：对局不应进入可正常游玩的 `IN_GAME` 状态；记录标记为 `INTERRUPTED` 或 `CORRUPTED` 且 `completeness=INCOMPLETE`，或回滚根记录。
- P1 增量 append 失败：正式对局可以继续，但 match record 必须降级为 `PARTIAL` / `INCOMPLETE`，保存 `lastRecorderError` / `appendFailureAt`，并保留可重试游标。
- `sealMatch` 失败：保留运行中最后状态并记录服务端错误日志；下一次清理或管理入口应可重试封存。
- `markPartial` / 降级状态写入失败：不能向用户伪装完整记录；服务端必须记录 critical error，并在管理入口或健康检查中可发现该 match record 处于未知追加状态。

### 5.3 P0 验收

- 开始联机对局时数据库存在 match record、participants 和 deck snapshots。
- 初始化后存在初始 authority checkpoint，能看到双方初始牌序、起手和能量卡组顺序。
- 初始 checkpoint 拥有独立 `checkpointSeq`，即使 `publicSeq` 相同也不会覆盖其他历史节点。
- 用户修改原卡组后，历史 deck snapshot 不变化。
- 房间清理或 match 删除前，记录进入 `INTERRUPTED` 或等价生命周期状态，并将 `completeness` 标记为 `PARTIAL`；规则流程进入 `GAME_END` 时记录被封存为正常完成。
- 普通业务路径不会开启无历史记录的正式联机对局。

## 6. P1 实施计划：时间线与玩家视角回放读取

### 6.1 追加记录

P1 在每次命令或系统推进后追加：

- 新增 `timeline entry`
- 新增 `RecordFrame` 或等价账本节点，作为本批命令、事件、审计、规则事件和 checkpoint 的统一顺序来源
- 新增 `GameEvent` / `eventLog` 增量；若当前事件只属于规则事实而非双方可见事实，timeline 应标记为规则事件或审计可见，不应直接当作公共事件展示
- `publicEvents` 增量
- 按 seat 持久化双方新增 `privateEvents` 增量；普通读取时只返回当前用户所属 seat 可见的私密事件
- `sealedAudit` 摘要或高权限 payload
- `commandLog` 增量，包括被拒绝命令
- 按策略保存 `AUTHORITY` checkpoint

推荐先采用简单 checkpoint 策略：

- P1 首版最低保证：每个已接受命令完成后保存一个 authority checkpoint，checkpoint 身份由 recorder 分配，不使用 `publicSeq` 作为主键。
- 服务层显式阶段/子阶段切换、对局结束、房间清理前封存等节点，在能拿到当前权威状态克隆时也应保存独立 timeline / checkpoint。
- 命令内部的窗口打开/关闭、私密选择、同一 `publicSeq` 下多次 `setAuthorityState` 等中间节点，只有在 transition hook 或显式 recorder frame 落地后才纳入首版记录；没有 hook 时，不应依赖 `authoritySnapshots` 的最后覆盖结果倒推中间状态。
- 被拒绝命令只追加命令和审计，不要求保存新 checkpoint，除非记录状态变化。

每个成功命令后保存 authority checkpoint 简单可靠，但会放大存储体积。P1 首版可以先接受该成本，前提是 checkpoint payload envelope 已保留 `compression` / `payloadCompression` 字段，并在 schema 与 recorder 中预留后续按阶段、每 N 个事件或关键节点采样的策略入口；不能把“每命令完整 checkpoint”写死为长期唯一策略。

`MatchRecorder` 需要维护每个 match 已持久化的 seq：

- `lastPublicSeq`
- `lastGameEventSeq`
- `lastPrivateSeqBySeat`
- `lastAuditSeq`
- `lastCommandSeq`
- `lastCheckpointSeq`
- `lastTimelineSeq`

追加应按 `matchId + timelineSeq` 或等价幂等键写入，支持服务重试。

增量采集原则：

- recorder 从 `GameSession` 读取 `last*Seq` 之后的新 public/private/audit/command/game-event 事实，并为每批持久化生成新的 timeline entries。为此需要先补稳定的 `getGameEventsSince(seq)` / `getCurrentGameEventSeq()` 或等价 recorder hook；不应长期依赖 `session.state.eventLog` 这种调试入口采集规则事件。
- 服务层在进入 `GameSession` 之前拒绝的已授权操作，例如非当前玩家 `advancePhase`，也应写入服务层 rejected timeline 或审计摘要；未通过 match 参与者校验的请求可以走安全审计或普通 HTTP 拒绝，不进入普通玩家回放时间线。
- 若某批追加成功写入部分事实后失败，下一次重试必须基于持久游标和幂等键补齐或跳过已写入项，不能重复生成用户可见事件。

### 6.2 在线服务接入点

`online-match-service.executeCommand`：

- 无论命令接受或拒绝，只要 `GameSession` 已记录 command/audit，就调用 recorder 追加。
- 成功命令追加后再返回 snapshot；如果追加失败，返回仍可成功，但 match record 必须将 `completeness` 标记为 `PARTIAL` 或 `INCOMPLETE`，并在结果或管理日志中可追踪。
- 成功命令导致 `GAME_END` 时，追加本批事实和最终 checkpoint 后调用 `sealMatch(COMPLETED)`；如果 seal 失败，记录必须降级或进入可重试封存状态。

`online-match-service.advancePhase`：

- 作为系统/玩家推进节点追加时间线和 checkpoint。
- 如果服务层在进入 `GameSession.advancePhase` 前拒绝操作，应记录服务层 rejected timeline 或审计摘要，避免 P1 “被拒绝命令”覆盖缺口。
- 成功推进导致 `GAME_END` 时，追加本批事实和最终 checkpoint 后调用 `sealMatch(COMPLETED)`。

`online-match-service.cleanupExpiredMatches` 与 `online-room-service.cleanupExpiredState`：

- 删除运行中 match 前调用 recorder 部分封存。
- `deleteMatch`、过期清理和房间销毁路径都必须走同一个封存入口；不能只从内存 `Map` 删除 match。

### 6.3 读取 API

建议新增只读路由，路径可按现有 API 风格调整：

- `GET /api/online/match-records`：当前用户参与的历史对局列表。
- `GET /api/online/match-records/:matchId`：对局详情、参与者、卡组摘要、结果和能力标记。
- `GET /api/online/match-records/:matchId/replay?checkpointSeq=...`：按当前用户参与视角读取指定 checkpoint 节点。迁移期可兼容旧 `cursor` 查询参数，但新代码应使用 `checkpointSeq`，避免和 timeline 翻页游标混淆。
- `GET /api/online/match-records/:matchId/timeline`：当前用户可见的时间线摘要。
- `GET /api/online/admin/match-records/:matchId/audit`：高权限审计读取，后续再开放。

普通玩家 timeline 需要独立的历史投影器，不能直接复用 E0 管理员 timeline 摘要。E0 timeline 可以出现 private/audit/admin 级摘要；P1 timeline 必须按当前用户 seat 过滤私密事实，只展示该玩家可见的公共事件、自己 seat 的私密事件和脱敏后的记录状态。

普通玩家 replay 响应应接近：

- `playerViewState`
- `replayPosition`
- `timelineSummary`
- `recordFrame`
- `visibleEvents`
- `visiblePrivateEvents`
- `checkpointInfo`
- `recordStatus`
- `recordCompleteness` / `partialReason`：只返回脱敏后的不完整原因摘要，不暴露服务端堆栈或审计细节

普通玩家响应不得包含：

- 完整 authority checkpoint payload
- sealed audit payload
- 对手隐藏手牌
- 未公开牌库顺序
- 完整随机顺序

### 6.4 Replay Projector

P1 可以先基于 authority checkpoint 读取后调用 `projectPlayerViewState` 生成玩家视角。后续性能不足时再增加预投影 `PLAYER_VIEW` checkpoint。

读取层必须验证：

- 当前用户是该 match participant，或具备高权限。
- 请求视角只能是自己的 seat，公共视角和审计视角走独立权限。
- 历史节点的可见性由 checkpoint 投影和事件权限决定。

### 6.5 P1 验收

- 用户可以看到自己参与过的历史对局列表。
- 用户可以打开详情，看到参与者、先后手、卡组快照摘要、胜负、回合数和记录状态。
- 用户可以按自己的当时视角打开只读回放节点。
- 回放支持前进、后退和跳转到 checkpoint 或关键 timeline entry。
- 普通玩家接口不会返回 authority checkpoint、sealed audit 或对手隐藏信息。

## 7. P2 实施计划：决策记录与手动原因

P2 的完整目标是形成稳定 `Decision Record`。在 E0 / P1 阶段，如果已有能力低成本采集部分决策事实，可以先写入 `decisions` 的 partial payload，但必须带 `decisionSchemaVersion` 和 `transitionSemantics`，并明确不承诺完整 deterministic replay。

最小 v0 决策摘要应至少表达：

- `decisionId`
- `decisionSchemaVersion`
- `matchId`
- `timelineSeq`
- `playerId`
- `decisionType`
- `abilityId`
- `sourceCardId`
- `eventIds`
- `visibleContextSummary`
- `submission`：选择的卡、槽位、option 或跳过原因
- `resultSummary`
- `transitionSemantics`

不得把 runner 当前未版本化的 `activeEffect` / `pendingAbilities` 原始对象作为长期格式。完整候选、审计候选和 step 细节可在后续字段中逐步补齐。

P2 新增 `match_decision_records` 或等价 payload：

- `decisionId`
- `matchId`
- `timelineSeq`
- `decisionSchemaVersion`
- `decisionType`
- `sourceType`
- `sourceCardObjectId`
- `sourceCardCode`
- `sourceBaseCardCode`
- `sourceZone`
- `sourceSlot`
- `abilityId`
- `triggerCondition`
- `abilityCategory`
- `abilitySourceZone`
- `effectTextSnapshot`
- `stepId`
- `stepText`
- `waitingSeat`
- `visibleCandidates`
- `auditCandidates`
- `minSelect` / `maxSelect`
- `canSkip`
- `openedCheckpointSeq`
- `submittedTimelineSeq`
- `submittedCommandSeq`
- `submission`
- `status`
- `replayCapability`
- `transitionSemantics`：`STRUCTURED` / `SNAPSHOT_AUDIT_ONLY` / `UNSTRUCTURED_MANUAL`

优先覆盖：

- `activeEffect` 打开和 `CONFIRM_EFFECT_STEP` 提交。
- 起动能力 `ACTIVATE_ABILITY`。
- 自动能力顺序选择。
- 换牌、Live 设置、成功 Live 选择。

自由拖拽和手动处理先补 `manual adjustment context`：

- `reason`
- `sourceCardId`
- `abilityId`
- `note`
- `visibility`
- `structured`

原因未结构化时必须显示为过渡语义，不标记为可确定性重演。

实现约束：

- `activeEffect` 和 `pendingAbilities` 可以作为 recorder 输入，但写入前必须转换为上述稳定字段。
- runner helper 名称、resolver 拆分、steps DSL 迁移不应要求修改历史表结构；需要调试的内部细节可放入带版本的高权限审计 payload。
- 如果未来新增需要跨对局查询或权限过滤的新长期事实，再单独做 schema migration；普通字段扩展优先走 payload version 兼容读取。

## 8. P3 实施计划：体验与审计增强

P3 在 P0-P2 稳定后推进：

- 回放 UI 时间线索引。
- 关键节点过滤：回合开始、阶段开始、卡效打开、Live 判定、胜负结算。
- 对局结束后“查看复盘”入口。
- 部分记录状态提示。
- 管理员/开发者审计读取和脱敏导出。
- 权威 checkpoint 压缩、冷存储和保留策略。

## 9. 测试计划

E0 focused tests：

- 管理员可以导出 debug replay bundle。
- 非管理员不能导出或导入 debug replay bundle。
- 导出和导入后的 E0 bundle 不会出现在普通用户历史列表，也不能被普通 replay API 读取。
- bundle 包含 `recordSchemaVersion`、项目版本或 git commit、卡牌数据 hash、capabilities 和 authority checkpoint。
- authority checkpoint payload 经过 serializer envelope 保存，导入后能复水为可投影的运行时 `GameState`。
- E0a 单点或有限 checkpoint bundle 会标记 `SINGLE_CHECKPOINT_ONLY` / `LIMITED_TIMELINE` / `NO_DETERMINISTIC_REPLAY` 或等价 limitations。
- 导出错误日志不会包含完整 bundle payload 或隐藏信息。
- 导入兼容 bundle 后可以读取只读 timeline / checkpoint。
- 版本不兼容、payload hash 不匹配或 serializer 不受支持的 bundle 会被拒绝或降级为仅审计查看。

P0 focused tests：

- 创建正式联机对局会创建 match record、participants 和 deck snapshots。
- 修改原 deck 后，历史 snapshot 不变。
- 初始化成功后写入初始 authority checkpoint。
- 初始 authority checkpoint 使用 serialized payload envelope，不保存未版本化裸 `GameState`。
- 初始 checkpoint 和后续无新增 public event 的 checkpoint 拥有不同 `checkpointSeq`，不会因相同 `publicSeq` 覆盖。
- `beginMatch` 或 `recordInitialCheckpoint` 失败时，房间不会进入 `IN_GAME`。
- match 清理前写入部分封存状态。
- 规则流程进入 `GAME_END` 后写入正常完成封存状态。

P1 focused tests：

- P1 采集规则事件前，`GameSession` 已提供稳定的 `GameEvent` 增量读取接口或 recorder hook。
- 接受命令后追加 timeline、command、events 和 checkpoint。
- `RecordFrame` / `timelineSeq` 统一排序命令、事件、规则事件和 checkpoint。
- 同一 `publicSeq` 下的多个 checkpoint 使用不同 `checkpointSeq`，不会互相覆盖。
- 已写入 `GameState.eventLog` 的规则事件会以规则事件身份追加或关联到 timeline，不会被误投影为双方可见 `PublicEvent`。
- 拒绝命令后追加 rejected command 与 audit，但不伪装为状态变化。
- 服务层拒绝的已授权操作，例如非当前玩家 `advancePhase`，会留下 rejected timeline 或审计摘要。
- recorder append 失败后，运行中 match 可继续，但 record completeness 会降级并保留可排查错误摘要。
- 普通用户只能读取自己参与的 match。
- 玩家 A 回放不包含玩家 B 手牌、牌库顺序或 sealed audit。
- replay projector 从 authority checkpoint 生成的 `PlayerViewState` 与实时投影可见性一致。
- checkpoint `serialize -> JSON.stringify -> JSON.parse -> rehydrate` 后，`cardRegistry`、zone `cardStates`、`liveResolution` maps 与 Heart requirements 等关键 `Map` 字段保持可用。

P2 focused tests：

- `activeEffect` 打开写入 `decision opened`。
- `CONFIRM_EFFECT_STEP` 写入 `decision submitted` 并关联打开记录。
- 缺少打开记录时标记 `submitted_without_open_record`。
- 决策记录写入稳定语义字段和 `decisionSchemaVersion`，不会把未版本化的 `activeEffect` / `pendingAbilities` 原始对象作为长期格式。
- 自由拖拽缺少原因时显示未结构化过渡语义。

推荐测试命令在实现后按改动范围补充：

```bash
pnpm test:run tests/unit/*replay*.test.ts tests/integration/*replay*.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

## 10. 非本阶段事项

第一阶段不做：

- 从命令和 seed 完整重跑整局。
- 第三方公开分享页面。
- 普通用户 replay 下载或导入。
- WebSocket/SSE 改造。
- AI 复盘建议。
- 全卡池卡文解释器。
- 普通玩家完整隐藏信息回放。

## 11. 后续开发顺序建议

截至 2026-06-18，E0-P1 已落地，P2 已推进到 active effect、部分玩家命令和待处理能力顺序选择记录。2026-06-19 已修复 active effect 决策记录的发生序列区分，并让 recorder 的默认 timeline `dedupeKey` 优先使用 command/game-event/public 稳定事实序号；命中相同 key 时会直接返回既有 frame，避免重试写入被唯一约束标记为 partial。后续不再重复 E0/P0/P1 施工清单，按以下顺序收束：

1. 补 P2d 自由拖拽、手动处理原因和更多规则外调试命令的结构化 decision record。
2. 补完整随机记录与 seed / shuffle / reveal 事实边界，再评估是否进入确定性重演。
3. 增强只读回放 UI：节点范围事件、decision 详情、partial/incomplete 提示和更清晰的玩家视角导航。
4. 最后做 P3 UI、审计增强、公开分享或自动复盘等非第一阶段能力。
