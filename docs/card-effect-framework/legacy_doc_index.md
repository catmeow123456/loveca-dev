# Card Effect Legacy Document Index

> 文档类型：历史/计划文档
> 适用范围：卡效旧设计、交接、覆盖和缺口文档的权威关系
> 当前状态：现行索引；用于避免旧文档和目标架构互相覆盖

本文说明已有卡效相关文档在新框架下的用途。旧文档不删除，但不应替代当前权威文档。

## Current Authority

| 文档 | 当前用途 |
|---|---|
| [README.md](README.md) | 卡效框架主入口。 |
| [target_architecture.md](target_architecture.md) | 最终目标架构。 |
| [module_boundaries.md](module_boundaries.md) | 模块边界与编码约束。 |
| [runtime_action_helpers.md](runtime_action_helpers.md) | 原子动作 helper 参数与迁移状态。 |
| [workflow_module_guide.md](workflow_module_guide.md) | workflow family / 特殊卡 workflow 写法。 |
| [active_effect_runtime.md](active_effect_runtime.md) | activeEffect runtime 与 step handler registry 目标。 |
| [migration_roadmap.md](migration_roadmap.md) | runner 去中心化迁移路线。 |

## Still Active Specialist Docs

| 文档 | 当前用途 |
|---|---|
| [trigger_matcher_plan.md](trigger_matcher_plan.md) | trigger matcher T-0/T-1/T-2 计划与字段边界。 |
| [steps_promotion_queue.md](steps_promotion_queue.md) | workflow family 晋升 steps-lite 的候选队列。 |
| [steps_lite_plan.md](steps_lite_plan.md) | steps-lite 的目标和非目标。 |
| [card_effect_implementation_guide.md](card_effect_implementation_guide.md) | 新增卡效时的操作指南。 |
| [../card-effect-reuse-audit/existing_module_map.md](../card-effect-reuse-audit/existing_module_map.md) | 卡牌基础编号完成状态登记册。 |
| [../card-effect-reuse-audit/effect_module_coverage.md](../card-effect-reuse-audit/effect_module_coverage.md) | 通用模块覆盖说明。 |
| [../card-effect-reuse-audit/module_gap_list.md](../card-effect-reuse-audit/module_gap_list.md) | 缺口与下一批抽象候选。 |
| [../card-effect-reuse-audit/condition_query_remaining_inventory.md](../card-effect-reuse-audit/condition_query_remaining_inventory.md) | condition/query 剩余清单。 |
| [../card-effect-reuse-audit/domain_safe_identity_plan.md](../card-effect-reuse-audit/domain_safe_identity_plan.md) | shared 团体身份边界。 |

## Historical / Background Docs

| 文档 | 当前状态 |
|---|---|
| [card_effect_framework_design.md](card_effect_framework_design.md) | 旧框架设计草案和阶段性落地说明；目标态以 `target_architecture.md` 为准。 |
| [card_effect_fragment_coverage_matrix.md](card_effect_fragment_coverage_matrix.md) | fragment 覆盖矩阵，仍可用于查 catalog 覆盖，但不作为 runner 目标架构入口。 |
| [effect_refactor_handoff_20260616.md](effect_refactor_handoff_20260616.md) | 历史交接与审查上下文；不替代当前目标架构。 |
| [../card-effect-reuse-audit/reuse_audit_report.md](../card-effect-reuse-audit/reuse_audit_report.md) | 历史复用审计报告。 |
| [../card-effect-reuse-audit/safe_refactor_plan.md](../card-effect-reuse-audit/safe_refactor_plan.md) | 早期安全重构计划，具体路线已被 `migration_roadmap.md` 接管。 |
| [../card-effect-reuse-audit/card_effect_batch_expansions.md](../card-effect-reuse-audit/card_effect_batch_expansions.md) | 历史批量扩样本记录。 |

## Rule

如果旧文档和新目标架构冲突：

1. 先看真实代码和测试。
2. 再看 `README.md`、`target_architecture.md`、`module_boundaries.md`。
3. 旧文档只作为背景，必要时更新本索引或对应权威文档。
