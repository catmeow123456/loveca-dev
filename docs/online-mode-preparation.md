# Loveca 联机模式准备工作文档

> 文档类型：设计/准备工作文档
> 适用范围：基于当前 `game_system_design.md` 与现有对局引擎实现，分析 Loveca 从本地双视角/对墙打推进到真实双人联机前需要完成的梳理、重构与基础设施建设。
> 最后更新：2026-04-01

---

## 1. 目标与结论

当前对局引擎已经具备一套可运行的本地权威状态模型，但它的“客户端”和“服务端”仍在同一进程中，且默认信任玩家、默认暴露完整权威状态、默认允许自由拖拽修正。这使它适合本地调试、对墙打、规则验证，但还不能直接上线成真实联机产品。

如果要做联机模式，且目标是“尽可能模拟实体卡远程对战，而不是把所有规则都硬编码成封闭式自动裁判”，建议先明确以下总原则：

- 服务端仍然要维护权威会话，但这个“权威”更接近远程牌桌记录员/同步器，而不一定是全自动裁判。
- 对局状态仍然必须拆成“权威状态”和“玩家视角状态”两层。
- “信任玩家原则”可以保留，但要转化为一种明确的联机模式设计，而不是默认的未定义行为。
- 阶段机必须显式区分“串行优先权窗口”和“双方并行等待窗口”。
- 隐藏信息、操作可见性、重连恢复、幂等、超时、争议回放要作为一等设计对象。

结论上，联机前最关键的准备工作不是先接 WebSocket，而是先把领域层和动作层整理成适合“远程判桌辅助”联机的形状。

---

## 2. 当前实现现状与联机相关事实

### 2.1 当前架构的真实边界

从 [game_system_design.md](/root/loveca/game_system_design.md) 以及代码看，当前核心路径是：

- `GameSession` 维护 `authorityState`，但仍是本地内存会话：[src/application/game-session.ts](/root/loveca/src/application/game-session.ts)
- `gameStore` 直接持有 `GameSession` 实例，前端并不是远程客户端：[client/src/store/gameStore.ts](/root/loveca/client/src/store/gameStore.ts)
- `getStateForPlayer()` 还未做脱敏，直接返回权威状态副本：[src/application/game-session.ts](/root/loveca/src/application/game-session.ts)
- 服务端目前只有 REST API，没有对局房间、实时同步、重连、观战、匹配等基础设施：[src/server/app.ts](/root/loveca/src/server/app.ts)

这说明当前“联机接口”还不存在，只有“本地服务端模拟器”。

### 2.2 当前状态机的真实形状

当前主阶段大致为：

- `SETUP -> MULLIGAN -> ACTIVE -> ENERGY -> DRAW -> MAIN`
- 先攻通常阶段结束后切到后攻通常阶段
- 后攻通常阶段结束后进入 `LIVE_SET -> PERFORMANCE(先攻) -> PERFORMANCE(后攻) -> LIVE_RESULT`
- 再回到下一轮先攻通常阶段

参考：

- [src/shared/phase-config/phase-registry.ts](/root/loveca/src/shared/phase-config/phase-registry.ts)
- [src/shared/phase-config/sub-phase-registry.ts](/root/loveca/src/shared/phase-config/sub-phase-registry.ts)
- [src/application/phase-manager.ts](/root/loveca/src/application/phase-manager.ts)

当前模型本质上是“共享阶段 + 单权威状态 + 子阶段派生活跃玩家”。这为联机很有价值，因为它已经显式表达了谁当前可操作，但还没把“双方同时等待”和“双方同时提交”的语义抽象清楚。

### 2.3 当前最不适合直接联机的点

#### A. 客户端默认可见完整状态

当前 `GameSession.getStateForPlayer()` 尚未脱敏，联机下会直接泄露：

- 对手手牌
- 对手盖放 Live 的真实内容
- 牌库顺序
- 对手可能不应提前知道的中间信息

参考：[src/application/game-session.ts](/root/loveca/src/application/game-session.ts)

#### B. 动作层采用“信任玩家”策略，但尚未被定义成联机契约

当前多处明确采用“信任玩家”原则：

- `MANUAL_MOVE_CARD` 支持自由拖拽
- 非法状态更多依赖规则层事后修正
- UI 允许大量自由区间操作

参考：

