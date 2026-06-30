# Steps Promotion Queue

> 文档类型：专题跟踪
> 适用范围：记录 runner / workflow helper 何时应晋升为 steps 配置化
> 当前状态：队列与审查机制；不是 steps DSL 设计文档

本文只追踪“已经出现复用迹象的 helper / workflow family”。它不表示 steps DSL 已经落地，也不要求普通卡效批次顺手改 runner 解释器。

## Rules

- 新增或扩展 runner workflow helper 时，必须在本文登记或更新对应 candidate。
- 第 3 个真实同型样例出现时，必须评估是否晋升；不是必须晋升，但必须写清判断。
- 晋升只按单一 workflow family 做，例如 `lookTopSelectToHand`，不要一次性抽完整 steps DSL。
- 若暂不晋升，必须写清 blocker、promotion trigger 和 next action。
- 涉及 pending 顺序、费用支付时机、事件消费、domain continuous modifier 的项目，默认先标为 `blocked` 或 `candidate`，交由审查窗口确认。

## Status

| status | meaning |
|---|---|
| `candidate` | 已有 helper 或重复 workflow，但样例/差异轴还不足以配置化。 |
| `proven` | 2-3 张真实卡已验证，主要差异轴清楚。 |
| `ready` | 可以开独立 steps 配置化窗口；普通卡效批次不要直接大改。 |
| `blocked` | 仍被 pending / 费用 / 事件 / domain 连续修正等语义卡住。 |
| `promoted` | 已晋升为 steps 配置化，保留审计记录。 |

## Queue

