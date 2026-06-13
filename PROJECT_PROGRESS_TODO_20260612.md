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

## 本地测试卡组与卡图资产

当前事实：

- 测试卡组 YAML 位于 `assets/decks/`，当前有 `缪预组.yaml`、`蓝紫.yaml` 与 `系统边界混合.yaml`。
- 本地测试入口 `client/src/lib/localTestData.ts` 当前默认静态 import `系统边界混合.yaml` 作为玩家1、`缪预组.yaml` 作为玩家2；`蓝紫.yaml` 保留为非默认测试资产。
- 卡图下载脚本为 `scripts/download-local-test-card-images.mjs`。脚本已改为自动扫描 `assets/decks/*.yaml` / `*.yml`，不再硬编码两副卡组。
- 本地测试卡牌数据源生成脚本为 `scripts/generate-local-test-card-sources.mjs`。脚本自动扫描 `assets/decks/*.yaml` / `*.yml`，从 `llocg_db/json/cards.json` 与 `llocg_db/json/cards_cn.json` 生成 `client/src/lib/localTestCardSources.generated.ts`。
- 当前 dry-run 结果：三副测试卡组需要 79 张唯一卡图。本次新增下载 28 张 PNG，旧图跳过 51 张；`assets/card/` 保存 PNG，`assets/images/{thumb,medium,large}/` 保存 WebP，79 张均已压缩成功。

