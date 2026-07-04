# Loveca 文档地图

> 文档类型：总览文档
> 适用范围：`docs/` 与根目录长期文档的阅读入口、分类和维护边界
> 当前状态：现行文档导航；新增长期文档时应同步更新

本文档用于说明 Loveca 文档从哪里读起、每类文档承担什么责任，以及哪些文档不应作为当前实现的权威来源。

## 主阅读路径

新维护者优先按以下顺序阅读：

1. [根目录 README](../README.md)：项目是什么、主要模块、运行与部署注意。
2. [项目总体需求](PROJECT_REQUIREMENTS.md)：产品、规则和工程目标，不展开代码实现。
3. [官方规则参考](../detail_rules.md)：综合规则中文参考资料；产品需求会提炼其中的项目范围。
4. [系统设计](system-design.md)：当前代码架构、模块职责、关键流程和代码路径。
5. [运行时数据结构与算法链路](runtime-data-flow-and-algorithm-chain.md)：权威状态、玩家视图、命令、卡效、LIVE、recorder/replay 与性能热路径之间如何串联。
6. [当前实现限制](current-limitations.md)：跨模块的已知限制、部署差异和未落地能力。
7. [开发规范](coding-standard/dev-standard.md)：共享引擎、服务端、联机边界和测试规范。
8. [文档编写规范](doc_writing_guide.md)：文档分类、状态标注和维护规则。

## 当前权威文档

这些文档描述长期项目事实，代码变化后应优先判断是否需要同步：

| 文档 | 类型 | 维护边界 |
| --- | --- | --- |
| [README](../README.md) | 总览文档 | 项目入口、模块目录、运行与部署入口 |
| [项目总体需求](PROJECT_REQUIREMENTS.md) | 需求文档 | 产品目标、规则需求和功能边界 |
| [系统设计](system-design.md) | 设计文档 | 当前架构、状态机、数据流和关键代码路径 |
| [运行时数据结构与算法链路](runtime-data-flow-and-algorithm-chain.md) | 设计文档 | 权威状态、玩家视图、命令、卡效、LIVE、recorder/replay 与性能热路径的横向链路；不维护系统全景和字段大全 |
| [当前实现限制](current-limitations.md) | 专题说明 | 跨模块限制、部署差异、已知实现偏差 |

## 规则与运行入口

| 文档 | 类型 | 说明 |
| --- | --- | --- |
| [官方规则参考](../detail_rules.md) | 专题说明 | 外部综合规则资料；项目产品范围以 `PROJECT_REQUIREMENTS.md` 为准 |
| [Web 客户端说明](../client/README.md) | 总览文档 | 客户端目录、常用命令和后端依赖 |
| [Drizzle 数据库迁移](../drizzle/README.md) | 专题说明 | 迁移目录、基线说明和数据库结构变更流程 |

## 专题文档

这些文档描述某个局部能力的当前事实或专项约束：

