# Card Effect Module Boundaries

> 文档类型：编码标准
> 适用范围：卡效 query、runtime action、workflow、runner、domain rule 的职责边界
> 当前状态：现行边界约束

本文定义卡效相关代码应该放在哪里。实现和评审时，优先用本文件判断是否越界。

## Boundary Summary

| 层级                 | 可以做                                                         | 不可以做                                            |
| -------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| selector / query     | 只读 `GameState`，返回布尔、计数、cardIds 或派生值。           | 移动卡、创建 activeEffect、改变 pending。           |
| runtime action       | 执行一个稳定原子动作，返回新 `GameState` 与动作结果。          | 表达完整卡文流程、读取 ability 文案、推进 pending。 |
| activeEffect runtime | 创建/推进/清理选择步骤，统一可见性、metadata 与 step handler。 | 写单卡业务判断。                                    |
| workflow             | 表达一张或一族卡的流程，组合 runtime action 和 query。         | 重复实现底层移动/选择机制，绕过 runtime。           |
| runner               | 发现、入队、调度、继续 pending。                               | 写具体卡牌 start/finish 逻辑。                      |
| domain rule          | 纯规则计算或 domain 级状态投影。                               | 反向依赖 application workflow。                     |

本回合成员卡效活跃限制属于窄 domain rule：状态只记录受影响玩家、来源、能力与创建回合，query 只回答当前回合是否有效；具体卡牌 workflow 只负责建立状态，公共成员状态 action 负责执行门禁。该边界不是任意条件或限制 DSL。

费用4「松浦果南」的 LIVE_END 待机保护同样属于窄 domain rule。workflow 只建立包含受影响玩家、来源实例、ability identity、结构化 Aqours 条件与印刷 BLADE 上限的状态；通用 WAITING 目标选择在候选生成时查询，公共成员状态 action 在实际变为 WAITING 时再次查询，防御窗口开启后才获得保护的 stale 目标。CARD_EFFECT cause 将效果控制者与实际选择玩家作为不同事实，但只有效果控制者决定是否属于对方效果，实际选择玩家不能绕过保护。因此费用15「セラス 柳田 リリエンフェルト」让受影响玩家自行选择时，仍须从未受保护成员中选择；全部成员受保护时什么也不发生。来源离场不清除，只有真实 LIVE_END 清理。这个边界不构成任意免疫、数值 predicate 或 protection DSL。

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
- `src/application/card-effects/runtime/public-reveal-dwell.ts`

Rules:

- 统一创建选择步骤。
- 统一校验 `awaitingPlayerId`、`stepId`、候选可见性和选择对象类型。
- 通过 registry 把 `abilityId + stepId` 分发给 workflow step handler。
- `public-reveal-dwell.ts` 只负责“隐藏卡牌刚变为双方公开”后的权威定时展示与原 step/下一交互恢复：无输入原 step 使用 `withPublicRevealDwell`，真实下一交互使用 `createPublicRevealDwellBeforeNextEffect`。
- dwell 只接受本次明确公开的 cardIds，不决定公开集合、不移动卡、不写奖励、不推进 pending，也不包装已有 public-card-selection / public-effect-choice 自动展示。
- 不写卡文条件。

## Workflow

Target locations:

- `src/application/card-effects/workflows/cards/`
- `src/application/card-effects/workflows/shared/`

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

完整卡效 fallback 已从 runner 清空。runner 当前只允许保留 pending/activeEffect 生命周期、workflow registry 注册，以及尚未迁出的 matcher / relay / trigger 条件胶水；新增或修改具体卡效不得把 start/finish/resolver 流程写回 runner。

## Continuous / Domain Modifier

Typical locations:

- `src/domain/rules/live-modifiers.ts`
- `src/domain/rules/live-requirement-modifiers.ts`

Rules:

