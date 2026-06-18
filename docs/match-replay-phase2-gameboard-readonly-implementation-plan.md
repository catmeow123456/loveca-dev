# Loveca 对局回放 Phase 2：只读 GameBoard 展示实施文档

> 文档类型：实施计划
> 适用范围：历史对局页面选择 checkpoint 后，复用现有 `GameBoard` / `PlayerArea` 展示 `MatchRecordReplayView.playerViewState`，并保证回放模式只读
> 当前状态：已实施 v1.0
> 最后更新：2026-06-19

## 1. 目标

Phase 2 目标是在已有历史记录读取能力基础上，把普通历史页从“摘要面板 + zone 列表”推进到“玩家视角桌面回放”：

- 历史页选择某个 checkpoint 后，将 `replay.playerViewState` 注入前端 store。
- 复用现有 `GameBoard` / `PlayerArea` / 卡牌详情 / 判定区展示能力。
- 禁用所有会提交命令或改变权威状态的入口，包括拖拽、出牌、阶段推进、效果确认、费用支付、换牌、判定提交、分数确认、调试模式切换和免费登场。
- 保持玩家视角隐私边界：普通用户只能看到服务端 replay API 已投影出的 `PlayerViewState`，前端不接触 authority checkpoint。

本阶段不是确定性重演，不重新运行规则引擎，不播放逐命令动画，也不提供修改历史状态的功能。

## 2. 当前基础

当前暂存区已经具备 Phase 2 的主要后端前提：

- `GET /api/online/match-records/:matchId/replay` 已返回 `MatchRecordReplayView`。
- `MatchRecordReplayView.playerViewState` 与实时桌面 store 使用的 `PlayerViewState` 是同一类型。
- 服务端 `match-replay-read-service` 会从 authority checkpoint 复水，再调用 `projectPlayerViewState(authorityState, viewerPlayerId, ...)` 生成玩家视角投影。
- 普通 replay 响应已经包含 `timelineCursor`、`checkpointInfo`、`visibleEvents`、`visiblePrivateEvents`、`visibleDecisions` 和 `playerViewState`，但不返回 authority payload、sealed audit 或对手私密事件。
- `MatchRecordsPage` 已能读取列表、详情、timeline 和指定 checkpoint 的 replay，并维护当前 `replay` 状态。
- `GameBoard` / `PlayerArea` 的主要展示查询都读 `gameStore.playerViewState`，理论上可以直接展示 replay checkpoint。

当前尚未满足 Phase 2 的前端只读前提：

- `gameStore` 只有本地 session 与远程 session 概念，没有独立 replay session。
- `BattleSurfaceCapabilities` 没有 `REPLAY_READONLY` surface，也没有统一 `isReadOnly` 标志。
- 部分桌面交互只按阶段窗口判断可操作，不完全依赖 `permissions.availableCommands`。
- `GameBoard` 的 active effect 与 pending cost 确认按钮当前只按 seat / 能量数量判断，未统一检查只读模式。
- `DebugControl` 当前会在桌面端渲染，且免费登场控制默认对所有 surface 开启。
- `MatchRecordsPage` 当前异步加载 detail / timeline / replay 后直接写入本地 state；接入桌面 store 前必须增加请求序号防护，避免旧 checkpoint 请求较晚返回后覆盖当前回放视图。

## 3. 实施原则

- 只读是 store / surface 的一等模式，不能仅依赖“没有 command hints”间接禁用。
- 实施顺序必须先落 store / surface 只读防线，再接 GameBoard overlay 或页面入口；不能先做 UI 禁用再补命令兜底。
- replay checkpoint 注入不能伪装成远程联机会话；否则误触命令时可能走 `/matches/:matchId/command`。
- UI 层要禁用交互，store 命令出口也要兜底拒绝，形成双层防线。
- `GameBoard` 和 `PlayerArea` 继续作为唯一桌面展示组件，不新建一套回放专用桌面。
- 历史页面负责 checkpoint 选择、节点导航和 replay session 生命周期；规则状态仍来自服务端投影。
- replay 模式下允许本地 UI 状态，例如 hover 卡牌、展开休息室、打开判定区、折叠效果窗口；不允许提交 `GameCommand` 或修改 `playerViewState`。
- 只读模式不应污染实时对局 store；离开历史页、切换记录或进入联机/本地对局时必须清理 replay session。

