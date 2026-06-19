# 对局记录与回放文档索引

> 文档类型：总览文档
> 适用范围：历史对局记录、玩家视角回放、checkpoint、决策记录和确定性重演相关文档
> 当前状态：现行专题导航；本主题新增长期文档时应同步更新

本目录集中维护 match replay 主题文档。跨模块已知限制仍以 [当前实现限制](../current-limitations.md) 为准；全项目入口仍以 [Loveca 文档地图](../README.md) 为准。

## 推荐阅读顺序

| 文档 | 类型 | 维护边界 |
| --- | --- | --- |
| [需求](requirements.md) | 需求文档 | 用户历史对局、复盘、回放和确定性重演的产品与工程目标 |
| [设计](design.md) | 设计文档 | match record、timeline、checkpoint、decision record 和 replay capability 的架构边界 |
| [第一阶段实施计划](phase1-implementation-plan.md) | 历史/计划文档 | E0-P3 的阶段拆分、表模型、API 和测试落地顺序 |
| [Phase 2 只读 GameBoard 实施计划](phase2-gameboard-readonly-implementation-plan.md) | 历史/计划文档 | 普通历史页接入只读 GameBoard 的前端实施边界 |
| [序列化与复水契约](serialization-contract.md) | 设计文档 | checkpoint / debug bundle payload envelope、版本、hash 和复水安全边界 |

## 维护规则

- 当前事实优先写入需求、设计或序列化契约；实施计划只保留阶段拆分和背景。
- 文件之间使用本目录内相对链接，不再在 `docs/` 根层新增 `match-replay-*` 文档。
- 若变更影响联机运行时或当前限制，同步检查 [联机模式文档](../online-mode/README.md) 与 [当前实现限制](../current-limitations.md)。
