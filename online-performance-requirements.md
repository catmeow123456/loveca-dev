# 联机对局中途卡顿问题记录

> 文档类型：专题说明
> 适用范围：正式联机对局中“中途越来越卡”的现象、可能原因和当前发现
> 当前状态：已复核当前代码；主要嫌疑已修复，仍存在若干残余压力点需要验证和后续优化

---

## 1. 现象

生产环境中，和同学进行正式联机对局时，中途可能出现明显卡顿，并且对局越久越容易变严重。

已反馈的表现包括：

- 操作后界面短暂停顿或响应变慢
- 对手操作同步变慢
- 阶段推进、确认、拖拽等交互反馈不及时
- 对局进行一段时间后比刚开局更卡

## 2. 原始最可疑原因

### 2.1 联机快照返回全量历史

原始排查时，正式联机每次获取对局快照会返回从开局到当前的完整事件历史和快照历史：

- `publicEvents: match.session.getPublicEventsSince(0)`
- `privateEvents: match.session.getPrivateEventsSince(participant.playerId, 0)`
- `snapshots: match.session.getSnapshotHistory()`

这意味着对局时间越长，单次同步响应体越大。前端需要下载、解析、反序列化和应用的数据也会越来越多。

该情况非常符合“中途越来越卡”的表现。

### 2.2 正式对局轮询频率较高

正式联机进入对局后，客户端会按固定间隔同步对局状态：

- 房间状态轮询间隔：约 1200ms
- 对局快照轮询间隔：约 800ms

如果每次对局快照都携带越来越大的历史数据，固定高频轮询会持续放大网络、服务端序列化、客户端解析和渲染压力。

### 2.3 命令响应也携带完整快照

玩家提交命令或推进阶段后，服务端返回结果中也会附带对局快照。若该快照同样包含完整历史，玩家主动操作时也可能触发一次较重的同步处理。

### 2.4 客户端反序列化成本会随响应体增长

客户端收到联机数据后会通过 transport serde 递归恢复结构。响应体越大，主线程解析和递归处理耗时越高，可能直接表现为界面卡顿。

### 2.5 每次状态变化可能触发较大范围 UI 更新

客户端会把新的 `playerViewState` 应用到全局 store。只要对局序号变化，牌桌相关组件可能重新计算和渲染。若同步频率高、响应体大、卡牌对象多，渲染压力会进一步增加。

### 2.6 卡图预加载可能叠加卡顿

远程快照应用前，会对新变为正面可见的卡牌图片做预加载，并设置了短时间预算。网络或对象存储较慢时，这部分可能与同步解析、渲染一起叠加成可感知卡顿。

## 3. 当前代码状态复核

### 3.1 已解决：正式联机不再返回全量历史

当前正式联机的 `OnlineMatchSnapshot` 已经改为 `RemoteMatchSnapshot`，只包含：

- `matchId`
- `seat`
- `playerId`
- `seq`
- `playerViewState`

正式联机快照构造函数 `buildSnapshot()` 只返回当前玩家视图，不再附带 `publicEvents`、`privateEvents`、`snapshots`。

历史字段目前保留在 `RemoteMatchHistorySnapshot`，并主要用于调试联机路径。正式联机类型 `OnlineMatchSnapshot` 没有引用该历史快照类型。

结论：原始最高优先级嫌疑，也就是“正式联机每次 snapshot 都返回从 0 开始的完整历史”，在当前代码中已经修复。

### 3.2 已解决：正式联机轮询支持未变更小响应

正式 snapshot 路由读取 `sinceSeq`：

- 客户端同步时传入当前 `playerViewState.match.seq`
- 服务端比较 `sinceSeq` 与 `currentPublicEventSeq`
- 若 `sinceSeq >= currentSeq`，服务端返回 `{ matchId, seq, modified: false }`
- 客户端收到 `modified: false` 后返回 `null`，不会预加载图片，也不会应用 store

这意味着 800ms 高频轮询在“对局状态没有变化”时，响应体已经很小，也不会触发大范围 UI 更新。

### 3.3 已保留：命令和阶段推进仍返回整份当前视图

玩家提交命令或推进阶段后，服务端仍会返回一份完整的当前 `playerViewState`。

这不再包含全量历史，因此不会随事件历史无限增长；但它仍然包含整张牌桌的当前投影视图。若某次操作导致大量卡牌对象、区域、权限提示变化，客户端仍需要完成：

- HTTP 响应下载
- JSON 解析
- transport 递归反序列化
- 新公开卡图预加载
- store 替换 `playerViewState`
- React 组件重新计算和渲染

结论：命令响应的“历史增长型压力”已解决，但“整份当前视图替换”的压力仍存在。

### 3.4 已保留：正式对局仍使用 HTTP 轮询

正式联机仍有两个轮询：

