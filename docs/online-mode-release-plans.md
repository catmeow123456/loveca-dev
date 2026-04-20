# Loveca 正式联机发布方案对照

> 文档类型：实施方案对照 / 发布前决策文档  
> 适用范围：把当前“调试联机 online-mode”迁移到正式可发布版时的两套可选落地方案。  
> 最后更新：2026-04-20

---

## 1. 文档目的

这份文档用于固定两套已经整理完成的正式联机首版实施方案：

- 方案 A：`HTTP 轮询首版`
- 方案 B：`WebSocket 首版`

两套方案共享同一产品目标：

- 玩家在正式版中输入同一个房间编号进入同一房间。
- 双方各自选择并锁定一副自己的合法云端卡组。
- 房主提出先后手方案，对手确认。
- 达成一致后，双方进入 online-mode 对局。

两套方案的主要差异不在于“产品流程”，而在于“同步链路”和“首版基础设施投入”。

---

## 2. 已锁定的共同前提

以下前提对两套方案都成立：

- 正式联机首版只允许已登录用户参与。
- 房间与准备状态首版只保存在服务进程内，不做数据库恢复。
- 房间最多 2 人。
- 房间号由玩家手动输入，同号即进入同一房间。
- 只能选择当前用户自己的云端合法卡组，不支持本地临时卡组。
- 先后手采用“房主提议，对手确认”的产品流程。
- 一旦双方锁组且先后手确认完成，系统自动进入对局，不额外增加“开始游戏”按钮。
- 对局内仍复用现有 `GameSession`、`PlayerViewState`、命令执行链路与快照投影能力。
- 当前调试联机不应继续作为单独演化分支；无论采用哪套方案，都应把调试页改为复用正式联机的基础服务能力。

---

## 3. 方案 A：HTTP 轮询首版

### 3.1 摘要

- 正式版房间和对局都走 REST API。
- 客户端在房间页和对局页通过固定间隔轮询获取最新状态。
- 房间准备阶段与对局阶段都可直接建立在当前调试联机的“请求返回快照”模型之上。
- 这是首版复杂度最低、与现状最接近的迁移路径。

### 3.2 适用场景

适用于以下目标优先级：

- 优先尽快把“双人房间 + 锁定卡组 + 协商先后手 + 正式进入 online-mode”做成可发布功能。
- 优先复用现有调试联机实现，而不是先补完整实时基础设施。
- 接受首版对局同步存在轻微轮询延迟。

### 3.3 服务端接口与状态模型

建议新增正式联机 REST 路由：

- `POST /api/online/rooms`
  创建或占用一个房间号；首个进入者自动成为房主。
- `POST /api/online/rooms/:roomCode/join`
  加入现有房间；房间满员返回错误。
- `GET /api/online/rooms/:roomCode`
  返回完整房间状态。
- `POST /api/online/rooms/:roomCode/deck`
  锁定或更新当前用户的卡组，服务端按 `deckId` 读取数据库中的正式卡组记录。
- `POST /api/online/rooms/:roomCode/turn-order-proposal`
  仅房主可调用；提交先后手提议。
- `POST /api/online/rooms/:roomCode/turn-order-response`
  仅对手可调用；接受或拒绝提议。

正式房间状态最少应包含：

- `roomCode`
- `status`：`PREPARING | READY | IN_GAME`
- `ownerUserId`
- `members`
- `lockedDeckId`
- `resolvedDeckConfig`
- `turnOrderProposal`
- `turnOrderAgreement`
- `matchId`
- `updatedAt`

正式对局接口建议复用当前调试联机语义，但迁移到正式 `online` 路由并增加登录保护：

- `GET /api/online/matches/:matchId/snapshot?seat=FIRST|SECOND`
- `POST /api/online/matches/:matchId/command`
- `POST /api/online/matches/:matchId/advance`

### 3.4 前端改造重点