- continuous modifier 由 domain 或规则层按当前场面动态收集。
- SCORE / REQUIREMENT 等临时 LIVE 修正通过 `addLiveModifier` / `replaceLiveModifier` 写入；HEART 的生产 workflow 与 continuous registry 必须先使用 `create/addHeartLiveModifierForSourceMember`、`...ForTargetMember` 或 `...ForPlayer` 显式决定 scope。
- 不把 continuous modifier 混入 runner workflow 或 steps DSL。
- HEART scope 只按卡文语义决定；选择或指定成员时即使 source=target 仍为 `TARGET_MEMBER`，并分别保存真实来源与受益成员。不得按卡型、区域、ID 相等或缺失字段推断。
- `SOURCE_MEMBER` / `TARGET_MEMBER` Heart 应由有效 Heart 读取路径合并，不写入 legacy `playerHeartBonuses`；成员绑定清理由通用 LeaveStage 生命周期负责，单卡 workflow 不得假定某个特殊离场流程会代为清理。

## 有限成员登场选项与卡定义特殊登场边界

手牌成员的额外登场方式统一由 `application/member-play-options.ts` 投影为 `MemberPlayOption`。`DOUBLE_RELAY` 是普通登场命令的有限换手选项，仍提交 `PLAY_MEMBER_TO_SLOT + relayMode=DOUBLE`；只有 `CARD_DEFINED` 进入服务端权威 `BEGIN/CONFIRM_SPECIAL_MEMBER_PLAY`。客户端只渲染服务端给出的 option id、玩家文案、合法槽位与选择描述，不维护基础编号白名单，不自行计算费用或推导程序动作。

`application/special-member-play-procedures.ts` 是显式 procedure registry。当前真实模式包括：

- `LL-bp7-001`：选择指定三名成员作为程序成本，本次特殊登场基准费用为10。
- `PL!N-bp7-011`：将自己休息室全部成员洗切并放置于主卡组底，本次特殊登场基准费用为11。

每个 procedure 各自拥有 begin/confirm 校验、可序列化 pending、玩家文案配置和原子 resolve。新增真实样本应增加有限 procedure 与 RULES/FREE focused 测试，不得把支付区域、费用公式、任意移动序列或 callback 扩成特殊登场 DSL。

需要在执行前完整枚举合法确认输入的调用方使用 `querySpecialMemberPlayConfirmation`。该只读查询按具体 procedure 重验来源、目标槽、固定费用上下文、当前程序候选和共享费用计划，并提供可验证 witness；它不移动卡牌、不支付费用、不触发事件。确认 selection 仍调用同一 procedure 的 `validateConfirm`，最终执行仍由 `resolveSpecialMemberPlay` 原子完成。

BEGIN 的权威 guard 必须拒绝未结算 `activeEffect`、pending ability/choice/cost、check timing、inspection 或 delegated sequence，不能依赖 UI 隐藏按钮。确认时重验来源、目标槽、程序候选、区域事实、固定费用上下文与当前模式；任一步失败都返回原状态。休息室到主卡组移动必须走中央 grouped event wrapper，登场仍走标准 `ON_ENTER_STAGE`、换手 replacement 与 sealed audit 管线。

RULES 模式按服务端费用计划、换手合法性与 `movedToStageThisTurn` 槽位限制结算；客户端不提交数字费用。`specialPlayBaseCost` 只影响本次 play 的费用上下文，不改写印刷费用或登场后的 modifier。已占槽位必须记录真实单换手/重复成员事实，不能因为被换成员有效费用为0而省略 replacement。

FREE 模式只放宽本次特殊登场的能量支付和目标槽位限制：不检查或支付登场能量，三个成员区均可成为目标且不受 `movedToStageThisTurn` 限制；卡面规定的程序成本/动作仍必须完整执行，占用槽位继续沿用普通 FREE 登场的单换手或重复成员规则。审计必须记录 `manualOperationMode`、实际支付能量和真实 replacement，不能把 FREE 的0能量或换手事实伪装成 RULES 计划。

更完整的执行约束与当前样本见 `runtime_action_helpers.md` 的“卡效特殊登场 + ON_ENTER_STAGE 触发”和 `workflow_module_guide.md` 的“有限成员登场选项与卡定义特殊流程”；本节只定义层级边界，不重复维护 procedure 细节。
