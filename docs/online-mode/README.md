# 联机模式文档索引

> 文档类型：总览文档
> 适用范围：正式联机、玩家视角投影、自由拖拽、运行期同步和联机边界规范相关文档
> 当前状态：现行专题导航；本主题新增长期文档时应同步更新

本目录集中维护 online mode 主题文档。跨模块已知限制仍以 [当前实现限制](../current-limitations.md) 为准；全项目入口仍以 [Loveca 文档地图](../README.md) 为准。

## 推荐阅读顺序

| 文档 | 类型 | 维护边界 |
| --- | --- | --- |
| [联机模式准备文档](preparation.md) | 设计文档 | 正式联机基础闭环、剩余边界、命令/事件/视图约束 |
| [联机模式边界规范](boundary-standard.md) | 编码标准 | 联机 UI、store selector、命令、投影和公共事件边界 |
| [可见性与公开对象矩阵](visibility-matrix.md) | 专题说明 | `PlayerViewState`、对象可见性和公开对象投影规则 |
| [自由拖拽核对表](free-drag-checklist.md) | 专题说明 | 自由拖拽权限模型和最小回归 checklist |
| [Transport Serde 性能说明](transport-serde-performance.md) | 专题说明 | 正式联机 JSON-native 响应热路径、性能基准和后续增量同步边界 |

## 维护规则

- 联机当前事实优先写入 `preparation.md` 或 `current-limitations.md`，不要散落到根层临时计划。
- 历史对局读取当前已有中性 `/api/battle/match-records...` 路径；`/api/online/match-records...` 只作为正式联机时期的兼容 alias 保留。涉及 replay / 对墙打记录时，同步检查 [对局记录与回放文档](../match-replay/README.md)。
- 编码约束写入 `boundary-standard.md`；通用开发规范只保留跨主题规则和链接。
- 本主题文件之间使用本目录内相对链接，不再在 `docs/` 根层新增 `online-mode-*` 文档。
