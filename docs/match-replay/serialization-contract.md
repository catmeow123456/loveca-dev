# Loveca 对局回放 checkpoint / bundle 序列化与复水契约

> 文档类型：实现契约 / review 基线
> 适用范围：`DebugReplayBundle`、`Replay Checkpoint`、历史回放读取前的权威状态复水
> 当前状态：v0.3；已补充服务端可记录对墙打 replay limitation 与历史记录高权限导出包边界
> 最后更新：2026-06-28

## 1. 契约目的

对局回放会持久保存或导出权威 `GameState`、玩家视角投影、命令、事件和审计事实。当前权威状态内包含 `Map`、`ReadonlyMap`、枚举对象、卡牌实例和运行时结构，不能把这些对象直接 `JSON.stringify` 后作为长期 checkpoint 或 bundle payload。

本契约定义：

- checkpoint / bundle payload 如何变成 JSON-safe 数据。
- 导入或读取时如何复水为可投影的运行时对象。
- 哪些字段是 review 时必须检查的硬边界。
- 哪些能力标记必须说明当前记录不能完整重演。

后续 E0、P0、P1 的实现和 code review 应以本文档作为基准。若实现改变序列化格式、压缩格式、复水流程或权限边界，必须同步更新本文档。

## 2. 核心结论

第一版 checkpoint 和 debug bundle 应使用项目现有 transport serde 语义作为序列化底座：

- 写入前：`toTransport(value)`，把 `Map` 等运行时结构转换为 JSON-safe 结构。
- 存储或导出：只保存 transport 后的 JSON-safe payload，必要时再压缩。
- 读取后：先解压和 JSON parse，再 `fromTransport<T>(payload)` 复水。
- 普通玩家读取：复水后的 authority checkpoint 只能在服务端投影为 `PlayerViewState` 后返回，不能把权威 payload 交给前端隐藏。

如果未来新增 replay 专用 serializer，应满足同等或更强的复水能力，并通过 payload schema version 与 `serializer` 字段区分，不能静默替换旧格式。

## 3. 术语

`Serialized Payload`：已经经过 serializer 处理、可以安全放入 JSON / JSONB / bundle 文件的 payload。

`Rehydrated Payload`：从 serialized payload 复水后的运行时对象，例如 `GameState`、`PlayerViewState` 或命令 payload。

`Authority Checkpoint`：完整权威状态，包含双方隐藏信息、牌库顺序和可能关联审计的信息。只供服务端投影、审计、调试和未来确定性重演使用。

`DebugReplayBundle`：管理员调试 / 历史高权限导出包 envelope。`sourceMatch.exportedStatus=RUNNING_OR_RECENT` 表示 E0 运行中或近期对局调试导出；`sourceMatch.exportedStatus=HISTORY_RECORD` 表示从正式历史记录导出的回放包。它可以包含隐藏信息，但必须只走管理员或开发审计入口。

`RecordFrame`：记录层生成的单调时间线节点。每个 frame 分配 `timelineSeq`，并按需关联命令、事件、决策、随机事实和 checkpoint。

## 4. Serialized Payload Envelope

所有 checkpoint payload 都应包在 envelope 中，不能只保存裸 `GameState`。

逻辑字段：

- `payloadSchemaVersion`：payload envelope 版本。
- `serializer`：当前建议为 `TRANSPORT_V1`。
- `payloadKind`：`AUTHORITY_GAME_STATE` / `PLAYER_VIEW_STATE` / `PUBLIC_VIEW_STATE` / `COMMAND_PAYLOAD` / `EVENT_PAYLOAD`。
- `sourceSchemaVersion`：来源对象 schema 版本，例如 `gameStateSchemaVersion` 或等价规则版本。
- `compressed`：是否压缩。
- `compression`：`NONE` / `GZIP` 或后续受控枚举。
- `encoding`：未压缩时为 `JSON_VALUE`；压缩时为 `BASE64_JSON`.
- `payloadHash`：对 serialized payload 的稳定 hash，用于导入校验和排障。
- `uncompressedByteLength`。
- `compressedByteLength`：未压缩时可等于 `uncompressedByteLength`。
- `payload`：JSON-safe payload，或压缩后的 base64 字符串。

示例：

