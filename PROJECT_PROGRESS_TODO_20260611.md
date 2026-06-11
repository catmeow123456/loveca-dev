# Loveca 项目进度及待办

日期：2026-06-11

## 接续方式

后续新窗口建议先读：

1. `AGENTS.md`
2. 本文件 `PROJECT_PROGRESS_TODO_20260611.md`

`AGENTS.md` 是长期稳定开发原则；本文件是当天施工日志和下一步。

## 当前状态

本地测试桌面已经可以用于继续开发和验证卡效。

当前用户浏览器页面：

- `http://localhost:5176/`

进入方式：

- 离线模式游玩
- 本地测试对局

当前测试卡组：

- `assets/decks/缪预组.yaml`
- `assets/decks/蓝紫.yaml`

## 明日待办补充

- 统一早期效果选择 UI：检查 `PL!-sd1-004-SD` 海未选择 LIVE 加入手牌、多个 `LIVE开始时` 效果选择发动顺序等仍只显示名字的旧选择入口，尽量都改成卡图网格 + hover 详情；文字标签只作为辅助信息。

本地测试桌面和正式网页桌面共用 `GameBoard` / `PlayerArea`，不是分叉 UI。后续费用、效果、检视区、撤销等改动都会进入同一套桌面组件。

## 今日已完成

### 1. 样例卡效 runner

新增/完善了两张样例登场效果，并新增第一张非登场样例效果。

`PL!-sd1-007-SD`：东条希，费用 7。

- 效果：登场时将自己卡组顶 5 张放入休息室。其中有 LIVE 卡的场合，抽 1 张卡。
- 当前流程：先将卡组顶 5 张加入公开检视区，双方可见；点击继续后放入休息室并按条件抽 1。

`PL!-sd1-004-SD`：园田海未，费用 11。

- 效果：登场时检视自己卡组顶 5 张。可以将 1 张其中的 LIVE 卡公开并加入手牌。其余放入休息室。
- 当前流程：控制者私密检视 5 张；选择 LIVE 后公开被选牌；再次确认后被选 LIVE 加入手牌，其余进休息室。

`PL!N-pb1-004-P+`：朝香果林，费用 5。

- 效果：LIVE 开始时公开自己卡组顶的卡。若为费用 9 以下成员则加入手牌，并进行站位变换；否则放入休息室。
- 当前流程：表演阶段入口触发 `ON_LIVE_START`；公开卡组顶 1 张进入检视区；确认后按条件加入手牌或放入休息室；加入手牌的场合继续选择果林移动到哪个成员区。

相关文件：

- `src/application/card-effect-runner.ts`
- `src/application/game-service.ts`
- `tests/integration/sample-card-effect-runner.test.ts`

### 2. 检视区与效果展示

已统一“翻自己卡组若干张”的效果思路：

- 公开翻 X 张：进入 `inspectionZone`，双方看正面。
- 自己检视 X 张：控制者看正面，对手看背面。
- 选择后公开其中一张：只公开被选牌，再移动到目标区域。

效果处理弹窗已调整：

- 标题显示“费用 + 卡名”。
- 正文尽量显示卡牌原效果文本。
- 不再显示额外奇怪解释句。
- 需要选择卡牌时，选项改为卡图网格，hover 可查看卡牌详情；卡图下方保留“费用/分数 + 卡名”的短标签。
- 舞台上的起动效果按钮显示完整效果文本，并使用较小字号/更宽文本框适配长效果。

相关文件：

- `src/domain/entities/game.ts`
- `src/online/types.ts`
- `src/online/projector.ts`
- `client/src/components/game/GameBoard.tsx`
- `client/src/components/game/PlayerArea.tsx`

### 3. 登场/换手费用体系

已实现普通成员登场/换手的自动费用处理。

当前行为：

- 玩家从手牌拖成员到成员槽位。
- 系统自动计算费用。
- 系统自动横置前 N 张活跃能量。
- 继续完成登场或换手。
- 若登场后有卡效，继续进入卡效流程。
- 不再弹“确认支付费用”窗口。

底层仍保留：

- `pendingCostPayment`
- `CONFIRM_COST_PAYMENT`

保留原因：

- 未来如果出现“必须由玩家选择支付对象”的特殊费用，仍可复用。

费用计算入口：

- `src/domain/rules/cost-calculator.ts`

主要实现：

- `src/application/game-session.ts`
- `src/domain/entities/game.ts`
- `src/online/projector.ts`
- `client/src/store/gameStore.ts`
- `tests/integration/member-cost-payment.test.ts`

后续费用重点：

- 抽象“费用修正器”，支持 BP2 三人卡那类“每有一张其他手牌 -1 费”的动态费用。
- 不要在 UI 或具体命令里临时写减费逻辑。

### 4. 撤销一步

已实现本地/调试桌面的广义撤销一步。