## 4. 交付边界

### 4.1 本阶段包含

- 新增 replay readonly session 状态。
- 历史页 checkpoint 选择后注入 `playerViewState`。
- 在历史页内嵌或全屏展示现有 `GameBoard`。
- 禁用拖拽、出牌、阶段推进、命令提交和调试控制。
- 展示只读标识、checkpoint 信息和 partial/incomplete 提示。
- 保留历史页 timeline 前进、后退、跳转 checkpoint。
- 补 focused 单元测试和前端类型检查。

### 4.2 本阶段不包含

- 确定性重演。
- 逐命令动画播放。
- 从 decision record 回放玩家选择过程。
- 跨视角切换到对手隐藏信息。
- 管理员 authority replay UI。
- 新增后端权限模型。
- 改造 card effect runner 或规则引擎。

## 5. 推荐架构

### 5.1 Store 状态

在 `client/src/store/gameStore.ts` 增加独立 replay 状态：

```ts
export interface ReplayReadonlySessionState {
  readonly matchId: string;
  readonly viewerSeat: Seat;
  readonly viewerPlayerId: string;
  readonly checkpointSeq: number;
  readonly timelineSeq: number;
  readonly recordStatus: string;
  readonly recordCompleteness: string;
  readonly partialReasonSummary: string | null;
}
```

新增 store 字段：

```ts
readonly replaySession: ReplayReadonlySessionState | null;
```

新增动作：

```ts
enterReadonlyReplay: (replay: MatchRecordReplayView) => Promise<void>;
leaveReadonlyReplay: () => void;
isReadonlyReplayMode: () => boolean;
```

`enterReadonlyReplay` 负责：

- 预加载从旧 view 到新 view 新出现的正面卡图。
- 校验 `replay.viewerSeat === replay.playerViewState.match.viewerSeat`，不一致时拒绝注入。
- 从 `replay.playerViewState.match.participants[replay.viewerSeat].id` 派生 `viewerPlayerId`；`MatchRecordReplayView` 当前不直接返回 playerId，不能凭空写死。
- 规范化 `replay.playerViewState`。
- 清空或禁用 `permissions.availableCommands`。
- 设置 `playerViewState`、`viewingPlayerId: viewerPlayerId`、`remoteSession: null`、`replaySession`。
- 清理 selected / dragging / highlighted / hovered 等会影响操作态的 UI 状态。

建议新增一个专用 normalize 入口：

```ts
function normalizeReadonlyReplayViewState(playerViewState: PlayerViewState): PlayerViewState {
  const normalized = normalizePlayerViewState(playerViewState);
  if (!normalized) {
    throw new Error('历史回放视图状态为空');
  }

  return {
    ...normalized,
    permissions: {
      ...normalized.permissions,
      availableCommands: [],
    },
  };
}
```

建议新增一个明确的视角派生 helper，避免后续误用 `viewerSeat` 当作 playerId：

```ts
function getReadonlyReplayViewerPlayerId(replay: MatchRecordReplayView): string {
  const viewerSeat = replay.viewerSeat;
  if (viewerSeat !== replay.playerViewState.match.viewerSeat) {
    throw new Error('历史回放视角与投影视角不一致');
  }

  const viewerPlayerId = replay.playerViewState.match.participants[viewerSeat]?.id;
  if (!viewerPlayerId) {
    throw new Error('历史回放缺少当前视角玩家信息');
  }

  return viewerPlayerId;
}
```

不要复用 `connectRemoteSession` 或 `applyRemoteSnapshot`，因为 replay 不是可提交命令的远程 match。

### 5.2 Surface capabilities

扩展 `client/src/store/battleSurfaceCapabilities.ts`：