| candidate | status | current helper / location | proving cards | shared shape | variable axes | blockers | promotion trigger | next action |
|---|---|---|---|---|---|---|---|---|
| look-top select-to-hand workflow | proven | workflow family in `src/application/card-effects/workflows/shared/look-top-select-to-hand.ts`; discard wrapper in `workflows/shared/discard-look-top-select-to-hand.ts`; wait + discard wrapper in `workflows/shared/wait-discard-look-top-select-to-hand.ts`; primitives in `src/application/effects/look-top.ts` | `PL!-sd1-004` 费用 11「园田海未」；`PL!SP-bp2-002` 费用 2「唐 可可」；`PL!-bp6-002` 费用 2「绚濑绘里」；`PL!HS-bp2-012` 费用 5「乙宗 梢」；`PL!-bp3-010` 费用 9「高坂穗乃果」；`PL!HS-bp5-008` 费用 4「桂城泉」 | 检视卡组顶 N 张，按 selector 选择 0/1 或 exact/range 数量，必要时公开确认，选中入手，其余入休息室；弃手前置与自身待机 + 弃手前置由外层 workflow 串接。 | `topCount`、selector、exact/range count、是否公开确认、step 文案、无目标处理、ordered resolution、外层费用/状态前置。 | 已迁出无前置费用、弃手前置、HS-bp5-008 自身待机 + 弃手样例；支付能量与分支前置样例仍未统一配置化，尚未晋升 ability definition 配置，也不是 steps DSL。 | 再完成支付能量/分支前置样例后，评估是否将 `LOOK_TOP_SELECT_TO_HAND` 晋升为 ready。 | 继续迁移前置费用外层调用方；不要在普通卡效批次直接做 steps-lite/DSL。 |
| draw-then-discard workflow | proven | workflow family in `src/application/card-effects/workflows/shared/draw-then-discard.ts`; BLADE threshold wrapper in `workflows/cards/hs-pb1-009-kaho.ts`; actions in `src/application/card-effects/runtime/actions.ts` | `PL!SP-bp4-008` 费用 13「若菜四季」；`PL!HS-bp1-006` 费用 11「藤岛 慈」；`PL!N-bp4-018` 费用 7「近江彼方」；`PL!HS-pb1-009` 费用 15「日野下花帆」 | 先抽 N 张，再打开 activeEffect 选择 M 张手牌放置入休息室；无可弃手牌时 confirm-only 继续 pending。 | `drawCount`、`discardCount`、stepId、sourceSlot、ordered resolution、是否在 start 记录每回合使用、外层条件前置。 | 只覆盖真正抽后弃；纯抽牌如 `PL!-pb1-015` 不进入本 family。`PL!HS-pb1-009` 的 BLADE 条件由窄 card wrapper 保持，不把条件系统塞进 workflow。 | 再出现抽后弃并只差数量/step 文案/外层条件时，评估是否进一步抽 activation config；仍不做 steps DSL。 | 继续观察抽后弃 + 额外后续动作的样例，必要时先加 card wrapper。 |
| self-sacrifice waiting-room recovery workflow | candidate | Pure self-sacrifice recovery in `src/application/card-effects/workflows/shared/self-sacrifice-waiting-room-to-hand.ts`; `PR_017` custom wrapper in `src/application/card-effects/workflows/cards/pl-pr-017-nico.ts` | `PL!-sd1-002` 费用 2「绚濑绘里」；`PL!-sd1-005` 费用 2「星空凛」；`PL!-pb1-019` 费用 2「高坂穗乃果」；`PL!-bp4-003` 费用 2「南琴梨」；`PL!-PR-017` 费用 2「矢泽日香」 | 起动自送休息室，从休息室按 selector 回收 0-1 张卡，或有合法目标时强制回收 1 张；纯回收 4 个 ability 已迁出 runner，`PR_017` 以单卡 wrapper 保留回收后成功区分数检查与活跃能量奖励。 | selector、baseCardCodes、有目标时可选/强制、无目标时是否继续、每回合限制、是否有回收后奖励。 | 自送费用会产生离场事件；`PL!-PR-017` 已迁出 runner，但没有并入纯 self-sacrifice recovery family，避免把成功区分数奖励和活跃能量奖励塞进 shared family；不是 steps DSL。 | 再出现自送回收且后续奖励只剩参数时，评估是否拆 card wrapper 或晋升为 `proven`。 | 保持 workflow family + custom exception；不要把后续奖励塞进纯自送回收。 |
| pay-energy waiting-room recovery workflow | candidate | `src/application/card-effects/workflows/shared/pay-energy-waiting-room-to-hand.ts` | `PL!HS-bp1-003` 费用 13「乙宗梢」；`PL!HS-bp1-004` 费用 15「夕雾缀理」 | 起动前先确认候选存在，再记录 ability use，支付固定数量活跃能量，之后从休息室回收到手牌。 | energy cost、selector、baseCardCodes、count rule、是否可跳过、step 文案。 | 目前只覆盖纯支付能量后回收；公开手牌同名回收、支付能量+自送登场、支付能量+弃手+分支仍暂缓；不是 steps DSL。 | 第 3 个纯支付能量回收样例出现时，评估是否升为 `proven`。 | 继续登记差异轴；不混入 reveal-hand 或舞台登场 workflow。 |
| discard-cost waiting-room recovery workflow | candidate | `src/application/card-effects/workflows/shared/discard-cost-waiting-room-to-hand.ts` | `PL!-bp4-002` 费用 15「绚濑绘里」 | 起动时先按条件检查，再选择固定张数手牌作为费用放置入休息室，之后从休息室回收 0-1/强制 1 张卡。 | discard count、activation condition、有目标时可选/强制、无目标时是否继续、是否每回合限制、是否还有后续奖励；当前 proving card 仍是 `μ's LIVE` 回收。 | 当前只有 1 个 10 轴 μ's proving card，保持 `candidate`；弃手费用期间事件消费时机仍不应提前抽象；不同卡可能混入登场/自动时点或复合费用。 | 再出现 1-2 张同型起动且差异只剩参数时，评估是否升为 `proven`；晋升 steps 必须单独审查。 | 保持 workflow family；不抽 steps DSL。 |
| source-member BLADE runtime action | candidate | `addBladeLiveModifierForSourceMember` in `src/application/card-effects/runtime/actions.ts` | `PL!HS-pb1-009` 费用 15「日野下花帆」；`PL!HS-bp5-001` 费用 11「日野下花帆」；`PL!HS-bp6-004` 费用 13「百生吟子」；`PL!HS-bp1-004` 费用 15「夕雾缀理」；固定支付能量 BLADE 同型；`PL!HS-pb1-012` 费用 15「百生吟子」 | 已有 workflow/card resolver 在完成费用、公开、弃手、洗回或条件判断后，只需要给来源成员写入本次 LIVE 期间 BLADE modifier。 | playerId、sourceCardId、abilityId、amount。 | 这是原子 runtime action，不创建 activeEffect，不写 action history，不处理 target member BLADE、continuous projection、reveal confirm 或支付/弃手语义；`PL!HS-bp6-031` 指定目标姬芽 BLADE 与 reveal helper 仍暂缓。 | 如果后续还有多个 source member BLADE 写入点只差 amount，可继续复用；target member BLADE 需单独审查参数轴。 | 保持 runtime action 形态；不要晋升为 steps DSL。 |
| waiting-room cards shuffle-to-deck-bottom runtime action | candidate | `shuffleWaitingRoomCardsToDeckBottomForPlayer` in `src/application/card-effects/runtime/actions.ts` | `PL!HS-bp6-031` 分数 8「ファンファーレ！！！」；`PL!HS-pb1-012` 费用 15「百生吟子」 | caller 已经确定一组休息室卡后，将这些卡洗切并追加到主卡组底。 | playerId、cardIds。 | 不扫描 selector，不计算成员数量或小组数量，不写 action history，不处理奖励/回收/BLADE/activeEffect/pending continue；不是万能 zone move。休息室登场、grouped recovery 与 reveal helper 仍暂缓。 | 再出现同样“指定休息室卡洗后放主卡组底”的样例时继续复用；若出现保持顺序或放卡组顶，需要另行审查参数轴。 | 保持 runtime action 形态；不要塞入 workflow 后续奖励。 |
| grouped waiting-room recovery workflow | candidate | Local grouped recovery flows in `src/application/card-effect-runner.ts`; `paySelectedDiscardHandCost`; `WAITING_ROOM -> HAND` zone-selection | `PL!HS-pb1-020` 费用 9「百生吟子」；`PL!-bp6-005` 费用 11「星空凛」 | 支付或触发条件后，从休息室按两个 selector 分组选卡，组内上限各 1，最后移动到手牌。 | 触发时点（登场/离场等）、前置条件、费用是否可选、discard count、每组 selector、每组 min/max、无目标组是否强制补齐、是否允许选择 0、文案与公开性。 | 目前只有 2 个真实样例且关键语义相反：`PL!HS-pb1-020` 有可用组时强制补齐，`PL!-bp6-005` 支付后两组都为至多 1 且可选 0；费用/触发时点也不同。 | 第 3 个真实 grouped recovery 样例出现时，先评估是否只剩参数差异；若仍涉及强制性/费用时机差异，继续保持 `candidate`。 | 记录共同点/差异轴；仍用局部 runner 校验分组上限，不晋升 steps。 |
| success-live-score threshold reward | candidate | `successLiveScoreAtLeast` in `src/application/effects/conditions.ts`; reward writing remains in runner | `PL!-bp5-005` 费用 10「星空凛」；`PL!-bp4-021` 分数 6「?←HEARTBEAT」；`PL!-PR-017` 费用 2「矢泽日香」；`PL!-bp4-002` 费用 15「绚濑绘里」 | 读取成功 LIVE 卡区分数合计，按阈值触发能量、必要 Heart、分数等奖励，或作为起动合法性门槛。 | threshold、condition use（奖励/起动门槛）、reward kind、目标是玩家/此 LIVE/能量区、是否需要确认窗口。 | 这是 condition-bound query 复用，不是纯 workflow steps；`PL!-bp4-002` 只新增起动前 gate，用于证明 query 可复用，不足以抽 builder。 | 若继续出现 2 张以上只差 threshold + reward kind / activation gate 的样例，先评估 typed builder，不直接做 steps DSL。 | 维持 `candidate`；第三个以上样例虽已出现，但用途横跨登场、LIVE_START、起动与后续奖励，暂不晋升。 |
