# Loveca Battle Agent Guide

本文件给后续接手本项目的 AI / Codex 使用。开始任何开发前，先读本文件，再读最新的 `PROJECT_PROGRESS_TODO_*.md`。

## 项目定位

- 本项目目标是实现 Loveca 的本地测试桌面、规则流程、卡牌效果和后续联机对战能力。
- 当前重点是“规则正确 + 玩家视角可测”，不是先做完整线上产品形态。
- 本地测试桌面和正式网页桌面共用 `GameBoard` / `PlayerArea`，不要把测试界面做成另一套分叉 UI。

## 常用入口

- 仓库目录：`/Users/meiyikai/Desktop/文件/个人/codex/loveca/loveca_battle`
- 当前本地测试页面通常在：`http://localhost:5173/`
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
- 新增卡效前先在 `card-effect-runner.ts` 的 `CARD_ABILITY_DEFINITIONS` 中按规则分类登记，不要先写单卡散逻辑。
- 需要隐藏信息时，以 `projector` / visibility / inspection context 控制前端可见性。
- 本地测试和正式网页桌面应尽量复用同一套组件和命令，不做“双轨 UI”。
- 自动费用、撤销、检视区、效果弹窗等交互应以玩家视角自然为优先，但底层仍要记录可审计动作。

## 卡效分类约定

- `CONTINUOUS`（常时）：不进效果队列，由对应计算层读取持续修正，例如声援张数、分数、必要 Heart 修正等。
- `ON_ENTER`（登场）：来源为刚登场成员，触发 `ON_ENTER_STAGE`，必须进入待处理效果队列。
- `ACTIVATED`（起动）：来源为舞台成员，由玩家在合法时点主动点击；费用、次数限制和目标选择在命令层/runner 校验。
- `LIVE_START`（LIVE开始）：来源可以是舞台成员或当前 LIVE 区的 LIVE 卡，触发 `ON_LIVE_START`，必须进入 LIVE 开始效果队列，由玩家选择同一时点顺序。
- `LIVE_SUCCESS`（LIVE成功）：来源为成功的 LIVE 卡或满足条件的卡，必须在对应 Live 成功后才进入 LIVE 成功效果队列。
- `AUTO`（自动）：其他诱发型自动能力按具体 `TriggerCondition` 入队，不应伪装成常时或结算时静默修正。

## 卡效步骤约定

- “可以将 N 张手牌放置入休息室：……”属于通用发动代价/费用步骤，不是具体卡牌特例。
- 当前 N=1 的手牌弃置步骤统一使用 `card-effect-runner.ts` 中的 `createDiscardHandToWaitingRoomActivationEffect` 和 `moveHandCardToWaitingRoomForEffect`。
- 这类步骤的选择区文案应明确为“请选择要放置入休息室的卡牌”，跳过按钮应为“不发动”，不要写成“请选择要处理的卡牌”或“不加入”。
- 后续支持 N>1、指定名称/颜色/类型的手牌弃置时，应扩展同一个步骤 helper，而不是在单张卡效果里临时写 UI 文案和移动逻辑。
- “检视卡组顶 N 张 -> 选择其中若干张 -> 可选公开 -> 加入手牌 -> 其余放置入休息室”也是通用步骤，不要只为 `PL!-sd1-004-SD` 或 `PL!-sd1-015-SD` 单独写流程。
- 若效果文本写“公开并加入手牌”，必须先把被选牌加入 `inspectionZone.revealedCardIds`，等待玩家确认后再移动到手牌；不能直接加入手牌。
- 若效果文本写“将 1 张加入手牌”而不是“可以将 1 张加入手牌”，选择阶段应强制选择；只有没有合法目标时才允许不选。

## 卡效高频场景底座

2026-06-12 已对 `llocg_db/json/cards_cn.json` 全量 2032 张卡做过一次只读统计，其中 1381 张有中文效果文本。高频动作包括：`手牌放置入休息室` 340 次、`检视自己卡组顶` 154 次、`公开并加入手牌` 74 次、`加入手牌` 384 次、`其余的卡片放置入休息室` 162 次、`从自己的休息室...加入手牌` 182 次、`将此成员从舞台放置入休息室` 60 次、`[E]` 费用 180 次、`LIVE开始时` 397 次、`LIVE成功时` 45 次、`分数+1/＋１` 约 131 次、`必要HEART减少` 18 次。

因此后续优先抽象这些共性场景：

- 时点与队列：`ON_ENTER`、`ACTIVATED`、`LIVE_START`、`LIVE_SUCCESS`、`AUTO` 按规则分类登记；同一时点多效果必须走待处理队列/顺序选择。
- 发动费用/代价：手牌放置入休息室、公开手牌、支付能量、此成员从舞台放置入休息室都应是可复用步骤。
- 检视/公开/移动：私密检视、公开翻牌、选择目标、公开被选目标、加入手牌、其余入休息室、放回卡组顶/排序应拆成可组合步骤。
- 区域检索：从休息室按类型、费用、团体、名称等筛选加入手牌应共用筛选与移动逻辑。
- LIVE 修正：加 Heart、加分、加声援张数、增加/减少必要 Heart 等都应进入 LIVE 自动判定流水线，而不是在 UI 手填结果里静默处理。
- “必要HEART增加/减少”类效果应使用 `applyHeartRequirementModifiers`；它支持粉/黄/紫等指定颜色，也支持泛用/无色/All 需求，并兼容 `RAINBOW` 条目和 `totalRequired` 表达的两种数据形态。`PL!-sd1-022-SD` 这种减少 `[無ハート]` 的效果只是其中的 All 需求负修正。
- 当前状态字段 `liveRequirementModifiers` 承载 cardId -> requirement modifier 列表；旧字段 `liveRequirementReductions` 仅为 `PL!-sd1-022-SD` 这类“无色/All 减少 N”的兼容投影，不应再用于新增彩色必要 Heart 增减或必要 Heart 增加卡效。
- “1回合 N 次”属于能力定义的通用限制，应在 `CARD_ABILITY_DEFINITIONS.perTurnLimit` 登记，由起动入口统一记录 `ACTIVATED_ABILITY_USE` 并检查同一玩家同一能力在当前 `turnCount` 的使用次数；不要在单张卡效果里临时判断。

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
pnpm test:run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

全量验证更重，只有需要时再跑：

```bash
pnpm test:run
pnpm --dir client build
```

## 下一步优先级

1. 继续把 `PL!-sd1` 已登记效果收口成通用步骤，优先做 LIVE 成功时效果、多选/排序/放回卡组顶等还缺底座的场景。
2. 继续扩展 effect runner 的数据结构，减少具体卡效硬编码，但所有新增能力仍先登记 `CARD_ABILITY_DEFINITIONS`。
3. 继续完善 LIVE 自动判定流水线，确保加棒、加心、加分、必要 Heart 增减、抽卡等结果都进入同一套预判和人工确认入口。
4. 为撤销、LIVE 自动判定、起动次数限制、效果队列顺序补更多边界测试。
5. 费用修正器暂缓到减费/加费相关卡效一起做，届时优先扩展 `cost-calculator.ts`，不要在 UI 或单卡命令里临时判断。