```ts
export type BattleAuthority = 'LOCAL' | 'REMOTE' | 'REPLAY';
export type BattleSurfaceKind =
  | 'LOCAL_DEBUG'
  | 'SOLITAIRE'
  | 'ONLINE'
  | 'REMOTE_DEBUG'
  | 'REPLAY_READONLY';
```

新增能力字段：

```ts
readonly isReadOnly: boolean;
```

`REPLAY_READONLY` 建议能力：

- `authority: 'REPLAY'`
- `surface: 'REPLAY_READONLY'`
- `isReadOnly: true`
- `canSwitchPerspective: false`
- `canSwitchLocalMode: false`
- `canShowDebugLog: false`
- `canUndo: false`
- `showFreePlayControl: false`
- `scoreConfirmPresentation: 'STANDARD_MODAL'`

`getBattleSurfaceCapabilities` 应优先检查 `replaySession`，再检查 `remoteSession` 与本地模式。

实现上可以让 `deriveBattleSurfaceCapabilities` 接受 `replaySession?: ReplayReadonlySessionState | null`，或者在 `getBattleSurfaceCapabilities` 中先行返回 replay capabilities。关键是不让 replay 落回 `LOCAL_DEBUG`，因为当前 `showFreePlayControl` 默认开启且 `canUndo` 会按本地会话放开。

### 5.3 Store 命令兜底

所有命令提交出口必须在 replay 下直接拒绝。这里按“所有能改变权威状态的 store action”处理，而不是只覆盖 UI 上当前能点到的按钮。

第一层防线：

- `runStoreCommand`
- `runViewerCommand`
- `runRemoteCommandSequence`
- `advancePhase`
- `dispatchRemoteCommand`
- `dispatchRemoteAdvancePhase`
- `endPhase`
- `setViewingPlayer`
- `setGameMode`
- `setFreePlayEnabled`
- `canUseAction`
- `canUndoLastStep`
- `syncState`
- `syncRemoteState`

建议统一 helper：

```ts
function rejectReadonlyReplayCommand(): CommandDispatchResult {
  return { success: false, error: '历史回放为只读模式，不能提交操作' };
}
```

具体要求：

- `canUseAction` 在 replay 下永远返回 `false`。
- `advancePhase` 在 replay 下不调用本地 `gameSession.advancePhase()`，也不调用远程 advance API。
- `runStoreCommand` 在 replay 下不调用本地 `GameSession`，也不调用远程 command API。
- `runRemoteCommandSequence` 在 replay 下直接拒绝，不返回 `false` 后让调用方继续走本地 `gameSession.executeCommand`。
- `dispatchRemoteCommand` / `dispatchRemoteAdvancePhase` 在 replay 下直接 no-op，防止未来误留 `remoteSession` 或入口顺序错误。
- `setFreePlayEnabled` 在 replay 下直接 return，不写日志刷屏。
- `setViewingPlayer` 在 replay 下直接 return；普通历史回放不允许切换到对手隐藏信息视角。
- `syncState` 在 replay 下不从本地 `GameSession` 覆盖当前 checkpoint。
- `connectRemoteSession`、`connectRemoteDebugSession`、`createGame`、`initializeGame` 进入新对局上下文前必须清理 `replaySession`。
- `leaveLocalGame` 不能悄悄把 replay 当成本地对局处理；历史页应使用 `leaveReadonlyReplay` 明确清理。
- `applyRemoteSnapshot` 在 replay 下直接忽略或先清 replay 后由远程入口重新接管，不能把远程 snapshot 合并进 replay checkpoint。
- `handleGameSessionEvent` 在 replay 下不能因本地 `GameSession` 事件调用 `syncState` 覆盖回放 checkpoint；最小做法是让 `syncState` 自身 replay guard 成为最终防线。

第二层防线：所有没有走 `runStoreCommand` / `runViewerCommand`、而是直接调用 `gameSession.executeCommand` 的 action 必须单独加 replay guard。当前已知重点：