常用命令：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/generate-local-test-card-sources.mjs
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/download-local-test-card-images.mjs --dry-run
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/download-local-test-card-images.mjs
```

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
- 抽牌 Stage 1F 已对当前 μ's 预组验证集收口：`src/application/effects/draw.ts` 提供 `drawCardsFromMainDeckToHand`，表达卡效步骤中的主卡组顶抽牌到手牌。当前 `007` 的额外抽 1 已迁入该 helper，并覆盖“翻到 Live 抽 1 / 未翻到 Live 不抽”的 focused tests；开局/阶段/LIVE 判定等规则流程抽牌仍归 `GameService`，不由该 helper 接管。F02 已由 `PL!SP-bp4-008-P` 费用 13「若菜四季」左侧登场起步为抽 2 弃 1 壳；F12/刷新语义继续等真实样例。

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
- `PL!SP-PR-004-PR`：登场可弃 1 手牌；如此做时，从能量卡组顶放置 1 张待机能量到能量区。
  - 当前实现复用 C01 弃手选择步骤，并通过 `src/application/effects/energy.ts` 的 `placeEnergyFromDeckToZone` 明确放置为等待状态。普通能量阶段默认放置为活跃状态的行为不变。
- `PL!SP-bp4-008-P` 费用 13「若菜四季」：左侧登场时抽 2 弃 1；右侧登场时，将最多 2 张待机能量变为活跃；LIVE 开始时可以进行站位变换。
  - 当前实现通过 `requiredSourceSlots: [LEFT/RIGHT]` 做登场来源槽位条件过滤；左侧复用抽牌 helper 与手牌进休息室 helper，右侧通过 `src/application/effects/energy.ts` 的 `setFirstEnergyCardsOrientation` 执行能量方向变更。LIVE 开始段登记为 `LIVE_START` 队列能力，使用可选 slot-selection，并通过 `src/application/effects/member-state.ts` 的 `moveMemberBetweenSlots` 完成站位变换/交换。

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
- 已刷新 `docs/card-effect-reuse-audit/existing_module_map.md`、`module_gap_list.md`、`safe_refactor_plan.md`，标出 Stage 1A-1F 已落地模块、仍 inline 的效果、当时暂缓模块与下一批非 `PL!-sd1` proving candidates。后续 Stage 1O 已用 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」把 AUTO / S08 最小路径起步。
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

本次 2026-06-13 新测试卡组与卡图资产收口：

- 新增 `assets/decks/系统边界混合.yaml`：48 张成员、12 张 LIVE、12 张能量，混合“现有模块非预组扩样本”和“费用/能量/登场/AUTO 等新系统边界”样例。
- 默认本地测试入口已切为 `系统边界混合` vs `缪预组`，`蓝紫.yaml` 保留为非默认测试资产。
- 新增 `scripts/generate-local-test-card-sources.mjs`，从所有 `assets/decks/*.yaml` / `*.yml` 生成 `client/src/lib/localTestCardSources.generated.ts`。
- `scripts/download-local-test-card-images.mjs` 已实际跑通：三套测试卡组共 79 张唯一卡图，本次新增下载 28 张 PNG，79 张均已生成 `thumb/medium/large` WebP。
- 用户已在 `http://localhost:5173/` 初步测试，反馈测试卡组看起来没有问题。
- 验证：`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` 均通过。

本次 2026-06-13 `PL!SP-PR-004-PR` / E03 能量放置底座起步：

- 新增 `src/application/effects/energy.ts`，提供 `placeEnergyFromDeckToZone`，用于卡效步骤从能量卡组顶放置能量到能量区，并显式指定放置后的活跃/待机状态。
- `PL!SP-PR-004-PR` 已登记为 `ON_ENTER` 队列能力：可弃 1 手牌；若弃牌成功，则从能量卡组顶放置 1 张待机能量。
- 新增 focused tests：`tests/unit/energy.test.ts` 覆盖能量放置 helper；`tests/integration/sample-card-effect-runner.test.ts` 覆盖 PR-004 不发动与发动两条路径。
- 验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/draw.test.ts tests/unit/energy.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs --dir client exec tsc -b
```

结果：12 files passed，104 tests passed，server/client TypeScript passed。

本次 2026-06-13 `PL!SP-bp4-008-P` 费用 13「若菜四季」右侧 E02 与来源槽位条件起步：

- `CARD_ABILITY_DEFINITIONS` 新增 `requiredSourceSlots`，`PendingAbilityState` 新增 `sourceSlot`。登场触发从 `PLAY_MEMBER.targetSlot` 记录来源槽位；LIVE 开始触发从舞台槽位收集来源槽位。能力入队前统一检查来源槽位条件，避免在单卡 resolver 里硬写右侧判断。
- `src/application/effects/energy.ts` 扩展 `setEnergyOrientation` / `setFirstEnergyCardsOrientation`，用于卡效步骤把能量区指定卡或前 N 张符合方向条件的能量设为目标方向。
- `PL!SP-bp4-008-P` 已登记右侧登场能力：仅在登场到 `RIGHT` 槽位时入队；确认后将最多 2 张待机能量变为活跃。此批当时仅接右侧 E02；后续批次已接左侧 F02，并已在 S05 批次补完 LIVE 开始站位变换。
- 新增 focused tests：`tests/unit/energy.test.ts` 覆盖能量方向 helper；`tests/unit/card-effect-classification.test.ts` 覆盖 `requiredSourceSlots` 注册；`tests/integration/sample-card-effect-runner.test.ts` 覆盖右侧触发与中心不触发。
- 验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/draw.test.ts tests/unit/energy.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs --dir client exec tsc -b
```

结果：12 files passed，108 tests passed，server/client TypeScript passed。

本次 2026-06-13 `PL!SP-bp4-008-P` 费用 13「若菜四季」左侧 F02 抽弃起步：

- `PL!SP-bp4-008-P` 新增左侧登场能力：仅在登场到 `LEFT` 槽位时入队；处理时先抽 2 张卡，再选择 1 张手牌放置入休息室。
- 新增 `startDrawThenDiscardOneEffect` / `finishDrawThenDiscardOneEffect` 抽弃壳，组合 `drawCardsFromMainDeckToHand` 与 `moveHandCardToWaitingRoomForEffect`；当前先覆盖抽 N 后弃 1，后续遇到弃 M 张再扩多选。
- focused tests 新增左侧触发路径，并扩展中心登场不触发左/右任一段。
- 验证：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/draw.test.ts tests/unit/energy.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs --dir client exec tsc -b
```

结果：12 files passed，109 tests passed，server/client TypeScript passed。

本次 2026-06-13 低风险复用扩样本收口：

- `PL!HS-bp1-006-P` 费用 11「藤岛 慈」已完成登场段：抽 2 张卡，将 1 张手牌放置入休息室。复用 draw helper + hand discard 壳；LIVE 开始弃手给 Heart 段尚未实现。
- `PL!-pb1-019-N` 费用 2「高坂穗乃果」已完成起动：自送休息室，从休息室回收 1 张成员卡。复用 effect-costs 自送 + zone-selection/member selector。
- `PL!-bp4-003-P` 费用 2「南琴梨」已完成起动：自送休息室，从休息室回收 1 张 LIVE 卡。复用 effect-costs 自送 + zone-selection/live selector。
- focused tests 已补 `tests/integration/sample-card-effect-runner.test.ts` 与 `tests/unit/card-effect-classification.test.ts` 覆盖。
- 验证：focused 2 files / 28 tests passed；相关 12 files / 112 tests passed；`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` passed。

本次 2026-06-13 低风险同构扩样本收口：

- `LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下花帆」：登场段已完成，复用 `zone-selection + card-selectors`（从休息室回收 1 张成员入手）。
- `PL!HS-PR-001-PR` 费用 10「日野下花帆」：登场段已完成，复用 `effect-costs` 与 `look-top`（可弃1→看顶3选1入手）。
- `PL!-bp3-010-N` 费用 9「高坂穗乃果」：登场段已完成，复用 `effect-costs` 与 `look-top`（可弃1→看顶5公开可选1张 LIVE 入手）。
- `PL!HS-bp2-002-P` 费用 13「村野沙耶香」：登场段已完成，复用 `zone-selection + card-selectors`（休息室最多2张费用≤2成员入手）。
- `PL!HS-PR-001-PR` 费用 10「日野下花帆」、`PL!-bp3-010-N` 费用 9「高坂穗乃果」、`PL!HS-bp2-002-P` 费用 13「村野沙耶香」、`LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下花帆」的未做段：分别为 live-only 段，均明确记录为后续分批。
- focused tests 已补：
  - `tests/integration/sample-card-effect-runner.test.ts`
  - `tests/unit/card-effect-classification.test.ts`
- 验证：`tests/unit/card-effect-classification.test.ts` 与 `tests/integration/sample-card-effect-runner.test.ts` 已通过；`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` 已通过。

本次 2026-06-13 `PL!SP-bp4-008-P` 费用 13「若菜四季」LIVE 开始 S05 站位变换收口：

- 新增 `SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID`，登记为 `LIVE_START` / `STAGE_MEMBER` / `ON_LIVE_START` 队列能力。
- 新增通用 `startMemberPositionChangeEffect` / `finishMemberPositionChangeEffect` 壳，四季 LIVE 开始段使用可选站位变换；不选择槽位时可跳过，选择槽位时复用 `moveMemberBetweenSlots`，支持空槽移动与成员交换。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts` 覆盖四季 LIVE 开始能力登记。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖 LIVE 开始触发、可选 slot-selection、从中间移动到右侧并与右侧成员交换。
- 验证：focused 2 files / 33 tests passed；相关完整验证 12 files / 117 tests passed；`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` passed。

本次 2026-06-13 `LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」X11 费用修正底座起步：

- `src/domain/rules/cost-calculator.ts` 新增登场费用修正明细：保留印刷基础费用、修正后费用、修正来源与合计减费，再与换手减免一起生成支付方案。
- `GameSession.preparePlayMemberCostPayment` 现在向 `costCalculator` 传入正在登场的来源卡 ID、当前手牌列表与舞台成员状态，普通登场仍自动扣费；支付说明会显示基础费用、费用减少、换手减免与最终支付。
- `LL-bp2-001-R+` 已完成手牌中的常时费用减少段：此卡以外的其他手牌每有 1 张，登场费用减少 1；此卡本身不计入数量，手牌只有此卡时仍是 20 费，最低可降到 0 费。
- `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」已完成手牌中的常时费用减少段：只要自己的舞台存在待机状态的『虹咲』成员，登场费用减少 2；活跃虹咲成员或待机非虹咲成员均不会触发减费。
- `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」已完成舞台来源常时费用减少段：手牌中费用 10 的『Liella!』成员登场费用减少 2；换手登场时先应用此费用修正，再计算换手减免。当前本地 `系统边界混合` 测试卡组缺少合适的 10 费 Liella! 目标，先以构造数据 focused tests 固定规则路径。
- 暂未实现同卡其他段：`此成员无法因换手放置入休息室` 与 LIVE 开始弃任意张指定姓名手牌获得 BLADE。
- focused tests 已补：
  - `tests/unit/cost-calculator.test.ts` 覆盖三人卡不计自身、按其他手牌减费、最低 0 费、与换手减免叠加；艾玛无待机虹咲成员不减费、有待机虹咲成员减 2；千砂都只对 10 费 Liella! 成员减 2，非 10 费或非 Liella! 不误伤，并验证先减费再换手。
  - `tests/integration/member-cost-payment.test.ts` 覆盖真实 `PLAY_MEMBER_TO_SLOT` 路径中三人卡 20 费按 17 张其他手牌降为 3 费并自动扣费；艾玛在舞台待机虹咲成员条件满足时可自动按减后费用登场；千砂都作为目标槽位换手来源时仍能先修正 10 费 Liella! 成员费用再自动扣费。
- 验证：focused cost tests 2 files / 30 tests passed；相关完整验证 14 files / 147 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-13 `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」LIVE 开始段与 `PL!S-bp2-006-P` 费用 11「津岛善子」S07 卡效登场起步：

- `src/application/effects/member-state.ts` 新增批量成员方向 helper `setMembersOrientation`，以及 `playMembersFromWaitingRoomToEmptySlots` 卡效登场原语。
- `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」已补完 LIVE 开始段：中心位来源进入 LIVE 开始队列，确认后将自己舞台上全部 Liella! 成员与全部能量变为活跃状态；非 Liella! 成员不受影响。
- `PL!S-bp2-006-P` 费用 11「津岛善子」已完成登场段：可以支付 4 张活跃能量，从休息室选择至多 2 张费用合计小于等于 4 的成员，逐张选择空成员区登场。
- 当前 S07 边界：卡效登场只进入空槽，不走普通登场费用、不计算换手。非手牌方式登场的成员已通过 `enqueueTriggeredCardEffects` 的显式登场来源继续触发自己的登场能力；触发入队不写进 S07 移动原语。
- focused tests 已补：
  - `tests/unit/member-state.test.ts` 覆盖批量设置成员方向、从休息室登场到空槽。
  - `tests/unit/card-effect-classification.test.ts` 覆盖千砂都 LIVE 开始与善子登场能力登记。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖千砂都批量活跃 Liella! 成员/能量、善子支付 4 能量后从休息室登场 2 名成员，以及 `PL!-sd1-003-SD` 费用 13「南 ことり」被效果登场后继续触发自己的登场能力。
- 验证：focused 3 files / 41 tests passed；相关完整验证 14 files / 152 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-13 `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」登场段收口：

- 新增 `EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID`，登记为 `ON_ENTER` / `PLAYED_MEMBER` / `ON_ENTER_STAGE` 队列能力。
- 登场段先通过 `selectableOptions` 选择“成员”或“能量”分支；进入后续选择步骤时会清空旧选项按钮，避免重复点击旧分支。
- 成员分支选择 1 名待机舞台成员并复用 `setMembersOrientation(..., ACTIVE)`；能量分支不要求玩家选择具体能量卡，而是按能量区顺序自动取至多 2 张待机能量并复用 `setEnergyOrientation(..., ACTIVE)`。普通登场费用、换手与能量支付路径保持不变。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts` 覆盖艾玛登场能力登记。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖登场后选择待机成员变活跃，以及选择能量分支后自动将由登场支付横置的 2 张能量变活跃。
- 验证：focused 4 files / 47 tests passed；能量分支免手选修正 focused 3 files / 42 tests passed；修正后相关完整验证 14 files / 154 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-13 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」AUTO proving 收口：

- 新增 `HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID`，登记为 `AUTO` / `STAGE_MEMBER` / `ON_LEAVE_STAGE` 队列能力。
- `enqueueTriggeredCardEffects` 新增 `ON_LEAVE_STAGE` 入队路径，当前通过最近的 `PLAY_MEMBER` 替换来源、`MOVE_CARD` 从成员区到休息室来源，以及自送休息室费用的显式来源构造最小离场事件来源。
- `PL!HS-bp2-012-N` 费用 5「乙宗 梢」解析复用 look-top：检视顶 5，选择成员后先公开，确认后该成员入手，其余检视牌进休息室。
- 待处理效果顺序选择从“同一 timingId”扩为“同一 controller 且同 timingId 或共享 eventId”。因此当 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」被普通登场换手替换时，其离场 AUTO 与新登场成员的登场能力会进入同一个顺序选择窗口，由玩家选择先后。
- 当前仍不是完整 `GameEvent -> trigger matcher` 层；`S08` 只先覆盖舞台成员进入休息室的 proving 路径。更多移动事件、状态变化、每回合限制、when-if 等 AUTO 边界后续继续扩。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts` 覆盖 AUTO 能力登记与队列 metadata。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖从舞台移动到休息室触发 AUTO、公开并入手 1 张成员、其余进休息室，以及被换手替换时与 `PL!HS-bp1-006-P` 费用 11「藤岛 慈」登场能力同窗排序。
- 验证：focused 2 files / 40 tests passed；相关完整验证 14 files / 156 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

## 下一步建议

优先级 1：基于 `系统边界混合` 测试卡组开始实现新效果，优先打开新系统边界，同时保留少量现有模块扩样本。

推荐下一批 proving cards：

- `PL!HS-bp2-012-N` 费用 5「乙宗 梢」已完成 AUTO proving 第一张，后续 AUTO proving set 可继续看 `PL!HS-bp6-017-N` 费用 11「日野下花帆」、`PL!HS-pb1-009-R` 费用 15「日野下花帆」、`PL!HS-bp6-004-R` 费用 13「百生 吟子」。目标 fragment：`T06,S08,S09,T07` 等，重点是继续扩大真实事件边界，而不是为单卡硬写。
- `PL!S-bp2-006-P` 费用 11「津岛善子」与 `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」当前目标段已完成，后续保留为 S07/S02/E02/X11 回归样例。
- `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」费用减少与登场二选一活跃段已完成，后续保留为 X11/X03/S02/E02 回归样例。
- `PL!SP-bp4-008-P` 费用 13「若菜四季」与 `PL!SP-PR-004-PR` 费用 4「唐 可可」当前已完成目标段，后续保留为 F02/E02/E03/S05 回归样例。

优先级 1.5：旧建议中的非 `PL!-sd1` 低风险扩样本中，`LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下花帆」、`PL!HS-PR-001-PR` 费用 10「日野下花帆」、`PL!-bp3-010-N` 费用 9「高坂穗乃果」已收口完成登场段；下一个推荐是 `PL!HS-PR-002-PR` 费用 10「村野さやか」。

- `PL!HS-PR-002-PR` 费用 10「村野さやか」：登场看顶3选1，优先作为同构下一步。

优先级 1.5：继续减少 runner inline orchestration，但不要做大型 resolver DSL。

- `PL!-sd1-006-SD` 的公开手牌 + 成功区交换仍 inline，等需要 C07/交换效果时再抽。
- 003 Heart 颜色选择仍是专用步骤，等第二个选择型效果再抽 generic option-choice。
- 009/022/001 的条件/倍率仍在 resolver，等非预组样例重复后再抽 condition AST。
- F12、抽牌刷新语义继续等待真实样例；F02 当前只有抽 2 弃 1 的第一条 proving path。

优先级 2：Step 12 / Stage 1G 自动能力框架已最小起步。

- `PL!HS-bp2-012-N` 费用 5「乙宗 梢」已证明 `ON_LEAVE_STAGE` 入队、look-top 解析与同事件顺序选择。
- 保留 AUTO 待办：后续继续推进标准 `GameEvent`、trigger matcher、每回合限制、when-if 与更广泛移动/状态事件，并用真实自动能力样例验证。

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

优先级 5：费用修正器后续扩展。

费用修正器已由 `LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」、`PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」与 `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」起步。后续同类卡继续扩展 `cost-calculator.ts` 的 cost modifier 条件与来源，不要写 UI 层特例。

## 已知注意点

- 子模块 `llocg_db` 里可能有本地未跟踪 `.DS_Store`，不要提交。
- 旧进度文档 `PROJECT_PROGRESS_TODO_20260611.md` 是历史施工日志；新窗口应以本文件为当前事实。
- 本地测试端口目前按 `5173` 使用；如果页面没热更新，先确认实际 Vite 端口。