- [src/application/game-service.ts](/root/loveca/src/application/game-service.ts)
- [src/application/action-handlers/phase-ten.handler.ts](/root/loveca/src/application/action-handlers/phase-ten.handler.ts)
- [client/src/components/game/GameBoard.tsx](/root/loveca/client/src/components/game/GameBoard.tsx)
- [client/src/components/game/PlayerArea.tsx](/root/loveca/client/src/components/game/PlayerArea.tsx)

这套模式本身并不是问题。问题在于它目前只存在于本地 UI 和单进程会话里，还没有被正式定义为联机协议的一部分。

如果 Loveca 的联机目标是“远程模拟实体卡对战”，那么客户端不一定只能提交严格受限的数字卡牌命令。相反，可以保留较高自由度的玩家声明动作，但必须补齐：

- 哪些动作对双方公开
- 哪些动作只公开结果
- 哪些动作需要记录操作明细以便回放
- 哪些动作仍需最小规则护栏避免状态彻底失真
- 出现争议时如何回看操作序列

#### C. 规则层尚未完全收口

设计文档已注明：

- `check-timing.ts` 保留更完整模型，但未接主流程
- `live-resolver.ts` 也不是唯一主入口
- 运行时主链路更多是动作处理器 + `rule-actions`

这意味着“规则的唯一裁判入口”还没完全收口。联机需要一个确定、可回放、可审计的单一规则执行链。

参考：

- [game_system_design.md](/root/loveca/game_system_design.md)
- [src/domain/rules/check-timing.ts](/root/loveca/src/domain/rules/check-timing.ts)
- [src/domain/rules/rule-actions.ts](/root/loveca/src/domain/rules/rule-actions.ts)

#### D. 会话生命周期仍是内存态

当前没有：

- 对局房间持久化
- 动作日志持久化
- 快照与事件回放
- 断线重连恢复
- 幂等动作去重

这使真实联机中的断线、刷新、切设备、服务重启都无法被妥善处理。

---

## 3. 联机模式的目标架构建议

建议采用“服务端权威会话 + 事件流同步 + 视角脱敏快照”的架构，但这里的“权威”不等于“全自动裁判”，更接近“远程牌桌状态记录器 + 最小规则守卫 + 日志系统”。

```text
Client A / Client B
  -> 发送 Command
Match Gateway / Realtime Session
  -> 验证身份、房间、动作序号、幂等键
Authoritative Match Engine
  -> 校验动作合法性
  -> 执行规则与阶段推进
  -> 产生 Domain Events
Projection Layer
  -> 生成玩家A视角快照
  -> 生成玩家B视角快照
Persistence Layer
  -> 保存 Match / Action Log / Snapshot / Result
Realtime Push
  -> 推送事件与最新视角状态
```

建议把联机系统分成五层：

- Match 服务层：房间、座位、匹配、重连、超时、结算。
- 权威引擎层：只接受合法命令，产出确定性状态变更。
- 视图投影层：把权威状态裁剪成不同玩家可见的视图。
- 实时同步层：推送事件、ack、重放、补快照。
- 持久化层：动作日志、快照、对局结果、断线恢复信息。

---

## 4. 网络基础设施需要做哪些准备

### 4.1 房间与连接模型

至少需要新增以下概念：

- `Match`：一场对局的稳定标识。
- `Seat`：`FIRST` / `SECOND`，和用户 ID 分离。
- `Connection`：某玩家当前连接，可变，支持断线重连。
- `SessionVersion`：房间当前状态版本号。

建议：

- 用户先通过 REST 创建/加入房间。
- 对局中通过 WebSocket 维持实时通道。
- 所有服务端推送都带 `matchId + version + serverTimestamp`。

### 4.2 WebSocket 之外还要准备什么

WebSocket 只是传输层，不是联机架构本身。还需要：

- 命令幂等键：避免重复点击或重发造成重复执行。
- 服务端 ack：客户端必须知道命令是否被接受。
- 版本号检查：避免旧视图上的非法操作。
- 补快照机制：丢包、乱序、重连时以快照纠正。
- 心跳与会话过期：识别断线、假在线、长时间无响应。

建议协议分三类消息：

- `client_command`
- `server_ack`
- `server_event/server_snapshot`

### 4.3 持久化与恢复

联机必须新增对局数据表或等价存储：

- `matches`
- `match_seats`
- `match_connections`
- `match_commands`
- `match_events`
- `match_snapshots`
- `match_results`

其中：

- `commands` 用于审计、幂等、调试。
- `events` 用于回放。
- `snapshots` 用于快速重连恢复。

