# Loveca 远程撤销恢复实施记录与剩余计划

> 文档类型：历史/计划文档
> 适用范围：服务端可记录对墙打、正式联机、远程调试联机的撤销能力恢复
> 当前状态：P0-P4 已落地并作为历史实施记录保留；P5 远程调试撤销与回放节点体验尚未实现
> 当前事实来源：桌面能力与场景边界见 `../battle-mode-purpose-and-boundaries.md`；本文件中的早期代码缺口只解释实施背景
> 最后更新：2026-07-24

> 2026-06-20 实施标记：已完成服务端可记录对墙打即时撤销首版，包括受控 undo entry、`remoteRevision`、`UNDO_APPLIED` recorder frame、事件明细 timeline 身份、`undoPolicy` 与 `/api/battle/solitaire-matches/:matchId/undo`。已完成正式联机请求式撤销首版，包括 undo request runtime state、`UNDO_REQUESTED/ACCEPTED/REJECTED/EXPIRED` frame、`/api/online/matches/:matchId/undo-requests` 系列接口、`pendingRequest` 投影、前端请求/响应弹窗、超时和新命令失效。远程调试撤销策略、回放时间线撤销节点增强展示仍未实现。
> 2026-06-23 实施标记：正式联机请求式撤销补充“允许连续撤销”选项。对手接受请求时可授权发起方在同一撤销边界内继续直接撤销，不需要每一步重复确认；授权会在超时、阶段推进、新命令、撤销目标不再连续时失效。正式联机 direct undo 接口仍由服务端校验，未获得连续授权时不能绕过对手同意。

## 1. 背景

本计划启动时，本地调试和本地对墙打已有浏览器内 `GameSession` 权威快照撤销，而服务端可记录对墙打和正式联机尚未开放撤销。P0-P4 完成后，服务端可记录对墙打已经使用即时远程撤销，正式联机已经使用请求式撤销；远程调试联机仍未接入撤销策略。

恢复撤销时不能简单把按钮重新显示出来，也不能让客户端调用本地 `gameSession.undoLastStep()`。远程对局的权威状态在服务端，撤销必须由服务端执行并重新投影给所有相关视角，否则会出现客户端桌面回退、服务端状态未回退、历史记录继续前进的分裂状态。

本文档把“恢复撤销”定义为：在服务端权威对局中提供可审计、可同步、可受限的回退操作，用于防止误操作，同时不破坏隐藏信息、对局记录、回放和双方一致性。

## 2. 代码复核结论

以下是计划启动时的代码复核基线；其中 P0-P4 对应底座已经落地，保留这些条目用于解释设计原因，不表示当前仍全部缺失：

- `GameSession.undoLastStep()` 会恢复权威状态，也会恢复 `publicEvents`、`privateEventsBySeat`、`sealedAuditRecords`、`commandLog`、`snapshotHistory` 和 `authoritySnapshots`。这适合本地撤销，但远程可记录对局不能只调用裸 `undoLastStep()` 后再从 `GameSession` 增量日志里倒推历史事实。
- 远程同步当前用 `playerViewState.match.seq` / `RemoteMatchSnapshot.seq` / `sinceSeq` 做去重和短路；这些值当前来自 public event seq。撤销会让 public seq 回到旧值，所以必须引入独立的 `remoteRevision`，并让远程 snapshot 去重、轮询短路和响应 seq 全部使用它。
- `MatchRecorderService` 当前只支持 `COMMAND_ACCEPTED`、`COMMAND_REJECTED`、`SYSTEM_TRANSITION` 等运行时 frame。撤销需要新增 `UNDO_*` frame type、默认摘要、dedupe key 和 checkpoint 写入路径。
- recorder 当前用 `match_records.last_public_seq` / `last_command_seq` 等持久游标做 `session.get*Since(cursor)` 增量采集，timeline dedupe 默认也会使用 `relatedCommandSeq` / `relatedPublicSeq`。撤销后这些 runtime seq 会回退，后续新命令可能复用旧 seq；若不引入分支感知的采集游标和 dedupe key，撤销后的新事实会漏录或命中旧 timeline frame。
- undo entry 的 actor、before/after seq、公开/随机/对手后续等元数据不能从现有 snapshot 事后可靠推导；它必须在成功操作落地后补全并保存。
- 前端 `BattleSurfaceCapabilities.canUndo` 只能表达“本地是否显示撤销”，不足以表达远程即时撤销、远程请求撤销和禁用原因。需要升级为明确的 `undoPolicy`，并读取服务端投影的 availability。

## 3. 目标与非目标

目标：

- 服务端可记录对墙打恢复单人可用的撤销入口。
- 正式联机恢复玩家可发起的撤销入口，并通过对手确认避免单方回滚公共事实。
- 远程调试联机可复用正式联机的撤销协议，必要时允许开发配置直接撤销。
- 撤销后所有客户端收到同一个服务端权威快照，且远程同步版本单调递增。
- 对局记录不丢失已发生事实，能表达“某操作被撤销”。
- 撤销范围仍受当前本地撤销边界约束：阶段、子阶段、活跃玩家、等待玩家变化后不跨边界撤销。

非目标：

