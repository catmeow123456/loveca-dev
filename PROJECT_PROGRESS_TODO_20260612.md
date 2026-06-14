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

2026-06-14 临时测试服务器补图记录：

- 作者提供的一键测试环境可用云端卡组测试，但本机没有完整生产卡图对象存储；为了改善本地测试体验，临时从 `/Users/meiyikai/Desktop/文件/个人/codex/loveca/deck` 下的两副外部 YAML 卡组补齐所需卡图到 `assets/card/` 与 `assets/images/{thumb,medium,large}/`。
- `scripts/download-local-test-card-images.mjs` 已补充 `--deck-dir=...`，并默认按同基础编号展开全部罕度。例如 deck 中出现 `PL!HS-pb1-009-R` 时，会同时尝试补 `PL!HS-pb1-009-P+` 等同编号变体。
- 为兼容数据库 `image_filename` 与中文卡图路径的命名差异，脚本会为同一源图生成多个 WebP 别名，例如 `P+` / `P2` / `Pplus`、`L+` / `L2` / `Lplus`。这属于本地显示兼容层，不代表生产文件命名规范。
- 这些临时图片只影响卡图显示，不参与规则引擎、费用计算、卡效触发、对局状态或测试服务器数据库逻辑。卡效开发仍应以卡牌数据和对局行为验证为准。
- 生产环境已有正常图片服务器/对象存储。上线或发正式 PR 前，应重点检查 `assets/card/` 与 `assets/images/` 中由本次补图产生的大量临时文件，不要把它们当作生产资产提交；生产图片链路确认正常后，可以清理这些临时图片，不会影响已实现卡效。

常用命令：

```bash
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/generate-local-test-card-sources.mjs
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/download-local-test-card-images.mjs --dry-run
env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/download-local-test-card-images.mjs
```

## 当前状态

本地测试桌面已经进入“LIVE 自动判定 + 卡效分类底座”阶段。

目前已完成的核心方向：

- 对局前端已新增可剥离的卡效自动化视觉标记：正面已自动化卡牌在卡顶中间显示约 4px 小点与 1px 圆角外描边，当前正在处理/可发动时变亮；标记只在 `PlayerArea` 等对局组件中通过 `Card.effectVisualState` 传入，不进入卡牌数据库。控制入口为 `client/src/lib/cardEffectAutomationVisuals.ts`，默认开启，可用 `VITE_CARD_EFFECT_VISUAL_MARKERS=false` / `0` / `off` 关闭；后续若全卡效完成后想剥离，删除该 helper、`CardEffectMarker`、`Card.effectVisualState` prop 和 `PlayerArea` 传参即可。
- 活跃阶段规则自动化已补齐：进入某玩家活跃阶段时，`GameService` 的 `UNTAP_ALL` 会将该玩家舞台成员和能量全部恢复为活跃状态；不会同时重置非当前玩家。
- LIVE 判定区会按当前光棒数自动翻推荐应援牌。
- 玩家仍可手动调整判定区，然后选择接受自动判定。
- 接受后系统会生成 Live 成功/失败、抽卡、分数草案，玩家仍保留强制成功/失败等人工修正入口。
- 多首 Live 判定已按规则改为“全部 Live 成功才算整个 Live 成功”；任一 Live 失败时总分为 0。
- Live 失败与 Live 成功但分数为 0 在状态中保持区分。
- 多首 Live 会先合并需求再判定，避免按单首贪心消耗 Heart 导致误判。

## 卡效分类与底座

`card-effect-runner.ts` 已建立 `CARD_ABILITY_DEFINITIONS` 登记入口。新增卡效前先登记分类，不要直接写单卡散逻辑。