- 房间状态轮询：约 1200ms
- 对局快照轮询：约 800ms

对局轮询已通过 `sinceSeq` 降低无变化时的成本，并且有 `polling` 标记避免同一个 effect 内请求重叠。

仍需注意：

- 房间轮询在 `IN_GAME` 后仍继续存在，会与对局轮询并发。
- 房间轮询和对局轮询没有统一调度，弱网下仍可能与命令请求、图片请求叠加。
- 轮询不是推送模型，服务端仍会持续接收空转请求。

结论：轮询本身不再是主要增长型卡顿源，但仍是稳定的背景压力。

### 3.5 已解决：正式联机响应侧已绕过 transport serde

正式联机 snapshot、命令响应和阶段推进响应已经直接返回 JSON-native DTO，不再在响应侧调用 `toTransport()`，客户端正式联机响应也不再调用 `fromTransport()`。

仍需区分：

- 命令请求体仍保守使用 `toTransport(command)` / `fromTransport<GameCommand>()`，但请求体规模远小于完整 `playerViewState`。
- 调试联机路径仍可使用通用 transport serde，不应和正式联机性能结论混用。
- 每次真实状态变化仍会传输并替换整份当前 `playerViewState`，主要压力转为 JSON 解析、store 写入、图片预加载和 React 渲染。

结论：正式响应侧 serde 已不再是残余卡顿主因；后续性能排查应优先看整份视图替换后的渲染和快照应用成本。

### 3.6 已保留：store 替换整份 `playerViewState` 可能触发大范围渲染

客户端收到新快照后会把整份 `playerViewState` 写入 Zustand store。当前代码已经避免重复 seq 的应用：

- 如果 `match.seq`、`playerId`、`seat` 都相同，`applyRemoteSnapshot()` 直接返回原 state。

但只要 seq 变化，牌桌相关组件会重新读取 store：

- `GameBoard` 订阅了 match、phase、subPhase、activeSeat、分数等多个派生值。
- 两个 `PlayerArea` 会读取大量区域、卡牌 ID、权限状态。
- `PlayerArea` 中很多数据通过 `getSeatZoneCardIds()`、`getCardViewObject()` 等方法在 render 期间重新计算。
- `getZoneCardIds()` 每次会把 public object id 映射为 card id，通常会生成新数组。
- 多个组件通过方法型 selector 订阅函数引用，再在 render 中从全局 state 读取最新 `playerViewState`。

这意味着当前架构在真实状态变化时仍可能产生较大的 render fan-out。由于未变更轮询已被跳过，这个压力主要发生在：

- 玩家主动操作后
- 对手操作同步到本地后
- 阶段自动推进产生多次 seq 变化时
- 检视、判定、结算等涉及多张卡移动或公开的流程中

结论：UI 渲染仍是主要残余压力点之一，尤其需要 Performance 面板确认真实操作后的 commit 时间。

### 3.7 已保留：卡图预加载有时间预算，但仍可能叠加卡顿

远程快照应用前会扫描新快照中的 `objects`，找出从非正面变为正面、或正面 cardCode 变化的卡牌，并预加载 medium 图片。

当前已有保护：

- 使用 `Set` 去重本次快照的图片 URL。
- `preloadImage()` 有全局缓存，成功或失败后都会标记，避免重复尝试。
- 预加载等待预算为约 180ms，超时后继续应用快照。

剩余风险：

- 扫描 `nextViewState.objects` 是全量扫描，成本随当前对象数增长。
- 首次公开多张卡时会同时发起多张图片请求。
- 图片请求、浏览器解码、React 渲染可能叠加在同一段时间。
- 如果对象存储或 Nginx 代理慢，虽然逻辑只等待 180ms，但浏览器网络和解码压力仍存在。

结论：卡图预加载不太像“越打越卡”的主因，但可能解释“某些公开/检视/判定瞬间特别顿”。

### 3.8 已保留：拖拽交互对 store 更新和重绘敏感

拖拽使用 `@dnd-kit`。代码已经做了一些降成本处理：

- 拖拽传感器设置 5px 激活距离。
- `DroppableZone` 拖拽中关闭 transition。
- 高亮使用 outline，避免 box-shadow ring 的重绘成本。

剩余风险：

- `DroppableZone` 订阅 `ui.isDragging` 和 `ui.highlightedZones`，拖拽开始/结束会让多个放置区重新渲染。
- 拖拽 hover 本身由 `@dnd-kit` 驱动，区域较多时碰撞检测和样式更新仍可能频繁。
- 若拖拽同时遇到后台 snapshot 应用，交互会被同步渲染打断。

结论：拖拽卡顿更像交互局部压力，可能被后台同步放大。

### 3.9 调试联机仍保留全量历史

`debug-match-service` 的 snapshot 仍返回：

