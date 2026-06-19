# Steps-Lite Plan

> 文档类型：历史/计划文档
> 适用范围：steps-lite 的目标、非目标、晋升条件与现有 promotion queue 的关系
> 当前状态：计划；不是已落地 DSL

steps-lite 是 workflow helper 稳定后的下一阶段，不是当前 runner 去中心化的前置条件。

## Goal

steps-lite 只处理已经被真实卡效反复证明的 workflow family，例如：

- inspect top N, choose M, selected to hand, rest to waiting room
- discard exact hand cards, then recover from waiting room
- self-sacrifice source member, then recover one card
- pay fixed energy, gain fixed BLADE

它应是 typed builder 或 typed config，不是任意 DSL 解释器。

## Non-Goals

- 不做完整 steps 解释器。
- 不让 runner 直接解释任意 JSON。
- 不把特殊卡强行配置化。
- 不提前处理费用期间事件消费时机。
- 不替代 runtime action、workflow module 或 activeEffect runtime。

## Relationship To Workflow Modules

Migration path:

1. 先有 runtime action。
2. 再有 workflow module。
3. workflow family 出现 3 个以上稳定样例。
4. 差异轴清楚后，评估 steps-lite typed builder。
5. 只有评估通过，才进入 `steps_promotion_queue.md` 的 `ready` 或 `promoted`。

Special card workflow 可以永远不进入 steps-lite。

## Promotion Queue

候选与状态仍记录在：

- [steps_promotion_queue.md](steps_promotion_queue.md)

本文只定义 steps-lite 的边界和非目标。
