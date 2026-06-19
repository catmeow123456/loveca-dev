# New Card Effect Cookbook

> 文档类型：一页式使用入口
> 适用范围：新增或扩展卡效前，快速判断应复用哪个 workflow/helper、何时写单卡 workflow、必须补哪些测试和文档
> 当前状态：现行使用指南；不替代 `migration_roadmap.md`、`workflow_module_guide.md`、`active_effect_runtime.md` 或真实代码/测试

本页只做开发入口。拿到新卡效后，先按效果形状找最接近的已迁 workflow/helper；若没有稳定 family，再写 `workflows/cards/` 单卡 workflow。runner 仍保留 registry-first fallback 旧逻辑，不能把本页理解为 runner 已完成、trigger matcher 已接入 runner 或 steps DSL 已落地。

## Common Effect Routes

| 常见效果 | 推荐 workflow/helper | 何时单卡 workflow | 必测路径 | 需同步文档 |
|---|---|---|---|---|
| 登场 / LIVE成功 / 声援相关检视或公开选卡 | `workflows/shared/look-top-select-to-hand.ts`、`workflows/shared/arrange-inspected-deck-top.ts`、`workflows/shared/revealed-cheer-selection.ts`；底层看顶/声援选择优先复用 `effects/look-top.ts`、`effects/cheer-selection.ts`、`effects/cheer.ts`。 | 需要先支付卡特有费用、看顶后进入第二段特殊处理、或声援公开卡之外还有事件/替代放置分支时，写 `workflows/cards/<card>.ts` 薄 wrapper，再调用 shared core。 | 正常选择、无目标、skip/取消、非法选择、公开/inspection/processing zone 清理、事件 enqueue 或 additional cheer 不递归。 | `existing_module_map.md`；新增 family/组织规则时同步 `workflow_module_guide.md`；迁出 runner 时同步 `migration_roadmap.md`。 |
| 抽 N 弃 M | `workflows/shared/draw-then-discard.ts`，原子动作复用 `runtime/actions.ts` 的 draw/discard helper。 | 抽弃前后还有卡特有奖励、分支或额外 target selection，且差异轴不足以进 shared config。 | 正常抽弃、牌库不足、手牌不足、skip/可选费用、弃牌候选可见性、pending continuation。 | `existing_module_map.md`；扩展 helper 边界时同步 `runtime_action_helpers.md` 或 `active_effect_runtime.md`。 |
| 可选弃 1 手牌费用窗口 | `runtime/active-effect.ts` 的 `createOptionalDiscardHandToWaitingRoomActiveEffect` 构造 activeEffect shell；实际弃牌仍用 `runtime/actions.ts` 的 `discardOneHandCardToWaitingRoomForPlayer`。 | 带额外能量/横置/source cost、分组选择、弃到 N 张、双方 hand-adjust 或复杂 metadata 的窗口先写在 workflow 内。 | 默认 cost metadata、候选只等待玩家可见、skip/不发动、非法选择、弃牌后续 payload、pending continuation。 | 新增/扩展 activeEffect shell 时同步 `active_effect_runtime.md`；若变成 action helper 再同步 `runtime_action_helpers.md`。 |
| 从休息室回收 | 普通回收用 `workflows/shared/waiting-room-to-hand.ts`；自送回收用 `self-sacrifice-waiting-room-to-hand.ts`；支付能量回收用 `pay-energy-waiting-room-to-hand.ts`；弃手费用回收用 `discard-cost-waiting-room-to-hand.ts`。 | 回收只是复合卡的一段，或费用/奖励/目标分组与现有 family 轴不稳定。 | 正常回收、无目标、费用失败、费用已支付后无目标、取消/skip、回收目标离开区域。 | `existing_module_map.md`；新增 recovery family 规则时同步 `workflow_module_guide.md`。 |
| 分组回收 | `workflows/shared/grouped-recovery.ts`，分组 min/max validation 复用 `runtime/grouped-selection.ts`。 | 回收不是“一组最多/至少几张”的稳定结构，或每组后续奖励不同到无法参数化。 | 每组正常选择、同组超选、缺少必选组、全无目标、部分组无目标、费用失败、payload 字段保持旧语义。 | `existing_module_map.md`；调整分组规则时同步 `workflow_module_guide.md`。 |
| 支付能量得 BLADE | `workflows/shared/pay-energy-gain-blade.ts`，费用 action log 复用 `runtime/workflow-helpers.ts` 的 `recordPayCostAction`。 | 支付能量后不是固定 BLADE，或还有区域移动/选目标/按状态动态计算奖励。 | 正常支付、能量不足、skip、费用支付时机、BLADE modifier 写入、pending continuation。 | `existing_module_map.md`；若新增费用胶水 helper，同步 `active_effect_runtime.md` 或 `runtime_action_helpers.md`。 |
| LIVE 开始条件修正 | `workflows/shared/conditional-live-modifier.ts`；confirm-only 窗口优先复用 `runtime/active-effect.ts` 的 activeEffect start helper。 | 条件修正同时包含复杂费用、选择目标或多段状态变化，导致 confirm-only modifier 轴不稳定。 | 条件满足、条件不满足、modifier add/replace/null、旧 modifier 清理、START_CONFIRM payload、finish payload、ordered pending continuation。 | `existing_module_map.md`；新增 modifier family 规则时同步 `workflow_module_guide.md`。 |
| 成员获得 HEART | `domain/rules/live-modifiers.ts` 的 `addHeartLiveModifierForMember`；只表达“某张成员获得 HEART”，由 helper 生成 `SOURCE_MEMBER` 或 `TARGET_MEMBER` 内部 modifier。 | 成员选择、费用、条件判断仍留在 workflow；不要把它扩成通用奖励 DSL。 | 来源成员获得 HEART、目标成员获得 HEART、跨玩家目标成员归属、非法目标、legacy `playerHeartBonuses` 不投影 member HEART。 | 新增/扩展 member HEART helper 时同步本 cookbook；不要使用 `target: 'PLAYER'` 表达真实成员 HEART。 |
| 公开手牌后进入下一 step | `runtime/active-effect.ts` 的 `revealHandCardForActiveEffect`。公开前的手牌候选用 `selectableCardVisibility: 'AWAITING_PLAYER_ONLY'`，公开后通过 helper 写入 `revealedCardIds`。 | 同名搜索、成功区交换、回收、费用支付、skip 分支和 pending continuation 仍留在具体 workflow；不要把它扩成 reveal DSL。 | 公开后的 `revealedCardIds`、旧 action payload/metadata 字段、候选仍在手牌、非法候选不半更新、后续 step 候选可见性。 | 新增/扩展 activeEffect helper 时同步 `active_effect_runtime.md`；迁出 runner 或新增 family 时同步 `migration_roadmap.md`。 |
| 对方成员变待机 | `workflows/shared/opponent-wait-target.ts`，舞台目标查询优先复用 `effects/stage-targets.ts`，事件差量复用 `runtime/events.ts`。 | 目标不是对方成员、方向变化不是 WAITING、或事件 enqueue 时机与 shared family 不同。 | 正常待机、无目标、非法目标、skip、member-state event enqueue、来源/目标 payload。 | `existing_module_map.md`；事件 timing 规则变化时同步 `workflow_module_guide.md`。 |
| 可选/skip/confirm-only activeEffect | `runtime/active-effect.ts` 的 `startPendingActiveEffect`、`startConfirmOnlyActiveEffect`、`finishSkippedActiveEffect`；step registry 用 `runtime/step-registry.ts`。 | helper 只能封装 pending 移除、activeEffect 拼装、START_CONFIRM/skip 这类通用胶水；若需要卡文条件、费用、区域移动或 modifier 策略，留在 workflow。 | 正常确认、skip、无目标、activeEffect 不匹配、pending continuation、payload 字段、orderedResolution。 | 新增/扩展 activeEffect helper 时同步 `active_effect_runtime.md`。 |
| 特殊复杂卡 | 放入 `workflows/cards/<card>.ts`，只在稳定片段处调用 shared workflow/helper。 | 默认路径。只有至少三张以上同型效果，且差异轴稳定，才晋升 shared family。 | 卡文全部分支、费用失败、费用已支付后目标消失、无目标、取消/skip、事件 enqueue、modifier/zone cleanup、重复触发限制。 | `existing_module_map.md`；若迁出 runner，同步 `migration_roadmap.md`；若形成 family，再同步 `workflow_module_guide.md`。 |