2026-06-14 起，连续新增多张卡效时采用“快速卡效批处理模式”：每张卡/每个效果段实时更新 `docs/card-effect-reuse-audit/existing_module_map.md`、focused tests 与本 progress 的短记录；`card_effect_framework_design.md`、`card_effect_fragment_coverage_matrix.md`、`effect_module_coverage.md`、`card_effect_batch_expansions.md`、`module_gap_list.md`、`safe_refactor_plan.md` 等设计/覆盖/gap 文档默认攒到 5-10 张卡后统一收束。若引入新抽象、新模块、新事件边界，或改变 resolver / cost calculator / live modifier registry / 同编号罕度同步机制，则仍需在同一批内同步更新相关文档。

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
- “1回合 N 次”作为能力定义通用特征，使用 `perTurnLimit` 登记；通用 `ABILITY_USE` 按 `playerId + abilityId + sourceCardId + turnCount` 记录和校验，限制的是此来源卡实例，不是同名卡或同一玩家同能力总次数。
- 卡效发动费用已开始收口为 `src/application/effects/effect-costs.ts` 中的通用 `EffectCostDefinition` / `payImmediateEffectCosts` / `paySelectedDiscardHandCost` 底座。当前已覆盖弃 1 手牌、支付活跃能量、将来源成员从舞台放置入休息室、将来源成员变为指定方向四类；`PL!HS-bp5-008-R` 费用 4「桂城泉」已用 `SET_SOURCE_MEMBER_ORIENTATION` 验证“自身待机作为费用”。
- 区域目标选择/移动已开始收口为 `src/application/effects/zone-selection.ts` 中的 `ZoneCardSelectionConfig` / `createWaitingRoomToHandEffectState` / `moveSelectedCardsFromZone`。当前覆盖 `WAITING_ROOM -> HAND` 单选路径，`001` / `003` / `002` / `005` 的“从休息室加入手牌”已走统一完成逻辑。
- 最小 selector API 已落在 `src/application/effects/card-selectors.ts`，当前提供 `typeIs` / `groupIs` / `unitIs` / `unitAliasIs` / `unitAliasOrTextAliasIs` / `costLte` / `costGte` / `cardNameIs` / `cardNameAliasIs` / `and` / `or` / `not`，`001` / `003` / `002` / `005` 已用组合 selector 表达 LIVE、成员、低费 μ's 等候选条件；`PL!HS-bp6-004-R` 费用 13「百生 吟子」已用 `cardNameIs` 处理弃置「百生吟子」成员判断；`PL!HS-bp2-022-L+` 分数 2「アオクハルカ」已用 `unitAliasIs` 识别真实导入数据中的 `unitName=スリーズブーケ`；`PL!HS-sd1-006-SD` 费用 15「安养寺姬芽」已用 `cardNameAliasIs` 判断舞台中是否有大泽瑠璃乃/百生吟子/徒町小铃，`PL!HS-bp5-008-R` 费用 4「桂城泉」已用 `costGte(9)` 筛选看顶候选。小组名别名当前覆盖 `Cerise Bouquet`/`スリーズブーケ`、`DOLLCHESTRA`、`Mira-Cra Park!`/`みらくらぱーく！`/`みらくらぱーく!`、`EdelNote`；普通小组条件只看 `unitName`，需要“此卡视为某小组”等文本身份时才显式使用 `unitAliasOrTextAliasIs`。成员名别名当前按卡库常见角色覆盖中日名、空白/中点差异与组合卡 `&` 分隔组件，并额外覆盖早期中文误译/异体：`澁谷かのん`/`渋谷かのん`/`涩谷香音`/`涉谷香音`、`大沢瑠璃乃`/`大泽瑠璃乃`/`大泽琉璃乃`、`セラス柳田リリエンフェルト`/`セラス 柳田 リリエンフェルト`/`赛拉丝柳田利林费尔德`/`赛拉丝·柳田·利林费尔德`；严格卡面名才继续使用 `cardNameIs`。
- 舞台成员目标选择 active effect 已由 `src/application/effects/stage-member-target-selection.ts` 起步：按 `targetPlayerId + CardSelector` 生成可选舞台成员，并在确认后调用 `setMemberOrientation`；`PL!HS-bp6-004-R` 费用 13「百生 吟子」对手低费成员待机段已迁入该入口。
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