- 不实现任意历史步数跳转式回滚。
- 不把历史回放变成可编辑对局。
- 不把撤销做成房间外的管理员强制修复工具。
- 不把普通玩家撤销设计成“消除已经泄漏的信息”。人类已经看到的信息无法撤回，只能回滚状态。
- 不把 `GameState` 改成事件源模型；远程撤销首版仍复用 `GameSession` 的快照恢复能力。

## 4. 设计硬约束

### 4.1 远程撤销必须走受控入口

服务端不能直接把裸 `GameSession.undoLastStep()` 暴露给 API。正确形态是：

1. `GameSession` 保存带元数据的 undo entry。
2. 服务层读取 `getUndoAvailability()`。
3. 请求携带 `expectedRevision` 和 `undoEntryId`。
4. 服务层校验操作者、seat、participantKind、当前 revision、undo entry、边界和安全标记。
5. 校验通过后调用受控恢复入口，例如 `undoLastStepForPlayer()`。
6. 服务层追加撤销 recorder frame 和新的 authority checkpoint。
7. 服务层递增 `remoteRevision` 并重新投影 snapshot。

`undoLastStep()` 可以继续保留给本地会话。远程入口应使用新的受控方法，避免绕过权限、幂等和记录层。

### 4.2 运行时同步版本不能和 public seq 混用

新增概念：

- `publicEventSeq`：公共事件序号，描述 public event 流，不保证撤销后继续单调。
- `commandSeq`：`GameSession` 内命令序号，撤销后会随运行时状态恢复到旧值。
- `timelineSeq` / `checkpointSeq`：历史记录层序号，必须永远单调。
- `remoteRevision`：运行中远程 snapshot 同步版本，必须永远单调。

远程 snapshot 协议要求：

- `OnlineMatchState.remoteRevision` 在初始化后存在。
- 接受命令、阶段推进、撤销应用、正式联机撤销请求状态变化都递增 `remoteRevision`。
- `GET snapshot?sinceSeq=` 的短路判断使用 `remoteRevision`。
- `RemoteMatchSnapshot.seq` 使用 `remoteRevision`。
- `playerViewState.match.seq` 在远程运行时也使用 `remoteRevision`。
- 记录层仍使用自身的 `timelineSeq` / `checkpointSeq`；public event、command 和 game event seq 只作为关联字段。

实现上不能直接继续用 `GameSession.getPlayerViewState()` 的默认 seq 作为远程响应，因为该方法当前会把 `publicEventSeq` 写入 `PlayerViewState.match.seq`。远程运行时应满足以下二选一：

- 为 `GameSession.getPlayerViewState()` 增加受控的 `seq` override，并仅由服务端远程 match service 传入 `remoteRevision`。
- 或由 `OnlineMatchService` 使用权威状态直接调用 `projectPlayerViewState(authorityState, playerId, { seq: remoteRevision, gameMode })`。

本地调试、本地对墙打和 replay 读取可以继续使用现有 public seq / checkpoint related public seq 语义；不要为了远程撤销破坏这些路径的测试假设。

如果后续需要在远程响应中暴露 public event seq，应新增明确字段，例如 `playerViewState.match.publicSeq` 或 snapshot 顶层 `publicSeq`，不要继续把 `match.seq` 同时用作同步版本和公共事件版本。

### 4.3 撤销不能删除历史事实

撤销可以回滚运行中权威状态，但不能删除已经写入历史记录的 timeline frame、command、event、decision 或 checkpoint。

因此记录层必须新增撤销事实：

- `UNDO_REQUESTED`：正式联机中玩家发起撤销请求。
- `UNDO_ACCEPTED`：对手接受撤销请求。
- `UNDO_REJECTED`：对手拒绝或服务端拒绝撤销请求。
- `UNDO_EXPIRED`：撤销请求或连续撤销授权超时、被新命令失效，或已经没有可继续撤销的目标。
- `UNDO_APPLIED`：撤销已应用并写入新的 authority checkpoint。

服务端应用撤销后，`GameSession` 内部 public/command/audit seq 可能回退。此时不能再依赖 `session.getPublicEventsSince(cursor.lastPublicSeq)` 这类增量读取来生成撤销事实；撤销 frame 应由服务层/recorder 以显式输入追加。

同理，撤销后的后续命令也不能继续只依赖持久记录里的 `last_*_seq` 作为运行时采集游标。`match_records.last_public_seq` / `last_command_seq` 等字段适合表达“记录层已经见过的最大关联序号”，不适合作为撤销后 `GameSession` 的增量读取起点。服务层必须额外维护分支感知的 runtime capture cursor，或由 recorder append API 显式接收本次 transition 的事实集合。

`UNDO_APPLIED` 至少应关联：

- `undoEntryId`
- `requesterSeat`
- `targetActorSeat`
- `targetBeforePublicSeq`
- `targetAfterPublicSeq`
- `targetBeforeCommandSeq`
- `targetAfterCommandSeq`
- 被撤销操作摘要
- 新 authority checkpoint

### 4.4 撤销后记录分支必须有单调事实身份

撤销后，旧事实仍留在历史时间线上，新事实从被恢复的局面继续产生。两条事实链可能复用相同的 `publicEventSeq`、`privateEventSeq`、`commandSeq` 或 `gameEventSeq`。记录层必须能区分“旧时间线上 seq=12 的命令”和“撤销后新时间线上 seq=12 的命令”。

