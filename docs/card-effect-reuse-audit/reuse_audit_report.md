# Loveca card effect reuse audit report

> 文档类型：历史/计划文档
> 适用范围：2026-06-13 卡效复用只读审查快照与后续重构背景
> 当前状态：历史审计快照；路径、行号、缺口和优先级均不代表当前实现
> 替代来源：卡牌状态见 `existing_module_map.md`，模块覆盖见 `effect_module_coverage.md`，当前缺口见 `module_gap_list.md`
> 最后更新：2026-07-24

审查日期：2026-06-13
审查范围（历史）：只读审查当时 `loveca_battle` 已登记/实现的样例卡效；未修改业务代码。
输入基准：`references/codex_loveca_reuse_audit_pack.zip` 中的 `loveca_effect_fragments_catalog.json`、`loveca_effect_reuse_report.md`、`codex_loveca_reuse_audit_prompt.md`。
主要实现入口：`src/application/card-effect-runner.ts`。

> 2026-06-14 更新：本报告下方 reuse table 是早期只读审查快照，部分 “missing abstraction / local helper” 结论已被后续模块化工作关闭。当前权威状态请优先看同目录的 `existing_module_map.md`、`effect_module_coverage.md`、`card_effect_batch_expansions.md`、`module_gap_list.md`、`safe_refactor_plan.md`。

## Summary

当前代码已经不是“每张卡完全各写各的”：`CARD_ABILITY_DEFINITIONS`、触发入队、起动次数限制、弃手费用壳、部分费用支付、休息室到手牌选择、Live modifier、控顶选择都有可复用雏形。

主要差距是这些雏形多数仍是 `card-effect-runner.ts` 内的局部 helper，而不是可组合的公共 effect/action/selector 模块。尤其是 selector/condition 仍大量写在单卡函数或 cardCode 判断中；多处区域移动直接 `updatePlayer` 改 zone/slot，未来若自动能力监听移动事件，会比较难接。

## Reuse table