```ts
interface ReplaySerializedPayloadEnvelope {
  payloadSchemaVersion: 1;
  serializer: 'TRANSPORT_V1';
  payloadKind: 'AUTHORITY_GAME_STATE' | 'PLAYER_VIEW_STATE' | 'PUBLIC_VIEW_STATE';
  sourceSchemaVersion: string;
  compressed: boolean;
  compression: 'NONE' | 'GZIP';
  encoding: 'JSON_VALUE' | 'BASE64_JSON';
  payloadHash: string;
  uncompressedByteLength: number;
  compressedByteLength: number;
  payload: unknown;
}
```

## 5. Checkpoint Envelope

`match_checkpoints.payload` 或 bundle 内 checkpoint 不应直接保存裸 payload envelope；还需要 checkpoint 自身身份字段。

逻辑字段：

- `matchId`
- `checkpointSeq`
- `timelineSeq`
- `checkpointType`：`AUTHORITY` / `PLAYER_VIEW` / `PUBLIC_VIEW`
- `relatedPublicSeq`
- `relatedCommandSeq`
- `relatedGameEventSeq`
- `turnCount`
- `phase`
- `subPhase`
- `createdAt`
- `payloadEnvelope`
- `visibilityScope`
- `capabilities`
- `limitations`

约束：

- `checkpointSeq` 由 recorder 分配，不能复用 `PublicEvent.seq`。
- 同一 `publicSeq` 下允许存在多个 checkpoint；它们必须拥有不同 `checkpointSeq`。
- `payloadEnvelope.payloadKind` 必须与 `checkpointType` 匹配。
- `AUTHORITY` checkpoint 必须默认视为高权限材料。
- 普通 replay API 可以返回 `PLAYER_VIEW` / `PUBLIC_VIEW` checkpoint 的投影结果，但不能返回 `AUTHORITY` payload envelope。

## 6. DebugReplayBundle Envelope

Bundle 顶层必须明确来源类型，不能把运行中调试导出和正式历史记录导出混在一起。

逻辑字段：

- `recordSchemaVersion`
- `bundleSchemaVersion`
- `serializer`
- `exportedAt`
- `appVersion` / `gitCommit`
- `rulesVersion`
- `cardDataVersion` / `cardDataHash`
- `sourceMatch`
- `participants`
- `deckSnapshots`
- `recordFrames`
- `checkpoints`
- `commands`
- `publicEvents`
- `privateEventsBySeat`
- `sealedAudit`
- `gameEvents`
- `decisions`
- `capabilities`
- `limitations`

`sourceMatch.exportedStatus=RUNNING_OR_RECENT` 的 E0a 若只能导出当前 authority checkpoint 和运行时可获得事实，必须在 `capabilities` / `limitations` 中标清：

- `AUTHORITY_CHECKPOINT`
- `SINGLE_CHECKPOINT_ONLY` 或 `LIMITED_CHECKPOINTS`
- `LIMITED_TIMELINE`
- `GAME_EVENTS_SNAPSHOT`，如果 `GameEvent` 不是通过稳定增量接口采集
- `DECISION_RECORDS_PARTIAL`，如果没有完整 `decision opened/submitted`
- `NO_DETERMINISTIC_REPLAY`
- `NOT_USER_HISTORY_RECORD`

`sourceMatch.exportedStatus=HISTORY_RECORD` 的历史导出包不应标记 `NOT_USER_HISTORY_RECORD`。它仍是管理员高权限材料，但来源已经是正式持久化历史记录；导出可以包含完整历史 timeline、authority checkpoints、public/private events 与 decision records。若历史记录当前缺少完整 command log，必须如实保留 `commands: []` 或等价空集合，依靠 decision records 表达结构化决策，不能伪造命令序列。

导入端必须读取这些能力标记。缺少完整 timeline 的 bundle 只能打开为有限调试视图，不能伪装成完整回放。历史导出包即使可以导入管理员 Debug Replay 查看器，也不改变普通玩家历史读取边界。

服务端可记录对墙打如果仍把对手自动流程压缩在玩家命令后的 checkpoint 中，根记录或相关 checkpoint capability/limitation 必须标记 `SOLITAIRE_AUTOMATION_COMPRESSED`。该标记表示 replay 可查看状态节点，但不能逐步展开对手自动换牌、自动跳过主阶段或自动确认等中间动作。

## 7. 序列化流程

写入 checkpoint 或导出 bundle 时：