首版实现必须满足：

- `OnlineMatchState` 或 recorder append 输入维护一个分支感知的 `recordCaptureCursor`，用于从当前 `GameSession` 采集增量事实。这个 cursor 可以随撤销恢复到较小的 runtime seq；它不能等同于 `match_records.last_public_seq` 等持久最大游标。
- 每个成功命令、阶段推进、撤销请求状态变化和撤销应用都必须有单调的 `remoteRevision`。撤销后的 frame dedupe key 必须包含 `remoteRevision`、请求 idempotency key 或等价单调身份，不能只用会回退的 `relatedCommandSeq` / `relatedPublicSeq`。
- `UNDO_APPLIED` 写入后，应把运行中 capture cursor 重置到恢复后的 runtime seq，并递增 `remoteRevision`。之后新命令产生的低位 seq 仍要被采集并写入新的 timeline frame。
- `match_record_public_events` / `match_record_private_events` 这类事件表不能继续只以 `match_id + event_seq` 或 `match_id + seat + event_seq` 作为唯一事实身份。需要加入 `timelineSeq`、`remoteRevision`、`recordBranchId` 或等价字段，或调整写入策略确保撤销后复用的 event seq 不会被 `ON CONFLICT DO NOTHING` 吃掉。
- replay 读模型在读取事件时应以 `timelineSeq` 为主顺序，再按事件自身 seq 排序；不能只按 event seq 排序，否则撤销前后的同号事件会错序。

如果首版暂不持久化撤销后低位 public/private event 明细，也必须显式标记为记录能力限制，并且 `UNDO_APPLIED` 与后续 `COMMAND_ACCEPTED` 的 authority checkpoint 仍必须完整写入。推荐优先修正事件唯一键和读模型排序，而不是依赖该降级策略。

### 4.5 undo entry 必须在成功操作后补全

当前 `GameSession` 在执行命令前捕获 undo snapshot。远程撤销需要的 after seq、是否公开、是否随机、是否产生对手后续等信息只有操作成功后才知道。

因此建议 `GameSession` 内部把 undo entry 拆成两段：

- 操作前：捕获可恢复 snapshot 和 before 元数据。
- 操作后：若操作成功且没有被边界清空，补全 after 元数据并压入 undo history。

失败命令不产生 undo entry。幂等重复命令不产生新的 undo entry。

### 4.6 availability 由服务端投影为准

前端可以根据桌面场景决定显示哪种按钮样式，但“现在能不能撤销”和“禁用原因”必须来自服务端或本地 `GameSession` 的 authoritative 查询。

远程场景下，前端不得自行推断：

- 当前最新 undo entry 是谁的。
- 是否跨越边界。
- 是否已有对手后续命令。
- 是否涉及不可逆隐藏信息。

## 5. 术语

- 本地撤销：浏览器内本地 `GameSession` 对上一步快照的回退，只影响本地会话。
- 远程撤销：服务端 `GameSession` 接受撤销请求后回退权威状态，再广播或返回新投影。
- 撤销单位：一次玩家命令及其服务端自动后续处理形成的操作组。例如登场和自动支付费用应作为一个单位撤销。
- 撤销边界：当前本地实现以阶段、子阶段、活跃玩家、等待玩家等上下文区分操作窗口。边界变化后，旧撤销历史应失效。
- 信息不可逆边界：已经产生对方后续决策，或进入无法解释的随机/洗切事实。已经向人类对手公开此前不知道的隐藏信息时，可以请求撤销，但只能回滚局面，不能消除对方已经看见的信息。
- 撤销请求：正式联机中，玩家发起、对手接受或拒绝的远程撤销流程。
- 连续撤销授权：正式联机中，对手接受一次撤销请求时额外给出的临时授权。授权只适用于同一撤销边界内、同一发起方的连续最新 undo entry；换阶段、有新命令、超时或目标变化后失效。
- `remoteRevision`：运行中远程 snapshot 同步版本，独立于 public event seq。
- `recordBranchId`：记录层用于区分撤销前旧事实链与撤销后新事实链的分支身份；它不是用户可见对局 ID。
- runtime capture cursor：服务层用于从当前 `GameSession` 采集 public/private/audit/command/game event 增量的运行时游标。它可以在撤销后回退，不等同于持久记录表中的最大 seq 游标。

## 6. 场景能力矩阵

| 场景                           | 权威来源   | 当前实现                                             | 剩余计划                                 |
| ------------------------------ | ---------- | ---------------------------------------------------- | ---------------------------------------- |
| 本地调试 `LOCAL_DEBUG`         | 浏览器本地 | 立即撤销                                             | 无                                       |
| 本地对墙打 `SOLITAIRE`         | 浏览器本地 | 立即撤销                                             | 无                                       |
| 服务端可记录对墙打 `SOLITAIRE` | 服务端     | 玩家单方即时远程撤销                                 | 继续完善回放节点说明                     |
| 正式联机 `ONLINE`              | 服务端     | 发起请求，对手确认后撤销；可授予同一操作窗口连续撤销 | 继续完善回放节点说明                     |
| 远程调试联机 `REMOTE_DEBUG`    | 服务端     | 不开放撤销，`undoPolicy = NONE`                      | P5：默认请求确认，并允许开发配置直接撤销 |
| 历史回放 `REPLAY_READONLY`     | 持久记录   | 不允许撤销                                           | 无                                       |