- `publicEvents: match.session.getPublicEventsSince(0)`
- `privateEvents: match.session.getPrivateEventsSince(playerId, 0)`
- `snapshots: match.session.getSnapshotHistory()`

调试页面每 1200ms 轮询状态，并在状态更新 effect 中调用 `syncRemoteDebugState()`。调试联机不是本文原始生产问题的正式联机路径，但如果用调试联机复现性能问题，它仍然可能出现“越打越卡”的历史增长问题。

结论：正式联机已修，调试联机未修；压测正式问题时不要混用调试联机结论。

### 3.10 `seq` 作为未变更判断的边界

正式联机用 `currentPublicEventSeq` 判断 snapshot 是否变化。多数状态变化会通过公开事件推进 seq，例如阶段、窗口、声明、卡牌移动等。

需要注意的是，`GameSession.setAuthorityState()` 当前顺序是：

1. 写入权威状态
2. 记录公开事件
3. 记录私有事件和审计
4. 记录 authority snapshot

如果未来新增某类只改变当前玩家私有视图、但不增加 public seq 的状态变化，`sinceSeq` 可能误判为未修改。因此后续新增规则时需要确认：

- 影响任一玩家 `playerViewState` 的变化是否一定推进 public seq
- 或正式 snapshot 是否需要引入独立 view revision

结论：当前逻辑看起来可用，但 `seq` 的语义应被明确为“视图变更版本”或补充独立版本号。

## 4. 残余问题汇总

| 优先级 | 残余压力点 | 当前判断 | 建议验证指标 |
| --- | --- | --- | --- |
| 高 | 真实状态变化后整份 `playerViewState` 替换导致大范围 React 渲染 | 最值得继续确认的残余卡顿源 | React commit 时间、组件 render 次数、操作后 long task |
| 高 | 命令/阶段推进返回整份当前视图 | 不随历史增长，但单次操作仍可能重 | 命令响应体大小、JSON parse、快照应用和渲染耗时 |
| 中 | 800ms 对局轮询 + 1200ms 房间轮询背景压力 | 无变化时成本已小，但仍会占用网络和服务端请求处理 | 空转请求 QPS、304/not-modified 比例、弱网下请求排队 |
| 中 | 卡图预加载与图片解码 | 可能造成公开卡牌瞬间顿 | 图片请求耗时、decode 任务、公开多卡时 long task |
| 低 | transport 递归处理 | 正式响应侧已移除；请求侧和调试路径仍保留 | 命令请求体大小、调试 snapshot 响应体大小 |
| 中 | 拖拽期间同步更新打断交互 | 局部交互风险，可能被后台同步放大 | 拖拽 FPS、pointer event 延迟、同步到达时掉帧 |
| 低/中 | 调试联机仍返回全量历史 | 影响调试路径，不应混同正式联机 | 调试 snapshot 响应体随时间变化 |
| 低 | `seq` 语义边界 | 当前可用，未来规则扩展需注意 | 私有视图变化是否全部伴随 public seq |

## 5. 需要进一步确认的数据

后续排查时建议记录以下信息，以确认卡顿主因：

- 对局开始、10 分钟、20 分钟、30 分钟时的 `/api/online/matches/:matchId/snapshot` 响应体大小
- 同一时间点 `modified: false` 响应占比
- 单次 snapshot 服务端生成耗时
- 单次 snapshot JSON 序列化耗时
- 客户端下载耗时
- 客户端 JSON 解析和快照应用耗时
- 客户端应用快照后的渲染耗时
- React commit 时间和主要重渲染组件
- `playerViewState.objects` 数量、`table.zones` 数量、`availableCommands` 数量
- 命令响应体大小和命令响应处理耗时
- 浏览器 Performance 面板中是否出现明显主线程 long task
- 卡顿时是否伴随卡图请求、对象存储慢响应或大量图片解码
- 拖拽期间是否有 snapshot 应用、图片解码或长任务插入

## 6. 当前判断

当前正式联机代码已经解决原始最高优先级嫌疑：**正式联机 snapshot 不再返回全量历史，并且无变化轮询会返回小响应。**

因此，如果生产环境仍然出现明显“越打越卡”，需要优先确认部署版本是否包含该修复，以及浏览器实际收到的 snapshot 是否仍包含历史字段。

在确认部署正确后，剩余最可疑方向从“历史响应体无限增长”转为：

1. 真实状态变化时整份 `playerViewState` 替换引发的大范围 UI 更新。
2. 命令/阶段推进后的整份当前视图 JSON 解析、快照应用和渲染。
3. 卡图预加载、图片解码与同步渲染叠加造成的瞬时卡顿。
4. 轮询、命令请求和图片请求在弱网下并发排队。

换句话说，主要增长型问题已修复；剩余问题更可能是“单次状态变化处理较重”或“多个轻中等任务叠加到同一帧”。
