# 对战模式边界收敛计划

> 文档类型：历史/计划文档
> 适用范围：对战桌面能力层收敛的背景、迁移步骤和阶段性记录
> 当前状态：已归档；当前事实以 `docs/battle-mode-purpose-and-boundaries.md`、`docs/online-mode/boundary-standard.md` 和代码中的 `client/src/store/battleSurfaceCapabilities.ts` 为准

## 背景

当前 `GameBoard` / `PlayerArea` 复用方向是正确的：本地调试、对墙打和联机都应该共享同一套桌面组件和命令模型。现有技术债主要来自模式维度混杂，而不是组件复用本身。

目前代码里常见的两个判断维度是：

- `gameMode`: 在本地权威会话中表达规则自动化策略，例如 `DEBUG` / `SOLITAIRE`；它不是完整的桌面 UI 场景标识。
- `remoteSession`: 表达当前权威状态是否来自远程服务端。

问题在于这两个维度经常被组件直接组合判断。远程联机会话当前也会复用 `GameMode.DEBUG`，如果组件只看 `gameMode`，就会把“远程权威桌面”误判为“本地调试桌面”，导致调试日志、视角切换、调试遮罩和免费登场按钮边界错位。

## 当前状态

截至 2026-06-15，联机免费登场兜底已经做过一次局部修复：

- 远程联机提交 `PLAY_MEMBER_TO_SLOT` 时，会按当前客户端按钮状态携带 `freePlay: true`。
- 服务端仍校验自由拖拽窗口、操作者、己方手牌、成员卡类型和目标槽位，只在该次命令中跳过登场费用检查与支付。
- 本地调试视角切换、模式切换、日志面板与分数确认调试遮罩已被局部限制为“非远程 DEBUG”。
- `docs/online-mode/free-drag-checklist.md` 已明确“免费登场”是规则自动化缺口的正式兜底，不是远程房间全局调试开关或作弊开关。

但这只是止血，不是边界收敛完成；第一批能力层落地前的遗留问题包括：

- 组件层散落 `!isRemoteMode && gameMode === GameMode.DEBUG`、`!isRemoteMode && gameMode === GameMode.SOLITAIRE` 之类组合判断。
- store 中的 `localFreePlay` 在远程时实际表示“本客户端提交命令时是否带 `freePlay`”，命名仍偏本地。
- `connectRemoteSession()` 仍把 store 的 `gameMode` 设为 `GameMode.DEBUG`，因此 UI 不能把 `gameMode` 当作桌面能力来源。
- `src/online/projector.ts` 的 `uiHints` 当时默认 `gameMode: GameMode.DEBUG` / `isLocalMode: true`，不能作为权威的 UI 能力模型。
- 当时还没有 `getBattleSurfaceCapabilities()` selector，也没有覆盖四种桌面场景的能力单测。
- `src/shared/types/enums.ts` 与 `src/application/game-session.ts` 的注释当时仍把 `GameMode.DEBUG` 描述成“调试模式 / UI 展示”，和新的“规则自动化策略”边界不完全一致。
- `docs/solitaire-mode-requirements.md` 是本地模式需求文档，保留“调试模式 / 对墙打模式”的用户入口描述可以接受，但后续若被共享桌面或联机文档引用，需要标明它只讨论本地场景。

截至 2026-06-16，第一批能力层收敛已落地：

- 已新增 `client/src/store/battleSurfaceCapabilities.ts`，用 `deriveBattleSurfaceCapabilities()` 派生 `LOCAL_DEBUG`、`SOLITAIRE`、`ONLINE`、`REMOTE_DEBUG` 四种桌面能力。
- `gameStore` 已暴露 `getBattleSurfaceCapabilities()` selector；`canUndoLastStep()` 改为读取能力对象的 `canUndo`。
- `GameBoard` / `PlayerArea` / `DebugControl` / `GameLog` / `ScoreConfirmModal` 已改为读取能力对象，去掉共享桌面组件里的 `!isRemoteMode && gameMode === ...` 组合判断。
- 已补 `tests/unit/battle-surface-capabilities.test.ts` 覆盖四种 surface 的关键字段。
- `src/shared/types/enums.ts` 与 `src/application/game-session.ts` 的 `GameMode` 注释已改为规则自动化策略口径。

同日第二批后续收敛已落地：