- `mulligan`：当前会在远程分发失败后直接 `gameSession.executeCommand(command)`。
- `acceptAutomaticJudgment`：当前会构造两个命令并循环执行 `gameSession.executeCommand(entry.command)`。
- `autoConfirmOtherLocalWinners`：当前会在本地双赢结果窗口中直接 `gameSession.executeCommand(createConfirmStepCommand(...))`，replay 下必须直接 return。
- 后续新增任何直接 `gameSession.executeCommand` / `gameSession.advancePhase` / `gameSession.undoLastStep` 的 action，必须先过同一个 replay guard。

实现前后都建议用下面的静态检查辅助人工扫漏：

```bash
rg -n "gameSession\\.(executeCommand|advancePhase|undoLastStep)|dispatchRemote(Command|AdvancePhase)|runRemoteCommandSequence" client/src/store/gameStore.ts
```

## 6. GameBoard / PlayerArea 改造点

### 6.1 GameBoard

读取：

```ts
const isReadOnly = capabilities.isReadOnly;
```

改造点：

- `DndContext` 可保留，但 `onDragStart` / `onDragEnd` / `onDragCancel` 在只读下直接 return，并清理 drag hints。
- `canConfirmActiveEffect` 保留当前 seat / step / selection 校验，并额外增加 `!isReadOnly && canUseAction(CONFIRM_EFFECT_STEP)`；不要用 command hint 替代已有选择数量、候选合法性检查。
- `canConfirmCostPayment` 保留当前 seat / 能量数量校验，并额外增加 `!isReadOnly && canUseAction(CONFIRM_COST_PAYMENT)`。
- `handleLiveAnimationComplete` 在只读下不调用 `confirmSubPhase`。
- `LiveResultAnimation` 在只读下建议不渲染，或至少保证 `onComplete` 无副作用，避免 checkpoint 停在结果动画窗口时自动确认子阶段。
- 只读下不渲染 `DebugControl`。
- 只读下不渲染 `MulliganPanel` 的可提交版本；最简单做法是 `mulliganPanelOpen && !isReadOnly`。
- 只读下不渲染 `ScoreConfirmModal` 的可提交版本；最简单做法是 `!isReadOnly && <ScoreConfirmModal />`。若希望展示历史分数确认状态，后续单独做只读摘要。
- `JudgmentPanel` 可以继续作为查看面板，但内部操作必须被 `canUseAction` 和 `isReadOnly` 禁用。
- `PhaseIndicator` 的主按钮在只读下不应出现，即使某个旧 checkpoint 投影里残留 command hint；按钮显示要同时受 `!isReadOnly` 控制。
- 只读下显示顶部或左上角标识，例如“历史回放 · checkpoint N · 只读”。

### 6.2 PlayerArea

读取：

```ts
const isReadOnly = useGameStore((s) => s.getBattleSurfaceCapabilities().isReadOnly);
```

改造点：

- `allowGeneralOwnZoneInteraction = !isReadOnly && ...`
- `allowLiveZoneDeskInteraction = !isReadOnly && !isOpponent`
- `canReceiveInspectionDrop = !isReadOnly && !isOpponent && hasOwnedInspectionContext`
- 所有 `DraggableCard.disabled` 条件自然随上述开关变为 true。
- 成员卡点击选择、双击待机/活跃、起动按钮、能量点击、主卡组点击检视、手牌快捷抽卡/回顶、检视区批量操作都随 `isReadOnly` 禁用。
- 休息室展开、卡牌 hover 详情、判定结果展示保留。

注意：`PlayerArea` 内有些成功区 compact / Live 区代码只判断 `isOpponent`，要统一带上 `isReadOnly`，避免移动成功 LIVE 或 Live 区卡牌。

需要逐项扫到的高风险点：

- 成功 LIVE 区：`DroppableZone.disabled` 从 `isOpponent` 改为 `isReadOnly || isOpponent`，卡牌 `DraggableCard.disabled` 和 `Card.interactive` 同步带上 `isReadOnly`。
- LIVE 区：`renderLiveCard` 当前只用 `isOpponent` 禁拖，必须改为 `isReadOnly || isOpponent`。
- 休息室弹窗：当前 LIVE 卡存在特殊可拖例外，replay 下也必须禁用；只读下仍允许展开和 hover。
- 检视区：批量“全放休息室 / 关闭回顶”、单卡 reveal、拖拽排序、拖到手牌/休息室/卡组顶/底，都要带 `!isReadOnly`。批量函数自身也要在开头 guard，不能只依赖按钮 disabled。
- 手牌快捷按钮：抽卡、回顶按钮虽然依赖 `canUseAction`，仍建议显式带 `!isReadOnly`，便于人工审查。