建议快照策略：

- 每 N 个事件做一次快照，或每个主阶段结束做一次快照。
- 服务重启后先加载最新快照，再回放后续事件。

### 4.4 匹配、约战、掉线和托管

至少要提前定义产品策略：

- 断线多久判负。
- 是否允许短时重连保留席位。
- 是否支持好友房/邀请码房。
- 是否支持观战。
- 是否支持超时自动过阶段/自动不发动/自动不换牌。

这部分会反过来影响状态机，因为“超时默认动作”本质上也是一种系统动作。

---

## 5. 游戏领域实体层需要先梳理什么

联机前，领域层最需要做的是“把权威状态、隐私信息、视图投影、房间实体”分开。

### 5.1 新增联机领域实体

建议新增：

- `MatchState`：对局级状态，包含房间元信息、座位、连接、倒计时、重连状态。
- `SeatState`：座位视角信息，而不是仅用 `playerId`。
- `CommandContext`：动作发起者、客户端版本、幂等键。
- `ProjectionPolicy`：容器级与卡牌级信息如何投影给不同座位。
- `TimerState`：阶段倒计时、优先权倒计时、断线宽限时间。

### 5.2 拆分权威状态与玩家视角状态

建议明确三套对象：

- `AuthoritativeGameState`
- `PlayerViewState`
- `SpectatorViewState`（如果未来要做观战）

其中 `PlayerViewState` 不能直接复用 `GameState`，因为很多字段需要裁剪或替换：

- 对手手牌：只显示数量，不显示实例内容。
- 盖放 Live：只显示张数、放置顺序、公共可见元信息，不显示真实卡面。
- 主牌库/能量牌库：只显示数量，不暴露顺序。
- 待处理选择：只对相关玩家可见。

### 5.3 卡牌实例的可见性元数据

建议给卡牌实例或区域状态补充：

- `surfaceForSeat`: `Record<Seat, 'NONE' | 'BACK' | 'FRONT'>`
- `occupancyVisibility`: 哪些观察者知道此处有独立卡对象
- `countVisibility`: 哪些观察者知道容器张数
- `orderPolicy`: `NONE | PUBLIC_ORDERED | OWNER_ORDERED_HIDDEN`

这样“公开区明牌”“公开区盖牌”“私有区仅张数公开”都能落在同一模型里，否则投影层只能到处写 if/else，长期会失控。

### 5.4 玩家标识与座位标识解耦

当前逻辑很多地方直接拿 `playerId` 做规则判断。联机后建议分开：

- `userId`：账号身份
- `seat`：`FIRST` / `SECOND`
- `playerId`：如果仍保留，应只是领域内玩家实例标识

原因：

- 重连时连接会变，座位不变。
- 托管/AI/裁判模式里，身份和操作者可能分离。

---

## 6. 规则层需要做哪些梳理和准备

### 6.1 建立单一权威规则入口

联机前必须回答一个问题：

“任何一个客户端命令进来后，引擎是通过哪一条唯一路径完成合法性校验、规则处理、诱发处理、阶段推进、结算收尾？”

建议目标：

- `Command -> Validate -> Apply Intent -> Resolve Rules/Triggers -> Emit Events -> Project Views`

不要继续保留多条等价主链路。

### 6.2 明确“强规则”与“弱辅助”

当前实现里有些逻辑在 UI 限制，有些在 handler 校验，有些在 `rule-actions` 事后清理。联机前应重分层：

- 强规则：必须在服务端命令校验或规则结算时严格执行。
- 弱辅助：UI 高亮、推荐落点、快捷操作。

联机下，以下都必须升格为强规则：

- 行动时机是否合法
- 卡牌来源是否合法
- 隐藏信息是否允许被引用
- 目标选择是否在合法集合内
- 是否满足费用与次数限制
- 是否满足当前窗口/子阶段

### 6.3 从“纯事后纠正”升级成“可审计的信任玩家模型”

当前 `MANUAL_MOVE_CARD + 规则自动纠正` 很适合调试，但联机下如果原样照搬，会带来几个问题：

- 客户端和服务端短时间看到不同中间态
- 很难解释“为什么你刚拖过去又被打回来”
- 会为作弊脚本提供更多试探面

联机建议：

- 保留“信任玩家原则”，允许玩家声明较自由的操作
- 但要把自由操作分层，而不是全部视为同一种拖拽
- 对局日志必须记录足够细的公开动作和私密动作元数据
- 服务端对一部分底线规则仍要做护栏

