# Loveca safe card effect refactor plan

> 文档类型：历史/计划文档
> 适用范围：Stage 1 系列卡效安全迁移的历史步骤、验证思路与 proving card 背景
> 当前状态：历史实施计划；下方阶段状态和测试结果停留在当时快照，不作为当前代码或卡牌完成状态来源
> 替代来源：当前路线见 `../card-effect-framework/migration_roadmap.md`，卡牌状态见 `existing_module_map.md`，当前缺口见 `module_gap_list.md`
> 最后更新：2026-07-24

审查日期：2026-06-14
历史状态快照：Stage 1A-1F 已完成当时 μ's 验证集的主要底座抽取；Stage 1I-1T 已陆续打开 E03/E02 能量、F02 抽弃、S05 站位变换、X11 登场费用修正、S07 卡效登场、X03 分支选择、S08 离场 AUTO、`ON_ENTER_STAGE` 监听 AUTO、舞台目标选择、同编号罕度同步、公开手牌隐私投影、声援公开卡选择、`ON_CHEER` 与追加声援等边界。本批 `绿莲-6弹ver.yaml` 已继续补齐 `PL!HS-bp5-001` 费用 11「日野下花帆」、`PL!HS-bp1-003` 费用 13「乙宗梢」、`PL!HS-bp1-002` 费用 11「村野沙耶香」、`PL!HS-sd1-001` 费用 9「日野下花帆」、`PL!HS-pb1-020` 费用 9「百生吟子」、`PL!HS-bp6-001` 费用 4「日野下花帆」、`PL!HS-cl1-009` 分数 1「水彩世界」、`PL!HS-bp6-031` 分数 8「ファンファーレ！！！」与 `PL!HS-bp6-027` 分数 5「月夜見海月」，新增验证公开手牌确认窗口、私有候选不向对手投影、条件型 continuous SCORE、此 Live 卡分数与 LIVE 合计分数投影分离、relay 来源条件、分组回收、动态控顶、LIVE 成功舞台成员来源、`cheer-selection.ts`、`cheer.ts` 与追加声援。卡效登记已支持 `baseCardCodes`，同基础编号不同罕度由测试防漏同步；普通活跃阶段进入时也已自动重置当前玩家成员与能量。

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

`conditions.ts` 已作为第一版 condition/query helper 起步，当前有独立 helper 单测与迁移卡效的集成测试覆盖；继续稳定后再纳入 frozen baseline。

当前验证基线：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/draw.test.ts tests/unit/energy.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

最近结果：本批 `PL!HS-bp5-001` 费用 11「日野下花帆」/`PL!HS-bp1-003` 费用 13「乙宗梢」/`PL!HS-bp1-002` 费用 11「村野沙耶香」/`PL!HS-sd1-001` 费用 9「日野下花帆」/`PL!HS-pb1-020` 费用 9「百生吟子」/`PL!HS-bp6-001` 费用 4「日野下花帆」/`PL!HS-cl1-009` 分数 1「水彩世界」/`PL!HS-bp6-031` 分数 8「ファンファーレ！！！」/`PL!HS-bp6-027` 分数 5「月夜見海月」已完成实现；最新 focused `PL!HS-bp6-027` + classification 验证 2 files / 5 tests passed。

## 1. Continue Stage 1G only through real AUTO proving cards

Stage 1G 应包含：

1. standard `GameEvent`
2. effect/cost/move steps emitting events
3. trigger matcher
4. once-per-turn / when-if / source timing rules
5. UI pending trigger selection

2026-06-15 已完成第一批事件层地基：`GameState.eventLog` / `eventSequence` 与 `emitGameEvent` 已落地；`member-state.ts`、普通 `TAP_MEMBER` 与活跃阶段重置会在成员方向变化时写入 `ON_MEMBER_STATE_CHANGED`，成员状态变化事件可携带 `PLAYER_ACTION` / `RULE_ACTION` / `CARD_EFFECT` cause；成员槽位移动与交换会写入 `ON_MEMBER_SLOT_MOVED`。随后已接入 `ON_MEMBER_STATE_CHANGED` / `ON_MEMBER_SLOT_MOVED` 消费：`PL!N-bp4-018-N` 费用 7「近江彼方」验证自身 `ACTIVE -> WAITING` 触发抽 1 弃 1，`PL!-pb1-015` 费用 7「西木野真姬」验证自己的卡效使对方费用 <= 4 成员 `ACTIVE -> WAITING` 后抽 1，普通 `MOVE_MEMBER_TO_SLOT` 与卡效站位变换产生的成员移动事件会进入 `enqueueTriggeredCardEffects`，并由 `PL!SP-bp4-011-P` 费用 7「鬼冢冬毬」完成首条 S09 proving path。同日 `ON_ENTER_STAGE` / `ON_LEAVE_STAGE` / `ON_LIVE_START` / `ON_LIVE_SUCCESS` 主路径也已转为优先消费 `EnterStageEvent` / `LeaveStageEvent` / `LiveStartEvent` / `LiveSuccessEvent`：普通手牌登场、卡效从休息室登场、手动舞台进休息室、换手替换离场、自送费用、LIVE 翻开进入 LIVE 开始检查时机与 LIVE 成功效果窗口均写入 `eventLog`，旧 fallback 保留为回退。