### 6.3 子组件

`PhaseIndicator`：

- 可以继续依赖 `availableCommands`。
- 必须额外读取 `isReadOnly`，只读下状态文案显示“历史回放”，不显示“你的回合”，也不渲染阶段推进/确认按钮。

`DebugControl`：

- `REPLAY_READONLY` 不渲染。
- `showFreePlayControl` 必须为 false。

`MulliganPanel`：

- `canMulligan` 已依赖 `canUseAction`，但 replay 下最好不打开遮罩，避免历史开局 checkpoint 被换牌面板挡住。

`JudgmentPanel`：

- 所有操作按钮已经依赖 `canUseAction`，但可加 `isReadOnly` 改文案。
- 只读下保留“应援区 / Live 判定结果”查看，不展示“点击翻开一张”等操作提示。
- `acceptAutomaticJudgment`、`confirmJudgment`、`confirmPerformanceOutcome`、`revealCheerCard`、`moveResolutionCardToZone` 这类 store action 必须已有 replay guard，组件禁用只是体验层。

`ScoreConfirmModal`：

- replay 下不打开提交弹窗。
- 后续如有需要，可在历史侧栏展示当时分数与确认状态。

## 7. MatchRecordsPage 集成

### 7.1 基础流程

历史页加载 checkpoint：

```ts
const nextReplay = await fetchMatchRecordReplay(matchId, checkpointSeq);
setReplay(nextReplay);
await enterReadonlyReplay(nextReplay);
```

真实实现必须用 request token / sequence guard，避免快速切换对局或 checkpoint 时，较慢返回的旧请求覆盖当前 store：

```ts
const requestId = ++latestReplayRequestRef.current;
const nextReplay = await fetchMatchRecordReplay(matchId, checkpointSeq);
if (requestId !== latestReplayRequestRef.current) return;
setReplay(nextReplay);
await enterReadonlyReplay(nextReplay);
```

页面卸载或离开历史页：

```ts
leaveReadonlyReplay();
```

切换 match：

- 先清理旧 replay session。
- 再加载新 detail / timeline / replay。
- 新 replay 成功后注入新 checkpoint。
- 只有最后一次请求可以写入 `detail` / `timeline` / `replay` 与桌面 store；旧请求返回时必须 no-op。

加载失败：

- 清 `replay`。
- 调用 `leaveReadonlyReplay()`，避免继续显示旧 checkpoint。

注意：上面的注入流程适用于“checkpoint 选择后立刻展示桌面”的实现。如果首版采用 full-screen overlay，则建议把 `enterReadonlyReplay(nextReplay)` 放在“打开桌面回放”或 overlay 内 checkpoint 导航成功后执行，关闭 overlay 时调用 `leaveReadonlyReplay()`；历史页只浏览摘要时不占用桌面 store，能降低污染实时对局的风险。

### 7.2 展示布局

推荐先做“历史页内桌面预览 + 右侧信息栏”：

- 上方保留 `PageHeader`、对局列表和 timeline。
- 中间或主区域增加固定高度桌面容器，渲染 `<GameBoard readOnlyBanner="..." />` 或通过 store 自动显示。
- 右侧继续保留 visible events / private events / decisions / zone summary，便于 review。

如果当前三栏布局空间不够，优先提供“打开桌面回放”按钮进入 full-screen overlay：

- overlay 内全屏 `GameBoard`。
- 左上角返回历史页。
- 顶部显示 match id、checkpoint、timeline seq、只读状态。
- 底部或右侧保留 checkpoint 前进 / 后退。
- overlay 容器负责提供 `h-screen` / `min-h-screen` 尺寸；不要把 `GameBoard` 直接塞进当前三栏普通流布局。

