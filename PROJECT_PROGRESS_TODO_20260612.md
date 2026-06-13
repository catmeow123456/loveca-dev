# Loveca 项目进度及待办

日期：2026-06-12

## 接续方式

新窗口建议先读：

1. `AGENTS.md`
2. 本文件 `PROJECT_PROGRESS_TODO_20260612.md`

当前主要提交：

- `c89b66c Implement live automation effect foundations`

当前本地测试页面：

- `http://localhost:5173/`

当前分支：

- `myk_20260611`

## 当前状态

本地测试桌面已经进入“LIVE 自动判定 + 卡效分类底座”阶段。

目前已完成的核心方向：

- LIVE 判定区会按当前光棒数自动翻推荐应援牌。
- 玩家仍可手动调整判定区，然后选择接受自动判定。
- 接受后系统会生成 Live 成功/失败、抽卡、分数草案，玩家仍保留强制成功/失败等人工修正入口。
- 多首 Live 判定已按规则改为“全部 Live 成功才算整个 Live 成功”；任一 Live 失败时总分为 0。
- Live 失败与 Live 成功但分数为 0 在状态中保持区分。
- 多首 Live 会先合并需求再判定，避免按单首贪心消耗 Heart 导致误判。

## 卡效分类与底座

`card-effect-runner.ts` 已建立 `CARD_ABILITY_DEFINITIONS` 登记入口。新增卡效前先登记分类，不要直接写单卡散逻辑。

当前分类约定：

- `CONTINUOUS`：常时，不进队列，由计算层读取。
- `ON_ENTER`：登场，触发后进入待处理效果队列。
- `ACTIVATED`：起动，由玩家合法时点主动发动。
- `LIVE_START`：LIVE 开始，同一时点多效果必须进 LIVE 开始队列，由玩家选择顺序。
- `LIVE_SUCCESS`：LIVE 成功，只有对应 Live 成功后才能入队。
- `AUTO`：其他自动诱发，后续按具体触发条件入队。

已抽出的通用能力/步骤：

- 手牌放置入休息室作为通用发动代价，当前 N=1 使用 `createDiscardHandToWaitingRoomActivationEffect` / `moveHandCardToWaitingRoomForEffect`。
- UI 文案统一为“请选择要放置入休息室的卡牌”，跳过按钮为“不发动”。
- 检视卡组顶 N 张、选择目标、公开被选牌、加入手牌、其余入休息室已开始共用流程；基础检视/清理/移动原语已落在 `src/application/effects/look-top.ts`。
- “公开并加入手牌”必须先公开被选牌，再由玩家确认后移动。
- 必要 Heart 增减使用 `applyHeartRequirementModifiers`，支持指定颜色、泛用/All、增加和减少。
- “1回合 N 次”作为能力定义通用特征，使用 `perTurnLimit` 登记；起动入口统一记录和校验。
- 卡效发动费用已开始收口为 `src/application/effects/effect-costs.ts` 中的通用 `EffectCostDefinition` / `payImmediateEffectCosts` / `paySelectedDiscardHandCost` 底座。当前已覆盖弃 1 手牌、支付活跃能量、将来源成员从舞台放置入休息室三类，并已迁移 `002` / `005` / `008` / `003` / `011` / `012` / `015` / `016` 的相关费用路径。
- 区域目标选择/移动已开始收口为 `src/application/effects/zone-selection.ts` 中的 `ZoneCardSelectionConfig` / `createWaitingRoomToHandEffectState` / `moveSelectedCardsFromZone`。当前覆盖 `WAITING_ROOM -> HAND` 单选路径，`001` / `003` / `002` / `005` 的“从休息室加入手牌”已走统一完成逻辑。
- 最小 selector API 已落在 `src/application/effects/card-selectors.ts`，当前提供 `typeIs` / `groupIs` / `costLte` / `and` / `or` / `not`，`001` / `003` / `002` / `005` 已用组合 selector 表达 LIVE、成员、低费 μ's 等候选条件。
- Live 修正已进入 Stage 1D 主写入路径：`domain/rules/live-modifiers.ts` 提供 `addLiveModifier` / `replaceLiveModifier` / `projectLiveModifierCompatibility`，临时修正统一写入 `liveResolution.liveModifiers` 的 `SCORE`、`HEART`、`BLADE`、`REQUIREMENT` modifier；旧的 `playerScoreBonuses` / `playerHeartBonuses` / `liveRequirementReductions` / `liveRequirementModifiers` 由 `liveModifiers` 投影，仅作为 UI/在线投影兼容层保留。常时修正已整理为 continuous modifier registry，`001` 常时 BLADE 由 `collectLiveModifiers` 动态收集。
- 状态与站位变换 Stage 1E 已起步：`src/application/effects/member-state.ts` 提供 `setMemberOrientation` / `moveMemberBetweenSlots`，覆盖卡效里的成员待机/活跃基础原语与站位变换。当前 `PL!N-pb1-004-P+` 的站位变换已改为调用 `moveMemberBetweenSlots`；普通规则 TAP_MEMBER、自由拖拽和手动移动仍归规则/桌面流程，不反向塞进 card effects。
- 抽牌 Stage 1F 已对当前 μ's 预组验证集收口：`src/application/effects/draw.ts` 提供 `drawCardsFromMainDeckToHand`，表达卡效步骤中的主卡组顶抽牌到手牌。当前 `007` 的额外抽 1 已迁入该 helper，并覆盖“翻到 Live 抽 1 / 未翻到 Live 不抽”的 focused tests；开局/阶段/LIVE 判定等规则流程抽牌仍归 `GameService`，不由该 helper 接管。F02/F12/刷新语义等暂等真实样例再接。