更准确地说，联机下不应是“完全禁用自由动作”，而应改成以下四类：

- `自由公开动作`：双方都看得到过程和结果，例如拖动公开区域的牌、翻开已公开的牌、调整公开结算区。
- `自由私密动作`：只有操作者自己看到过程，但服务端记录元数据，例如检视牌库顶部若干张、从私密候选中选择。
- `结果声明动作`：玩家自行完成实体卡式判断，再向系统声明结果，例如某张牌成功/失败、某个效果结算后的去向。
- `底线护栏动作`：服务端仍阻止明显破坏对局结构的操作，例如把能量牌放进手牌、跨玩家操作对方私有区、无上下文地删除牌。

因此，`MANUAL_MOVE_CARD` 不一定要删除，但需要拆语义，而不是继续作为一个“万能移动动作”存在于正式联机协议中。

### 6.4 诱发与检查时机要补完

设计文档已指出 `check-timing.ts` 更完整但未接主流程。联机前建议统一：

- 哪些是自动结算窗口
- 哪些是玩家响应窗口
- 相同事件下双方诱发如何排序
- 同一玩家多个可选效果如何排队
- 超时默认如何处理

如果这些规则不先收口，联机时会出现：

- 客户端看到“可以点”
- 服务端实际认为“窗口已过”
- 或双方都在等待对方导致死锁

### 6.5 确定性与可回放

联机规则层必须保证：

- 同一初始快照 + 同一命令序列，结果完全一致。
- 随机行为可重放。

建议：

- 洗牌使用服务端种子并落库。
- 所有随机结果写入事件流，而不是只写最终状态。

---

## 7. 动作层需要做哪些梳理和准备

### 7.1 把“拖拽动作”整理成“可同步、可见、可回放的联机命令”

联机动作建议分成两大层：

- 玩家命令：客户端可发，允许一定自由度
- 系统命令/系统事件：只由服务端产生

玩家命令示例：

- `SubmitMulligan`
- `PlayMemberToSlot`
- `SetLiveCardFromHand`
- `RevealCardsFromDeckTop`
- `LookAtCards`
- `MoveCardBetweenPublicZones`
- `EndMainPhase`
- `ConfirmJudgment`
- `ConfirmScore`
- `SelectSuccessLive`
- `PassPriority`

系统事件示例：

- `PhaseStarted`
- `SubPhaseStarted`
- `CardsDrawn`
- `LiveCardsRevealed`
- `RuleActionApplied`
- `MatchEnded`

### 7.2 命令必须携带上下文

每个联机命令建议至少带：

- `matchId`
- `seat`
- `commandId` 或 `idempotencyKey`
- `expectedVersion`
- `payload`
- `clientTimestamp`

这样服务端才能做：

- 幂等
- 版本冲突检测
- 重放保护
- 审计

### 7.3 拆掉“万能动作”，不是拆掉自由度

以下设计不建议直接进入联机正式模式：

- 一个没有可见性语义的 `MANUAL_MOVE_CARD`
- 一个没有公开/私密边界的“任意区域移动”
- 一个没有回放价值的纯前端快捷操作

建议做法：

- 保留自由操作能力
- 但为每类操作补上 `publicDelta/privateDeltaBySeat/sealedAudit` 语义，以及 `allowedContexts`
- 让服务端知道“哪些变化进入公共世界，哪些只属于某一座位，哪些只进密封审计”

例如：

- `LookAtTopDeckCards(count)`：私密动作，记录“看了几张”，通常不记录牌面给对手
- `RevealSelectedCards(cardIds, reason)`：公开动作，对手可见具体牌
- `MovePublicCard(cardId, fromZone, toZone)`：公开动作，双方看到过程
- `DeclareJudgment(cardId, success)`：结果声明，对手看到结果，必要时看到相关公开依据

### 7.4 动作结果不能只返回成功/失败

联机下，命令执行结果最好拆成：

- `accepted`
- `rejected`
- `applied_with_events`
- `requires_choice`

因为很多操作并不是“立刻结束”，而是“进入下一个等待玩家选择的窗口”。

---

## 8. UI 信息对双方玩家分别是否可见

这一部分应以 [docs/online-mode-visibility-matrix.md](/root/loveca/docs/online-mode-visibility-matrix.md) 作为正式基线，不再单独维护另一套“公开/私密”枚举。

