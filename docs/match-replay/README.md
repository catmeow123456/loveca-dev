# 对局记录与回放文档索引

> 文档类型：总览文档
> 适用范围：历史对局记录、玩家视角回放、checkpoint、决策记录和确定性重演相关文档
> 当前状态：现行专题导航；本主题新增长期文档时应同步更新

本目录集中维护 match replay 主题文档。跨模块已知限制仍以 [当前实现限制](../current-limitations.md) 为准；全项目入口仍以 [Loveca 文档地图](../README.md) 为准。

## 推荐阅读顺序

| 文档                                          | 类型     | 维护边界                                                                            |
| --------------------------------------------- | -------- | ----------------------------------------------------------------------------------- |
| [需求](requirements.md)                       | 需求文档 | 用户历史对局、复盘、回放和确定性重演的产品与工程目标                                |
| [设计](design.md)                             | 设计文档 | match record、timeline、checkpoint、decision record 和 replay capability 的架构边界 |
| [序列化与复水契约](serialization-contract.md) | 实现契约 | checkpoint / debug bundle payload envelope、版本、hash 和复水安全边界               |

## 当前实施边界

- 正式联机与服务端可记录对墙打已经写入历史根记录、参与者、卡组快照、timeline、authority checkpoint、public/private event 和部分 decision record。
- 普通玩家历史读取只返回对应玩家视角的 checkpoint 投影；回放桌面复用共享 `GameBoard` / `PlayerArea`，但不允许提交命令或读取权威状态。
- 对墙打运行态缺失时可以从最近 authority checkpoint 恢复；正式联机进程重启后恢复进行中对局尚未闭环。
- 完整随机记录、完整决策覆盖、自由拖拽/手动处理原因结构化、确定性重演和公开分享回放仍是后续能力。
- 已完成阶段的逐步施工记录已从现行文档集移除；需要追溯时使用 Git 历史，不再维护平行的实施流水账。

## 维护规则

- 产品边界写入需求，当前架构和实施状态写入设计，序列化安全边界写入序列化契约。
- 不再为已完成阶段保留或新增实施流水账；只有仍会约束后续开发的迁移、兼容或运行手册可以单独保留。
- 文件之间使用本目录内相对链接，不再在 `docs/` 根层新增 `match-replay-*` 文档。
- 若变更影响联机运行时或当前限制，同步检查 [联机模式文档](../online-mode/README.md) 与 [当前实现限制](../current-limitations.md)。