## Card Workflow Template

单卡 workflow 文件应尽量保持这个形状：

```text
src/application/card-effects/workflows/cards/<card-slug>.ts
```

- export 一个 `register<Card>WorkflowHandlers()`，在 runner 初始化处注册 starter / step / activated handler。
- start 函数只处理本卡进入 activeEffect 或直接结算的第一步。
- finish 函数按 `stepId` 处理玩家输入，并在结算完成后调用 pending continuation。
- 卡文差异保留在 workflow 内；通用抽牌、弃牌、回收、看顶、声援、activeEffect 胶水优先复用 runtime/effects helper。
- 不在单卡 workflow 内重写 trigger matcher、steps DSL、cost calculator 或底层 zone mutation helper。

## Pre-Commit Checklist

实现或迁移卡效前后，至少检查：

- `abilityId` / `stepId` 是否命名稳定，且 action payload 字段保持旧语义。
- 新增/扩展卡效时检查 `ability-ids.ts`、`definitions/index.ts`、`card-effect-classification.test.ts` 是否需要同步。
- pending 顺序、费用语义、费用支付时机、事件消费时机是否和旧流程一致。
- 正常、无目标、费用失败、取消/skip、非法选择、事件 enqueue 都有对应测试或明确复用既有覆盖。
- 新增/扩展 helper 时，helper 只封装通用流程胶水，不内置具体卡效条件或 modifier 策略。
- 新增卡效或完成同型扩展时同步 `docs/card-effect-reuse-audit/existing_module_map.md`。
- 迁出 runner 或新增 shared family 时同步 `docs/card-effect-framework/migration_roadmap.md` 和/或 `workflow_module_guide.md`。
- 执行范围内测试、`tsc --noEmit` 和 `git diff --check` 按当前任务要求通过。