首版更推荐 full-screen overlay，原因是现有 `GameBoard` 本身按 `h-screen` 桌面布局设计，直接塞进三栏小容器风险更高。

### 7.3 Checkpoint 导航

历史页已有 `checkpointEntries` 和前进 / 后退逻辑。Phase 2 只需要确保每次导航成功后同步 store：

- previous checkpoint：重新拉 replay 并注入。
- next checkpoint：重新拉 replay 并注入。
- timeline row 点击：如果有 `relatedCheckpointSeq`，重新拉 replay 并注入。

不要在前端对 `playerViewState` 做增量 patch。checkpoint 是只读快照，跳转时整体替换。

## 8. UX 要求

- 回放桌面必须有明显“只读”标识。
- 禁用按钮不应显示可点击 hover 样式。
- 拖拽手势不应让卡牌进入 dragging 状态。
- active effect / pending cost 若存在，应作为历史状态展示，但按钮禁用。
- 当前 checkpoint 属于 partial / incomplete 记录时，桌面旁显示提示，避免用户误以为回放完整。
- 隐藏信息按 `PlayerViewState` 现有投影展示：对手手牌背面、不可见牌背面、公开牌正面。
- 用户仍可 hover 正面卡查看详情，打开休息室查看公开卡。

## 9. 验收标准

功能验收：

- 历史页选择 checkpoint 后，GameBoard 显示该 checkpoint 的玩家视角桌面。
- checkpoint 前进 / 后退会整体替换桌面状态。
- 对手隐藏区不泄漏。
- 休息室、成功 LIVE、LIVE 区、成员槽、能量区、手牌数量和阶段信息与 replay 摘要一致。
- 离开历史页后，不再保留 replay 桌面状态。

只读验收：

- 拖拽任何卡牌不会触发状态变化，也不会提交网络请求。
- 点击阶段按钮区域不会推进阶段。
- 点击成员、能量、手牌快捷操作、主卡组、检视区操作、起动按钮不会提交命令。
- active effect 和 pending cost 的确认按钮不可用。
- 换牌、判定、分数确认相关提交入口不可用或不渲染。
- 免费登场、撤销、调试切换、视角切换不出现。

权限验收：

- 普通用户 replay API 不返回 authority payload。
- 普通用户只能打开自己参与的 match。
- 普通用户只看到自己 seat 的 private events。
- 同一 checkpoint 下，`viewerSeat` 与 `playerViewState.match.viewerSeat` 一致。

## 10. 测试计划

### 10.1 单元测试

新增或扩展：

- `battleSurfaceCapabilities`：
  - replay session 派生 `REPLAY_READONLY`。
  - `isReadOnly=true`。
  - `showFreePlayControl=false`、`canUndo=false`、`canShowDebugLog=false`。

- `gameStore`：
  - `enterReadonlyReplay` 注入 `playerViewState`。
  - `enterReadonlyReplay` 校验 `viewerSeat`，并从 `participants[viewerSeat].id` 设置 `viewingPlayerId`。
  - replay 下 `canUseAction` 永远 false。
  - replay 下 `runStoreCommand` / `advancePhase` 不调用本地或远程命令。
  - replay 下 `mulligan` / `acceptAutomaticJudgment` 这类直接 `gameSession.executeCommand` 的 action 返回只读错误。
  - replay 下 `autoConfirmOtherLocalWinners` 不会补发本地确认命令。
  - replay 下 `handleGameSessionEvent` 触发的 `syncState` 不会覆盖当前 replay checkpoint。
  - replay 下 `runRemoteCommandSequence` 不会返回 false 让调用方继续走本地命令。
  - 进入 `connectRemoteSession` / `createGame` 会清理旧 replay session。
  - `leaveReadonlyReplay` 清空 replay session 和 player view。

- `MatchRecordsPage`：
  - checkpoint / match 快速切换时，旧请求返回不会覆盖最新 `replay` 或调用 `enterReadonlyReplay`。
  - 加载失败、页面卸载、关闭 overlay 与切换 match 都会调用 `leaveReadonlyReplay`。