- `PL!HS-bp1-006-P` 费用 11「藤岛 慈」已完成两段：登场抽 2 张卡后将 1 张手牌放置入休息室，复用 draw helper + hand discard 壳；LIVE 开始可弃 1 手牌，若自己的舞台存在其他成员，则从粉/红/黄/绿/蓝/紫中选择 1 个 Heart 颜色并通过 `addLiveModifier` 写入 `HEART` modifier。无其他成员时只支付费用并结束。
- `PL!-pb1-019-N` 费用 2「高坂穗乃果」已完成起动：自送休息室，从休息室回收 1 张成员卡。复用 effect-costs 自送 + zone-selection/member selector。
- `PL!-bp4-003-P` 费用 2「南琴梨」已完成起动：自送休息室，从休息室回收 1 张 LIVE 卡。复用 effect-costs 自送 + zone-selection/live selector。
- focused tests 已补 `tests/integration/sample-card-effect-runner.test.ts` 与 `tests/unit/card-effect-classification.test.ts` 覆盖。
- 验证：focused 2 files / 28 tests passed；相关 12 files / 112 tests passed；`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` passed。

本次 2026-06-14 `PL!HS-bp1-006-P` 费用 11「藤岛 慈」LIVE 开始段补齐：

- 新增 LIVE 开始能力登记：可弃 1 手牌；若自己的舞台存在其他成员，则从粉/红/黄/绿/蓝/紫中选择 1 个 Heart 颜色，LIVE 结束时为止获得 1 个该颜色 Heart。
- 复用 `createDiscardHandToWaitingRoomActivationEffect`、Heart option active effect 与 `addLiveModifier` 主写入路径；未引入新的 UI 特例。
- 新增 focused 覆盖：有其他成员时弃手后可选 Heart 并写入 `liveModifiers`；无其他成员时只支付费用并结束，不写入 Heart modifier。
- 验证：focused 4 files / 94 tests passed。

本次 2026-06-14 `PL!HS-bp1-004-P` 费用 15「夕雾缀理」两段补齐：

- 起动段登记为 `ACTIVATED` / `STAGE_MEMBER` / 每回合 1 次：支付 3 张活跃能量，从自己的休息室选择 1 张『莲之空』LIVE 卡加入手牌。
- LIVE 开始段登记为 `LIVE_START` / `STAGE_MEMBER`：可支付 1 张活跃能量；LIVE 结束时为止，按自己的 LIVE 区卡牌数量获得 BLADE。
- 复用 `perTurnLimit`、`payImmediateEffectCosts(TAP_ACTIVE_ENERGY)`、`zone-selection`、`groupIs('莲之空')` / `groupIs('蓮ノ空')`、`addLiveModifier`；未新增 UI 特例。
- 新增 focused 覆盖：无合法目标时起动不支付也不占次数；起动支付 3 能量只筛选莲之空 LIVE 并验证每来源卡每回合 1 次；LIVE 开始支付 1 能量后按 LIVE 区 2 张写入 BLADE +2。
- 验证：focused 4 files / 105 tests passed。

本次 2026-06-14 同编号罕度同步与卡效登记册重整：