| 主题 | 推荐入口 | 说明 |
| --- | --- | --- |
| 对战模式目的 | [对战模式目的与边界](battle-mode-purpose-and-boundaries.md) | 本地调试、对墙打、正式联机、远程调试联机的目的、受众和能力边界 |
| 联机模式 | [专题索引](online-mode/README.md)、[准备文档](online-mode/preparation.md)、[边界规范](online-mode/boundary-standard.md)、[远程撤销恢复需求设计与实施计划](online-mode/remote-undo-requirements-design.md) | 联机首版能力、玩家视角投影、自由拖拽、运行期同步、远程撤销恢复和编码边界 |
| 对局记录与回放 | [专题索引](match-replay/README.md)、[需求](match-replay/requirements.md)、[设计](match-replay/design.md)、[序列化与复水契约](match-replay/serialization-contract.md) | 历史对局保存、玩家视角回放、卡组快照、卡效复盘、确定性重演需求和架构承接 |
| UI 设计 | [专题索引](ui-design/README.md)、[UI 规范](ui-design/standard.md)、[移动端适配需求](ui-design/mobile-adaptation-requirements.md)、[游戏桌 UI 现状](ui-design/game-table/current-state.md)、[对局入口选组现状](ui-design/deck-selection-entry-current-state.md) | 前端 UI 规范、主题重设计、移动端适配、游戏桌交互和对局入口选组设计 |
| 卡组管理 | [卡组管理需求](deck-management/requirements.md)、[卡组管理设计](deck-management/design.md) | 云端卡组、DeckLog、分享、游戏入口选组 |
| 卡牌数据管理 | [卡牌数据管理需求](card-data-management/requirements.md)、[卡牌数据管理设计](card-data-management/design.md) | 管理后台、卡牌 CRUD、发布状态和字段边界 |
| 卡牌数据规范 | [卡牌数据规范](card-data-management/data-spec.md) | `cards` 表字段、同步脚本和管理端输入约束 |
| 卡牌同步 | [专题索引](card-data-sync/README.md)、[同步需求](card-data-sync/requirements.md)、[同步设计](card-data-sync/design.md)、[CloudBase 新卡同步脚本](card-data-sync/cloudbase-new-card-sync.md)、[llocg_db 与 Loveca Excel 格式差异调查](card-data-sync/llocg-vs-xlsx-format-audit-20260626.md) | `llocg_db`、Loveca Excel 与 CloudBase 到当前 `cards` 表的同步管线、格式差异和接入边界 |
| 卡牌效果自动化 | [卡效框架入口](card-effect-framework/README.md)、[目标架构](card-effect-framework/target_architecture.md)、[模块边界](card-effect-framework/module_boundaries.md)、[卡效实现指南](card-effect-framework/card_effect_implementation_guide.md)、[迁移路线](card-effect-framework/migration_roadmap.md)、[旧文档索引](card-effect-framework/legacy_doc_index.md)、[卡效完成状态登记册](card-effect-reuse-audit/existing_module_map.md) | 卡效系统最终目标、runner 去中心化边界、新卡效实现入口、迁移计划、旧文档权威关系和已实现基础编号 |
| MinIO 与图片 | [MinIO 需求与设计](minio-requirements.md)、[图片优化方案](image_optimization.md) | 对象存储、图片上传、压缩和访问 URL |
| 生产发布 | [生产发布 Runbook](production-release-runbook.md) | 当前自托管发布步骤、部署检查、健康检查与回滚边界 |
| 对墙打模式 | [对墙打模式需求](solitaire-mode-requirements.md) | 本地调试模式与对墙打模式边界 |
| 特殊成员堆叠 | [特殊成员卡堆叠](special-member-stacking.md) | `memberBelow` 当前能力和边界 |

## 编码标准

| 文档 | 说明 |
| --- | --- |
| [开发规范](coding-standard/dev-standard.md) | 共享引擎、服务端 API、联机边界与测试规范 |
| [联机模式边界规范](online-mode/boundary-standard.md) | 联机 UI、store selector、命令和投影边界 |
| [前端 UI 开发规范](ui-design/standard.md) | React 组件、主题 token、页面布局和覆盖层 |
| [文档编写规范](doc_writing_guide.md) | 文档状态、类型和维护规则 |

## 计划与历史参考

这些文档可以解释背景或后续方向，但不应替代当前事实文档：

| 文档 | 当前用途 |
| --- | --- |
| [卡组分享功能方案](deck-management/share-plan.md) | 历史方案与增强项参考；当前事实以卡组需求/设计文档为准 |
| [Android App 打包指南草稿](android-app-packaging-guide-draft.md) | Web/PWA/TWA/Capacitor 打包路线规划；PWA/TWA 前置项已开始实施 |
| [历史迁移说明](historical-migrations.md) | 早期外部托管方案的历史参考 |
| [对战模式边界收敛计划](archive/battle-mode-boundary-plan.md) | 已归档的桌面能力层收敛计划；当前事实以对战模式目的文档、联机边界规范和代码为准 |
| [文档重构需求](archive/documentation-refactor-requirements.md) | 已归档的阶段性文档重构需求；不作为当前实现事实来源 |

## 临时记录

这些文档只用于短期状态沟通，不应被需求、设计或编码标准当作当前实现权威来源：

| 文档 | 当前用途 |
| --- | --- |
| [项目进度摘要](../progress.md) | 项目级当前状态摘要；阶段性整理后可更新或删除 |

## 维护规则

- 描述当前实现时，优先引用当前权威文档和代码路径。
- 描述计划、建议或未落地能力时，必须明确标注状态。
- 已完成的阶段任务和一次性 checklist 不进入主阅读路径。
- 新增长期文档时，应在本文档登记分类、用途和维护边界。
- 同一事实只保留一个权威描述；其他文档用链接引用，不重复展开。
- 局部代码重构、命名调整、测试补充或组件内部整理通常不要求同步修改长期文档。