## 7. 功能需求

### 7.1 对墙打远程撤销

服务端可记录对墙打只有一个真实用户和一个系统对手。真实 FIRST 座位用户可以撤销自己最近一次仍在合法范围内的操作组。

要求：

- 按当前登录用户校验参与权限。
- 只允许 `participants.FIRST.participantKind === 'USER'` 的真实用户撤销。
- 系统对手不能成为撤销操作者。
- 非参与用户不能读取 availability，也不能提交撤销。
- 只允许撤销当前真实玩家最近一次仍有效的 undo entry。
- 撤销后返回新的 `OnlineMatchSnapshot`，客户端立即同步桌面。
- 如果没有可撤销内容，按钮可以显示为禁用，并提供原因。
- 撤销动作本身必须写入对局记录。

对墙打中的系统对手不是人类对手，因此“向对手泄漏隐藏信息”不应按正式联机同等严格处理。首版可允许撤销只影响真实用户自己已看到的信息或系统自动流程的操作，只要存在完整 authority snapshot 可恢复，并且 recorder 写入 `UNDO_APPLIED` checkpoint。若某操作已经跨过阶段/等待玩家边界并导致 undo history 被清空，则仍不可撤销。

### 7.2 正式联机撤销请求

正式联机中，撤销会影响两个真实玩家看到的公共事实，因此不能做单方立即回滚。第一版采用“请求 - 同意 - 服务端回滚”的协议。

要求：

- 玩家点击按钮后创建撤销请求，而不是立即回滚。
- 对手看到请求弹窗，内容至少包含发起方、拟撤销操作摘要，以及拒绝、接受一步、允许连续撤销按钮。
- 对手接受后，服务端再次校验撤销请求仍指向当前最新 undo entry 和当前 revision；通过后执行撤销。
- 对手选择允许连续撤销时，服务端在首次回滚后创建短期 grant。发起方之后可以在同一撤销边界内继续直接撤销自己的最新操作，不再逐步打扰对手。
- 对手拒绝、超时或期间任一方继续提交改变状态的命令时，请求失效。
- 连续撤销授权不等于整回合授权。它只覆盖当前操作窗口中连续、仍合法的 undo entry；阶段、子阶段、活跃玩家、等待玩家或新命令改变后失效。
- 涉及已向人类对手公开隐藏信息的操作，可以请求撤销；对手接受后只回滚局面，不能消除对手已经看见的信息。

### 7.3 UI 需求

桌面不应只用 `canUndo` 一个布尔值表达所有场景。建议引入明确的撤销展示策略：

```ts
type UndoPolicy = 'NONE' | 'LOCAL_IMMEDIATE' | 'REMOTE_IMMEDIATE' | 'REMOTE_REQUEST';
```

前端展示建议：

- `LOCAL_IMMEDIATE`：按钮文案“撤销”，调用本地撤销。
- `REMOTE_IMMEDIATE`：按钮文案“撤销”，调用服务端撤销接口。
- `REMOTE_REQUEST`：按钮文案“请求撤销”，调用服务端请求接口。
- `REMOTE_REQUEST` 且当前视角存在连续撤销授权时：按钮文案可以显示“继续撤销”，调用服务端 direct undo 接口；服务端仍必须校验 grant、revision、undo entry 和边界。
- `NONE`：隐藏按钮。
- 当策略允许但当前无可撤销内容时，按钮保留但禁用，tooltip 或日志展示原因。

`BattleSurfaceCapabilities` 负责表达桌面场景策略；`OnlineUndoView` 负责表达服务端当前 availability。远程场景的按钮启用状态应同时满足：

- `undoPolicy !== 'NONE'`
- `playerViewState.match.undo.canUndoNow === true`

### 7.4 权限、幂等与审计需求

- 服务端必须校验 match、seat、user、participantKind。
- 请求必须携带 `expectedRevision` 和 `undoEntryId`，防止旧客户端或重复点击撤销错误步骤。
- 如果 API 仍沿用字段名 `expectedSeq`，其语义必须明确为 `remoteRevision`，不是 public event seq。
- 撤销接口必须支持幂等处理，建议请求携带 `idempotencyKey`。
- 对同一 `undoEntryId + idempotencyKey` 的重复应用，应返回相同结果或当前已应用后的 snapshot，不应二次回滚。
- 撤销结果要进入 public event 或等价公共通知，让双方知道发生过撤销。
- 密封审计或 recorder payload 应保留撤销前后的关键摘要，便于排查争议。

## 8. 规则与安全边界

### 8.1 不能跨撤销边界

继续沿用当前本地撤销思路：阶段、子阶段、活跃玩家、等待玩家变化后清空旧撤销历史。服务端实现时不要为了“多撤几步”绕过这个边界。

原因：

- 跨阶段撤销会影响自动推进、LIVE 判定、卡效窗口和等待玩家。
- 对墙打自动流程可能已经压缩多个对手动作，跨边界回滚难以解释。
- 正式联机中，对方可能已经基于新局面做出决策。