- `CardAbilityDefinition` 新增 `baseCardCodes`，`getCardAbilityDefinitions` 统一支持 exact `cardCodes` 与基础编号匹配；`PL!HS-bp1-004` 费用 15「夕雾缀理」、`PL!HS-bp1-006` 费用 11「藤岛 慈」、`PL!HS-bp6-004` 费用 13「百生 吟子」、`PL!SP-bp4-008` 费用 13「若菜四季」等已同步同编号多罕度。
- resolver / generic look-top 参数判断 / continuous live modifier registry / cost calculator 已改用基础编号判断；`PL!-bp4-003` 费用 2「南琴梨」的 `P/R` 不再分散为两套起动登记。
- 新增 `tests/unit/card-effect-rarity-sync.test.ts`，从 `llocg_db/json/cards_cn.json` 扫描同基础编号族群，防止后续 exact `cardCodes` 漏同步其他罕度。
- `docs/card-effect-reuse-audit/existing_module_map.md` 已重写为按基础编号的卡效完成状态登记册；模块覆盖拆到 `effect_module_coverage.md`，同构批量扩样本拆到 `card_effect_batch_expansions.md`。
- 当前已验证：`tests/unit/card-code.test.ts`、`tests/unit/card-effect-classification.test.ts`、`tests/unit/card-effect-rarity-sync.test.ts`、`tests/unit/cost-calculator.test.ts`、`tests/unit/stage-member-target-selection.test.ts`、`tests/unit/card-selectors.test.ts`、`tests/integration/member-cost-payment.test.ts`、`tests/integration/sample-card-effect-runner.test.ts` 共 8 files / 163 tests passed。

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

本次 2026-06-13 `PL!HS-bp6-017-N` 费用 11「日野下花帆」AUTO proving 收口：

- 新增 `HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID`，登记为 `AUTO` / `STAGE_MEMBER` / `ON_LEAVE_STAGE` 队列能力。
- 继续复用 `ON_LEAVE_STAGE` 离场 AUTO 入队路径，并补了薄事件来源接口：`enqueueTriggeredCardEffects` 可从 `LeaveStageEvent` 转换离场来源；当前主流程仍兼容 action-history / explicit-source。
- 效果流程复用现有弃手费用与 `WAITING_ROOM -> HAND` 移动原语：离场后可选择 1 张手牌放置入休息室；如此做时，从休息室选择 LIVE 卡和成员卡至多各 1 张加入手牌。来源成员自身已进入休息室，因此也会成为合法成员候选。
- 新增 grouped recovery 校验：多选最多 2 张，但 LIVE 不超过 1 张、成员不超过 1 张；尝试选择两张 LIVE 会被权威层拒绝。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts` 覆盖第二张离场 AUTO 能力登记。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖离场触发、跳过弃手、弃手后回收 LIVE/成员各 1 张，以及同类双选被拒绝。
- 验证：focused 2 files / 42 tests passed；相关完整验证 14 files / 158 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-13 `PL!HS-pb1-009-R` 费用 15「日野下花帆」AUTO proving 收口：

- 新增 `HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID`，登记为 `AUTO` / `STAGE_MEMBER` / `ON_ENTER_STAGE` 队列能力，`requiredSourceSlots: [CENTER]`，`perTurnLimit: 2`。
- `enqueueTriggeredCardEffects` 的 `ON_ENTER_STAGE` 现在同时支持登场者自己的 `ON_ENTER` 能力与舞台成员监听登场事件的 AUTO；新增薄 `EnterStageEvent` / on-enter source adapter，当前主流程仍兼容最近 `PLAY_MEMBER` action。
- “1回合 N 次”限制改为通用实例级底座：`ABILITY_USE` 按来源卡实例计数；同步修正 `PL!-sd1-008-SD` 费用未登记「小泉 花陽」的旧行为，同一实例本回合第二次会被拒绝，另一张同名实例可以发动。
- 效果段写入 `liveResolution.liveModifiers` 的 `BLADE` modifier：己方「莲之空」成员登场至自己舞台时，来源为中央的此成员获得 BLADE +2。FAQ 覆盖“此成员自己登场到中央也会触发”。
- 同卡第二段登记为 `LIVE_START` / `STAGE_MEMBER` 队列能力：LIVE 开始时统计此成员有效 BLADE，若大于等于 8，则复用 F02 抽 2 弃 1 流程。
- `domain/rules/live-modifiers.ts` 新增 `getMemberEffectiveBladeCount`：以印刷 BLADE 加上同 `playerId + sourceCardId` 的 BLADE modifier 统计成员当前有效 BLADE；非成员或找不到来源时返回 0。
- 新增通用 confirm-only active effect：玩家从顺序选择窗口手动点选无输入 pending ability 时，先显示来源卡、效果文本与“继续处理”按钮；点击后才真正 resolve。`PL!HS-pb1-009-R` 费用 15「日野下花帆」第一段已接入该壳；“顺序发动”仍按队列自动处理，不逐个弹确认。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts` 覆盖 `PL!HS-pb1-009-R` 费用 15「日野下花帆」AUTO 登记、中心位与每回合 2 次限制。
  - `tests/unit/live-modifiers.test.ts` 覆盖成员有效 BLADE 只统计同玩家、同来源成员的 BLADE modifier。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖自己登场触发、非「莲之空」不触发、同一来源实例每回合只触发 2 次、`PL!-sd1-008-SD` 费用未登记「小泉 花陽」同名不同实例可分别发动，LIVE 开始 BLADE 阈值未满足时跳过、满足时抽 2 弃 1，以及手动点选无输入 AUTO 先进入 confirm-only、顺序发动不弹 confirm-only。