| card_no | card_name | implementation_path | effect_summary | matched_fragment_ids | current_reuse_status | issues | suggested_shared_module | risk | migration_priority |
|---|---|---|---|---|---|---|---|---|---|
| `PL!-sd1-001-SD` | 高坂 穂乃果 | `src/application/card-effect-runner.ts:203`; `src/application/card-effect-runner.ts:1304`; `src/domain/rules/live-modifiers.ts:57` | 登场：成功 Live >=2 时从休息室回收 Live；常时：成功 Live 每 1 张得 BLADE | `T01,F07,F08,L01,L02,X01`; `T05,L01,L02,B08,X13` | `OK_REUSED` + `HARD_CODED_SELECTOR` + `LOCAL_HELPER_SHOULD_BE_SHARED` | 登场能力走队列和 WR->HAND helper，但成功区条件、Live selector 写在 `startHonokaOnEnterSelection`；常时 BLADE 收集写死 cardCode `PL!-sd1-001-SD` | `selectFromZoneToHand(waitingRoom, selector, count)`；`continuousLiveModifierRegistry`；`condition.successLiveCountAtLeast(n)` | medium | `P1-soon` |
| `PL!-sd1-002-SD` | 絢瀬 絵里 | `src/application/card-effect-runner.ts:224`; `src/application/card-effect-runner.ts:2818`; `src/application/card-effect-runner.ts:2839` | 起动：自身进休息室，从休息室回收成员 | `T03,C04,F07,F09` | `OK_REUSED` + `LOCAL_HELPER_SHOULD_BE_SHARED` + `BYPASSES_ENGINE_EVENT` | 起动壳、C04 费用和 WR->HAND 选择已复用；但 `startSacrificeSelfActivatedEffect`、`payImmediateEffectCosts` 仍局部；自送休息室直接改 slot/waitingRoom | `activatedAbility(costs, effectSteps)`；`payCost(moveSelfStageToWR())`；`selectFromZoneToHand(type=member)` | low | `P0-now` |
| `PL!-sd1-003-SD` | 南 ことり | `src/application/card-effect-runner.ts:238`; `src/application/card-effect-runner.ts:1327`; `src/application/card-effect-runner.ts:2688` | 登场：回收费用 <=4 的 μ's 成员；Live 开始：可弃手，选择粉/黄/紫 Heart | `T01,F07,F09,X04,X06`; `T02,C01,B03,B08` | `OK_REUSED` + `HARD_CODED_SELECTOR` + `LOCAL_HELPER_SHOULD_BE_SHARED` | 回收和弃手流程复用了局部 helper；`isMuseCard`、`cost <= 4`、Heart 颜色选项硬编码；B03 选项选择还不是通用 `chooseOptions` | `selector.group('μs').type(member).costLte(4)`；`optionalDiscardHandCost(1)`；`chooseColorThenGrantHeart` | medium | `P0-now` for C01; `P1-soon` for B03 |
| `PL!-sd1-004-SD` | 園田 海未 | `src/application/card-effect-runner.ts:258`; `src/application/card-effect-runner.ts:1928`; `src/application/card-effect-runner.ts:2476` | 登场：看顶 5，公开 μ's Live 加手，其余进休息室 | `T01,F04,X04` | `INLINE_DUPLICATE` + `MISSING_ABSTRACTION` + `HARD_CODED_SELECTOR` | 能力壳 OK；看顶、筛选、公开、入手、其余入休息室是单卡流程，和 015 的 F04 语义重复；μ's Live selector 写死 | `lookTopSelectToHand({lookN:5,takeUpTo:1,selector,reveal:true,rest:'WAITING_ROOM'})` | medium | `P0-now` |
| `PL!-sd1-005-SD` | 星空 凛 | `src/application/card-effect-runner.ts:268`; `src/application/card-effect-runner.ts:2828`; `src/application/card-effect-runner.ts:2839` | 起动：自身进休息室，从休息室回收 Live | `T03,C04,F07,F08` | `OK_REUSED` + `LOCAL_HELPER_SHOULD_BE_SHARED` + `BYPASSES_ENGINE_EVENT` | 与 002 共用自送休息室 + WR->HAND 局部 helper；Live selector 是函数参数但还不是 selector AST | `payCost(moveSelfStageToWR())`；`selectFromZoneToHand(type=live)` | low | `P0-now` |
| `PL!-sd1-006-SD` | 西木野 真姫 | `src/application/card-effect-runner.ts:282`; `src/application/card-effect-runner.ts:1507`; `src/application/card-effect-runner.ts:1589` | 登场：可公开手牌 Live，成功 Live 入手；如此做则公开牌放成功区 | `T01,C07,L01,L02,X01,X02` | `MISSING_ABSTRACTION` + `HARD_CODED_SELECTOR` + `BYPASSES_ENGINE_EVENT` | C07 公开手牌、X02 “如此做”绑定、成功区与手牌交换都是单卡流程；直接改 hand/successZone | `revealFromHand(selector)`；`ifPreviousActionSucceeded`；`exchangeZones(hand,successZone)` | medium | `P1-soon` |
| `PL!-sd1-007-SD` | 東條 希 | `src/application/card-effect-runner.ts:292`; `src/application/card-effect-runner.ts:1871`; `src/application/card-effect-runner.ts:2406` | 登场：公开/堆墓顶 5；其中有 Live 则抽 1 | `T01,F01,F06,X01` | `INLINE_DUPLICATE` + `MISSING_ABSTRACTION` + `BYPASSES_ENGINE_EVENT` | 能力壳 OK；F06 堆墓、F01 抽牌、X01 条件判断均是单卡内直接移动/抽牌；缺少可组合的 topDeckToWR + draw action | `moveTopDeckToWaitingRoom(n,{reveal:true})`；`if(moved.some(type=live), draw(1))` | medium | `P0-now` |
| `PL!-sd1-008-SD` | 小泉 花陽 | `src/application/card-effect-runner.ts:302`; `src/application/card-effect-runner.ts:421`; `src/application/card-effect-runner.ts:2925` | 起动 1/turn `[E][E]`：顶 10 入休息室 | `T03,T07,F06,E01` | `OK_REUSED` + `LOCAL_HELPER_SHOULD_BE_SHARED` + `BYPASSES_ENGINE_EVENT` | T07 通过 actionHistory 统一校验；E01 支付活跃能量走局部 cost helper；F06 顶 10 入休息室直接改 deck/waitingRoom | `payEnergy(n)`；`moveTopDeckToWaitingRoom(10)` | low | `P0-now` |
| `PL!-sd1-009-SD` | 矢澤 にこ | `src/application/card-effect-runner.ts:317`; `src/application/card-effect-runner.ts:1636`; `src/application/card-effect-runner.ts:1677` | Live 开始：休息室 μ's >=25 时 Live 合计分数 +1 | `T02,B05,X01,X04,X05` | `OK_REUSED` + `HARD_CODED_SELECTOR` + `LOCAL_HELPER_SHOULD_BE_SHARED` | T02 队列 OK，分数写入 `liveModifiers` OK；但 μ's 计数条件和分数 modifier 构建仍是单卡函数，且还同步 legacy map | `condition.countInZone(waitingRoom, selector)>=25`；`modifyLiveTotalScore(+1,duration=liveEnd)` | medium | `P1-soon` |
| `PL!-sd1-011-SD` | 絢瀬 絵里 | `src/application/card-effect-runner.ts:327`; `src/application/card-effect-runner.ts:1992`; `src/application/card-effect-runner.ts:2033` | 登场：可弃 1 手牌；看顶 3，必须选 1 入手，其余进休息室 | `T01,C01,F03` | `OK_REUSED` + `LOCAL_HELPER_SHOULD_BE_SHARED` | 与 012/016 共用 `GENERIC_DISCARD_LOOK_TOP_ABILITY_ID`，复用度好；但 C01/F03 helper 仍在 runner 内，且区域移动直接改状态 | `optionalDiscardHandCost(1)`；`lookTopSelectToHand(3, exactly1, any)` | low | `P1-soon` |
| `PL!-sd1-012-SD` | 南 ことり | `src/application/card-effect-runner.ts:327`; `src/application/card-effect-runner.ts:1992`; `src/application/card-effect-runner.ts:2033` | 同 011 | `T01,C01,F03` | `OK_REUSED` + `LOCAL_HELPER_SHOULD_BE_SHARED` | 同 011 | `optionalDiscardHandCost(1)`；`lookTopSelectToHand(3, exactly1, any)` | low | `P1-soon` |
| `PL!-sd1-015-SD` | 西木野 真姫 | `src/application/card-effect-runner.ts:327`; `src/application/card-effect-runner.ts:1992`; `src/application/card-effect-runner.ts:2033`; `src/application/card-effect-runner.ts:2151` | 登场：可弃 1 手牌；看顶 5，可公开成员入手，其余进休息室 | `T01,C01,F04` | `OK_REUSED` + `HARD_CODED_SELECTOR` + `LOCAL_HELPER_SHOULD_BE_SHARED` | 复用 generic discard-look-top 流程，但 `topCount/memberOnly/revealSelectedBeforeHand` 由 cardCode 判断注入；应变成 ability config 参数 | `lookTopSelectToHand({lookN:5,takeUpTo:1,selector:type(member),reveal:true})` | low | `P0-now` |
| `PL!-sd1-016-SD` | 東條 希 | `src/application/card-effect-runner.ts:327`; `src/application/card-effect-runner.ts:1992`; `src/application/card-effect-runner.ts:2033` | 同 011 | `T01,C01,F03` | `OK_REUSED` + `LOCAL_HELPER_SHOULD_BE_SHARED` | 同 011 | `optionalDiscardHandCost(1)`；`lookTopSelectToHand(3, exactly1, any)` | low | `P1-soon` |
| `PL!-sd1-019-SD` | START:DASH!! | `src/application/card-effect-runner.ts:337`; `src/application/card-effect-runner.ts:2235`; `src/application/card-effect-runner.ts:2256` | Live 成功：看顶 3，任意张按顺序放回顶，其余进休息室 | `T04,F05` | `OK_REUSED` + `LOCAL_HELPER_SHOULD_BE_SHARED` | T04 队列 OK；`startArrangeInspectedDeckTopEffect` 已是较好的 F05 雏形，但仅 runner 内可用，未成为公共 look-top 控顶模块 | `lookTopReorderTopRestWR(lookN, selectRange, restDest)` | low | `P1-soon` |
| `PL!-sd1-022-SD` | 僕らは今のなかで | `src/application/card-effect-runner.ts:348`; `src/application/card-effect-runner.ts:1733`; `src/application/card-effect-runner.ts:1778`; `src/domain/rules/live-requirement-modifiers.ts:16` | Live 开始：按成功 Live 数减少无色必要 Heart | `T02,B07,L01,L02,X06,X13` | `OK_REUSED` + `HARD_CODED_SELECTOR` | T02 队列、B07 requirement modifier 和 `applyHeartRequirementModifiers` 复用较好；公式 `successLiveCount * 2`、无色 Heart 仍写在单卡 resolver | `modifyRequiredHearts({scale:successLiveCount,countPer:2,color:RAINBOW})` | medium | `P1-soon` |
| `PL!N-pb1-004-P+` | 朝香 果林 | `src/application/card-effect-runner.ts:358`; `src/application/card-effect-runner.ts:2160`; `src/application/card-effect-runner.ts:2539`; `src/application/card-effect-runner.ts:2622` | Live 开始：公开顶 1，费用 <=9 成员入手并站位变换，否则入休息室；后续已补常时：本回合未移动时获得 BLADE | `T02,S05,X01,X06,F13`; catalog also has `T05,B08` continuous | `MISSING_ABSTRACTION` + `HARD_CODED_SELECTOR` + `BYPASSES_ENGINE_EVENT` | 顶 1 公开/处理、费用阈值 selector、站位变换在早期快照中仍是单卡流程；2026-06-14 后续已迁入 `member-state.ts` 站位 helper，并通过 continuous modifier registry 补齐常时 BLADE。剩余问题是 condition/step DSL 未抽象。 | `peekOrRevealDeckTop(1)`；`selector.type(member).costLte(9)`；`positionChange(..., swap=true)`；`continuousLiveModifierRegistry` | medium | `P1-soon` |