## 当前已实现/登记的 PL!-sd1 效果要点

- `001`：登场按成功 Live 区条件回收 Live；常时按成功 Live 数增加光棒，已由 `collectLiveModifiers` 动态收集为 `BLADE` modifier。
- `002`：起动，此成员进休息室，从休息室回收成员。
- `003`：登场回收低费 μ's 成员；LIVE 开始可弃 1 手牌并选择粉/黄/紫 Heart，已通过 `addLiveModifier` 写入统一 `HEART` modifier。
- `004`：登场检视顶 5，可选 μ's Live 公开并加入手牌，其余入休息室。
- `005`：起动，此成员进休息室，从休息室回收 Live。
- `006`：登场可公开手牌 Live，与成功 Live 区 Live 交换。
- `007`：登场公开顶 5 入休息室，其中有 Live 则抽 1。Step 8 closure check 已确认 golden 行为稳定；当前看顶/堆墓走 look-top 底座，额外抽 1 走 `drawCardsFromMainDeckToHand`。
- `008`：起动 `[1回合1次][E][E]`，公开/处理卡组顶 10。
- `009`：LIVE 开始，休息室 μ's 达 25 张时分数 +1，已进 LIVE 开始队列，并显示当前张数，已通过 `addLiveModifier` 写入统一 `SCORE` modifier。
- `011` / `012` / `016`：登场可弃 1 手牌；若弃了，检视顶 3，必须选 1 张加入手牌，其余入休息室。
- `015`：登场可弃 1 手牌；检视顶 5，可选成员公开并加入手牌，其余入休息室。
- `019 START:DASH!!`：已实现为 `LIVE_SUCCESS`。Live 成功后进入成功时效果队列，检视顶 3，支持选择任意张并按选择顺序放回卡组顶，其余入休息室。
- `022`：LIVE 开始，根据成功 Live 区数量减少此 Live 必要 Heart，已通过 `replaceLiveModifier` 写入统一 `REQUIREMENT` modifier，并同步兼容投影字段。
- `PL!N-pb1-004-P+`：测试用果林 LIVE 开始效果，公开顶 1，符合条件加入手牌并站位变换。
  - 站位变换当前通过 `member-state.ts` 的 `moveMemberBetweenSlots` 执行，会携带来源槽位下方的能量/成员，并可与目标槽位成员交换。

## 全量卡池统计结论

已只读参考 `/llocg_db/json/cards_cn.json` 全量 2032 张卡，其中 1381 张有中文效果文本。

高频场景包括：

- 手牌放置入休息室
- 检视自己卡组顶
- 公开并加入手牌
- 加入手牌
- 其余卡片放置入休息室
- 从休息室加入手牌
- 将此成员从舞台放置入休息室
- `[E]` 费用
- LIVE 开始时
- LIVE 成功时
- 分数 +1
- 必要 Heart 增加/减少
- 1 回合 N 次

后续新增卡效时，应优先判断是否属于这些通用场景，先扩底座，再接具体卡号。

## 当前验证

最近已通过：

本次 2026-06-13 μ's 预组休息室回收 Stage 1A 更新后已通过：

```bash
pnpm test:run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
```

本次未改前端交互，未启动 `5173` 做浏览器验证。

本次 2026-06-13 selector / zone-selection 单测与费用底座外移后已通过：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
```

本次 2026-06-13 look-top 底座外移后已通过：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
```

本次 2026-06-13 top-deck-to-waiting-room 底座补齐后已通过：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
```

```bash
pnpm test:run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次 `019 START:DASH!!` 更新后已通过：

```bash
pnpm test:run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次卡效费用底座更新后同样已通过：

```bash
pnpm test:run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次区域选择/移动底座更新后已通过：

```bash
pnpm test:run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次 Live 临时修正流水线更新后已通过：

```bash
pnpm test:run tests/unit/live-judgment-settlement.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次 2026-06-13 Stage 1D Live modifier 主写入路径更新后已通过：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次 2026-06-13 Stage 1E member-state / position-change 底座起步后已通过：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

