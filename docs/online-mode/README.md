# 联机模式文档索引

> 文档类型：总览文档
> 适用范围：正式联机、玩家视角投影、自由拖拽、运行期同步和联机边界规范相关文档
> 当前状态：现行专题导航；本主题新增长期文档时应同步更新

本目录集中维护 online mode 主题文档。联机能力边界由 [准备文档](preparation.md) 和 [房间状态机与生命周期](room-exit-and-recovery.md) 维护；全项目入口仍以 [Loveca 文档地图](../README.md) 为准。

## 推荐阅读顺序

| 文档                                                                 | 类型          | 维护边界                                                                           |
| -------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| [联机模式准备文档](preparation.md)                                   | 设计文档      | 正式联机基础闭环、剩余边界、命令/事件/视图约束                                     |
| [房间状态机与生命周期](room-exit-and-recovery.md)                | 设计文档      | 准备、运行房间、终局、离房、再战与超时清理状态机                                   |
| [社区对战大厅调研](community-lobby-research.md)                      | 专题调研      | 官方产品案例、研究与 UI 规范依据；不是当前实现或效果证明                           |
| [社区对战大厅需求](community-lobby-requirements.md)                  | 需求文档      | 同池找人、公开范围、确认、恢复与玩家验收目标                                       |
| [社区对战大厅业务与 UI 设计](community-lobby-design.md)              | 设计文档      | 大厅发现、准入架构、列表投影与 UI 原型；退出和再战流程见生命周期文档 |
| [局内快捷表情需求与设计](match-emote-requirements-design.md)         | 设计文档      | 版本化运营目录、单局通信边界、共享时间流、交互与验收要求                           |
| [联机模式边界规范](boundary-standard.md)                             | 编码标准      | 联机 UI、store selector、命令、投影和公共事件边界                                  |
| [可见性与公开对象矩阵](visibility-matrix.md)                         | 设计文档      | `PlayerViewState`、对象可见性和公开对象投影规则                                    |
| [自由拖拽核对表](free-drag-checklist.md)                             | 专题说明      | 自由拖拽权限模型和最小回归 checklist                                               |
| [远程撤销恢复实施记录与剩余计划](remote-undo-requirements-design.md) | 历史/计划文档 | 已落地的服务端对墙打/正式联机撤销背景，以及尚未完成的远程调试 P5                   |
| [Transport Serde 性能说明](transport-serde-performance.md)           | 专题说明      | 正式联机 JSON-native 响应热路径、性能基准和后续增量同步边界                        |

## 维护规则

- 联机基础能力优先写入 `preparation.md`，房间状态机、退出后果与生命周期写入 `room-exit-and-recovery.md`，快捷表情目录与交互边界写入 `match-emote-requirements-design.md`，跨专题边界由主要负责的专题维护，其他专题链接引用；不要散落到根层临时计划。
- 历史对局读取当前已有中性 `/api/battle/match-records...` 路径；`/api/online/match-records...` 只作为正式联机时期的兼容 alias 保留。涉及 replay / 对墙打记录时，同步检查 [对局记录与回放文档](../match-replay/README.md)。
- 编码约束写入 `boundary-standard.md`；通用开发规范只保留跨主题规则和链接。
- 本主题文件之间使用本目录内相对链接，不再在 `docs/` 根层新增 `online-mode-*` 文档。
