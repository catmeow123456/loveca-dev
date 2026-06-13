# Loveca safe card effect refactor plan

审查日期：2026-06-13  
状态：Stage 1A-1F 已完成当前 μ's 验证集的主要底座抽取；Stage 1I 已用 `PL!SP-PR-004-PR` 费用 4「唐 可可」打开 E03 能量放置底座，并用 `PL!SP-bp4-008-P` 费用 13「若菜四季」打开来源槽位条件与 E02 能量活跃底座；Stage 1J 已用同一张四季与 `PL!HS-bp1-006-P` 费用 11「藤岛 慈」验证 F02 抽 2 弃 1，并用 `PL!-pb1-019-N` 费用 2「高坂穗乃果」/`PL!-bp4-003-P` 费用 2「南琴梨」验证自送休息室回收扩样本；Stage 1K 已补完 `PL!SP-bp4-008-P` 费用 13「若菜四季」LIVE 开始可选站位变换；Stage 1L 已用 `LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」、`PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」和 `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」打开 X11 登场费用修正底座；Stage 1M 已用 `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」与 `PL!S-bp2-006-P` 费用 11「津岛善子」验证批量活跃与 S07 卡效登场；Stage 1N 已用 `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」验证 X03 成员/能量分支选择并复用 S02/E02 方向 helper；Stage 1O 已用 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」打开最小 AUTO / S08 离场触发 proving path。

本计划假设当前行为是 golden。除非明确接受 behavior mismatch，否则每一批都应先补 focused tests，再迁移。

## 0. Frozen baseline after Stage 1F

当前可视为已稳定的模块：

- `card-selectors.ts`
- `zone-selection.ts`
- `effect-costs.ts`
- `look-top.ts`
- `draw.ts`
- `energy.ts`
- `member-state.ts`
- `live-modifiers.ts`

当前验证基线：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/draw.test.ts tests/unit/energy.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

最近结果：`PL!HS-bp2-012-N` 费用 5「乙宗 梢」AUTO proving 后，focused 2 files / 40 tests passed；相关完整验证 14 files / 156 tests passed；`pnpm exec tsc --noEmit`、`pnpm --dir client exec tsc -b` 与 `git diff --check` passed。

## 1. Continue Stage 1G only through real AUTO proving cards

Stage 1G 应包含：

1. standard `GameEvent`
2. effect/cost/move steps emitting events
3. trigger matcher
4. once-per-turn / when-if / source timing rules
5. UI pending trigger selection

当前已用 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」完成第一条 proving path：`ON_LEAVE_STAGE` 入队、look-top 解析、与同一动作登场能力共享顺序选择窗口。后续不要一次性扩成全量事件系统；继续用真实自动能力卡牌逐步扩 `GameEvent`、trigger matcher、when-if、每回合限制与更多移动/状态事件。

## 2. Recommended next implementation batch

`PL!SP-PR-004-PR` 费用 4「唐 可可」已作为第一张 `系统边界混合` proving card，证明 C01 + E03 可从实际新测试卡组跑通。`PL!SP-bp4-008-P` 费用 13「若菜四季」已证明来源槽位条件、F02 抽弃、E02 energy orientation 与 LIVE 开始 S05 可选站位变换可跑通。`PL!HS-bp1-006-P` 费用 11「藤岛 慈」、`PL!-pb1-019-N` 费用 2「高坂穗乃果」与 `PL!-bp4-003-P` 费用 2「南琴梨」已作为低风险复用扩样本落地。

`LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下 花帆」与 `PL!HS-PR-001-PR` 费用 10「日野下花帆」、`PL!-bp3-010-N` 费用 9「高坂穗乃果」、`PL!HS-bp2-002-P` 费用 13「村野沙耶香」的登场段低风险同构样本已收口；未做段仅保留为后续扩展项。

`LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」已完成手牌中的自身费用减少段：其他手牌每有 1 张费用 -1，自身不计入，最低 0 费。未做段保留：无法因换手放置入休息室、LIVE 开始弃指定姓名手牌获得 BLADE。

`PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」已完成手牌中的自身费用减少段与登场段：自己的舞台存在待机状态『虹咲』成员时费用 -2；登场时通过成员/能量分支选择，将 1 名待机舞台成员或至多 2 张待机能量变为活跃状态。能量分支不要求玩家选择具体能量卡，按能量区顺序自动处理。

`PL!SP-bp5-003-AR` 费用 17「岚 千砂都」已完成舞台来源费用减少段与 LIVE 开始段：手牌中费用 10 的 Liella! 成员登场费用 -2；换手登场时先减费再计算换手减免；中心位 LIVE 开始将自己舞台上全部 Liella! 成员与全部能量变为活跃状态。当前本地 `系统边界混合` 缺少合适的 10 费 Liella! 目标，因此费用段先用构造数据 focused tests 固定规则路径。

`PL!S-bp2-006-P` 费用 11「津岛善子」已完成登场段：可以支付 4 能量，从自己的休息室选择至多 2 张费用合计小于等于 4 的成员，逐张选择空成员区登场。当前 S07 边界是不走普通登场费用/换手。非手牌方式登场的成员已通过 `enqueueTriggeredCardEffects` 的显式登场来源继续触发自己的登场能力；触发入队不写进 S07 移动原语。

`PL!HS-bp2-012-N` 费用 5「乙宗 梢」已完成 AUTO 段：此成员从舞台放置入休息室时检视顶 5，可以公开并加入手牌 1 张成员，其余放置入休息室。当前最小底座覆盖普通离场、换手替换离场，以及与新登场成员能力同事件排序。

首选：

1. 继续 AUTO proving set 的真实样例
   - `PL!HS-bp6-017-N` 费用 11「日野下花帆」、`PL!HS-pb1-009-R` 费用 15「日野下花帆」、`PL!HS-bp6-004-R` 费用 13「百生 吟子」可作为后续候选。目标是扩事件边界，而不是为单卡硬写。

备选：

2. `PL!HS-PR-002-PR` 费用 10「村野さやか」：`T01,C01,F03`
   - 与 `PL!HS-PR-001-PR` 费用 10「日野下花帆」同型，验证同一组合流程可复用时作为下一类非 `PL!-sd1` 扩样本。

3. 第二个 S07 样例
   - 用于验证 `playMembersFromWaitingRoomToEmptySlots` 的边界是否足够稳定，并继续覆盖非手牌方式登场触发自己的登场能力的 ordering。

## 3. Safe parameterization after one non-precon card

如果下一张非预组样例通过，可以开始减少 runner inline 分支：

1. 将 simple recovery ability 配置化：
   - trigger: `ON_ENTER_STAGE` / `ACTIVATED`
   - condition: optional
   - step: `WAITING_ROOM -> HAND`
   - selector: `typeIs(MEMBER|LIVE)` plus optional group/cost predicates

2. 将 look-top workflow 配置化：
   - `lookN`
   - `take min/max`
   - selector
   - reveal selected before hand
   - rest destination
   - ordered selection for `F05`

3. 将 Live modifier builders 配置化：
   - score delta
   - Heart grant
   - requirement delta
   - condition and scaling source

不要先做大型 resolver DSL。等至少两类非预组卡走通后，再判断 step pipeline 的稳定形状。

## 4. Known inline items to leave alone for now

| item | reason to defer |
|---|---|
| `PL!-sd1-006-SD` hand reveal + success-zone exchange | C07/X02/L01/L02 only has one current proving card; low frequency compared with already-migrated modules. |
| 003 Heart color option step | UI shape exists, but generic option API needs第二个样例来确定参数。 |
| 009/022/001 condition builders | Condition AST should be driven by repeated non-precon examples, not invented from one card. |
| Karin continuous `T05,B08` | Current Karin is a test sample. Decide whether to implement full real card text before adding moved-this-turn condition tracking. |
| `F12` draw-then-deck-placement | F02 has a first draw-2/discard-1 proving path; deck position and refresh semantics still need actual samples. |

## 5. Verification after each future batch

For card-effect module changes:

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/draw.test.ts tests/unit/energy.test.ts tests/unit/member-state.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
```

For Live modifier changes:

```bash
pnpm test:run tests/unit/live-modifiers.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

For frontend-visible flows, start `5173` and ask the user to test one named card and one expected outcome.

## 6. Documentation updates required per batch

Update these together:

- `AGENTS.md`
- `PROJECT_PROGRESS_TODO_20260612.md`
- `docs/card-effect-framework/card_effect_framework_design.md`
- `docs/card-effect-framework/card_effect_fragment_coverage_matrix.md`
- `docs/card-effect-reuse-audit/existing_module_map.md`
- `docs/card-effect-reuse-audit/module_gap_list.md`
- `docs/card-effect-reuse-audit/safe_refactor_plan.md`