本次 2026-06-13 Stage 1F draw 底座收口后已通过：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/draw.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

结果：11 files passed，99 tests passed，server/client TypeScript 均通过。

本次未改前端交互；开发服务器按需打开 `5173` 后，建议优先手测 `PL!-sd1-007-SD`。

本次 2026-06-13 Step 13 / Stage 1H catalog 回扫已完成文档侧收口：

- 用 `loveca_effect_fragments_catalog.json` 回扫当前已登记/实现卡牌，共覆盖当前样例集 19 个 catalog segments。
- 已刷新 `docs/card-effect-reuse-audit/existing_module_map.md`、`module_gap_list.md`、`safe_refactor_plan.md`，标出 Stage 1A-1F 已落地模块、仍 inline 的效果、暂缓模块与下一批非 `PL!-sd1` proving candidates。
- 本次只改文档，不改业务代码；focused tests 仍为 11 files passed / 99 tests passed，`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` 均通过。

本次 2026-06-13 `PL!-sd1-022-SD` 必要 Heart 减少 UI 回归修复：

- 根因：后端 `REQUIREMENT` liveModifier 与判定读取链路正常，但前端 `JudgmentPanel` 用 raw `cardId` 查 `requirementModifiers` / `requirementReductions`；投影层字段当前以 `obj_<cardId>` 为 key，导致 022 结算后 UI 仍按原始 `6 ALL` 预览。
- 修复：`JudgmentPanel` 读取必要 Heart 修正时同时兼容 raw `cardId` 与 public object id。
- 新增 focused 回归：`tests/unit/live-judgment-settlement.test.ts` 覆盖 022 结算后进入判定立即使用减少后的必要无色 Heart。
- 验证：022 focused tests 4 passed；整组 focused tests 11 files passed / 100 tests passed；`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` 均通过。

历史浏览器检查：

- `http://localhost:5173/`
- 页面标题正常
- 控制台错误数为 0

## 下一步建议

优先级 1：选一张非 `PL!-sd1` 的低风险 proving card，验证当前模块不是 starter-deck-only。

- 首选 `LL-bp1-001-R＋` 登场从休息室回收成员，片段 `T01,F07,F09`，可直接验证 `zone-selection` / `card-selectors` 跨系列复用。
- 备选 `PL!HS-PR-001-PR` 或 `PL!HS-PR-002-PR` 登场看顶 3 选 1，片段 `T01,C01,F03`，可验证 `effect-costs` / `look-top` workflow 参数化。
- 备选 `PL!-pb1-019-N` 起动自送休息室回收成员，片段 `T03,C04,F07,F09`，可验证 `effect-costs` + `zone-selection` 不依赖预组卡号。

优先级 1.5：继续减少 runner inline orchestration，但不要做大型 resolver DSL。

- `PL!-sd1-006-SD` 的公开手牌 + 成功区交换仍 inline，等需要 C07/交换效果时再抽。
- 003 Heart 颜色选择仍是专用步骤，等第二个选择型效果再抽 generic option-choice。
- 009/022/001 的条件/倍率仍在 resolver，等非预组样例重复后再抽 condition AST。
- F02/F12、抽牌刷新语义继续等待真实样例。

优先级 2：Step 12 / Stage 1G 自动能力框架暂缓。

- μ's 预组当前没有足够合适的 AUTO proving case，不先空转设计/实现事件框架。
- 保留 AUTO 待办：后续开发到真正自动能力卡牌时，再设计 `GameEvent`、trigger matcher、每回合限制与 UI 选择窗口，并用该自动能力样例验证。

优先级 3：继续完善 LIVE 自动判定。

- 保持“系统预判 + 玩家确认/修正”的当前策略。
- 所有加棒、加心、加分、必要 Heart 增减都应进入统一预判。
- 后续卡效覆盖足够后，再考虑取消人工确认。

优先级 4：继续补测试。

- LIVE 开始多效果顺序对结果的影响。
- LIVE 成功时效果只在成功后触发。
- 起动次数限制跨回合重置。
- 必要 Heart 增加/减少同时存在时的合并。
- 效果处理中撤销的边界。

优先级 5：费用修正器暂缓。

用户已确认费用修正器可以留到和减费相关卡效一起做，例如 BP2 三人卡。届时应扩展 `cost-calculator.ts`，不要写 UI 层特例。

## 已知注意点

- 子模块 `llocg_db` 里可能有本地未跟踪 `.DS_Store`，不要提交。
- 旧进度文档 `PROJECT_PROGRESS_TODO_20260611.md` 是历史施工日志；新窗口应以本文件为当前事实。
- 本地测试端口目前按 `5173` 使用；如果页面没热更新，先确认实际 Vite 端口。