### 10.2 组件测试

若当前测试栈支持 React component test，覆盖：

- `GameBoard` 在 replay readonly 下不渲染 `DebugControl`。
- active effect 存在时确认按钮 disabled。
- pending cost 存在时确认按钮 disabled。
- `PlayerArea` 中成员 / 手牌 / 能量 / LIVE 区 / 成功 LIVE 区 / 休息室弹窗 / 检视区 `DraggableCard` disabled。
- `PhaseIndicator` 不显示阶段推进或确认按钮。

### 10.3 集成 / 手工回归

建议用已有测试环境跑一局正式联机，产生历史记录后手工验证：

1. 打开“历史对局”。
2. 选择一条有多个 checkpoint 的记录。
3. 打开桌面回放。
4. 前进 / 后退 checkpoint。
5. 尝试拖拽、阶段推进、点击起动效果、点击费用确认。
6. 观察 network 面板，没有 `/command` 或 `/advance` 请求。

命令验证建议：

```bash
pnpm --dir client exec tsc -b
pnpm exec tsc --noEmit
pnpm test:run
pnpm --dir client build
git diff --check
```

如果 Phase 2 只改前端，可先跑 `pnpm --dir client exec tsc -b` 与 focused tests；合并前再跑完整命令。

## 11. 分步实施建议

### Step 1：只读 surface 与 store 注入

- 增加 `replaySession`。
- 增加 `enterReadonlyReplay` / `leaveReadonlyReplay`。
- 增加 `REPLAY_READONLY` capabilities。
- store 命令出口加只读兜底。
- 用 `rg` 扫描 `gameSession.executeCommand` / `advancePhase` / `undoLastStep`，给绕过通用命令入口的 action 补 guard。
- 补单元测试。

完成标准：可在 devtools 或临时入口中注入 replay view，store 查询能展示；所有会提交命令、远程请求或直接调用 `gameSession` 的路径都返回只读错误或 no-op。

### Step 2：MatchRecordsPage 请求生命周期防护

- 给 `loadMatchNode` / checkpoint 导航增加 request token / sequence guard。
- 切换 match、加载失败、页面卸载、关闭 overlay 时清理旧 replay session。
- 若首版采用 overlay，只有打开 overlay 或 overlay 内导航成功后才调用 `enterReadonlyReplay`；关闭 overlay 立即 `leaveReadonlyReplay`。
- 若首版采用页面内即时预览，replay 成功加载后立即注入，但必须保证旧请求不会覆盖当前 store。

完成标准：快速切换 match / checkpoint 后，桌面 store 与页面侧栏始终停在最后一次选择的 checkpoint。

### Step 3：GameBoard / PlayerArea 禁用交互

- `GameBoard` 接入 `isReadOnly`。
- active effect / pending cost / animation / modal 提交入口禁用。
- `PlayerArea` 所有拖拽与点击操作受 `isReadOnly` 控制。
- `DebugControl` / free play / undo 不出现。
- 重点验证 Live 区、成功 Live 区、休息室弹窗、检视区批量操作和 active effect 弹窗，而不是只测手牌与成员区。

完成标准：手动尝试所有主要桌面操作都不会触发 command。

### Step 4：历史页桌面入口

- `MatchRecordsPage` 在桌面回放打开或 checkpoint 导航成功后调用 `enterReadonlyReplay`；若采用页面内即时桌面预览，则 replay 成功加载后立即注入。
- 增加 full-screen GameBoard replay overlay 或主区域桌面预览。
- overlay 内提供关闭、checkpoint 前后跳、partial 提示。
- 页面卸载、关闭 overlay、切换记录和加载失败时调用 `leaveReadonlyReplay`。
- checkpoint 请求加 request token / sequence guard，避免旧请求覆盖新选择。

完成标准：普通历史页能从 timeline 打开 checkpoint 桌面回放。

### Step 5：验收与文档收束

