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
| look-top select-to-hand workflow | candidate | `startLookTopSelectToHandEffect` in `src/application/card-effect-runner.ts`; primitives in `src/application/effects/look-top.ts` | `PL!-sd1-004` 费用 11「园田海未」；`PL!-bp3-010` 费用 9「高坂穗乃果」；`PL!SP-bp2-002` 费用 2「唐 可可」；`PL!-bp6-002` 费用 2「绚濑绘里」 | 检视卡组顶 N 张，按 selector 选择至多 1 张，必要时公开确认，选中入手，其余入休息室。 | `count`、selector、是否有前置弃手费用、可选/强制、公开确认文案、无目标处理、selector 是否依赖能力文本。 | 已超过 3 个真实样例，但现有样例仍混有前置弃手费用、可选/强制差异、公开确认时机与能力文本 selector；尚未统一为 ability definition 配置。 | 再出现 1-2 张同结构 look-top 卡，且差异只剩参数时，评估 `LOOK_TOP_SELECT_TO_HAND` steps family。 | 暂维持 `candidate`，不晋升；若下批继续只增加 `count + selector + reveal` 参数差异，再单独开审查窗口评估 `proven/ready`。 |
| self-sacrifice waiting-room recovery workflow | candidate | `startSacrificeSelfActivatedEffect` plus `finishSelectCardsFromZoneToHandEffect` / custom finishers | `PL!-sd1-002` 费用 2「绚濑绘里」；`PL!-sd1-005` 费用 2「星空凛」；`PL!-PR-017` 费用 2「矢泽日香」 | 起动自送休息室，从休息室按 selector 回收 0-1 张卡，或有合法目标时强制回收 1 张，之后可能有附加处理。 | selector、是否有附加条件奖励、有目标时可选/强制、无目标时是否继续后续效果、每回合限制。 | 自送费用会产生离场事件；后续效果可能依赖自送后的新状态，不应混入通用 steps 解释器。 | 再出现同型但附加处理只剩参数时，评估单一 self-sacrifice recovery steps family。 | 继续使用 helper；若新增 post-recovery 奖励或选择强制性轴，登记差异轴。 |
| discard-cost waiting-room recovery workflow | candidate | `startDiscardHandThenWaitingRoomRecoveryActivatedEffect` plus `paySelectedDiscardHandCost` and `WAITING_ROOM -> HAND` zone-selection | `PL!-bp4-002` 费用 15「绚濑绘里」 | 起动时先按条件检查，再选择固定张数手牌作为费用放置入休息室，之后从休息室回收 0-1/强制 1 张卡。 | discard count、activation condition、有目标时可选/强制、无目标时是否继续、是否每回合限制、是否还有后续奖励；当前 helper 仍是 `μ's LIVE` 局部回收，不宣称 selector 已泛化。 | 当前只有 1 个 10 轴 μ's proving card；弃手费用期间事件消费时机仍不应提前抽象；不同卡可能混入登场/自动时点或复合费用。 | 再出现 1-2 张同型起动且差异只剩参数时，评估是否升为 `proven`；晋升 steps 必须单独审查。 | 保持局部 typed helper；不抽 steps DSL。 |
| grouped waiting-room recovery workflow | candidate | Local grouped recovery flows in `src/application/card-effect-runner.ts`; `paySelectedDiscardHandCost`; `WAITING_ROOM -> HAND` zone-selection | `PL!HS-pb1-020` 费用 9「百生吟子」；`PL!-bp6-005` 费用 11「星空凛」 | 支付或触发条件后，从休息室按两个 selector 分组选卡，组内上限各 1，最后移动到手牌。 | 触发时点（登场/离场等）、前置条件、费用是否可选、discard count、每组 selector、每组 min/max、无目标组是否强制补齐、是否允许选择 0、文案与公开性。 | 目前只有 2 个真实样例且关键语义相反：`PL!HS-pb1-020` 有可用组时强制补齐，`PL!-bp6-005` 支付后两组都为至多 1 且可选 0；费用/触发时点也不同。 | 第 3 个真实 grouped recovery 样例出现时，先评估是否只剩参数差异；若仍涉及强制性/费用时机差异，继续保持 `candidate`。 | 记录共同点/差异轴；仍用局部 runner 校验分组上限，不晋升 steps。 |
| success-live-score threshold reward | candidate | `successLiveScoreAtLeast` in `src/application/effects/conditions.ts`; reward writing remains in runner | `PL!-bp5-005` 费用 10「星空凛」；`PL!-bp4-021` 分数 6「?←HEARTBEAT」；`PL!-PR-017` 费用 2「矢泽日香」；`PL!-bp4-002` 费用 15「绚濑绘里」 | 读取成功 LIVE 卡区分数合计，按阈值触发能量、必要 Heart、分数等奖励，或作为起动合法性门槛。 | threshold、condition use（奖励/起动门槛）、reward kind、目标是玩家/此 LIVE/能量区、是否需要确认窗口。 | 这是 condition-bound query 复用，不是纯 workflow steps；`PL!-bp4-002` 只新增起动前 gate，用于证明 query 可复用，不足以抽 builder。 | 若继续出现 2 张以上只差 threshold + reward kind / activation gate 的样例，先评估 typed builder，不直接做 steps DSL。 | 维持 `candidate`；第三个以上样例虽已出现，但用途横跨登场、LIVE_START、起动与后续奖励，暂不晋升。 |