- 验证：第一段 focused 2 files / 44 tests passed；第二段 focused 3 files / 49 tests passed；confirm-only 后 focused 3 files / 51 tests passed；相关完整验证 14 files / 165 tests passed；`pnpm exec tsc --noEmit` 与 `pnpm --dir client exec tsc -b` passed。

本次 2026-06-13 `PL!HS-bp6-004-R` 费用 13「百生 吟子」组合效果 proving 收口：

- 新增三条能力登记：
  - 登场段 `HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID`：对方舞台费用小于等于 9 的 1 名成员变为待机状态。
  - LIVE 开始段 `HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID`：同一对手低费成员待机效果。
  - LIVE 开始段 `HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID`：可弃 1 张手牌，LIVE 结束时为止获得 BLADE；若弃置的是姓名归一化后为「百生吟子」的成员卡，则共获得 BLADE +2。
- 顺序选择窗口补通用同源多能力区分：同一窗口若存在重复 `sourceCardId`，不再用卡图 ID 选择，而切到 `selectableOptions` 展示具体效果文本；不同来源卡的普通队列仍保持卡图选择。
- 新增舞台成员目标 helper：按 `playerId + predicate` 扫描成员区槽位，供对手目标/费用筛选复用；实际方向变更继续调用 `member-state.ts` 的 `setMemberOrientation`。
- 该舞台成员目标 helper 已从 runner 下沉到 `src/application/effects/stage-targets.ts`，并改为接收 `card-selectors.ts` 的组合 selector；舞台成员单选并改方向的 active effect 已继续抽为 `src/application/effects/stage-member-target-selection.ts`；弃置「百生吟子」判断也改为复用 `cardNameIs`。
- 弃手加 BLADE 段复用现有可选弃手 active effect 与 `moveHandCardToWaitingRoomForEffect`，并通过 `addLiveModifier` 写入 BLADE modifier。
- focused tests 已补：
  - `tests/unit/card-effect-classification.test.ts` 覆盖 `PL!HS-bp6-004-R` 费用 13「百生 吟子」三条能力登记。
  - `tests/unit/stage-member-target-selection.test.ts` 覆盖舞台成员目标 active effect 的候选生成、无目标结果与方向结算。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖登场时只能选择对方费用小于等于 9 的成员、同一张来源卡两条 LIVE 开始能力使用 option 区分、弃置同名「百生吟子」成员获得 BLADE +2。
- 验证：stage member target selection 抽取后 focused 4 files / 58 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-14 `PL!HS-bp5-019-L` 分数 6「花结」与 `PL!HS-bp2-022-L+` 分数 2「アオクハルカ」LIVE 卡来源 modifier 扩样本：