### 8.1 建议的可见性原则

- 容器层单独定义“张数、占位、顺序”是否公开。
- 卡牌层单独定义“对每个观察者显示正面、背面还是不存在”。
- 公共区域不等于所有卡都必须对双方看正面；Live 盖牌就是公开容器中的背面对象。
- 私有区域不应伪装成一排对手可见的背面牌，而应只投影容器摘要。

### 8.2 按区域梳理

#### 手牌

- 自己：可见全部卡面、顺序、实例 ID。
- 对手：只应见数量；通常不应见卡面、实例 ID、顺序。

当前 UI 已经把对手手牌显示为背面，但这是展示层效果，不是服务端脱敏：[client/src/components/game/PlayerArea.tsx](/root/loveca/client/src/components/game/PlayerArea.tsx)

#### 主卡组 / 能量卡组

- 自己：通常只见数量；如有检视效果，再在临时窗口中见具体内容。
- 对手：只见数量，不见顺序和内容。

#### 成员区

- 双方：可见卡面、状态、位置、附加能量数量。
- 如有里侧状态或特殊隐藏效果，再单独定义。

#### 能量区

- 双方：通常可见明牌内容与活跃/等待状态。

#### Live 区

需要细分阶段：

- `LIVE_SET` 中，自己刚放下去的盖牌内容自己可见，对手不可见。
- `PERFORMANCE_REVEAL` 后，翻开的卡对双方公开。
- 若 Live 区里允许放置成员作为“弃置投入”，在未翻开前对对手仍应隐藏具体内容，只见里侧张数。

#### 成功区

- 双方公开可见。

#### 休息室 / 除外区 / 解决区

一般建议公开可见，但要明确是否允许查看顺序。

### 8.3 按动作与中间信息梳理

这里需要额外区分“过程可见”和“结果可见”。

#### Mulligan

- 玩家是否换牌：对手最终通常只需知道“已确认”。
- 具体换了哪些牌：不应公开。

#### 判定确认

- 若 `ConfirmJudgment` 只是确认公开已翻开的 Live 成败，则双方可见结果。
- 若其中包含基于隐藏信息的中间判断，应只暴露最终公开结果。

#### 检视牌库 / 看牌

- 若只是“看了几张”，对手通常可以知道动作发生以及张数。
- 被看到的是哪些牌，通常只对操作者可见。
- 若其中有公开、展示、加入手牌前公开等后续步骤，再按规则逐步转成公开信息。

#### 公开翻牌 / 展示

- 这类动作应让双方看到具体是哪几张牌，而不只是看到“发生了展示”。
- 对于实体卡模拟感来说，这部分非常重要，因为对手应能像在线下牌桌一样追踪你实际展示过的牌。

#### 分数确认

- 推荐分数可以双方公开。
- “玩家是否手调了分数”是否公开，要单独定义。

#### 可选效果选择

- 若效果目标/成本/结果本身公开，则动作应公开。
- 若选择过程涉及私密区域，可只公开最终合法结果，不公开候选集。

---

## 9. 双方玩家操作的阶段状态机模型

联机时不要只说“当前活跃玩家是谁”，而要定义“当前窗口类型”。

建议引入三类窗口：

- `SERIAL_PRIORITY`：严格单方操作，另一方等待。
- `SIMULTANEOUS_COMMIT`：双方可同时提交，直到都提交完成。
- `SHARED_ACK`：双方都需要确认，但不涉及隐藏选择。

### 9.1 建议映射到现有阶段

#### SETUP

- 类型：系统阶段。
- 行为：服务端建房、验卡组、分配座位、洗牌。

#### MULLIGAN

- 更推荐建模为 `SIMULTANEOUS_COMMIT`，而不是“先攻换牌 -> 后攻换牌”。
- 原因：双方换牌通常是互不依赖的私密动作，同时提交更符合实体卡与业界体验。

建议流程：

1. 双方同时进入 `MULLIGAN_WAITING_SUBMIT`
2. 玩家提交 `SubmitMulligan`
3. 服务端分别记录私密结果
4. 双方都完成后统一执行换牌结果并进入下一阶段

这样能减少无意义等待，也更符合隐藏信息原则。

#### ACTIVE / ENERGY / DRAW / MAIN

- 类型：`SERIAL_PRIORITY`
- 只有当前回合方操作，对手只接收公开变更。

#### LIVE_SET