当前已用 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」完成第一条 proving path：`ON_LEAVE_STAGE` 入队、look-top 解析、与同一动作登场能力共享顺序选择窗口。`PL!HS-bp6-017-N` 费用 11「日野下花帆」完成第二条同触发 proving path：可选弃手后从休息室将 LIVE/成员至多各 1 张加入手牌；2026-06-15 起 `enqueueTriggeredCardEffects` 已优先从 `eventLog` 的 `LeaveStageEvent` 转换离场来源。`PL!HS-sd1-001-SD` 费用 9「日野下花帆」补充验证 relay 来源条件：换手导致离场时携带 `replacingCardId`，入队阶段校验换上成员为费用大于等于 10 的「莲之空」成员。`PL!HS-pb1-009-R` 费用 15「日野下花帆」完成舞台成员监听己方「莲之空」成员登场、实例级每回合 2 次、BLADE +2 写入 live modifier，并在 LIVE 开始用成员有效 BLADE helper 接 F02 抽弃；同卡第一段也验证了手动从顺序选择窗口点选无输入 AUTO 时的 confirm-only active effect，顺序发动不弹该确认壳。`PL!N-bp4-018-N` 费用 7「近江彼方」与 `PL!-pb1-015` 费用 7「西木野真姬」已验证成员状态变化事件消费；`PL!HS-bp5-019-L` 分数 6「花结」与 `PL!HS-bp6-004-R` 费用 13「百生 吟子」已验证 LIVE 卡来源与舞台成员来源的 LIVE 开始 pending ability 绑定真实 `LiveStartEvent.eventId`；`PL!HS-bp6-001` 费用 4「日野下花帆」与 `PL!HS-cl1-009` 分数 1「水彩世界」已验证 LIVE 成功时舞台成员来源与 LIVE 卡来源可只从 `LiveSuccessEvent` 入队。后续不要一次性扩成全量事件系统；继续用真实自动能力卡牌逐步扩 `GameEvent`、trigger matcher、when-if 与更多移动/状态事件。

## 2. Recommended next implementation batch

`PL!SP-PR-004-PR` 费用 4「唐 可可」已作为第一张 `系统边界混合` proving card，证明 C01 + E03 可从实际新测试卡组跑通。`PL!SP-bp4-008-P` 费用 13「若菜四季」已证明来源槽位条件、F02 抽弃、E02 energy orientation 与 LIVE 开始 S05 可选站位变换可跑通。`PL!HS-bp1-006-P` 费用 11「藤岛 慈」已证明登场 F02 与 LIVE 开始 C01/B03 可复用；`PL!-pb1-019-N` 费用 2「高坂穗乃果」与 `PL!-bp4-003-P` 费用 2「南琴梨」已作为低风险复用扩样本落地。

`LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下花帆」已补齐两段：登场回收成员复用 `zone-selection + card-selectors`；LIVE 开始可弃合计 3 张指定姓名手牌并通过 `addLiveModifier(SCORE)` 写入 LIVE 合计分数 +3。指定姓名手牌弃置当前以 `cardNameAliasIs + ORDERED_MULTI + paySelectedDiscardHandCost` 组合实现，组合名卡自身可作为费用候选。

`LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」已完成三段：手牌中的自身费用减少段（其他手牌每有 1 张费用 -1，自身不计入，最低 0 费）；无法因换手放置入休息室（支付方案与实际登场 action 层拦截）；LIVE 开始弃任意张指定姓名手牌并按弃置张数通过 `addLiveModifier(BLADE)` 获得 BLADE。

`PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」已完成手牌中的自身费用减少段与登场段：自己的舞台存在待机状态『虹咲』成员时费用 -2；登场时通过成员/能量分支选择，将 1 名待机舞台成员或至多 2 张待机能量变为活跃状态。能量分支不要求玩家选择具体能量卡，按能量区顺序自动处理。

`PL!SP-bp5-003-AR` 费用 17「岚 千砂都」已完成舞台来源费用减少段与 LIVE 开始段：手牌中费用 10 的 Liella! 成员登场费用 -2；换手登场时先减费再计算换手减免；中心位 LIVE 开始将自己舞台上全部 Liella! 成员与全部能量变为活跃状态。当前本地 `系统边界混合` 缺少合适的 10 费 Liella! 目标，因此费用段先用构造数据 focused tests 固定规则路径。

`PL!S-bp2-006-P` 费用 11「津岛善子」已完成登场段：可以支付 4 能量，从自己的休息室选择至多 2 张费用合计小于等于 4 的成员，逐张选择空成员区登场。当前 S07 边界是不走普通登场费用/换手。非手牌方式登场的成员已通过 `enqueueTriggeredCardEffects` 的显式登场来源继续触发自己的登场能力；触发入队不写进 S07 移动原语。

`PL!HS-bp2-012-N` 费用 5「乙宗 梢」已完成 AUTO 段：此成员从舞台放置入休息室时检视顶 5，可以公开并加入手牌 1 张成员，其余放置入休息室。当前最小底座覆盖普通离场、换手替换离场，以及与新登场成员能力同事件排序。

`PL!HS-bp6-017-N` 费用 11「日野下花帆」已完成 AUTO 段：此成员从舞台放置入休息室时，可以将 1 张手牌放置入休息室；如此做时，从休息室将 LIVE 卡和成员卡至多各 1 张加入手牌。当前复用离场 AUTO 入队、弃手费用与 `WAITING_ROOM -> HAND` 移动，并已迁入 `workflows/shared/grouped-recovery.ts`；LIVE/成员各至多 1 张的分组上限由 runtime grouped-selection 校验。

`PL!HS-pb1-009-R` 费用 15「日野下花帆」已完成两段：第一段为中心位监听己方「莲之空」成员登场，实例级每回合 2 次并获得 BLADE +2；第二段为 LIVE 开始时统计此成员有效 BLADE，达到 8 时抽 2 弃 1。当前复用 `ON_ENTER_STAGE` 入队、`ABILITY_USE` 实例级限制、`getMemberEffectiveBladeCount`、F02 抽弃流程与 confirm-only 无输入确认壳。

`PL!HS-bp6-004-R` 费用 13「百生 吟子」已完成三段：登场 / LIVE 开始时选择对方舞台费用小于等于 9 的 1 名成员变为待机状态；LIVE 开始时可弃 1 张手牌获得 BLADE，弃置「百生吟子」成员时共获得 BLADE +2。当前复用 `stage-member-target-selection.ts` 舞台成员目标 active effect、`stage-targets.ts` 舞台成员目标 helper、`card-selectors.ts` 组合 selector / `cardNameIs`、`setMemberOrientation`、可选弃手步骤、`addLiveModifier`，并补了同源双 LIVE 开始能力的 option 顺序选择。

`PL!HS-bp1-004-P` 费用 15「夕雾缀理」已完成两段：起动每回合 1 次支付 3 能量，从自己的休息室回收 1 张「莲之空」LIVE；LIVE 开始可支付 1 能量，按自己的 LIVE 区卡牌数量获得 BLADE。当前复用 `effect-costs.ts` 横置能量支付、`zone-selection.ts` 休息室到手牌选择、`card-selectors.ts` 的类型/团体组合 selector、`ABILITY_USE` 实例级每回合限制、`selectableOptions` 支付/不发动选择与 `addLiveModifier`。

`PL!HS-bp5-019-L` 分数 6「花结」已完成 LIVE 开始段：自己的 LIVE 卡区每有 1 张此卡以外的「莲之空」卡，通过 REQUIREMENT live modifier 使此卡必要绿色 Heart 减少 2。`PL!HS-bp2-022-L+` 分数 2「アオクハルカ」已完成 LIVE 开始段：休息室存在大于等于 3 张 `Cerise Bouquet` LIVE 卡时，通过带 `liveCardId` 的 SCORE live modifier 使此卡分数 +1。`PL!HS-bp1-003` 费用 13「乙宗梢」已完成三面不同名「莲之空」成员条件下的 continuous SCORE，验证不带 `liveCardId` 的 LIVE 合计分数投影。当前这些样例共同验证 LIVE 卡来源、条件计数、此 Live 卡分数 / LIVE 合计分数区分与 `addLiveModifier` / `replaceLiveModifier` / `collectLiveModifiers` 的低风险扩样本。

`PL!HS-bp5-001` 费用 11「日野下花帆」已完成登场与起动：登场公开检视顶 4 后点击继续处理入休息室，若存在 LIVE 获得 BLADE +2；起动支付 2 能量并公开手牌 LIVE，从休息室回收同名 LIVE。该卡验证公开手牌候选对对手隐藏、公开后通过 `revealedCardIds` 进入双方可见确认窗口，以及 `WAITING_ROOM -> HAND` 同名 LIVE 回收。

`PL!HS-bp1-002` 费用 11「村野沙耶香」已完成起动：支付 2 能量并自送，从休息室将费用小于等于 15 的「莲之空」成员登场至来源原区域。当前作为 `PL!S-bp2-006-P` 费用 11「津岛善子」之后的第二个 S07 样例，继续验证卡效登场不走普通登场费用/换手，并继续触发被登场成员的登场能力。

`PL!HS-pb1-020` 费用 9「百生吟子」已完成登场段：自己的休息室 LIVE 大于等于 3 时，可弃 2 手牌；如此做时回收 1 张 Cerise Bouquet 成员与 1 张「莲之空」LIVE。该卡验证弃 2 手牌候选隐私、分组回收校验与可用分组强制选择。

`PL!HS-bp6-001` 费用 4「日野下花帆」与 `PL!HS-cl1-009` 分数 1「水彩世界」已完成声援公开卡相关段：前者登场动态检视舞台成员数 + 2 并控顶，LIVE 成功时可将本次声援公开卡放回卡组顶；后者 LIVE 成功时从本次声援公开卡中回收费用 4-9 成员。当前新增 `src/application/effects/cheer-selection.ts`，并使 LIVE 成功入队同时支持成功 LIVE 卡来源与表演玩家舞台成员来源。

`PL!HS-bp6-027-L` 分数 5「月夜見海月」已完成 `ON_CHEER` 与追加声援：自动声援公开后写入 `CheerEvent`，入队优先消费 eventLog 并扫描表演玩家 LIVE 区来源，选择至多 3 张本次声援公开且无 BLADE HEART 的「莲之空」卡入休息室，并追加等量声援。`PL!S-bp2-004` 费用 11「黒澤ダイヤ」已补齐重做声援窄样本：来源先记录 turn1，以原 BLADE 创建 `additional=false` 普通 CheerEvent 并显式重走 ON_CHEER；`replaceCurrentCheerCards` 只替换当前玩家 current IDs，使 Q107 后续查询只见第二次声援。两者都不构成通用 cheer loop。

本批 17 张 `PL!-sd1-002-SD` 同型样本与 `绿莲-6弹ver.yaml` 已验收的 6 张卡已落地，不再列入首选低风险扩样本清单。建议直接继续：

首选：

1. 继续选择能推进 when-if、名称/数值 selector 配置化、公开/看顶 workflow、更多移动或状态事件边界的真实 AUTO / LIVE 成功 / LIVE 开始卡。
   - `PL!HS-bp6-027-L` 分数 5「月夜見海月」已完成追加声援，`PL!S-bp2-004` 费用 11「黒澤ダイヤ」已完成窄重做声援；更完整 cheer loop 语义仍等待后续真实样例。

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
| 003 / `PL!HS-bp1-006-P` 费用 11「藤岛 慈」Heart color option step；`PL!HS-bp1-004-P` 费用 15「夕雾缀理」pay-or-decline option step | UI shape exists, but generic option API still needs a stable resolver config shape before extraction. |
| 009/022/001/`PL!HS-bp1-003` condition builders | 第一版纯 query helper 已起步；Condition AST / typed formula builder 仍 should be driven by repeated non-precon examples, not invented from one card. |
| More movement/event-trigger cards | `PL!N-pb1-004` 已打开 `positionMovedThisTurn`，但完整成员区移动事件触发 `S09` 仍等待真实 AUTO 样例推动。 |
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
- `PROJECT_PROGRESS_TODO.md`
- `docs/card-effect-framework/card_effect_framework_design.md`
- `docs/card-effect-framework/card_effect_fragment_coverage_matrix.md`
- `docs/card-effect-reuse-audit/existing_module_map.md`
- `docs/card-effect-reuse-audit/effect_module_coverage.md`
- `docs/card-effect-reuse-audit/card_effect_batch_expansions.md`
- `docs/card-effect-reuse-audit/module_gap_list.md`
- `docs/card-effect-reuse-audit/safe_refactor_plan.md`