### 8.2 对手后续命令边界

正式联机中，若目标操作后已经存在另一名真实玩家提交并成功改变状态的命令，则旧 undo entry 不可撤销。

服务端可通过以下方式判断：

- undo entry 记录 `afterRemoteRevision`。
- 每个接受命令记录 actor seat 和 accepted revision。
- `getUndoAvailability()` 判断最新成功操作是否仍是该 undo entry，且没有其他真实玩家后续成功命令。

服务端可记录对墙打中的系统自动流程可以视为同一个操作组的一部分；只要 undo entry 仍存在且未跨边界清空，就可以回滚整组。

### 8.3 隐藏信息与随机事实

正式联机首版默认不允许撤销以下操作：

- 已经进行洗牌、刷新、随机顺序变更，且没有明确的恢复和记录策略。
- 已经产生对方后续命令。

已经向人类对手公开此前不知道的隐藏卡牌，或已经让人类对手看到检视内容、手牌内容时，可以请求撤销；对手接受后只回滚局面，不能消除对手已经看见的信息。

服务端可记录对墙打没有真实人类对手接收隐藏信息。随机/洗切操作如果有完整 authority snapshot，可恢复运行中状态；但 recorder 必须写入新的 checkpoint，并在回放中把撤销作为新事实展示。

正式联机当前已允许双方同意后撤销已公开隐藏信息的操作。请求弹窗必须明确提示“信息已经公开，撤销不能消除对方已知信息”；随机/洗切操作仍默认不放开。

## 9. 架构设计

### 9.1 `GameSession` 撤销元数据

当前 `GameSession` 已经有私有 undo snapshot，但远程撤销需要更多可校验元数据。建议新增只读查询与受控执行入口：

```ts
interface UndoEntrySummary {
  readonly undoEntryId: string;
  readonly actorPlayerId: string;
  readonly actorSeat: Seat;
  readonly label: string;
  readonly boundaryKey: string;
  readonly createdAt: number;
  readonly beforeCommandSeq: number;
  readonly afterCommandSeq: number;
  readonly beforePublicSeq: number;
  readonly afterPublicSeq: number;
  readonly beforeGameEventSeq: number;
  readonly afterGameEventSeq: number;
  readonly beforeRemoteRevision: number;
  readonly afterRemoteRevision: number;
  readonly recordBranchId: string;
  readonly beforeCaptureCursor: UndoRuntimeCaptureCursor;
  readonly afterCaptureCursor: UndoRuntimeCaptureCursor;
  readonly hasHumanOpponentReveal: boolean;
  readonly hasRandomOrShuffle: boolean;
  readonly hasOpponentFollowup: boolean;
}

interface UndoRuntimeCaptureCursor {
  readonly publicSeq: number;
  readonly privateSeqBySeat: Readonly<Record<Seat, number>>;
  readonly auditSeq: number;
  readonly commandSeq: number;
  readonly gameEventSeq: number;
}

interface UndoAvailability {
  readonly policy: UndoPolicy;
  readonly canUndoNow: boolean;
  readonly entry: UndoEntrySummary | null;
  readonly disabledReason: string | null;
}
```

建议新增方法：

- `getUndoAvailability(playerId, policy): UndoAvailability`
- `undoLastStepForPlayer(playerId, undoEntryId): GameOperationResult`

`beforeRemoteRevision` / `afterRemoteRevision` 可以由服务层在创建或补全 undo entry 时注入；如果不想让 `GameSession` 感知 remote revision，也可以把 remote revision 字段放在服务层维护的 `RemoteUndoEntrySummary` 中，但对外投影必须包含它。

`recordBranchId` 和 `UndoRuntimeCaptureCursor` 也可以由服务层维护，不强制写入 `GameSession`。关键要求是：撤销应用后，服务层能知道恢复后的 runtime seq，并能从该 seq 继续采集后续事实，而不是继续使用持久记录层的最大 seq。

### 9.2 服务端会话服务

涉及服务：

- `OnlineMatchService`
- `SolitaireMatchService`
- `OnlineRoomService` 或外层路由
- 记录层 `MatchRecorderService`

服务端职责：

- 在命令、阶段推进、撤销请求和撤销应用之间串行化处理，避免并发请求交错。
- 用 `expectedRevision` 和 `undoEntryId` 校验请求仍然指向当前最新操作组。
- 执行撤销后递增 `remoteRevision`。
- 执行撤销后重置当前 match 的 runtime capture cursor，并更新 record branch 身份。
- 重新生成两个座位的 `PlayerViewState`，并通过既有 snapshot 拉取机制同步给客户端。
- 通知 recorder 追加撤销 frame 和新 checkpoint。

建议把核心方法收敛在 `OnlineMatchService`：

- `getUndoAvailability(matchId, userId): OnlineUndoView | null`
- `undoLatest(matchId, userId, input): Promise<RemoteUndoResult | null>`
- `createUndoRequest(matchId, userId, input): Promise<UndoRequestResult | null>`
- `acceptUndoRequest(matchId, userId, requestId, input): Promise<RemoteUndoResult | null>`
- `rejectUndoRequest(matchId, userId, requestId): Promise<UndoRequestResult | null>`

`SolitaireMatchService` 只做对墙打权限包装，然后调用 `OnlineMatchService.undoLatest()`。