- 首页新增“正式联机”入口，保留“联机调试”作为开发入口。
- 新增正式联机房间准备页，承担以下流程：
  - 输入房间号并加入房间
  - 查看双方房间成员
  - 选择并锁定自己的卡组
  - 房主发起先后手提议
  - 对手接受或拒绝
  - 对局开始后自动跳转到 `GameBoard`
- `gameStore` 中不再把远程联机能力限定为 `remoteDebugSession`，而是泛化为正式远程会话状态。
- 房间页每隔固定时间轮询房间状态。
- 对局页在“命令请求返回最新快照”的基础上继续轮询补齐对手动作。

### 3.5 服务端实现重点

- 从当前 `debug-match-service` 抽离通用 `online match service`。
- 新增 `online room service`，负责房间成员、准备状态和开局条件判定。
- 在房间层维持 `HOST / GUEST`，在开局时再解析为 `FIRST / SECOND`。
- 若任一玩家重新选择卡组，房间应从“可开局”退回“准备中”。
- 房主离开且房间未开局时，房主身份自动转移给剩余玩家。
- 房间无人后自动从内存中删除。

### 3.6 测试与验收场景

- 创建房间、第二人加入、满员拒绝。
- 同一用户重复进入同一房间时复用原成员槽。
- 非本人不能锁卡组；非房主不能发起先后手提议；非对手不能确认。
- 一方锁组、双方锁组、房主修改提议、对手拒绝、对手接受。
- 对手接受后自动生成 `matchId` 并进入对局。
- 正式对局快照与当前调试联机快照语义一致。
- 玩家改卡组导致房间重新进入准备态。
- 服务重启后房间状态丢失，并向客户端返回明确错误。

### 3.7 主要优点

- 与现有调试联机实现最接近，迁移成本最低。
- 出问题时容易调试，日志和抓包都直观。
- 可以把工作重点放在“正式产品流程”而不是“实时通道基础设施”。
- 更适合作为“先发布可用版本”的首选方案。

### 3.8 主要缺点

- 房间页与对局页都存在轮询请求。
- 对手状态更新不是服务端主动推送，而是“下一次轮询才看到”。
- 如果后续追求更顺滑的实时体验，最终仍可能转向 WebSocket。

---

## 4. 方案 B：WebSocket 首版

### 4.1 摘要

- 房间创建和加入可保留 REST；房间状态同步和对局内操作改由 WebSocket 承担。
- 服务端在状态变化时主动推送房间状态和对局快照。
- 这是更接近完整正式联机基础设施的方案，但首版工程复杂度明显更高。

### 4.2 适用场景

适用于以下目标优先级：

- 不满足于“先能发布”，而是希望正式联机底座一步走到更实时的方向。
- 计划较快补齐断线恢复、事件补拉、ack、观战等能力。
- 接受首版范围明显扩大。

### 4.3 建议的传输模型

推荐保留以下 REST 入口：

- `POST /api/online/rooms`
- `POST /api/online/rooms/:roomCode/join`

同时新增单一认证 WebSocket 通道，例如：

- `/ws/online`

客户端发送的消息可至少包括：

- `SUBSCRIBE_ROOM { roomCode }`
- `LOCK_DECK { roomCode, deckId }`
- `PROPOSE_TURN_ORDER { roomCode, mode }`
- `RESPOND_TURN_ORDER { roomCode, accepted }`
- `SUBSCRIBE_MATCH { matchId, seat }`
- `COMMAND { matchId, seat, command, requestId }`
- `ADVANCE_PHASE { matchId, seat, requestId }`

服务端返回的消息可至少包括：

- `ROOM_STATE { room }`
- `ROOM_ERROR { code, message }`
- `SESSION_STARTED { roomCode, matchId, seat }`
- `MATCH_SNAPSHOT { matchId, seat, snapshot }`
- `COMMAND_ACK { requestId, success, error? }`

### 4.4 前端改造重点

- 新增正式联机房间页，与方案 A 的页面职责相同，但不再依赖固定轮询。
- 新增联机 WebSocket 客户端层，负责：
  - 建连与鉴权
  - 发送房间/对局消息
  - 维护订阅
  - 跟踪 `requestId` 与 ack
