# Card Effect Module Boundaries

> 文档类型：编码标准
> 适用范围：卡效 query、runtime action、workflow、runner、domain rule 的职责边界
> 当前状态：现行边界约束

本文定义卡效相关代码应该放在哪里。实现和评审时，优先用本文件判断是否越界。

## Boundary Summary

| 层级 | 可以做 | 不可以做 |
|---|---|---|
| selector / query | 只读 `GameState`，返回布尔、计数、cardIds 或派生值。 | 移动卡、创建 activeEffect、改变 pending。 |
| runtime action | 执行一个稳定原子动作，返回新 `GameState` 与动作结果。 | 表达完整卡文流程、读取 ability 文案、推进 pending。 |
| activeEffect runtime | 创建/推进/清理选择步骤，统一可见性、metadata 与 step handler。 | 写单卡业务判断。 |
| workflow | 表达一张或一族卡的流程，组合 runtime action 和 query。 | 重复实现底层移动/选择机制，绕过 runtime。 |
| runner | 发现、入队、调度、继续 pending。 | 写具体卡牌 start/finish 逻辑。 |
| domain rule | 纯规则计算或 domain 级状态投影。 | 反向依赖 application workflow。 |

## Selector / Query

Typical locations:

- `src/application/effects/card-selectors.ts`
- `src/application/effects/conditions.ts`
- `src/domain/rules/success-live-score.ts`

Rules:

- 只读输入，不改变 `GameState`。
- 可复用 selector，不新增卡牌专名 selector，除非真实身份语义无法参数化。
- application query 可以调用 shared/domain query；domain query 不反向依赖 application。

Examples:

- `successLiveScoreAtLeast(game, playerId, 6)`
- `getMemberEffectiveCost(game, playerId, memberCardId)`
- `cardBelongsToGroup(card.data, "μ's")`

## Runtime Action

Target location:

- `src/application/card-effects/runtime/actions.ts`

Rules:

- 表达一个稳定动作，例如抽牌、弃牌、移动、放置、公开、回收。
- 可以改变 `GameState`。
- 必须返回足够结果给 workflow，例如 `drawnCardIds`、`discardedCardIds`。
- 不创建完整 activeEffect 流程。
- 不调用 `continuePendingCardEffects`。
- 不修改 pending 顺序。

Current examples:

- `drawCardsForPlayer`
- `drawCardsForEachPlayer`
- `discardHandCardsToWaitingRoomForPlayer`
- `discardOneHandCardToWaitingRoomForPlayer`

## Active Effect Runtime

Target locations:

- `src/application/card-effects/runtime/active-effect.ts`
- `src/application/card-effects/runtime/step-registry.ts`

Rules:

- 统一创建选择步骤。
- 统一校验 `awaitingPlayerId`、`stepId`、候选可见性和选择对象类型。
- 通过 registry 把 `abilityId + stepId` 分发给 workflow step handler。
- 不写卡文条件。

## Workflow

Target locations:

- `src/application/card-effects/workflows/activated/`
- `src/application/card-effects/workflows/on-enter/`
- `src/application/card-effects/workflows/live-start/`
- `src/application/card-effects/workflows/live-success/`
- `src/application/card-effects/workflows/replacement/`

Rules:

- workflow 可以是 family，也可以是特殊卡单独文件。
- workflow 调用 runtime action、selector/query、zone selection、live modifier。
- workflow 可以创建 activeEffect，也可以提供 step handler。
- workflow 不重复手写已有 runtime action。
- workflow 不直接改费用支付时机或 event consumption。

## Runner

Current location:

- `src/application/card-effect-runner.ts`

Target rules:

- 只保留 public API 与调度入口。
- 使用 starter registry 启动 workflow。
- 使用 step handler registry 结算 activeEffect step。
- 不再新增完整卡牌流程。

短期允许 runner 保留尚未迁出的旧逻辑，但新增复杂卡效应优先进入 `workflows/`。

## Continuous / Domain Modifier

Typical locations:

- `src/domain/rules/live-modifiers.ts`
- `src/domain/rules/live-requirement-modifiers.ts`

Rules:

- continuous modifier 由 domain 或规则层按当前场面动态收集。
- 临时 LIVE 修正通过 `addLiveModifier` / `replaceLiveModifier` 写入。
- 不把 continuous modifier 混入 runner workflow 或 steps DSL。
- `SOURCE_MEMBER` / `TARGET_MEMBER` Heart 应由有效 Heart 读取路径合并，不写入 legacy `playerHeartBonuses`。
