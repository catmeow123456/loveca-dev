# Card Effect Framework

> 文档类型：总览文档
> 适用范围：卡效框架目标态、阅读入口、权威文档关系与迁移边界
> 当前状态：现行卡效框架总入口；新增长期卡效框架文档时应同步更新

本文是卡效框架的主入口。新增卡效、拆分 runner、抽取 helper 或评审执行窗口结果时，优先从这里判断应该读哪份文档。

## Current Goal

`card-effect-runner.ts` 的完整卡效 fallback 已清空，当前阶段目标是维护已经落地的去中心化边界，并只在明确开启对应架构窗口时继续收口调度胶水：

- runner 保留 pending / activeEffect 生命周期、trigger/activated 调度入口、workflow registry 注册，以及尚未迁出的 matcher / relay / trigger 条件胶水。
- 原子动作放入 `src/application/card-effects/runtime/`。
- 具体卡牌流程放入 `src/application/card-effects/workflows/cards/`，同型 family 放入 `workflows/shared/`。
- 能归类的效果按 workflow family 参数化；不能归类的特殊卡也单独放 workflow 文件，不再留在 runner。
- trigger matcher 继续保持纯 matcher，等 runner 调度边界稳定后再接入。
- steps-lite 只在真实重复 workflow 已稳定后推进，不做完整解释器。

## Read Order

### 新增或扩展卡效

1. [卡效实现指南](card_effect_implementation_guide.md)
2. [新卡效开发 cookbook](new_card_effect_cookbook.md)
3. [模块边界](module_boundaries.md)
4. [runtime 原子动作 helper](runtime_action_helpers.md)
5. [activeEffect 运行时](active_effect_runtime.md)
6. [workflow 模块指南](workflow_module_guide.md)
7. [卡效完成状态登记册](../card-effect-reuse-audit/existing_module_map.md)

### 拆分 runner 或设计新 helper

1. [目标架构](target_architecture.md)
2. [模块边界](module_boundaries.md)
3. [activeEffect 运行时](active_effect_runtime.md)
4. [runtime 原子动作 helper](runtime_action_helpers.md)
5. [迁移路线](migration_roadmap.md)

### trigger matcher / steps-lite

1. [trigger matcher 计划](trigger_matcher_plan.md)
2. [steps-lite 计划与晋升队列](steps_lite_plan.md)
3. [steps promotion queue](steps_promotion_queue.md)

### 查旧文档权威关系

1. [旧文档索引](legacy_doc_index.md)
2. [模块覆盖说明](../card-effect-reuse-audit/effect_module_coverage.md)
3. [模块缺口清单](../card-effect-reuse-audit/module_gap_list.md)

## Authoritative Documents

| 文档 | 责任 |
|---|---|
| [target_architecture.md](target_architecture.md) | 卡效系统最终目标态、目录结构和调度模型。 |
| [module_boundaries.md](module_boundaries.md) | query、runtime action、workflow、runner、domain modifier 等模块边界。 |
| [new_card_effect_cookbook.md](new_card_effect_cookbook.md) | 新增/扩展卡效时按常见效果选择 workflow/helper 的一页式入口。 |
| [runtime_action_helpers.md](runtime_action_helpers.md) | 抽牌、弃牌、回收、看顶、区域移动等原子动作 helper 的参数轴和迁移状态。 |
| [workflow_module_guide.md](workflow_module_guide.md) | workflow family 与特殊卡 workflow 应如何组织、导出和测试。 |
| [active_effect_runtime.md](active_effect_runtime.md) | activeEffect / stepId / metadata / 可见性 / step handler registry 的运行时约定。 |
| [migration_roadmap.md](migration_roadmap.md) | runner 去中心化迁移顺序、完成标准和禁止事项。 |
| [trigger_matcher_plan.md](trigger_matcher_plan.md) | 纯 trigger matcher 的字段边界、shadow test 与 T-2 接线计划。 |
| [steps_lite_plan.md](steps_lite_plan.md) | steps-lite 的目标、非目标和与 workflow helper 的关系。 |

## Registries

| 文档 | 责任 |
|---|---|
| [existing_module_map.md](../card-effect-reuse-audit/existing_module_map.md) | 卡牌基础编号完成状态，新增/补全卡效时必须优先同步。 |
| [effect_module_coverage.md](../card-effect-reuse-audit/effect_module_coverage.md) | 已有通用模块覆盖哪些效果碎片。 |
| [module_gap_list.md](../card-effect-reuse-audit/module_gap_list.md) | 剩余缺口、下一批抽象候选和风险。 |
| [condition_query_remaining_inventory.md](../card-effect-reuse-audit/condition_query_remaining_inventory.md) | condition/query 与 selector 清单。 |

## Hard Boundaries

- 不新增完整 steps 解释器 / DSL。
- 不把 trigger matcher 接入 runner，除非明确开启 T-2。
- 不改 pending 顺序、事件消费时机、费用语义或费用支付时机。
- 不为了整理文档拆 `src/application/card-effects/definitions/index.ts`。
- 不把 `llocg_db`、`assets/card/`、`assets/images/`、`trigger` 纳入普通卡效或框架提交。
- 新增复杂卡效时，不能继续把完整 workflow 直接写进 runner；至少应放入 workflow module 或复用既有 workflow helper。