- `PL!HS-bp5-019-L` 分数 6「花结」已登记为 LIVE 卡来源的 `LIVE_START` 队列能力：LIVE 开始时按自己的 LIVE 卡区中此卡以外的「莲之空」卡数量，每张使此卡必要绿色 Heart 减少 2 个。
- `PL!HS-bp2-022-L+` 分数 2「アオクハルカ」已按基础编号 `PL!HS-bp2-022` 覆盖 `L / L+`：LIVE 开始时若自己的休息室存在大于等于 3 张『Cerise Bouquet』LIVE 卡，则此卡分数 +1。
- 两张卡都复用现有 LIVE 开始队列、confirm active effect 与 `liveModifiers` 主写入路径；`花结` 使用 `replaceLiveModifier(REQUIREMENT)` 写入绿色必要 Heart 修正，`アオクハルカ` 使用 `addLiveModifier(SCORE)` 写入分数修正。
- 手测反馈修正：本地导入数据中 `Cerise Bouquet` / `スリーズブーケ` 是 `unitName`，而不是 `groupName`；已为 `card-selectors.ts` 增加 `unitIs`、`unitAliasIs` 与 `unitAliasOrTextAliasIs`，并让 `アオクハルカ` 的休息室 LIVE 计数通过 `unitAliasIs('Cerise Bouquet')` 识别 `unitName=スリーズブーケ`。默认小组条件只看 `unitName`；“此卡视为……”等文本身份保留给显式的 `unitAliasOrTextAliasIs`。
- 新增 focused 覆盖：
  - `tests/unit/card-effect-classification.test.ts` 覆盖两张 LIVE 卡能力登记与 `PL!HS-bp2-022-L+` 半角 `+` 归一化匹配。
  - `tests/unit/card-selectors.test.ts` 覆盖 `unitIs` 对 `unitName=スリーズブーケ` 的小队识别、`unitAliasIs` 的英日别名匹配，以及 `unitAliasOrTextAliasIs` 与纯 `unitAliasIs` 的文本身份边界。
  - `tests/integration/sample-card-effect-runner.test.ts` 覆盖 LIVE 卡来源入队、确认后写入绿色 `REQUIREMENT` modifier、休息室 3 张 `unitName=スリーズブーケ` LIVE 条件满足后写入 `SCORE` modifier。
- 验证：`env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec vitest run tests/unit/card-code.test.ts tests/unit/card-selectors.test.ts tests/unit/card-effect-classification.test.ts tests/unit/card-effect-rarity-sync.test.ts tests/unit/live-modifiers.test.ts tests/unit/live-judgment-settlement.test.ts tests/integration/sample-card-effect-runner.test.ts`，7 files / 159 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

本次 2026-06-14 `PL!HS-pb1-004-R` 费用 4「百生吟子」与 `PL!HS-PR-019-RM` 费用 2「百生吟子」登场效果扩样本：

- `PL!HS-pb1-004-R` 费用 4「百生吟子」已按基础编号 `PL!HS-pb1-004` 覆盖 `R / P+`：登场可支付 1 能量并弃 1 手牌，堆顶 3 入休息室后，从休息室回收 1 张 Cerise Bouquet LIVE。
- `PL!HS-PR-019-RM` 费用 2「百生吟子」已按基础编号 `PL!HS-PR-019` 覆盖 `PR / RM`：登场公开检视卡组顶 3 张，点击继续处理后放置入休息室；若均为持有绿色 Heart 的成员，则 LIVE 结束前获得绿色 Heart；PR/RM 中文措辞不同但实际效果相同。
- 角色名归一化额外加入早期中文误译/异体：`澁谷かのん = 渋谷かのん = 涩谷香音 = 涉谷香音`、`大沢瑠璃乃 = 大泽瑠璃乃 = 大泽琉璃乃`、`セラス柳田リリエンフェルト = セラス 柳田 リリエンフェルト = 赛拉丝柳田利林费尔德 = 赛拉丝·柳田·利林费尔德`。
- 本批已在收束时同步 `existing_module_map.md`、`card_effect_framework_design.md`、`card_effect_fragment_coverage_matrix.md`、`effect_module_coverage.md`、`card_effect_batch_expansions.md`、`module_gap_list.md`、`safe_refactor_plan.md` 等设计/覆盖/gap 文档；后续继续维持“每张实时登记、5-10 张或批末统一收束设计文档”的节奏。
- 最终验证：focused suite 12 files / 210 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

