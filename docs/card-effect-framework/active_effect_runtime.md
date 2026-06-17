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

## Migration Target

Priority:

1. 继续迁出 `confirmActiveEffectStep` 中剩余 workflow family。
2. 迁出特殊卡 workflow。
3. 收窄重复 activeEffect 创建/finish 样板。
4. runner 最终只保留 registry dispatch 与旧逻辑 fallback 被移除后的生命周期入口。