当前行为：

- 每次成功玩家命令前保存局面快照。
- 点击撤销可回到上一步之前。
- 可撤销登场自动扣费、拖拽移动、横置、效果确认等同一操作时点内的动作。
- 撤销按钮位于己方成功 Live 卡区下方。
- 远程对战暂不支持撤销。

撤销边界：

- 如果当前阶段变化，撤销历史清空。
- 如果当前子阶段变化，撤销历史清空。
- 如果活跃玩家变化，撤销历史清空。
- 如果等待玩家变化，撤销历史清空。

因此：

- 回合开始自动 `+1 能量 / 抽 1` 后不能撤销。
- 后攻结束回合进入先攻盖牌，先攻不能撤销后攻刚才的操作。
- 先攻盖牌结束进入后攻盖牌，后攻不能撤销先攻刚才的操作。

主要实现：

- `src/application/game-session.ts`
- `client/src/store/gameStore.ts`
- `client/src/components/game/PlayerArea.tsx`

### 5. 桌面基础显示修正

已修正：

- LIVE 区为 3 个横置槽位。
- 成功 Live 区为横置卡位。
- LIVE 卡盖上去后不再撑大灰边。
- 能量区等待状态改成横置显示。
- 撤销按钮从左上角移到己方成功 Live 区下方。

主要文件：

- `client/src/components/game/PlayerArea.tsx`
- `client/src/components/game/GameBoard.tsx`

### 6. 进程与端口

之前用于本地测试的旧端口 `5173` / `5174` / `5175` 有过遗留 Vite 进程，已清理旧进程。

当前用户正在使用：

- `http://localhost:5176/`

后续如果页面没热更新，先确认当前 Vite 实际端口。

### 7. 第一张非登场样例卡效

已新增 `PL!N-pb1-004-P+` 朝香果林的 `LIVE开始时` 样例效果。

当前行为：

- 从 Live 放置阶段进入表演阶段时，系统翻开 Live 卡后传入 `ON_LIVE_START` 检查时机。
- runner 会扫描当前表演玩家舞台上的朝香果林。
- 公开卡组顶 1 张到检视区。
- 确认后，费用 9 以下成员加入手牌；其他卡放入休息室。
- 若加入手牌，继续弹出站位变换选择，选择目标成员区后果林移动过去；若目标区已有成员，则双方互换位置，且槽位下方的能量/成员叠牌随对应成员一起移动。

多 `LIVE开始时` 效果：

- 若同一时点有多个可处理的 `LIVE开始时` 效果，先弹出选择界面。
- 玩家可以点具体来源卡来决定下一张先发动。
- 也可以点“顺序发动”，之后按当前队列顺序依次发动，省去每张之间重复选择顺序。

主要文件：

- `src/application/card-effect-runner.ts`
- `src/application/game-service.ts`
- `src/domain/entities/game.ts`
- `src/online/types.ts`
- `src/online/projector.ts`
- `client/src/store/gameStore.ts`
- `client/src/components/game/GameBoard.tsx`
- `tests/integration/sample-card-effect-runner.test.ts`

### 8. 本地调试免费登场

已新增本地调试用“免费登场”开关。

当前行为：

- 仅本地非远程模式显示在顶部 `DebugControl` 面板。
- 开启后，成员登场/换手不检查可用能量，也不自动横置能量支付费用。
- 登场动作本身仍走 `GameSession` / `GameService` 命令链，仍会触发登场卡效。
- 离开本地对局或进入远程联机会自动关闭。

主要文件：

- `src/application/game-session.ts`

### 9. 起动效果样例

已新增 `PL!-sd1-002-SD` 的起动效果样例。

当前行为：

- 当前玩家主阶段中，该成员在自己舞台上时，点击该卡会在卡牌下方显示起动按钮。
- 点击“起动：将此成员...”后，该成员从舞台进入休息室。
- 随后弹出效果处理窗口，列出自己休息室中所有成员卡，可选择 1 张加入手牌。
- 因为代价先结算，该成员进入休息室后也会成为可选成员；所以原本休息室没有成员卡时也能发动。
- 若该成员下方有附着能量或堆叠成员，当前实现会随离场一起放入休息室，避免舞台留下孤儿叠牌。

主要文件：

- `src/application/card-effect-runner.ts`
- `src/application/game-commands.ts`
- `src/application/game-session.ts`
- `client/src/store/gameStore.ts`
- `client/src/components/game/PlayerArea.tsx`
- `client/src/store/gameStore.ts`
- `client/src/components/game/DebugControl.tsx`
- `tests/integration/member-cost-payment.test.ts`

### 9. 本地测试双赢卡住修正

已修正本地调试桌面在双赢时停在 Live 胜者动画/结算确认的问题。

问题原因：