## 下一步建议

`绿莲-6弹ver.yaml` 中本轮原计划 10 张卡剩余未完成项按以下顺序推进：

1. `PL!HS-bp5-001-SEC` 费用 11「日野下花帆」
   - 建议拆两批：先做登场堆顶 4、含 LIVE 则 BLADE +2；再做起动公开手牌 LIVE 并按同名回收 LIVE。第二段会推进 C07 公开手牌。
2. `PL!HS-bp1-003-SEC` 费用 13「乙宗梢」
   - 先做起动支付 1 能量回收费用小于等于 4 的「莲之空」成员；常时三面不同名加分稍后等 condition / continuous builder 更稳再补。
3. `PL!HS-bp1-002-RM` 费用 11「村野沙耶香」
   - 支付 2 能量并自送，从休息室登场费用小于等于 15 的「莲之空」成员到原区域。适合作为第二个 S07 样例，但同基础编号文本有细微差异，需先处理同步策略。
4. 再往后放：`PL!HS-sd1-001-SD` 费用 9「日野下花帆」、`PL!HS-pb1-020-N` 费用 9「百生吟子」、`PL!HS-bp6-001-R+` 费用 4「日野下花帆」、`PL!HS-cl1-009-CL` 分数 1「水彩世界」、`PL!HS-bp6-027-L` 分数 5「月夜見海月」。
   - 这些分别牵涉 relay 条件、弃 2 手牌、动态控顶、声援公开卡/追加声援，适合后段集中推进。

本次 2026-06-14 低风险同构扩样本（与 `PL!-sd1-002-SD` 对齐）已完成 17 张卡：

- `PL!-pb1-025-N` 费用 2「東條 希」
- `PL!HS-PR-014-PR` 费用 2「日野下花帆」
- `PL!HS-pb1-019-N` 费用 2「大沢 瑠璃乃」
- `PL!HS-sd1-015-SD` 费用 2「セラス 柳田 リリエンフェルト」
- `PL!N-bp4-017-N` 费用 2「宮下 愛」
- `PL!N-bp4-020-N` 费用 2「エマ・ヴェルデ」
- `PL!N-sd1-006-SD` 费用 2「近江 彼方」
- `PL!S-PR-025-PR` 费用 2「高海 千歌」
- `PL!S-PR-027-PR` 费用 2「松浦 果南」
- `PL!S-bp2-016-N` 费用 2「国木田 花丸」
- `PL!S-bp6-014-N` 费用 2「渡辺 曜」
- `PL!S-sd1-008-SD` 费用 2「小原 鞠莉」
- `PL!SP-bp4-015-N` 费用 2「平安名 すみれ」
- `PL!SP-bp4-019-N` 费用 2「若菜 四季」
- `PL!SP-pb1-021-N` 费用 2「ウィーン・マルガレーテ」
- `PL!SP-sd2-014-SD2` 费用 2「嵐 千砂都」
- `PL!-pb1-019-N` 费用 2「高坂穗乃果」

- 已同步文档：`docs/card-effect-reuse-audit/existing_module_map.md`（`PL!-pb1-019-N` 同型批次 17 卡）、`docs/card-effect-reuse-audit/module_gap_list.md`（`F07,F08,F09` 闭环更新为 35 张同型）与 `docs/card-effect-framework/card_effect_fragment_coverage_matrix.md`。
- 本次焦点验证通过：`env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec vitest run tests/integration/sample-card-effect-runner.test.ts tests/unit/card-effect-classification.test.ts`、`env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs exec tsc --noEmit`、`env PATH=/Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/usr/bin:/bin:/usr/sbin:/sbin /Users/meiyikai/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node /private/tmp/package/bin/pnpm.cjs --dir client exec tsc -b`。