## Behavior mismatch

| card_no | issue | evidence | recommendation |
|---|---|---|---|
| `PL!N-pb1-004-P+` | 早期快照曾记录常时 `T05,B08` 未登记；该缺口已在后续提交关闭。 | 现行权威登记册记录 `PL!N-pb1-004` 费用 11「朝香果林」完整已实现；`tests/unit/live-modifiers.test.ts` 覆盖未进行成员区位置移动时 continuous BLADE +2。 | 保留本行作为历史审计关闭记录；当前状态以 `existing_module_map.md` 为准。 |

## Highest-value findings

1. `F07/F08/F09` 已有局部底座，但 selector 和 source/destination 还不是真公共 API。`startWaitingRoomCardSelection`/`moveSelectedCardsFromZone` 可以作为低风险第一批抽出。
2. `C01/C03/C04/E01` 已有 `EffectCostDefinition` 雏形，但仍在 runner 内；自送休息室、支付能量、弃手应迁移到公共 cost/action 层。
3. `F03/F04/F05/F06/F01/F13` 的顶牌处理目前分散在 Umi、Nozomi、generic discard-look、Karin、Start Dash、Hanayo 流程中。这里是复用收益最大的第二批。
4. Live modifier 方向正确：`collectLiveModifiers`、`LiveModifierState`、`applyHeartRequirementModifiers` 已经覆盖 B05/B07/B08 的关键链路；缺的是公共写入 API、持续时间语义和 selector/condition AST。
5. `S05` 站位变换风险最高：Karin 直接操作槽位和下方卡，未来应复用/强化 `moveCardUniversal` 或专门的 `positionChange` action，并保留现有 under-card swap 行为。