### 9.3 recorder 设计

记录层需要先扩展类型：

```ts
type ReplayRecordFrameType =
  | ExistingFrameTypes
  | 'UNDO_REQUESTED'
  | 'UNDO_ACCEPTED'
  | 'UNDO_REJECTED'
  | 'UNDO_EXPIRED'
  | 'UNDO_APPLIED';
```

建议新增 recorder 输入：

```ts
interface AppendUndoAppliedFrameInput {
  readonly matchId: string;
  readonly undoEntry: UndoEntrySummary;
  readonly requesterSeat: Seat;
  readonly authorityState: GameState;
  readonly remoteRevision: number;
  readonly recordBranchId: string;
  readonly restoredCaptureCursor: UndoRuntimeCaptureCursor;
  readonly reason?: string;
  readonly createdAt?: number;
  readonly idempotencyKey?: string;
}
```

`UNDO_APPLIED` 应写入新的 authority checkpoint。该 checkpoint 的 `relatedPublicSeq` 可以小于历史记录当前 `last_public_seq`，因为它表达“新时间线节点上的旧局面”。`timelineSeq` 与 `checkpointSeq` 必须继续单调递增。

recorder 还需要同步调整三类现有实现细节：

- `AppendMatchRecordFrameInput.frameType` 不能继续只允许 `COMMAND_ACCEPTED | COMMAND_REJECTED | SYSTEM_TRANSITION`；至少要扩展到 `UNDO_*`，并为这些 frame 补默认摘要、默认 visibility 和 dedupe 规则。
- `buildTransitionDedupeKey()` 或等价逻辑不能继续只用 `relatedCommandSeq` / `relatedGameEventSeq` / `relatedPublicSeq`。对撤销后分支，dedupe key 应包含 `recordBranchId`、`remoteRevision` 或请求 `idempotencyKey`。
- public/private event 的持久化唯一键和读模型排序要允许同一局里出现重复 runtime event seq。推荐把事实身份绑定到 `timelineSeq + eventSeq` 或 `recordBranchId + eventSeq`；回放读取按 `timelineSeq ASC, eventSeq ASC` 合成可见事件。

### 9.4 API 设计

对墙打即时撤销：

```http
POST /api/battle/solitaire-matches/:matchId/undo
Content-Type: application/json

{
  "expectedRevision": 42,
  "undoEntryId": "undo_...",
  "idempotencyKey": "..."
}
```

响应：

```ts
interface RemoteUndoResult {
  readonly success: boolean;
  readonly snapshot?: OnlineMatchSnapshot;
  readonly undo?: OnlineUndoView;
  readonly error?: string;
}
```

正式联机撤销请求：

```http
POST /api/online/matches/:matchId/undo-requests
POST /api/online/matches/:matchId/undo-requests/:requestId/accept
POST /api/online/matches/:matchId/undo-requests/:requestId/reject
```

请求对象：

```ts
interface UndoRequestView {
  readonly requestId: string;
  readonly requesterSeat: Seat;
  readonly targetUndoEntryId: string;
  readonly targetRevision: number;
  readonly summary: string;
  readonly expiresAt: string;
}

interface UndoGrantView {
  readonly grantId: string;
  readonly requesterSeat: Seat;
  readonly grantorSeat: Seat;
  readonly boundaryKey: string;
  readonly expiresAt: string;
}
```

后续可把 `/api/online` 和 `/api/battle` 收敛到统一 service 层，路由可以先按现有入口保留。

### 9.5 快照投影

首版建议把撤销视图放入 `playerViewState.match.undo`，让前端现有 store 在应用 snapshot 后自然拿到当前撤销状态：

```ts
interface OnlineUndoView {
  readonly policy: UndoPolicy;
  readonly canUndoNow: boolean;
  readonly disabledReason: string | null;
  readonly entry: UndoEntrySummary | null;
  readonly pendingRequest: UndoRequestView | null;
  readonly grant: UndoGrantView | null;
}

interface MatchViewState {
  readonly seq: number; // remote runtime uses remoteRevision
  readonly undo?: OnlineUndoView;
}
```

远程运行时生成 `PlayerViewState` 时，`match.seq` 使用 `remoteRevision`。本地和 replay 可以继续按现有语义使用。

### 9.6 前端状态与组件

需要调整：

- `BattleSurfaceCapabilities` 从 `canUndo` 扩展到 `undoPolicy`；可短期保留 `canUndo` 兼容，但新逻辑不再以它为唯一判断。
- `gameStore.canUndoLastStep()` 区分本地和远程策略。
- 新增 `undoRemoteLastStep()` 或统一 `undoLastStep()` 内部分派远程接口。
- `remoteMatchClient.ts` 分发 `undoRemoteMatch`。
- `solitaireMatchClient.ts` 实现对墙打撤销接口。
- `onlineClient.ts` 后续实现正式联机撤销请求接口。
- `PlayerArea` 根据 `undoPolicy` 显示“撤销”或“请求撤销”。
- 正式联机的撤销请求弹窗放在 `GameBoard` 或全局桌面层，不放在某个 `PlayerArea` 内部。

## 10. 实施计划

### P0：受控 undo entry 与 availability

范围：