建议改成 `SIMULTANEOUS_COMMIT`，而不是现在的“先攻盖牌、抽卡，后攻盖牌、抽卡”串行模式。

理由：

- 双方盖牌本质是私密并行准备。
- 串行模式会额外暴露节奏信息，也拖慢对局。
- 双方提交后再统一翻开/进入演出，联机体验更自然。

可建模为：

1. 双方同时提交本轮要放置的卡
2. 服务端记录双方私密放置
3. 双方都锁定后，分别处理补抽
4. 统一进入演出阶段

如果规则上必须维持先后，则要明确这是“规则要求”，不是“实现方便”。

#### PERFORMANCE

当前实现是先攻演出后攻演出，适合维持 `SERIAL_PRIORITY`。

但要额外拆：

- `Reveal`
- `OptionalTriggerWindow`
- `JudgmentConfirm`

其中：

- 如果只有当前演出方能操作，就是串行窗口。
- 如果某些诱发允许双方响应，就要引入更细的优先权传递模型，而不能只靠一个 `activePlayerIndex`。

#### LIVE_RESULT

这里至少分两种窗口：

- 成功效果处理：通常按既定顺序串行。
- 最终分数确认：更像 `SHARED_ACK`，双方都需要确认。

当前 `RESULT_SETTLEMENT` 已经是双方确认分数后才能结束，方向是对的：[src/application/action-handlers/phase-ten.handler.ts](/root/loveca/src/application/action-handlers/phase-ten.handler.ts)

---

## 10. 不同游戏阶段之间是同时进行还是有先后条件时机

建议整理为下面这张原则表。

| 阶段/窗口 | 建议模式 | 原因 |
| --- | --- | --- |
| 建房/验卡组/洗牌 | 系统自动 | 无需玩家逐步确认 |
| Mulligan 提交 | 双方同时 | 私密、互不依赖 |
| 通常阶段 | 严格先后 | 典型回合制优先权 |
| Live 放置 | 优先建议双方同时 | 私密、减少等待、减少节奏泄露 |
| 演出开始翻开 | 系统自动 | 一次性公开动作 |
| 演出中的可选效果 | 通常先后；如规则要求再做优先权交替 | 必须与规则文本一致 |
| 判定确认 | 通常先后 | 跟随当前演出方 |
| 结算分数确认 | 双方确认 | 避免单方推进导致认知不一致 |
| 回合结束/新回合开始 | 系统自动 | 确定性阶段推进 |

简化原则是：

- 私密且互不依赖的提交，尽量并行。
- 公开且有优先权依赖的行动，严格串行。
- 结算类动作由系统自动推进，确认类动作用双方 ack。

---

## 11. 双方的动作对对方是否可见

建议不再给动作贴单一“可见性标签”，而是统一拆成三层输出：

- `publicDelta`：双方共享的桌面变化与公共日志。
- `privateDeltaBySeat`：只给相关座位的私密补充信息。
- `sealedAudit`：仅服务端保存，用于回放与争议处理。

### 11.1 典型映射

- `PlayMemberToSlot`
  `publicDelta` 公开该牌进入公开区并显示正面。
- `SubmitMulligan`
  `publicDelta` 只公开“已提交”以及必要的数量摘要；完整换牌进入 `sealedAudit`。
- `SetLiveCardFromHand`
  `publicDelta` 公开 Live 区新增若干背面对象与补抽张数；具体卡牌只进本方 `privateDeltaBySeat`。
- `LookAtTopDeckCards(3)`
  `publicDelta` 最多公开“看了 3 张”；具体牌只进本方 `privateDeltaBySeat`。
- `RevealCards(cardIds)`
  `publicDelta` 公开这些牌变为双方可见正面。
- `RuleActionApplied`
  不是单独的 UI 可见性类别，它只通过对应的 `publicDelta/privateDeltaBySeat` 落到视图和日志。

前端日志也应区分：

- 玩家自己的详细日志
- 对手可见的公共日志
- 调试日志

不能继续把所有动作统一写成本地完整日志。

---

## 12. 联机前必须补的异常与恢复设计

### 12.1 断线重连

至少要支持：

- 玩家刷新页面后恢复到当前对局
- 玩家短时断线后继续操作
- 服务端告知当前等待谁、剩余多少时间

### 12.2 重复提交

必须支持：

- 同一命令因网络重发不会执行两次
- 客户端超时后可安全重试