优先级 1：基于 `系统边界混合` 测试卡组开始实现新效果，优先打开新系统边界，同时保留少量现有模块扩样本。

推荐下一批 proving cards：

- `PL!HS-bp6-004-R` 费用 13「百生 吟子」已完成登场/LIVE 开始对手低费成员待机、LIVE 开始可弃手加 BLADE、同源双 LIVE 开始顺序选择区分，并已抽出舞台成员目标选择 active effect 配置入口。下一批建议继续真实 AUTO / LIVE 开始 proving set，优先选择能推进 when-if、名称/费用 selector 配置化或更多状态事件的卡；若先做低风险复用验证，可找第二张“选择自己/对方舞台成员并改变状态”的同型卡接 `stage-member-target-selection.ts`。
- `PL!S-bp2-006-P` 费用 11「津岛善子」与 `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」当前目标段已完成，后续保留为 S07/S02/E02/X11 回归样例。
- `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」费用减少与登场二选一活跃段已完成，后续保留为 X11/X03/S02/E02 回归样例。
- `PL!SP-bp4-008-P` 费用 13「若菜四季」与 `PL!SP-PR-004-PR` 费用 4「唐 可可」当前已完成目标段，后续保留为 F02/E02/E03/S05 回归样例。
- `PL!HS-bp1-004-P` 费用 15「夕雾缀理」已完成起动支付能量回收莲之空 LIVE 与 LIVE 开始支付能量按 LIVE 区数量得 BLADE，后续保留为 C03/F08/B01 回归样例。
- `PL!HS-bp5-019-L` 分数 6「花结」与 `PL!HS-bp2-022-L+` 分数 2「アオクハルカ」已完成 LIVE 卡来源的 LIVE 开始必要 Heart / 分数 modifier，后续保留为 B07/B05 回归样例。

优先级 1.5：旧建议中的非 `PL!-sd1` 低风险扩样本中，`LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下花帆」、`PL!HS-PR-001-PR` 费用 10「日野下花帆」、`PL!-bp3-010-N` 费用 9「高坂穗乃果」已收口完成登场段；下一个推荐是 `PL!HS-PR-002-PR` 费用 10「村野さやか」。

- `PL!HS-PR-002-PR` 费用 10「村野さやか」：登场看顶3选1，优先作为同构下一步。

优先级 1.5：继续减少 runner inline orchestration，但不要做大型 resolver DSL。

- `PL!-sd1-006-SD` 的公开手牌 + 成功区交换仍 inline，等需要 C07/交换效果时再抽。
- 003 / `PL!HS-bp1-006-P` 费用 11「藤岛 慈」Heart 颜色选择仍是专用步骤；已有第二张 Heart 样例，下一张选择颜色/模式卡出现时可抽 generic option-choice。
- 009/022/001 的条件/倍率仍在 resolver，等非预组样例重复后再抽 condition AST。
- F12、抽牌刷新语义继续等待真实样例；F02 当前已有登场抽弃与 BLADE 阈值 LIVE 开始抽弃样例；`PL!HS-bp1-006-P` 费用 11「藤岛 慈」已补齐 LIVE 开始弃手后按条件选择 Heart 的 B03 扩样本。

优先级 2：Step 12 / Stage 1G 自动能力框架已最小起步。

- `PL!HS-bp2-012-N` 费用 5「乙宗 梢」已证明 `ON_LEAVE_STAGE` 入队、look-top 解析与同事件顺序选择；`PL!HS-bp6-017-N` 费用 11「日野下花帆」已证明同一离场 AUTO 底座可接弃手后分组回收；`PL!HS-pb1-009-R` 费用 15「日野下花帆」已证明 `ON_ENTER_STAGE` 可被舞台成员监听并接实例级每回合限制，且 LIVE 开始段可复用成员有效 BLADE helper 与 F02 抽弃流程。
- 保留 AUTO 待办：后续继续推进标准 `GameEvent`、trigger matcher、when-if 与更广泛移动/状态事件，并用真实自动能力样例验证。

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