- store UI 状态已从 `localFreePlay` 迁移为 `freePlayEnabled`，表达“当前客户端是否启用免费登场兜底”；`GameSession.localFreePlay` 继续只作为本地权威会话全局开关。
- `src/online/projector.ts` 的 `uiHints` 已移除 `isLocalMode`，只保留 `gameMode` 作为 `GameSession` 规则自动化策略提示；共享桌面仍以 store capability 作为 UI 能力来源。
- `docs/solitaire-mode-requirements.md` 已补充本地语境说明，避免把 `GameMode.DEBUG` 误读为正式联机或远程调试桌面的 UI 场景。

## 目标

建立一个小而明确的“桌面能力层”，让共享桌面组件不再直接散落判断 `gameMode`、`remoteSession`、`isRemoteMode()`。

目标状态：

- `GameBoard` / `PlayerArea` 继续复用，不分叉 UI。
- 本地调试、对墙打、正式联机、远程调试联机通过能力模型区分。
- 远程联机不继承本地调试控制项。
- 免费登场作为规则自动化缺口的正式兜底能力表达，不作为远程房间全局调试开关。
- 服务端权威校验仍由 `GameSession` / command 层负责，React 组件只负责展示和提交命令。
- `GameMode` 继续服务规则自动化策略；不要为了 UI 收敛而改写 `mode-automation.ts` 的语义。

## 模式维度

应拆成至少两个正交维度。

### 权威状态来源

```ts
type BattleAuthority = 'LOCAL' | 'REMOTE';
```

- `LOCAL`: 当前浏览器内的 `GameSession` 是权威状态。
- `REMOTE`: 服务端 `GameSession` 是权威状态，客户端只持有投影和提交命令。

### 桌面使用场景

```ts
type BattleSurfaceKind =
  | 'LOCAL_DEBUG'
  | 'SOLITAIRE'
  | 'ONLINE'
  | 'REMOTE_DEBUG';
```

- `LOCAL_DEBUG`: 本地双视角调试，可切视角、看本地日志、切模式。
- `SOLITAIRE`: 本地对墙打，弱化对手区域，不提供调试视角切换。
- `ONLINE`: 正式联机房间，权威在服务端。
- `REMOTE_DEBUG`: 调试联机入口，权威也在服务端，但入口和身份来自 debug online 工具。

`BattleSurfaceKind` 应由 store 根据 `remoteSession?.source` 与本地 `gameMode` 派生，不写入 `GameSession`，也不替代 `GameMode` 的规则自动化职责。

命名注意：

- `LOCAL_DEBUG`、`ONLINE`、`REMOTE_DEBUG` 都不是 `GameMode`，不要为了 UI 场景收敛把它们加到 `GameMode`。
- `SOLITAIRE` 同时出现在 `GameMode` 与 `BattleSurfaceKind` 中，是因为本地对墙打场景正好由 `GameMode.SOLITAIRE` 派生；使用时应通过类型名区分语义。
- `GameMode.DEBUG` 更准确的语义是“完整双人流程 / 不自动处理对手流程”，不是“显示调试控件”。本地调试 UI 是否显示，应由 `BattleSurfaceCapabilities.surface === 'LOCAL_DEBUG'` 或对应能力字段决定。

## 目标能力矩阵

| surface | authority | canSwitchPerspective | canSwitchLocalMode | canShowDebugLog | canUndo | showFreePlayControl | freePlayPolicy | isSolitairePresentation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `LOCAL_DEBUG` | `LOCAL` | yes | yes | yes | yes | yes | `SESSION_GLOBAL` | no |
| `SOLITAIRE` | `LOCAL` | no | yes | no | yes | yes | `SESSION_GLOBAL` | yes |
| `ONLINE` | `REMOTE` | no | no | no | no | yes | `COMMAND_FLAG` | no |
| `REMOTE_DEBUG` | `REMOTE` | no | no | no | no | yes | `COMMAND_FLAG` | no |

说明：

- `canShowDebugLog` 指当前本地 `GameLog` / 本地 action log，不代表未来不能在远程调试入口外层做服务端诊断面板。
- `canUndo` 仅表达当前本地调试撤销；远程撤销未来如要支持，应另做双方同步/同意机制。
- `showFreePlayControl` 在正式联机和远程调试中仍为 `yes`，因为它是规则自动化缺口的正式兜底，不是调试日志、作弊开关或视角切换。
- `REMOTE_DEBUG` 是远程权威桌面，不应因为名字包含 debug 就继承本地双视角调试能力。