### 12.3 版本冲突

客户端在旧版本状态上点了按钮时，服务端应返回：

- `stale_state`
- 最新版本号
- 可选的新快照

### 12.4 超时与默认行为

要提前定义：

- Mulligan 超时默认不换
- 可选效果超时默认不发动
- 分数确认超时默认接受推荐值
- 长时间断线是否判负

否则上线后会频繁卡死在等待窗口。

---

## 13. UI 层需要做的准备

### 13.1 从“本地状态读取”改成“服务端投影视图”

当前 `gameStore` 直接读本地 `GameSession`，联机后要改成：

- 本地 store 只持有 `PlayerViewState`
- 动作经网络发给服务端
- 服务端返回 `ack + event + snapshot`

### 13.2 UI 要显式展示等待关系

联机 UI 至少要展示：

- 当前轮到谁
- 当前窗口类型
- 自己是否已提交
- 对手是否已提交/已确认
- 剩余倒计时
- 是否正在等待服务端确认

### 13.3 日志与动画按可见性投影

例如：

- 对手 Mulligan：显示“对手已完成换牌确认”，不要显示具体卡。
- 对手盖 Live：显示“对手已盖放 2 张卡”，不要显示内容。
- Reveal 后：再用公开日志与动画展示真实结果。

---

## 14. 推荐的分阶段实施顺序

### 第一阶段：领域和规则收口

- 定义 `AuthoritativeGameState` 与 `PlayerViewState`
- 补状态脱敏投影层
- 禁用联机模式下的 `MANUAL_MOVE_CARD`
- 收口规则主链，明确唯一结算入口

### 第二阶段：联机会话与协议

- 新增 `Match` / `Seat` / `Command` / `Snapshot`
- 建立 WebSocket 协议
- 加入命令幂等、版本号、ack、重连恢复

### 第三阶段：阶段机升级

- 把 `MULLIGAN` 改成双方同时提交模型
- 评估并优先把 `LIVE_SET` 改成双方同时提交模型
- 把等待窗口模型显式化为 `SERIAL_PRIORITY / SIMULTANEOUS_COMMIT / SHARED_ACK`

### 第四阶段：前端联机化

- `gameStore` 改为远程驱动
- UI 增加等待态、重连态、超时态
- 日志与动画改为基于公开事件渲染

### 第五阶段：测试与运维

- 双端集成测试
- 断线重连测试
- 重发/乱序/幂等测试
- 压测与房间泄漏监控

---

## 15. 联机前的最小必做清单

如果只列最小必做项，我建议先完成以下事项再开始真正接实时联机：

1. 实现真正的 `getStateForPlayer()` 脱敏投影，而不是返回权威状态副本。
2. 定义正式的“容器可见性 + 卡牌可见面 + 三层审计输出”模型，并以此替代旧矩阵。
3. 将联机动作整理成带可见性与审计语义的命令接口，而不是继续依赖未定义的万能拖拽。
4. 收口规则执行主链，统一检查时机、诱发、结算和阶段推进。
5. 为对局引擎增加命令幂等键、状态版本号、事件日志和快照恢复模型。
6. 明确 `MULLIGAN`、`LIVE_SET`、`RESULT_SETTLEMENT` 这些双边窗口到底是串行还是并行。
7. 在服务端新增 `Match`、`Seat`、`Connection`、`CommandLog`、`Snapshot` 基础设施。

---

## 16. 对当前项目最重要的几个判断

### 判断 1

当前代码离“可联机引擎”并不远，但离“可上线联机产品”还有明显差距。核心差距不在卡牌规则本身，而在：

- 隐藏信息治理
- 动作权限边界
- 会话持久化
- 双方等待窗口模型

### 判断 2

`MULLIGAN` 和 `LIVE_SET` 很值得优先重构成双方并行提交窗口。它们是最容易暴露“当前阶段机仍偏本地调试思维”的地方。

### 判断 3

当前本地调试体验依赖“自由拖拽 + 规则纠错”，这套能力应该保留，但必须下沉为 `DEBUG/GM` 能力，不能直接带进正式联机。

---

## 17. 后续文档建议

在本文件基础上，建议继续拆三份实施文档：

- 《联机协议设计文档》：命令、事件、ack、版本号、重连协议。
- 《玩家视角状态投影文档》：每个字段对谁可见。
- 《联机状态机文档》：每个阶段/子阶段的操作方、等待方、超时默认动作、公开事件。
