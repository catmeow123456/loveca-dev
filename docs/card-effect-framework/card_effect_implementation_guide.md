# Card effect implementation guide

> 文档类型：专题说明
> 适用范围：新增或扩展卡牌效果时的入口索引、复用路线和提交前检查
> 当前状态：现行工作指南；不替代框架设计、登记册或具体测试

本文档给执行窗口一个固定路线：拿到新卡效后先查既有沉淀，再实现最小行为，不重新发明底层路线。

## What This Is

这是一份短指南，只回答三件事：

- 新卡效从哪里开始查。
- 已有 helper 应该优先怎么复用。
- 实现和提交前需要检查什么。

它不是卡效框架设计，不是 steps DSL 说明，也不是完整卡池实现计划。

## Start Here

新增或扩展卡效前，按顺序查看：

1. `docs/card-effect-framework/README.md`
   - 先确认当前卡效框架目标、模块边界和禁止事项。
2. `docs/card-effect-reuse-audit/existing_module_map.md`
   - 先查目标卡号或同型卡是否已经登记。
   - 若有同型，优先复用同型 resolver / helper / 测试形状。
3. `docs/card-effect-framework/module_boundaries.md`
   - 判断本卡应落在 query、runtime action、workflow、continuous modifier 还是 runner dispatch。
4. `docs/card-effect-framework/runtime_action_helpers.md`
   - 查抽牌、弃牌、回收、看顶等原子动作 helper 是否已有入口。
5. `docs/card-effect-framework/active_effect_runtime.md`
   - 多步、可选、confirm-only、skip、pending continuation 流程先查 activeEffect helper 边界。
6. `docs/card-effect-framework/workflow_module_guide.md`
   - 若有多步流程或特殊复合效果，优先放入 workflow module，不继续直接长进 runner。
7. `docs/card-effect-framework/card_effect_fragment_coverage_matrix.md`
   - 查效果片段目前落在哪一层：事件、condition/query、selector、cost、workflow 或 runner。
8. `docs/card-effect-reuse-audit/effect_module_coverage.md`
   - 查现有模块覆盖和已证明的 helper。
9. `docs/card-effect-reuse-audit/condition_query_remaining_inventory.md`
   - 查当前 condition/query、selector、domain-safe identity、formula-builder、workflow-step 的边界。
10. 相关测试：
   - `tests/integration/sample-card-effect-runner.test.ts`
   - `tests/unit/card-effect-classification.test.ts`
   - 若涉及 selector/query/domain，再查对应 unit test。

如果这些文档和真实代码冲突，以真实代码和测试为准，并在提交前做窄范围文档修正。

## Reuse First

优先复用这些入口：

- 卡牌身份与 selector：`src/application/effects/card-selectors.ts`
- condition/query：`src/application/effects/conditions.ts`
- 舞台目标查询：`src/application/effects/stage-targets.ts`
- 能量查询：`src/application/effects/energy.ts`
- 声援选择：`src/application/effects/cheer-selection.ts`
- shared 团体身份：`src/shared/utils/card-identity.ts`
- 卡效定义：`src/application/card-effects/`
- runtime 原子动作：`src/application/card-effects/runtime/`
- workflow 目标目录：`src/application/card-effects/workflows/`
- runner 接线：`src/application/card-effect-runner.ts`，只保留调度入口和未迁移旧逻辑

新增 helper 的条件：

- 至少有真实卡效需要它。
- helper 是纯函数、只读 query，或明确的 runtime 原子动作。
- helper 不偷塞完整 workflow、pending 顺序、事件消费或费用支付时机。
- helper 有 focused unit test 或被现有 integration test 覆盖。

不要为了减少 runner 行数而搬运一段同样命令式的 workflow。复杂卡效应迁入 `workflows/`，并复用 runtime action 与 activeEffect runtime。

## Definition Checklist

新增能力或同型扩展时检查：

- `ability-ids.ts`：是否需要新增 ability id 常量。
- `definitions/index.ts`：effect text、trigger、base card 是否登记。
- `definitions/shared-abilities.ts`：同型卡是否应该进入 shared base-card 列表。
- `card-effect-classification.test.ts`：分类和定义登记是否覆盖。

注意：`abilityId` 不要求全局唯一。多 trigger 登记可以共享同一 ability id，但文本和 base-card 语义必须一致。

## Implementation Checklist

实现前：

- 读目标卡真实卡文和现有同型卡。
- 确认触发时机是否已有事件事实；没有真实样例时不要提前设计费用期间事件消费。
- 确认只是 selector/query、cost、domain modifier，还是 workflow。

实现时：

- 候选扫描优先用 selector/query helper。
- 团体身份优先用 `groupAliasIs` 或 shared `cardBelongsToGroup`。
- 指定姓名优先用 `cardNameAliasIs` / `cardNameAliasAny` / `cardNameContains`，不要混淆 alias、contains、equality。
- 简单旧 workflow 可暂留 runner；新增复杂 workflow 或迁移中的 workflow 应进入 `src/application/card-effects/workflows/`。
- 不直接做 steps 解释器或 DSL。

实现后：

- 更新 `existing_module_map.md` 的卡效状态。
- 如引入新 helper 或关闭清单项，再同步相关专题文档。
- 不把临时执行记录、测试输出或一次性 checklist 写进长期文档。

## Validation Checklist

基础验证：

```bash
pnpm test:run tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
git diff --check
```

按改动范围追加：

- selector/query：`tests/unit/card-selectors.test.ts`、`tests/unit/conditions.test.ts`
- stage/energy：对应 `stage-targets` / `energy` unit test
- cost：`tests/unit/cost-calculator.test.ts`
- continuous modifier：`tests/unit/live-modifiers.test.ts`
- LIVE_START timing：`tests/integration/live-start-timing.test.ts`
- cheer：声援相关 unit/integration test

## Do Not

- 不直接跳到 steps DSL。
- 不提前处理费用期间事件消费时机。
- 不为了好看拆 `src/application/card-effects/definitions/index.ts`。
- 不把 `llocg_db`、`assets/card/`、`assets/images/`、`trigger` 纳入普通卡效提交。
- 不把 domain 反向依赖到 application helper。
- 不宣传 trigger matcher、steps 或完整 condition AST 已完成，除非真实代码和测试已经落地。