## 维护价值与收敛条件

| surface | 当前维护价值 | 可缩小或合并的条件 |
| --- | --- | --- |
| `LOCAL_DEBUG` | 卡效开发、规则复现、双人视角检查和本地撤销都依赖它，短期高价值 | 自动化测试、回放工具和管理诊断入口足以替代同浏览器双视角调试后，可弱化入口但不应影响 `GameMode.DEBUG` 规则策略 |
| `SOLITAIRE` | 单人可测和玩家视角 smoke test 仍有价值 | 若维护成本升高，先收窄为“自动确认/跳过对手无输入流程”的轻量模式；不要扩成完整 AI 对战 |
| `ONLINE` | 正式产品链路和联机验收目标，必须维护 | 不应合并到调试入口；只能随正式联机协议演进而调整能力字段 |
| `REMOTE_DEBUG` | 验证服务端权威、座位视角、隐藏信息投影、命令传输和同步恢复 | 正式联机若提供等价开发者诊断、座位视角验证和传输调试能力，可考虑并入正式联机诊断工具 |

`freePlay` / 免费登场不是第五种模式。它是当前规则自动化缺口下的桌面能力：本地用会话全局开关，远程用单次命令标记。后续费用、替代登场和卡效自动化补齐后，可以缩小展示范围或调整默认状态；但没有替代流程前，不应从正式联机移除。

## 推荐能力模型

建议先实现纯函数，再由 store selector 暴露，便于单测覆盖：

```ts
type FreePlayPolicy = 'SESSION_GLOBAL' | 'COMMAND_FLAG';
type ScoreConfirmPresentation = 'DEBUG_PASSTHROUGH' | 'STANDARD_MODAL';

interface BattleSurfaceCapabilities {
  readonly authority: BattleAuthority;
  readonly surface: BattleSurfaceKind;
  readonly canSwitchPerspective: boolean;
  readonly canSwitchLocalMode: boolean;
  readonly canShowDebugLog: boolean;
  readonly canUndo: boolean;
  readonly showFreePlayControl: boolean;
  readonly freePlayPolicy: FreePlayPolicy;
  readonly isSolitairePresentation: boolean;
  readonly scoreConfirmPresentation: ScoreConfirmPresentation;
}
```

建议入口：

- 短期可放在 `client/src/store/gameStore.ts` 中作为 selector。
- 为了测试和后续维护，更推荐拆出 `client/src/store/battleSurfaceCapabilities.ts`，导出 `deriveBattleSurfaceCapabilities()`，再由 `gameStore` 暴露 `getBattleSurfaceCapabilities()`。

组件应读取能力对象，而不是自行判断：

```ts
const capabilities = useGameStore((s) => s.getBattleSurfaceCapabilities());

if (capabilities.canShowDebugLog) {
  // show debug log
}
```

能力层只解决 UI 展示和命令提交策略，不作为服务端合法性判断。服务端仍必须从 `GameSession` / command 层校验操作者、阶段、区域和卡种。

## 免费登场边界

当前较稳健的方向是命令级兜底，并且已经局部落地：

- 本地 `LOCAL` 桌面：可继续使用 `GameSession.localFreePlay` 作为本地会话全局开关。
- 远程 `REMOTE` 桌面：不设置服务端房间全局免费模式；客户端在提交 `PLAY_MEMBER_TO_SLOT` 时按本地按钮状态携带 `freePlay: true`。
- 服务端仍校验自由拖拽窗口、操作者、己方手牌、成员卡类型和目标槽位，只跳过登场费用检查与支付。
- 正式联机也保留该按钮；它用于覆盖动态费用、替代登场、卡效未自动化等规则自动化缺口，让玩家能把当前应成立的规则结果落实到服务端权威桌面。

这样可以避免：

- 两端 UI 开关状态漂移导致误解。
- 房间权威状态中混入临时测试偏好。
- 联机模式继续依赖本地 `GameSession.localFreePlay`。

当前命名状态：

- store 中的免费登场 UI 状态已迁移为 `freePlayEnabled`，表达“当前客户端是否启用免费登场兜底”。
- `GameSession.localFreePlay` 保留给本地权威会话。
- 命令字段继续使用 `PlayMemberToSlotCommand.freePlay`，表达一次命令的费用兜底。

