# Loveca Battle Agent Guide

本文件给后续接手本项目的 AI / Codex 使用。开始任何开发前，先读本文件，再读最新的 `PROJECT_PROGRESS_TODO_*.md`。

## 项目定位

- 本项目目标是实现 Loveca 的本地测试桌面、规则流程、卡牌效果和后续联机对战能力。
- 当前重点是“规则正确 + 玩家视角可测”，不是先做完整线上产品形态。
- 本地测试桌面和正式网页桌面共用 `GameBoard` / `PlayerArea`，不要把测试界面做成另一套分叉 UI。

## 常用入口

- 仓库目录：`/Users/meiyikai/Desktop/文件/个人/codex/loveca/loveca_battle`
- 当前本地测试页面通常在：`http://localhost:5176/`
- 用户通常会在 Codex in-app browser 中自己操作页面测试。如果需要用户测试，直接说明要测什么，不要擅自推进复杂对局。

## 关键架构

- 权威状态与命令处理：`src/application/game-session.ts`
- 低层规则服务：`src/application/game-service.ts`
- 游戏状态实体：`src/domain/entities/game.ts`
- 区域/卡牌状态：`src/domain/entities/zone.ts`
- 费用计算入口：`src/domain/rules/cost-calculator.ts`
- 样例卡效入口：`src/application/card-effect-runner.ts`
- 联机/前端视图投影：`src/online/projector.ts`
- 前端 store：`client/src/store/gameStore.ts`
- 主桌面：`client/src/components/game/GameBoard.tsx`
- 玩家区域：`client/src/components/game/PlayerArea.tsx`

## 当前开发原则

- 规则状态必须通过 `GameSession` / `GameService` / command 层改变，不要让 React 组件直接改权威状态。
- 不要在 React 组件里硬写具体卡效。
- 不要在 action handler 里散落具体卡效。
- 具体卡效目前集中在 `card-effect-runner.ts` 做样例实现，后续应逐步抽象成可扩展 runner。
- 需要隐藏信息时，以 `projector` / visibility / inspection context 控制前端可见性。
- 本地测试和正式网页桌面应尽量复用同一套组件和命令，不做“双轨 UI”。
- 自动费用、撤销、检视区、效果弹窗等交互应以玩家视角自然为优先，但底层仍要记录可审计动作。

## 费用体系约定

- 普通登场/换手成员不弹确认窗口，自动支付费用。
- 自动支付会横置前 N 张可用活跃能量，并记录 `PAY_COST` action。
- `CONFIRM_COST_PAYMENT` / `pendingCostPayment` 底层暂时保留，用于未来真的需要玩家选择支付对象的特殊费用。
- 换手减免通过 `costCalculator` 计算。
- 后续要支持动态费用修正，例如“每有一张其他手牌 -1 费”，应优先扩展费用计算层，而不是在 UI 或具体命令里临时判断。

## 撤销约定

- 当前撤销是本地/调试桌面的“广义撤销一步”。
- 撤销通过 `GameSession` 保存权威状态快照实现，最多保留 50 步。
- 撤销覆盖玩家在同一操作时点内的桌面动作，例如登场、自动扣费、拖拽、横置、效果确认等。
- 一旦阶段、子阶段、活跃玩家或等待玩家变化，撤销历史会清空。
- 回合开始自动处理、先后攻操作时点交换、盖牌玩家切换后，不允许新操作者撤销上一时点。
- 远程对战暂不支持撤销。未来如要支持，应做双方同步/同意机制。

## 检视区与效果显示约定

- 翻牌类效果统一优先进入 `inspectionZone`，再执行下一步。
- 公开翻 X 张：双方都看正面，`revealedCardIds` 包含公开牌。
- 自己检视 X 张：控制者看正面，对手看背面。
- 选择后公开其中一张：先控制者看全部，选择后只公开被选牌，再移动到手牌或其他区域。
- 正在处理的效果应在桌面中央显示，标题使用“费用 + 卡名”，正文尽量显示卡牌原效果文本，不要加奇怪解释文案。
- 正在处理的效果如果需要玩家选择卡牌，应优先显示卡图网格，并支持 hover 查看卡牌详情；不要只用文字按钮让玩家猜卡。
- 舞台上可发动的起动效果按钮应显示完整效果文本；可以缩小字号和加宽文本框，但不要用省略号截断规则文本。

## 当前样例卡效

- `PL!-sd1-007-SD`：东条希，费用 7。
  - 登场：公开卡组顶 5 张放入休息室；其中有 LIVE 卡则抽 1。
  - 当前实现会先进入公开检视区，确认后放入休息室并抽牌。
- `PL!-sd1-004-SD`：园田海未，费用 11。
  - 登场：检视卡组顶 5 张，可选 1 张 LIVE 公开并加入手牌，其余放入休息室。
  - 当前实现会先私密检视，选择后公开被选 LIVE，再确认加入手牌。
- `PL!N-pb1-004-P+`：朝香果林，费用 5。
  - LIVE 开始时：公开卡组顶 1 张，费用 9 以下成员加入手牌并进行站位变换，否则放入休息室。
  - 当前实现支持多个 LIVE 开始时效果由玩家选择顺序，也支持“顺序发动”。
- `PL!-sd1-002-SD`：绚濑绘里，费用 2。
  - 起动：将此成员从舞台放置入休息室，从自己的休息室将 1 张成员卡加入手牌。
  - 当前实现会先支付代价，再用卡图网格选择休息室成员；原本休息室没有成员时也可发动并选择自身。

## 桌面 UI 约定

- LIVE 区是 3 个横置槽位。
- 成功 Live 区也是横置卡位。
- 能量区活跃/等待需要视觉区分；等待能量横置。
- 成员卡横置/等待使用 `orientation` 传给通用 `Card`。
- 撤销按钮位于己方成功 Live 卡区下方，不放左上角。

## 推荐验证命令

只在用户要求验证、或你做了容易破坏编译/核心规则的改动时运行。

```bash
pnpm test:run tests/integration/member-cost-payment.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm --dir client exec tsc -b
```

全量验证更重，只有需要时再跑：

```bash
pnpm test:run
pnpm --dir client build
```

## 下一步优先级

1. 抽象费用修正器，支持动态减费/加费。
2. 继续补样例卡效，优先选择规则简单、能覆盖不同检视可见性的卡。
3. 扩展 effect runner 的数据结构，减少具体卡效硬编码。
4. 为撤销补更多边界测试，例如阶段切换、盖牌切换、效果处理中撤销。
5. 对照官方规则和 QA 梳理阶段/子阶段差异。
