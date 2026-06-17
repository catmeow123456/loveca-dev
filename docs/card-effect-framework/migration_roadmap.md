# Card Effect Runner Migration Roadmap

> 文档类型：历史/计划文档
> 适用范围：runner 去中心化、runtime helper、workflow module 与 steps-lite 的迁移顺序
> 当前状态：迁移计划；完成状态以代码、测试和本表同步为准

本文记录 runner 去中心化路线。它不是一次性大重写计划；每一阶段都必须保持行为可验证。

## Status Legend

| status | meaning |
|---|---|
| `planned` | 尚未开始。 |
| `in_progress` | 已有代码或测试起步。 |
| `partial` | 已迁移部分调用点，但仍有同类旧逻辑。 |
| `blocked` | 需要先确认规则语义或完成前置拆分。 |
| `done` | 已完成并由测试覆盖。 |

## Roadmap

| phase | status | target | completion standard |
|---|---|---|---|
| R-0 | done | 建立卡效框架总文档与权威关系。 | `README.md`、目标架构、模块边界、迁移路线和旧文档索引落地。 |
| R-1 | partial | runtime action helpers。 | 抽牌、弃牌、回收等原子动作已有 runtime helper 和测试；看顶仍由 `src/application/effects/look-top.ts` 原语承接，更多区域移动/公开确认 helper 待真实 workflow 推动。 |
| R-2 | partial | activeEffect step handler registry。 | `confirmActiveEffectStep` 已先查 step registry，未命中 fallback 旧分支；look-top、抽后弃、回收等 workflow 已迁入 registry，复杂旧分支仍在 runner。 |
| R-3 | partial | pending / starter registry。 | `startPendingAbilityEffect` 已先查 starter registry，未命中 fallback 旧 switch；新增 queued workflow 应优先注册 starter。 |
| R-4 | partial | workflow family 迁出。 | look-top、discard look-top、draw-then-discard、waiting-room recovery、自送回收、支付能量回收与 BP4-002 弃手回收已离开 runner；复合特殊路径仍分批迁移。 |
| R-5 | planned | special card workflow 迁出。 | 瑠璃乃、錯覚CROSSROADS、南琴梨、东条希等复杂特殊卡放入 workflow 文件。 |
| R-6 | planned | trigger matcher T-2。 | 在 enqueue 边界稳定后，用纯 matcher 替代部分旧 trigger 判定，并保留 shadow 一致性测试。 |
| R-7 | planned | steps-lite。 | 只对 proven workflow family 建 typed builder；不做完整 DSL。 |

## R-1 Current Focus

Current start:

- `src/application/card-effects/runtime/actions.ts`
- `tests/unit/card-effect-runtime-actions.test.ts`

Current helper families:

- draw cards
- discard hand cards to waiting room
- recover waiting-room cards to hand

Next runtime candidates:

- inspect top choose
- public reveal confirm
- grouped zone selection

## R-2 / R-3 Current State

The largest runner pressure is not draw/discard actions; it is activeEffect step dispatch and card-specific workflows.

Current dispatch registries:

- `src/application/card-effects/runtime/step-registry.ts`
- `src/application/card-effects/runtime/starter-registry.ts`
- `src/application/card-effects/runtime/activated-registry.ts`

They are registry-first / fallback-old-runner entry points. Remaining work is to keep moving old starter/step/activated cases into workflow modules.

## R-4 Current Workflow Modules

Current migrated workflow modules:

- `workflows/shared/look-top-select-to-hand.ts`
- `workflows/shared/discard-look-top-select-to-hand.ts`
- `workflows/shared/draw-then-discard.ts`
- `workflows/shared/waiting-room-to-hand.ts`
- `workflows/shared/self-sacrifice-waiting-room-to-hand.ts`
- `workflows/shared/pay-energy-waiting-room-to-hand.ts`
- `workflows/shared/discard-cost-waiting-room-to-hand.ts`
- `workflows/cards/hs-bp5-008-izumi.ts`
- `workflows/cards/hs-pb1-009-kaho.ts`
- `workflows/cards/hs-sd1-006-hime.ts`
- `workflows/cards/pr-017-nico.ts`

`PR_017` 已迁到单卡 workflow wrapper，仍没有并入纯 self-sacrifice recovery family。Remaining near-term R-4/R-5 candidates include `BP5_003` 分支、`HS_PB1_004` 复合费用、`HS_BP5_001` 公开手牌同名回收、`HS_PB1_012` 洗回后回收并得 BLADE 与 grouped recovery。

## R-5 Special Workflow Candidates

These effects may remain card-specific, but should leave runner:

- `PL!HS-bp5-003` 费用 2「大泽瑠璃乃」：LIVE 开始弃手后同团成员获得桃 Heart；离场站位变换。
- `PL!-bp6-024-L` 分数 3「錯覚CROSSROADS」：成功区放置替代。
- `PL!-bp5-003` 费用 11「南琴梨」：弃牌分支后看顶或回收。
- `PL!-bp5-007` 费用 13「东条希」：换手登场后双方弃到 3 并各抽 3。

## Guardrails

Every migration phase must preserve:

- pending order
- event consumption timing
- cost semantics
- cost payment timing
- ability registration semantics
- online projection visibility

Do not:

- connect trigger matcher to runner before T-2 is explicitly opened
- introduce full steps DSL
- change card text behavior while moving code
- clean or include long-term untracked asset/database directories