- 为 `GameSession` 增加带元数据的 undo entry。
- 成功操作后补全 before/after seq、actor、boundary、公开/随机/后续标记。
- 新增 `getUndoAvailability()`。
- 新增 `undoLastStepForPlayer()`。
- 保持本地 `undoLastStep()` 行为不变。

验收：

- 本地撤销回归通过。
- 边界变化仍会清空 undo history。
- 失败命令和幂等重复命令不产生新 undo entry。
- 能判断 actor 不匹配、无 undo entry、边界失效、对手后续命令等禁用原因。

### P1：远程同步 revision

范围：

- 为 `OnlineMatchState` 增加 `remoteRevision`。
- 命令成功、阶段推进成功、撤销应用和撤销请求状态变化时递增。
- `getMatchSnapshot(... sinceSeq)` 使用 `remoteRevision` 短路。
- `RemoteMatchSnapshot.seq` 和远程 `playerViewState.match.seq` 使用 `remoteRevision`。
- `buildSnapshot()` 或等价投影入口必须把 `remoteRevision` 显式传给 `PlayerViewState.match.seq`；本地 `GameSession.getPlayerViewState()` 默认 public seq 语义保持不变。
- 若需要保留 public seq 给调试或恢复，新增明确字段，不复用 `seq`。

验收：

- 现有远程命令同步不回退。
- 同 seq 或旧 seq snapshot 仍被客户端正确丢弃。
- 撤销后的 snapshot 使用更高 revision，客户端不会因为 public seq 回退而忽略。
- 本地调试、本地对墙打和 replay 相关测试仍可继续假设默认 `PlayerViewState.match.seq` 是 public seq 或 checkpoint related public seq。

### P2：recorder 撤销 frame 与 checkpoint

范围：

- 扩展 `ReplayRecordFrameType`：新增 `UNDO_REQUESTED`、`UNDO_ACCEPTED`、`UNDO_REJECTED`、`UNDO_EXPIRED`、`UNDO_APPLIED`。
- 扩展 `MatchRecorderService` 支持追加撤销 frame。
- `UNDO_APPLIED` 写入新的 authority checkpoint。
- 为运行中 match 增加分支感知的 runtime capture cursor；撤销后 cursor 可以回退到恢复局面的 runtime seq，但 record timeline 继续单调递增。
- 扩展 frame dedupe key，撤销后新命令不能因复用 `relatedCommandSeq` / `relatedPublicSeq` 命中旧 frame。
- 调整 public/private event 持久化唯一键或写入模型，允许同一 match 在不同 timeline frame 中保存相同 runtime event seq。
- 调整 replay 事件读取排序，以 `timelineSeq` 为主顺序。
- 回放读模型能展示撤销节点摘要。
- `docs/match-replay/serialization-contract.md` 如需新增 frame 契约，应同步更新。

验收：

- 撤销不会删除旧 command/timeline/checkpoint。
- 撤销后最新 checkpoint 表示回滚后的权威局面。
- `timelineSeq` / `checkpointSeq` 单调递增。
- `relatedPublicSeq` 允许指向被恢复局面的 public seq，不影响时间线顺序。
- 撤销后继续提交新命令，即使 runtime `commandSeq` / `publicEventSeq` 复用旧值，也会产生新的 timeline frame、checkpoint 和可读事件。
- 回放 timeline 能按顺序看到“原操作 -> 撤销应用 -> 撤销后的新操作”，不会因同号 event seq 错序或漏项。

### P3：服务端可记录对墙打即时撤销

范围：

- 新增 `/api/battle/solitaire-matches/:matchId/undo`。
- `SolitaireMatchService` 校验真实 FIRST 用户后调用 `OnlineMatchService.undoLatest()`。
- 撤销后追加 `UNDO_APPLIED` frame 和 checkpoint。
- 前端对 `remoteSession.source === 'SOLITAIRE'` 显示远程撤销按钮。

验收：

- 登录态对墙打登场后可以撤销，手牌、能量、成员区回到前一局面。
- 撤销后客户端不会因为 seq 回退丢弃快照。
- 历史记录中能看到撤销 frame。
- 系统对手或非参与用户不能撤销。

### P4：正式联机请求式撤销

状态：已完成（2026-06-20 首版；2026-06-23 补充连续撤销授权）。

范围：

- 新增 undo request runtime state。
- 增加创建、接受、拒绝、超时失效接口。
- 增加连续撤销授权与 `/api/online/matches/:matchId/undo` direct undo 校验；没有授权时 direct undo 仍会被拒绝。
- 前端实现请求弹窗与状态刷新。
- 对手接受后执行同一受控撤销入口；若选择允许连续撤销，同一撤销边界内后续撤销不再重复弹请求。

验收：

- A 发起请求，B 拒绝后状态不变。
- A 发起请求，B 接受后双方桌面同步回退。
- A 发起请求，B 选择允许连续撤销后，A 可继续撤销同一操作窗口内的上一条最新 undo entry。
- 请求期间如果出现新命令，旧请求失效。
- 非参与者、错误 seat、旧 revision 请求均被拒绝。
- 没有连续授权时，正式联机 direct undo 不能绕过对手同意。
- 涉及人类对手已看到隐藏信息的操作可以请求撤销，但弹窗提示已知信息不会被消除。

