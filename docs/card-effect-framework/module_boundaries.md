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

本回合成员卡效活跃限制属于窄 domain rule：状态只记录受影响玩家、来源、能力与创建回合，query 只回答当前回合是否有效；具体卡牌 workflow 只负责建立状态，公共成员状态 action 负责执行门禁。该边界不是任意条件或限制 DSL。

费用4「松浦果南」的 LIVE_END 待机保护同样属于窄 domain rule。workflow 只建立包含受影响玩家、来源实例、ability identity、结构化 Aqours 条件与印刷 BLADE 上限的状态；公共成员状态 action 在实际变为 WAITING 时动态查询。保护不参与候选过滤，CARD_EFFECT cause 将效果控制者与实际选择玩家作为不同事实，因此塞拉斯让受影响玩家自行选择时不会被保护阻止。来源离场不清除，只有真实 LIVE_END 清理。这个边界不构成任意免疫、数值 predicate 或 protection DSL。

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
- `hasLiveWithoutLiveStartOrSuccessAbility(game, playerId)` 只扫描指定玩家当前 LIVE 区合法 LIVE 实例并按印刷 `cardText` 判断中日 LIVE_START / LIVE_SUCCESS；它不依赖 definition 是否已实现，也不创建 pending 或 modifier。

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

## Narrow special-member-play authority boundary

`LL-bp7-001-R+` 是首个窄特殊成员登场样本。`BEGIN_SPECIAL_MEMBER_PLAY` 在先选成员区后建立可复水 pending；`CONFIRM` 由权威端重验姓名分配、区域、换手与能量并原子结算。客户端不提交数字费用。窄 `specialPlayBaseCost: 10` 只是本次 play 的服务端验证输入；不改写印刷费用，不写登场后 modifier/replacement。该边界不是任意特殊登场或替代费用 DSL。

BEGIN 的权威 guard 必须拒绝任何未结算 `activeEffect` / pending ability/choice/cost、check timing、inspection 或 delegated sequence，不得依赖 UI 隐藏按钮。确认时，空区域只计算非换手方案；已占区域必须将费用查询绑定 `relayMode: 'SINGLE'`，即使被换手成员有效费用为0，费用 action、replacement 事件和 sealed audit 也必须记录同一换手事实。