## 投影与 UI hint 边界

`src/online/projector.ts` 当前仍会输出 `uiHints.gameMode`，但它只代表 `GameSession` 规则自动化策略，不代表最终桌面能力：

- 远程投影不再输出 `isLocalMode`。
- 客户端共享桌面的展示能力应优先来自 store 的 `BattleSurfaceCapabilities`。
- 组件不应读取 `uiHints.gameMode` 后自行推断本地调试、对墙打、正式联机或远程调试联机能力。

不要让 React 组件同时读取 `uiHints`、`gameMode`、`remoteSession` 后自行拼出另一套能力判断。

## 当前热点文件

优先收敛以下文件中的模式判断：

- `client/src/store/gameStore.ts`
- `client/src/store/battleSurfaceCapabilities.ts`（建议新增）
- `client/src/components/game/GameBoard.tsx`
- `client/src/components/game/DebugControl.tsx`
- `client/src/components/game/GameLog.tsx`
- `client/src/components/game/ScoreConfirmModal.tsx`
- `client/src/components/game/PlayerArea.tsx`
- `src/online/projector.ts`
- `src/online/types.ts`
- `src/application/game-session.ts`
- `src/application/game-commands.ts`
- `docs/online-mode/free-drag-checklist.md`

`client/src/components/pages/GameSetupPage.tsx` 是本地开局配置页面，可以继续直接使用 `GameMode` 表达用户选择的本地规则模式；它不是本次共享对战桌面能力收敛的核心目标。

## 迁移步骤

1. 新增 `deriveBattleSurfaceCapabilities()` 纯函数和 `getBattleSurfaceCapabilities()` selector。
2. 为能力对象补单测，至少覆盖：
   - 本地调试。
   - 对墙打。
   - 正式联机。
   - 远程调试联机。
3. 用能力对象替换共享桌面组件里的 `gameMode === GameMode.DEBUG`、`gameMode === GameMode.SOLITAIRE`、`isRemoteMode()` 组合判断。
4. 保留旧字段一段时间，不做大范围重命名，先降低行为风险。
5. 已完成：将 `localFreePlay` 的 UI 语义迁移为 `freePlayEnabled`，本地会话再映射到 `GameSession.localFreePlay`。
6. 已完成：修正或收窄 `projector` 的 `uiHints` 语义，避免它继续暗示远程投影是本地模式。
7. 已完成：同步旧注释和旧文档措辞：`src/shared/types/enums.ts`、`src/application/game-session.ts` 中的 `GameMode` 说明应改为规则自动化策略；`docs/solitaire-mode-requirements.md` 若继续使用“调试模式”，需限定为本地准备页/本地桌面语境。
8. 回归自由拖拽 checklist 中 D-01/R-01、R-01A、R-01B，以及调试日志、视角切换、调试遮罩不在正式联机出现。

## 非目标

本计划不要求：

- 拆分 `GameBoard` / `PlayerArea`。
- 为联机模式另做一套 UI。
- 改变服务端命令权威模型。
- 改变 `GameMode` 在 `mode-automation.ts` 中的规则自动化含义。
- 将免费登场变成卡牌规则本身，或变成免除服务端阶段、身份、卡种、目标校验的万能移动能力。
- 为远程对战实现撤销。
- 一次性重命名所有历史字段。

## 验收标准

- `GameBoard` / `PlayerArea` / `DebugControl` / `GameLog` / `ScoreConfirmModal` 基本不再直接组合 `gameMode` 与 `remoteSession`。
- 正式联机只显示联机应有控制项：无本地调试日志、无本地视角切换、无本地模式切换、无调试透传遮罩。
- 本地调试仍能切视角、看日志、切模式，并保持本地撤销能力。
- 对墙打仍保留本地测试便利能力，但不显示本地双视角调试项。
- 免费登场在本地和联机均可用；远程只通过命令级 `freePlay` 生效，不写入远程房间全局状态。
- 能力对象有 focused 单测覆盖四种 surface 与关键字段。
- `GameMode` 相关代码注释不再把 `DEBUG` 描述成完整 UI 场景；共享桌面文档用 `BattleSurfaceKind` / 能力对象描述 UI 场景。
- `docs/online-mode/free-drag-checklist.md` 与代码行为保持一致。