### P5：远程调试与体验收束

状态：未完成。

范围：

- 远程调试联机按配置选择 `REMOTE_REQUEST` 或开发态 `REMOTE_IMMEDIATE`。
- UI 补充禁用原因、超时提示、请求摘要。
- 回放时间线增强撤销节点展示。
- 将 `docs/battle-mode-purpose-and-boundaries.md` 中“远程不支持撤销”的现状说明更新为新事实。
- 更新 `docs/current-limitations.md`。

验收：

- 对局结束后回放不会把被撤销操作当成最终事实。
- 管理员审计可以追踪撤销前后状态。
- 文档、测试和当前限制同步。

## 11. 测试清单

后端单元测试：

- `GameSession` 本地撤销回归。
- `getUndoAvailability` 对 actor、边界、不可逆信息、对手后续命令的判断。
- `remoteRevision` 在命令、阶段推进、撤销和撤销请求状态变化后单调递增。
- `MatchRecorderService` 可追加 `UNDO_APPLIED` frame 和 authority checkpoint。
- `MatchRecorderService` 在撤销后 runtime seq 复用时，不会用旧 `relatedCommandSeq` / `relatedPublicSeq` dedupe 掉新 frame。
- public/private event 记录允许同一 match 中重复 runtime event seq，并通过 timeline 顺序读取。
- `SolitaireMatchService` 只允许真实 FIRST 用户撤销。
- `OnlineMatchService` 撤销请求的接受、拒绝、超时和失效。

集成测试：

- `/api/battle/solitaire-matches/:id/undo` 成功和失败路径。
- 撤销后 recorder 追加 frame 和 checkpoint。
- 撤销后再提交一个会产生 public/private event 的命令，历史记录仍追加新的 frame 和事件行。
- 回放读取撤销后的最新 checkpoint。
- 回放读取包含撤销前旧操作、`UNDO_APPLIED` 和撤销后新操作，且顺序按 timeline 而不是重复 event seq 排列。
- `/api/online/matches/:id/undo-requests` 全流程。

前端测试：

- `BattleSurfaceCapabilities` 各 surface 的 `undoPolicy`。
- `gameStore.undoLastStep()` 本地和远程分发。
- 远程低 seq 快照不会覆盖高 seq；撤销快照使用更高 revision 后能正常应用。
- `PlayerArea` 正确显示“撤销”或“请求撤销”。
- `GameBoard` 正确展示正式联机撤销请求弹窗。

手工验收：

- 服务端可记录对墙打：登场、支付费用、移动成员、确认卡效后尝试撤销。
- 服务端可记录对墙打：没有 undo entry、旧 revision、重复 idempotency key、非参与用户、系统对手均被正确处理。
- 正式联机：两浏览器分别测试接受、拒绝、超时。
- 正式联机：两浏览器测试“允许连续撤销”，确认同一操作窗口可连撤，换阶段或有新动作后授权失效。
- 对手已操作后，旧撤销请求失效。
- 涉及人类对手已看到隐藏信息的动作可以请求撤销；撤销后只回滚局面，不消除已看到的信息。

## 12. 风险与注意事项

- 不要只改 `canUndo=true`。按钮恢复但命令仍走本地 `GameSession` 会造成状态分裂。
- 不要让远程 `match.seq` 继续使用会回退的 public seq。客户端同步层会丢弃旧 seq。
- 不要从撤销后的 `GameSession` 增量事件里倒推撤销历史。撤销本身必须由 service/recorder 显式追加。
- 不要把 `match_records.last_public_seq` / `last_command_seq` 当作撤销后的运行时采集游标。它们是持久记录最大游标，不适合在 runtime seq 回退后继续传给 `session.get*Since()`。
- 不要让撤销后的新命令继续用 `COMMAND_ACCEPTED:command:<seq>` 这类只含回退 seq 的 dedupe key；同一 seq 在撤销前后可能代表不同事实。
- 不要让 public/private event 表只按 `match_id + event_seq` 去重，否则撤销后复用的 event seq 会被静默丢弃。
- 不要删除历史记录行。撤销是新事实，不是抹掉旧事实。
- 不要跨玩家后续命令撤销。正式联机必须保护对手基于局面的决策。
- 不要把撤销描述成能抹掉人类对手已看到的隐藏信息。看过的牌无法从玩家记忆中移除。
- 不要把系统对手当真实用户授权。服务端可记录对墙打只能由真实 FIRST 座位用户撤销。
- 不要把 replay readonly 复用成撤销入口。回放只能读。
- 不要让撤销请求长期挂起。需要超时和新命令失效机制。

## 13. 推荐落地顺序

推荐按 P0 到 P3 先完成服务端可记录对墙打即时撤销，再推进 P4 正式联机请求式撤销。

理由：

- P0/P1/P2 是所有远程撤销共享底座。
- 对墙打只有一个真实用户，不需要双方同意协议，能先验证权威回滚、remoteRevision、recorder frame 和前端远程分发。
- 正式联机请求式撤销复用同一受控入口，风险更低。

如果资源允许，也可以在 P2 之后直接实现正式联机请求模型；但不应跳过 P0/P1/P2，否则会出现状态能回滚、同步或历史记录不可靠的问题。