- 双赢时 `liveWinnerIds` 包含双方玩家。
- 后端要求双方胜者都确认 `RESULT_ANIMATION` / `RESULT_SETTLEMENT`。
- 本地测试界面胜者动画只会用当前视角确认一次，另一个胜者没有机会在动画阶段确认，因此卡住。

当前行为：

- 本地非远程模式下，确认 `RESULT_ANIMATION` 后若双方都是胜者，会自动补齐另一位胜者的动画确认。
- `RESULT_SETTLEMENT` 同样在本地双赢家时自动补齐另一位胜者的结算确认。玩家应在确认结算前自行把需要进入成功 Live 区的卡移过去；确认后剩余 Live 区卡会按规则进入休息室。

主要文件：

- `client/src/store/gameStore.ts`

## 今日验证过的命令

已通过：

```bash
pnpm test:run tests/integration/member-cost-payment.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm --dir client exec tsc -b
```

最近一次结果：

- `tests/integration/member-cost-payment.test.ts` 通过
- `tests/integration/sample-card-effect-runner.test.ts` 通过
- 前端 TypeScript build 通过

新增非登场卡效后已单独通过：

```bash
pnpm test:run tests/integration/sample-card-effect-runner.test.ts
pnpm test:run tests/integration/member-cost-payment.test.ts
pnpm --dir client exec tsc -b
```

结果：

- `tests/integration/sample-card-effect-runner.test.ts` 通过，4 个用例通过
- `tests/integration/member-cost-payment.test.ts` 通过，2 个用例通过
- Type Errors：no errors
- 前端 TypeScript build 通过

## 当前重要改动文件

规则 / 状态：

- `src/application/game-session.ts`
- `src/application/card-effect-runner.ts`
- `src/application/game-service.ts`
- `src/domain/entities/game.ts`
- `src/domain/rules/cost-calculator.ts`

联机视图 / 可见性：

- `src/online/types.ts`
- `src/online/projector.ts`

前端桌面：

- `client/src/store/gameStore.ts`
- `client/src/components/game/GameBoard.tsx`
- `client/src/components/game/PlayerArea.tsx`

测试：

- `tests/integration/member-cost-payment.test.ts`
- `tests/integration/sample-card-effect-runner.test.ts`

项目接续：

- `AGENTS.md`
- `PROJECT_PROGRESS_TODO_20260611.md`

## 下一步建议

### 优先级 1：费用修正器

目标：支持动态费用变化。

例子：

- BP2 三人卡：每有一张其他手牌，费用 -1。
- 未来其他加费/减费/替代支付效果。

建议做法：

- 在 `cost-calculator.ts` 增加费用修正器概念。
- 输入应包含：即将登场的成员、目标槽位、手牌数量、场上成员、换手对象、当前 game state 必要摘要。
- 输出应包含：基础费用、换手减免、效果修正、最终费用、解释文本。

### 优先级 2：继续补样例卡效

建议优先选规则简单但覆盖不同类型的卡：

- 公开翻若干张后丢休息室。
- 私密检视后选择加入手牌。
- 翻开若干张后选择一张放回卡组顶。
- 简单抽牌/移动区域效果。
- 继续测试并补全 `LIVE开始时` / `LIVE成功时` 类效果。

不要一开始就批量绑定复杂卡。

### 优先级 3：扩展 effect runner 抽象

当前 `card-effect-runner.ts` 已经有样例硬编码。

后续应逐步抽象：

- trigger
- condition
- inspection step
- selection step
- reveal step
- move / draw / shuffle 等原子操作

目标是减少每张卡都写一套流程的重复。

### 优先级 4：撤销补边界测试

建议补：

- 阶段变化后撤销不可用。
- 子阶段变化后撤销不可用。
- 先攻盖牌进入后攻盖牌后撤销不可用。
- 回合开始自动处理后撤销不可用。
- 效果处理中撤销的预期行为。

## 暂时不要做的事

- 不要在 React 组件里硬写具体卡效。
- 不要在 action handler 里硬写具体卡效。
- 不要让联机状态绕过 `GameSession` / `GameService` 直接变化。
- 不要先批量绑定真实复杂卡号。
- 不要把普通登场费用重新做成确认弹窗。
- 不要让本地测试桌面和正式网页桌面分叉成两套组件。
- 不要给远程对战直接开放单方撤销。

## 已知注意点

- `PL!-sd1-004-SD` 是园田海未，不是西木野真姬。
- `PL!-sd1-007-SD` 是东条希。
- LIVE 卡区和成功 Live 卡区都应横置。
- 能量卡没有颜色/编号策略意义，普通费用支付不要让玩家选择具体能量。
- 撤销是“同一操作时点内撤销一步”，不是跨玩家/跨阶段时间倒流。
- 本地测试页面当前在 `localhost:5176`，但 Vite 端口可能因旧进程变化。
