# Active Effect Runtime

> 文档类型：设计文档
> 适用范围：activeEffect、stepId、metadata、可见性与 step handler registry
> 当前状态：step handler registry 已落地；旧 runner 分支仍分批迁移中

`activeEffect` 是多步卡效的运行时状态。runner 膨胀的核心原因之一，是每张卡都在 runner 中手写 activeEffect 创建、step 校验、候选可见性和 finish 分发。当前已建立 step handler registry，`confirmActiveEffectStep` 先查 registry，未命中再 fallback 旧分支。

## Target Responsibilities

activeEffect runtime 应统一处理：

- step 创建。
- `awaitingPlayerId` 校验。
- 候选卡、候选对象、候选槽位、选项的可见性。
- `abilityId + stepId` 到 handler 的分发。
- step 完成后的 `activeEffect: null` 与 pending 继续。
- reveal confirm / private inspection / public selection 的通用投影字段。

它不应该处理：

- 单卡卡文条件。
- 特殊分支奖励。
- 费用语义变更。
- trigger matcher 接线。

## Step Handler Registry

Current API shape:

```ts
registerActiveEffectStepHandler(abilityId, stepId, handler);
```

Current resolve shape:

```ts
export function resolveActiveEffectStepWithRegistry(game, input): GameState {
  const effect = game.activeEffect;
  const handler = findStepHandler(effect.abilityId, effect.stepId);
  return handler(game, input);
}
```

Benefits:

- `confirmActiveEffectStep` 不再有数百行 `if abilityId && stepId`。
- workflow 拥有自己的 step handler。
- 新卡不需要修改 runner 的大型分发函数。

## ActiveEffect Fields

Important fields:

| field | responsibility |
|---|---|
| `abilityId` | 当前处理能力。 |
| `sourceCardId` | 来源卡实例。 |
| `controllerId` | 效果控制者。 |
| `awaitingPlayerId` | 当前需要输入的玩家。 |
| `stepId` | 当前步骤。 |
| `selectableCardIds` | 可选卡牌候选。 |
| `selectableObjectIds` | 可选公开对象候选。 |
| `selectableSlotPositions` | 可选槽位候选。 |
| `selectableOptions` | 颜色、模式、分支等选项。 |
| `revealedCardIds` | 已公开给双方的隐藏区卡。 |
| `selectableCardVisibility` | 候选对谁可见。 |
| `metadata` | workflow 私有上下文。 |

## Metadata Rule

`metadata` 可以保存 workflow 上下文，例如：

- discarded card ids
- selected branch
- source slot
- inspected card ids
- replacement origin

Rules:

- metadata 不应替代权威 zone/card 状态。
- step handler 必须重新校验目标仍合法。
- 跨玩家可见性不能仅靠 metadata 控制，必须配合投影字段。

## Continue Pending

step handler 完成后应明确决定：

- 是否清空 `activeEffect`。
- 是否调用 `continuePendingCardEffects`。
- 是否保持 ordered resolution。
- 是否只结束当前效果，不推进后续。

这些决策应由 workflow helper 统一承接，而不是每张卡重复写相同样板。

## Current Glue Helpers

Current helper modules outside `runtime/actions.ts`:

| helper | file | responsibility | boundary |
|---|---|---|---|
| `startPendingActiveEffect` | `src/application/card-effects/runtime/active-effect.ts` | 移除对应 pending ability，安装调用方已经拼好的 `activeEffect`，并写入 start `RESOLVE_ABILITY` action。 | 不构造卡文条件，不支付费用，不移动卡，不写 modifier，不 enqueue trigger，不决定 finish/continue 策略。 |
| `startConfirmOnlyActiveEffect` | `src/application/card-effects/runtime/active-effect.ts` | 为只有确认窗口的流程拼装 `activeEffect`，设置 step/awaiting player/orderedResolution metadata，并复用 `startPendingActiveEffect` 写入 `START_CONFIRM` action。 | 不判断条件是否满足，不选择 modifier 策略，不重算确认时数值，不清空 activeEffect，不推进 pending。 |
| `startConfirmOnlyPendingAbilityEffect` | `src/application/card-effects/runtime/active-effect.ts` | 为手动选择 pending ability 后需要先确认的流程安装 confirm-only `activeEffect`，保留原 pending ability，不写 start action。 | 不移除 pending，不结算卡效，不调用 starter，不应替代 `startConfirmOnlyActiveEffect`。 |
| `finishConfirmOnlyPendingAbilityEffect` | `src/application/card-effects/runtime/active-effect.ts` | 确认 confirm-only pending bridge 后，清空 `activeEffect`，通过调用方传入的 callback 以 `skipManualConfirmation` 重新进入 pending starter。 | 不 import runner，不知道具体卡效，不改变 pending 顺序；重新进入哪个 starter 由调用方注入。 |
| `finishSkippedActiveEffect` | `src/application/card-effects/runtime/active-effect.ts` | 清空当前 `activeEffect`，写入 `RESOLVE_ABILITY` with `step: 'SKIP'` by default，并按 metadata 中的 `orderedResolution` 继续 pending。 | 不处理费用、不检查目标、不 enqueue trigger、不决定卡文策略。 |
| `getAbilityEffectText` | `src/application/card-effects/runtime/workflow-helpers.ts` | 按 abilityId 读取卡效文本，供 workflow 创建 activeEffect。 | 不创建 activeEffect，不处理 step 或 metadata。 |
| `recordAbilityUseForContext` | `src/application/card-effects/runtime/workflow-helpers.ts` | 写入旧语义的 `RESOLVE_ABILITY` / `ABILITY_USE` action。 | 不支付费用，不判断发动条件。 |
| `recordPayCostAction` | `src/application/card-effects/runtime/workflow-helpers.ts` | 写入 `PAY_COST` action，并保留调用方传入的 payload 字段。 | 不支付费用，不移动卡，不判断费用能否支付，不决定卡效策略。 |
| `getSourceMemberSlot` | `src/application/card-effects/runtime/source-member.ts` | 查询来源成员当前所在舞台槽位。 | 只读查询；不移动成员，不判断卡文是否合法。 |
| `getNewEnterStageEvents` | `src/application/card-effects/runtime/events.ts` | 从 before/after game 的 eventLog 差异中取新产生的 `ON_ENTER_STAGE` 事件。 | 只读查询；不 enqueue trigger，不构造事件，不移动卡。 |
| `getNewMemberStateChangedEvents` | `src/application/card-effects/runtime/events.ts` | 从 before/after game 的 eventLog 差异中取新产生的 `ON_MEMBER_STATE_CHANGED` 事件。 | 只读查询；不 enqueue trigger，不构造事件，不改变成员状态。 |

These helpers are intentionally small. If a proposed helper starts to own payment timing, grouped recovery policy, trigger matching, or full activeEffect construction, it belongs in a separate audit before implementation.

`startConfirmOnlyActiveEffect` and `startConfirmOnlyPendingAbilityEffect` are deliberately separate. Use the active-effect version when the workflow is truly starting and should remove the pending ability immediately. Use the pending-ability bridge only for ordered/manual pending selection where the player must confirm a no-input ability before the same pending ability resumes through its starter.

## Migration Target

Priority:

1. 继续迁出 `confirmActiveEffectStep` 中剩余 workflow family。
2. 迁出特殊卡 workflow。
3. 收窄重复 activeEffect 创建/finish 样板。
4. runner 最终只保留 registry dispatch 与旧逻辑 fallback 被移除后的生命周期入口。
