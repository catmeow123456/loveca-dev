# Loveca 联机模式边界规范

> 目的：固定联机首版开发中最容易拖慢进度、最容易反复返工的边界约束。  
> 适用范围：`GameSession`、`gameStore`、联机 UI 组件、后续命令/事件改造。

## 1. 状态边界

### 1.1 联机 UI 不直接消费权威态

- 联机 UI 的主数据来源是 `PlayerViewState`
- `GameState` 只作为本地兼容态或调试态存在
- 新组件不得以“先拿 `gameState` 再删敏”的方式实现联机视图

要求：

- 可见性、可操作性、当前阶段、当前 seat，一律优先从 `PlayerViewState` 或 store selector 读取
- 若组件需要公开区域对象列表，优先使用 store selector，而不是直接遍历 `cardRegistry`

### 1.2 非 `FRONT` 对象不得暴露实例详情

- `BACK` / `NONE` 对象不能通过 `getCardInstance()` 取到真实卡牌实例
- `ViewCardObject.frontInfo` 只允许在 `surface === FRONT` 时存在
- `ViewCardObject.cardType` 不得在 `BACK` 视图泄露

要求：

- 组件若需要详情浮层、名称、分数、心数，必须先确认当前 viewer 能看正面
- 无法看正面的对象统一渲染卡背或摘要，不要从兼容态偷读真实数据

## 2. Store Selector 规则

### 2.1 组件优先使用 selector，不直接拼 `playerViewState`

优先使用：

- `getMatchView()`
- `getPermissionView()`
- `getCurrentPhaseView()`
- `getCurrentSubPhaseView()`
- `getActiveSeatView()`
- `getTurnCountView()`
- `getViewingPlayerState()`
- `getOpponentPlayerState()`
- `getActivePlayerState()`
- `getPlayerStateById()`
- `getSeatZone()`
- `getZoneCardIds()`
- `getCardViewObject()`
- `getLiveScoreForPlayer()`
- `isLiveWinner()`
- `isLiveDraw()`
- `getConfirmedScoreCount()`
- `isScoreConfirmed()`

禁止：

- 在多个组件里重复写 `${seat}_XXX_ZONE`
- 在组件里自己拆 `publicObjectId`
- 到处直接访问 `playerViewState.table.zones[...]`
- 抓取 store 方法后在组件里手动拼一组联机派生状态，替代现成 selector

原则：

- 视图结构解释逻辑收敛在 store
- 组件只处理展示和交互，不重复承担联机投影解析

### 2.2 优先订阅 selector 值，不在组件里二次组装联机状态

优先写法：

- `useGameStore((s) => s.getCurrentPhaseView())`
- `useGameStore((s) => s.getLiveScoreForPlayer(playerId))`
- `useGameStore((s) => s.isScoreConfirmed(playerId))`

避免写法：

- 先拿 `getLiveScoreForPlayer` 方法，再在渲染函数里调用
- 先拿 `gameState.liveResolution`，再在组件里拆分分数、胜负、确认状态
- 先拿整块 `matchView`，只是为了读 `turnCount`、`phase`、`subPhase`

原因：

- selector 值订阅更直接，响应式边界更清楚
- 组件不需要知道底层状态是来自 `PlayerViewState`、兼容态还是后续重构后的聚合视图
- 可以减少“组件自己算了一遍，但 store 里已经有同义逻辑”的重复实现

## 3. 命令与动作边界

### 3.1 新联机 UI 不得接入旧 action 通道

新联机交互必须优先走：

- `executeCommand()`
- 语义化命令 creator

禁止继续新增对以下旧入口的依赖：

- `manualMoveCard`
- `performCheer`
- `undoOperation`

说明：

- 这些入口缺少稳定的联机语义、公共事件约束或审计边界
- 若当前确实缺命令，先补命令，不要回退到旧 action

### 3.2 公共世界变化必须有公共事件语义

只要操作会改变公共可观察事实，就必须能映射到 `PublicEvent`。

典型包括：

- 公开区移动
- 检视区进出与重排
- 翻开应援
- 成员登场
- Live 成功/失败后的公开处理

不要只改状态不补事件。

## 4. 组件实现约束

### 4.1 面板组件不扫描隐藏区实例

以下类型的面板最容易越界：

- 检视面板
- 判定面板
- 分数确认面板
- 详情浮层

要求：

- 卡牌列表优先来自可见 zone/object selector
- 分数、当前操作者、等待状态优先来自 store 中对应的只读 selector
- 不要通过“遍历某区卡牌实例再过滤 ownerId”推导联机视图

### 4.2 调试能力与正式联机路径分离

- Debug UI 可以存在
- 但调试入口不能成为正式联机组件的数据依赖
- 如果某能力仅用于本地调试，要在 store 或组件命名上明确标识

## 5. 文档与测试要求

每次联机边界改动至少补其中一类测试：

- `PlayerViewState` 可见性测试
- `GameSession` 脱敏兼容态测试
- 命令 -> 公共事件链路测试

如果改动影响了以下任一项，也必须同步文档：

- `PlayerViewState` 结构
- `PublicEvent` 语义
- 命令边界
- 被禁用的旧入口