- 跑前端 typecheck 与 focused tests。
- 用真实历史记录手工验证 network 无 command 请求。
- 更新 `PROJECT_PROGRESS_TODO_20260612.md` 短记录。
- 如实现中新增新的 replay UI 边界，再同步 `docs/current-limitations.md`。

## 12. 风险与处理

### 12.1 命令漏口

风险：某个按钮不依赖 `canUseAction`，仍调用 store 命令。

处理：store 命令出口必须兜底拒绝。UI 禁用只是体验层，不能作为唯一防线。

额外要求：不要只检查 `runStoreCommand`。实现前后必须扫 `gameSession.executeCommand`、`gameSession.advancePhase`、`gameSession.undoLastStep` 和远程 dispatch helper，确保直接命令路径也被 replay guard 覆盖。

### 12.2 replay 污染实时对局

风险：离开历史页后 `playerViewState` 仍是 replay checkpoint，影响进入正式联机或本地对局。

处理：历史页生命周期显式 `leaveReadonlyReplay`；进入 `connectRemoteSession`、`createGame`、`leaveLocalGame` 时也清理 replay session。

若采用 overlay 首版，关闭 overlay 就应清理 replay session；只在历史页侧栏浏览记录时不需要占用桌面 store。

### 12.3 GameBoard 容器尺寸

风险：现有 `GameBoard` 假设 full-screen，小容器嵌入后布局挤压。

处理：首版优先 full-screen overlay。三栏内只放摘要和“打开桌面回放”按钮。

### 12.4 active effect 历史状态误导

风险：checkpoint 恰好停在 effect / cost 等待输入，用户看到“处理中的效果”但无法继续。

处理：显示“历史节点停在等待输入状态，回放只读不可继续处理”的短提示；按钮 disabled。

### 12.5 权限与隐藏信息

风险：为了桌面展示直接保存或传输 authority payload 到前端。

处理：普通前端只接受 `playerViewState`。authority checkpoint 只在服务端复水投影，不进入普通响应。

### 12.6 异步 checkpoint 覆盖

风险：用户快速点击不同 match / checkpoint，旧请求较晚返回后覆盖当前 replay store。

处理：`MatchRecordsPage` 加 request token / sequence guard；只有最后一次请求可以 `setDetail`、`setTimeline`、`setReplay` 与 `enterReadonlyReplay`，失败和卸载时清理 replay session。

## 13. 后续增强

Phase 2 完成后可继续推进：

- 按 timeline frame 展示该 checkpoint 前后事件范围。
- decision record 详情面板，展示当时可见候选和提交结果。
- 管理员 debug replay 的只读 GameBoard 入口，使用同一 readonly surface，但权限来源不同。
- checkpoint 搜索和关键节点过滤，例如 LIVE 开始、LIVE 成功、active effect、换牌、结算。
- 对 partial / incomplete 记录提供更细粒度的缺失说明。
- 在有完整随机与 decision 记录后，再评估确定性重演。

## 14. 实施结果

2026-06-19 已按本方案完成首版只读 GameBoard 回放：

- `client/src/store/gameStore.ts` 新增 replay readonly session、checkpoint 投影注入与命令兜底。
- `client/src/store/battleSurfaceCapabilities.ts` 新增 `REPLAY_READONLY` surface 与 `isReadOnly` 能力。
- `client/src/components/pages/MatchRecordsPage.tsx` 新增全屏桌面回放 overlay、checkpoint 导航与请求 token 防护。
- `client/src/components/game/GameBoard.tsx`、`PlayerArea.tsx`、`PhaseIndicator.tsx` 已按只读 surface 禁用提交类交互。
- `tests/unit/battle-surface-capabilities.test.ts` 已覆盖 replay readonly capabilities。

验证结果：

```bash
pnpm test:run tests/unit/battle-surface-capabilities.test.ts
pnpm --dir client exec tsc -b
pnpm exec tsc --noEmit
pnpm exec tsc -p tsconfig.server.json --noEmit
pnpm --dir client build
pnpm test:run
git diff --check
```

上述命令均已通过；`client build` 仅保留既有 chunk size / Browserslist 提示。