- `gameStore` 需要支持基于 ack 和服务端推送快照更新本地状态。
- 调试联机页不应再维护独立轮询实现，而是复用同一套连接层，仅保留 dev UX。

### 4.5 服务端实现重点

- 在现有 HTTP server 旁挂接 WebSocket server。
- 建立 `connection registry`，跟踪：
  - `userId -> socket(s)`
  - `roomCode -> subscribers`
  - `matchId -> seat subscribers`
- 房间状态与对局状态变化后统一执行广播。
- 仍复用正式 `online room service` 与通用 `online match service`。
- 首版只做到“刷新页面后可以重新订阅仍存在的房间/对局”，不补事件回放和持久恢复。

### 4.6 测试与验收场景

- 登录可建立连接，未登录连接被拒绝。
- 双方加入同一房间后能实时看到成员状态变化。
- 锁组、改组、提议、拒绝、接受均会实时推送给双方。
- 接受提议后由 `SESSION_STARTED` 驱动跳转进入对局。
- 对局命令收到 ack，对手无需轮询即可看到状态推进。
- 断开订阅后不再收到广播。
- 重复订阅不会产生重复广播。
- 房间满员、房间不存在、卡组无效、seat 越权等情况返回明确错误。

### 4.7 主要优点

- 房间页与对局页都能做到真正实时。
- 更适合作为未来联机能力扩展的基础层。
- 后续接入 ack、断线重连、事件补拉、观战会更自然。

### 4.8 主要缺点

- 首版工程复杂度最高。
- 需要同时处理连接生命周期、鉴权、广播、请求关联和重连。
- 当前仓库尚无现成实时通信基础层，首版投入会明显偏大。
- 在“房间和对局状态仍只保存在进程内”的前提下，WebSocket 的长期收益尚未完全兑现。

---

## 5. 两套方案的关键对比

| 维度 | 方案 A：HTTP 轮询首版 | 方案 B：WebSocket 首版 |
| --- | --- | --- |
| 首版复杂度 | 低 | 高 |
| 与当前调试联机的距离 | 最近 | 更远 |
| 房间同步体验 | 准实时 | 实时 |
| 对局同步体验 | 命令即时 + 轮询补齐 | 实时推送 |
| 调试排查成本 | 低 | 中高 |
| 后续升级空间 | 需要后续再切换实时通道 | 更自然 |
| 更适合的目标 | 尽快发布可用版 | 同步建设正式联机底座 |

---

## 6. 当前建议

如果当前目标是：

- 尽快把“正式房间 + 锁卡组 + 先后手协商 + 进入 online-mode”做成可发布功能；
- 且首版明确不做持久化恢复；

则更推荐：

- **优先采用方案 A：HTTP 轮询首版**

原因：

- 它最接近当前调试联机能力，迁移路径最短。
- 可以优先把“产品可用闭环”补齐。
- 可以把复杂度控制在“正式版入口与状态编排”层，而不是提前投入完整实时基础设施。

如果后续目标切换为：

- 需要更顺滑的实时体验；
- 需要为断线恢复、事件补发、观战等能力打底；

则可以在正式房间模型已经落地后，再向方案 B 演进。

---

## 7. 与现有文档的关系

这份文档只回答：

- “正式版调试联机迁移”有哪些可实施方案？
- 两套方案各自会引入哪些接口、状态与工作量？

若进一步决定采用 WebSocket 方案，并需要分析对当前架构的重点设计修改，另见：

- `docs/online-mode-websocket-architecture-design.md`

它不替代以下文档：

- `docs/online-mode-preparation.md`
  用于收敛联机边界、术语与总体设计原则。
- `docs/online-mode-staged-refactor-plan.md`
  用于描述联机整体分阶段重构路线。
- `docs/online-mode-visibility-matrix.md`
  用于描述不同区域与对象的可见性规则。
- `docs/online-mode-event-classification-draft.md`
  用于描述公共/私密/审计事件分类。
- `docs/online-mode-public-event-minimum-schema.md`
  用于描述最小公共事件结构。