1. 从 `GameSession` 或 recorder transition frame 获取不可变克隆或当前权威状态克隆。
2. 根据 payload 类型选择 `payloadKind`。
3. 使用 `toTransport(payload)` 转成 JSON-safe payload。
4. 对 transport payload 做稳定 JSON 编码，用于计算 byte length 和 hash。
5. 按策略决定是否压缩。
6. 写入 `ReplaySerializedPayloadEnvelope`。
7. 写入 checkpoint envelope 或 bundle。

稳定 hash 的输入必须是未压缩的 serialized payload，而不是运行时对象引用。首版可以使用受控 stable stringify：对象 key 按字典序输出，数组保持原顺序，transport 后的 `Map.entries` 保持 serializer 输出顺序。后续若改 hash 算法或 canonical JSON 规则，必须提高 `payloadSchemaVersion` 或写入新的 `hashAlgorithm` 字段，避免新旧 bundle 校验语义混用。

不得：

- 直接对原始 `GameState` 调用 `JSON.stringify` 作为长期 payload。
- 在 payload 外另存一份未序列化的权威对象引用。
- 把 serializer 细节藏在代码路径里而不写入 envelope。
- 在日志中打印完整 authority payload、双方手牌、牌库顺序、sealed audit payload 或私密事件正文。

## 8. 复水流程

读取 checkpoint 或导入 bundle 时：

1. 校验 `recordSchemaVersion`、`bundleSchemaVersion` 或 `payloadSchemaVersion`。
2. 校验 `serializer` 是否受支持。
3. 校验 `appVersion` / `gitCommit` / `rulesVersion` / `cardDataHash` 的兼容状态。
4. 校验 `payloadHash`；不匹配时拒绝或降级为审计摘要，不继续投影。
5. 解压 payload。
6. JSON parse。
7. 使用 `fromTransport<T>(payload)` 复水运行时对象。
8. 对 authority checkpoint，服务端调用历史 replay projector 生成指定玩家 `PlayerViewState`。
9. 返回普通玩家可见 DTO。

不得：

- 将导入后的 authority checkpoint 注入运行中 match。
- 对复水后的对象执行正式 `GameCommand`。
- 在普通 replay API 返回 authority checkpoint、sealed audit、对手隐藏信息或完整随机顺序。
- 因版本不兼容而静默按当前规则重算旧 checkpoint。

## 9. RecordFrame 最小契约

历史时间线应以 `RecordFrame` 或等价模型作为唯一单调顺序账本。命令、事件、决策、随机事实和 checkpoint 可以各自有独立 payload，但必须通过 frame 统一排序。

最小字段：

- `matchId`
- `timelineSeq`
- `frameType`
- `visibilityScope`
- `relatedCheckpointSeq`
- `relatedPublicSeq`
- `relatedPrivateSeq`
- `relatedPrivateSeqBySeat`
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

第一阶段 frame type 至少预留：

- `MATCH_INITIALIZED`
- `COMMAND_ACCEPTED`
- `COMMAND_REJECTED`
- `SYSTEM_TRANSITION`
- `PUBLIC_EVENT`
- `PRIVATE_EVENT`
- `SEALED_AUDIT`
- `GAME_EVENT`
- `CHECKPOINT_WRITTEN`
- `MATCH_SEALED`
- `DECISION_OPENED`
- `DECISION_SUBMITTED`
- `RANDOMNESS_RECORDED`

P1 普通玩家事件读取边界：

- `match_record_public_events.payload` 只保存 `PublicEvent`，可按 checkpoint timeline 范围返回给双方参与者。
- `match_record_private_events.payload` 必须按 `seat` 隔离，普通玩家只能读取自己所属 seat 的私密事件。
- 普通 replay API 不得通过事件 payload 返回 `SealedAuditRecord`、authority checkpoint envelope 或对手私密事件。

P0/P1 可以先只实现其中一部分，但读模型不能把 `PublicEvent.seq`、`commandSeq` 或 `checkpointSeq` 单独当成全局顺序来源。

## 10. 权限契约

`AUTHORITY` checkpoint 与 E0 bundle 默认属于高权限材料。

普通玩家接口只允许返回：

- `PlayerViewState` 或公共视角 DTO。
- 可见 `RecordFrame` 摘要。
- 公共事件。
- 当前玩家所属 seat 的私密事件。
- 脱敏后的部分记录状态。

普通玩家接口不得返回：

- `AUTHORITY` payload envelope。
- `sealedAudit` payload。
- 对手手牌。
- 未公开牌库或能量卡组顺序。
- 完整随机顺序。
- 审计候选、隐藏候选或服务端校验细节。

管理员调试 / 历史高权限导出必须：

- 使用 `requireAdmin` 或等价高权限中间件。
- 记录访问审计或至少服务端安全日志。
- 不把完整 bundle 写入普通请求日志。
- 运行中调试包若进入服务端临时存储，需要设置过期或显式删除机制；直接下载的历史 `.replay.json` 导出不进入普通用户历史列表或分享链路。

## 11. Review 检查清单

E0a / 历史高权限导出 review 必须确认：

- bundle 顶层有 `recordSchemaVersion`、`bundleSchemaVersion`、`serializer`、版本和 hash 字段。
- authority checkpoint 使用 payload envelope，不是裸 `GameState`。
- `serializer=TRANSPORT_V1` 时，导出路径实际调用 `toTransport`。
- 导入路径实际调用 `fromTransport`。
- `Map` 结构复水后仍是 `Map`，至少覆盖 `cardRegistry`、zone `cardStates`、`liveResolution` maps 和 Heart requirements。
- bundle capabilities 标明是否 `SINGLE_CHECKPOINT_ONLY`、`LIMITED_TIMELINE`、`NO_DETERMINISTIC_REPLAY`。
- `RUNNING_OR_RECENT` bundle 标记 `NOT_USER_HISTORY_RECORD`；`HISTORY_RECORD` bundle 不要求该 limitation，但必须仍走管理员权限。
- 历史导出不伪造缺失 command log，缺失时使用空 `commands` 并保留 decision records。
- 非管理员无法导出、导入或读取 bundle。

P0 review 必须确认：

- 初始 checkpoint 有独立 `checkpointSeq`。
- checkpoint payload 有 envelope 和 hash。
- `match_checkpoints.payload` 不是未版本化裸对象。
- 卡组快照保存当局展示摘要与 `cardDataHash`。
- 卡组摘要足以支持历史展示，不依赖当前 `cards` 表重查名称、费用/分数、图片、罕度、收录商品和必要效果文本。
- 物理 schema 与初始化脚本同步：`src/server/db/schema.ts` 与 `docker/init.sql` 都包含历史记录表、索引和约束。
- 至少有 `matchId + checkpointSeq`、`matchId + timelineSeq`、参与者 seat/user、deck snapshot seat 的唯一约束或等价幂等键。
- 记录创建或初始 checkpoint 失败时不会进入 `IN_GAME`。
- 若开发环境允许无 recorder 对局，该开关不是正式联机默认路径，并且该局不会进入用户历史记录。

P1 review 必须确认：

- replay 读取从 checkpoint 复水后在服务端投影。
- 普通响应不含 authority payload。
- `RecordFrame` / `timelineSeq` 统一排序命令、事件和 checkpoint。
- 同一 `publicSeq` 下多个 checkpoint 不会覆盖。
- append 失败会降级完整性状态。
- 首版若采用每个接受命令后完整 authority checkpoint，schema 和 envelope 已预留压缩、采样或关键节点 checkpoint 策略入口。
- 普通玩家 timeline 经过玩家视角过滤，不直接复用包含 private / audit / admin 摘要的 E0 timeline。

## 12. 最小测试基线

实现 E0/P0/P1 时应补 focused tests：

- authority checkpoint `serialize -> JSON.stringify -> JSON.parse -> rehydrate` 后，关键 `Map` 字段保持可用。
- 复水后的 `GameState` 可调用 `projectPlayerViewState`。
- 玩家 A 的 replay 响应不包含玩家 B 手牌和未公开牌序。
- `payloadHash` 不匹配时导入失败或降级为审计摘要。
- 版本不兼容 bundle 不被伪装成完整回放。
- `SINGLE_CHECKPOINT_ONLY` bundle 的 timeline UI 不展示完整逐步回放能力。

## 13. 维护规则

本文档是 checkpoint / bundle 序列化和复水的 review 基线。

- 新增 serializer、压缩格式或 checkpoint type 时，先更新本文档。
- 修改 `src/online/serde.ts` 中 `Map` 等结构的 transport 表达时，必须同步检查 replay 契约。
- 如果未来改为 replay 专用 canonical serializer，应保留旧 `TRANSPORT_V1` 读取能力或明确版本拒绝策略。
- 如果普通 replay API 新增字段，必须确认它不绕过 `PlayerViewState` 可见性边界。
