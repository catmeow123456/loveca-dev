# Loveca 文档地图

> 文档类型：总览文档
> 适用范围：文档导航、总领文档职责与专题归属
> 当前状态：现行阅读与维护入口

快速了解项目能做什么，从[项目现状](current-state.md)开始；确定下一步做什么，读[项目待办](../PROJECT_PROGRESS_TODO.md)。本文负责定位资料和分配维护职责，不记录产品完成状态。

## 总领文档的职责

| 文档 | 回答的问题 | 维护内容 | 内容边界 |
| --- | --- | --- | --- |
| [根 README](../README.md) | 项目是什么，如何运行？ | 项目介绍、环境、启动命令与主入口 | 不维护能力完成清单、架构详解或任务排序 |
| [项目现状](current-state.md) | 现在能做什么，主要边界在哪里？ | 产品级能力摘要、关键限制及专题链接 | 不复制实现参数、单卡清单、完整验收矩阵或生产部署状态 |
| [总体需求](PROJECT_REQUIREMENTS.md) | 产品需要满足什么？ | 用户与角色、核心规则、跨领域产品约束及范围 | 不记录施工进度、代码字段或专题全部细则；实现尚未满足的要求仍是要求 |
| [系统设计](system-design.md) | 当前系统如何实现这些要求？ | 分层、状态机、模块职责、持久化与关键代码入口 | 不承担产品现状总表、阶段计划或完整专题设计 |
| [运行时链路](runtime-data-flow-and-algorithm-chain.md) | 命令、状态、投影和记录怎样串联？ | 横向数据流、算法链路、热路径与跨模块不变量 | 不重复系统模块全景、字段大全或单卡结算 |
| [项目待办](../PROJECT_PROGRESS_TODO.md) | 接下来推进什么，何时算完成？ | 有优先级的任务、完成条件、阻塞与待决事项 | 不维护当前基线、综合限制清单、开发原则或实验流水 |
| 本文档 | 某类事实去哪里读、在哪里改？ | 文档导航、职责分工与专题归属 | 不复述各专题的当前能力、部署结果或待办 |
| [文档编写规范](doc_writing_guide.md) | 文档如何写和维护？ | 类型、状态、引用和更新半径的通用约定 | 不另建项目状态、任务或职责表 |
| [AGENTS.md](../AGENTS.md)／[CLAUDE.md](../CLAUDE.md) | Agent 如何在仓库内工作？ | AGENTS 维护共享工作边界、任务路由与验证要求；CLAUDE 导入共享入口 | 不复制产品现状、架构或命令手册；仅工具专属配置留在各工具入口 |

总体需求给出产品目标，系统设计与专题解释实现；现状页提炼能力摘要，待办选择下一步行动。详细领域契约由对应专题维护，其余入口引用该事实。专题同时包含需求和设计时，应明确区分目标、实现和未落地方案。

更新时按内容归属选择文档：产品目标改变时更新需求；实现结构改变时更新设计；能力或关键限制改变时同步现状摘要；任务完成、优先级或阻塞改变时更新待办。局部重构、测试补充或同构卡效追加通常只更新直接受影响的源码、测试和专题。

## 规则与运行入口

- [官方规则参考](../detail_rules.md)：外部规则资料；项目产品范围由总体需求定义。
- [Web 客户端说明](../client/README.md)：客户端命令、目录与后端依赖。
- [Drizzle 数据库迁移](../drizzle/README.md)：迁移目录、基线与执行流程。

## 专题文档

按当前任务定位专题；有专题索引时，优先由索引选择所需章节，无需通读全部链接。

| 主题 | 阅读入口 |
| --- | --- |
| 对战模式目的 | [对战模式目的与边界](battle-mode-purpose-and-boundaries.md) |
| 联机模式 | [专题索引](online-mode/README.md)、[准备文档](online-mode/preparation.md)、[房间状态机与生命周期](online-mode/room-exit-and-recovery.md)、[快捷表情需求与设计](online-mode/match-emote-requirements-design.md)、[边界规范](online-mode/boundary-standard.md)、[远程撤销恢复实施记录与剩余计划](online-mode/remote-undo-requirements-design.md) |
| 社区对战大厅 | [需求](online-mode/community-lobby-requirements.md)、[业务与 UI 设计](online-mode/community-lobby-design.md)、[调研背景](online-mode/community-lobby-research.md)、[开盒战（七弹）](online-mode/bp7-sealed.md) |
| 赛季排位 | [专题索引](matchmaking-and-ladder/README.md)、[首版当前状态与上线边界](matchmaking-and-ladder/RANKED_INITIAL_IMPLEMENTATION.md)、[数据与结算设计](matchmaking-and-ladder/RANKED_R2_DATA_AND_SETTLEMENT_DESIGN.md)、[卡组分类与环境饼图](matchmaking-and-ladder/RANKED_DECK_CLASSIFIER.md)、[V4 评分设计](matchmaking-and-ladder/RANKED_V4_RATING_DESIGN.md)、[评分参数修订与全量回算](matchmaking-and-ladder/RANKED_RATING_PARAMETER_REVISION.md)、[管理员 API](matchmaking-and-ladder/RANKED_ADMIN_API.md)、[历史 V2→V3 停机迁移](matchmaking-and-ladder/RANKED_V3_ACTIVE_SEASON_MIGRATION.md)、[影子报告分析](matchmaking-and-ladder/RANKED_SHADOW_REPORT_ANALYSIS_2026-07-30.md)、[影子报告运行说明](matchmaking-and-ladder/RANKED_SHADOW_REPORT_RUNBOOK.md) |
| 轮换主题牌桌 | [策划与设计](matchmaking-and-ladder/ROTATING_THEME_TABLE_DESIGN.md) |
| 赛季活动封面 | [需求与设计](matchmaking-and-ladder/SEASON_ACTIVITY_COVER_REQUIREMENTS_AND_DESIGN.md) |
| 对局记录与回放 | [专题索引](match-replay/README.md)、[需求](match-replay/requirements.md)、[设计](match-replay/design.md)、[序列化与复水契约](match-replay/serialization-contract.md)、[紧急数据库重建 Runbook](match-replay/emergency-retention-database-rebuild-runbook.md) |
| AI 对战 | [运行与观测](ai-battle/runtime-and-observation.md)、[支持矩阵](ai-battle/support-matrix.md)、[本地自对弈](ai-battle/self-play.md)、[本地 Codex 接入](ai-battle/local-codex.md)、[完整环境验证](ai-battle/full-environment-validation.md) |
| UI 设计 | [专题索引](ui-design/README.md)、[产品视觉系统](ui-design/product-visual-system.md)、[UI 开发规范](ui-design/standard.md)、[移动端适配需求](ui-design/mobile-adaptation-requirements.md)、[游戏桌 UI 现状](ui-design/game-table/current-state.md)、[对局入口选组现状](ui-design/deck-selection-entry-current-state.md) |
| 平台运维 | [专题索引](platform-operations/README.md)、[平台状态、维护开关与公告](platform-operations/site-status-and-announcements.md) |
| 卡组管理 | [卡组管理需求](deck-management/requirements.md)、[卡组管理设计](deck-management/design.md) |
| 卡牌数据管理 | [卡牌数据管理需求](card-data-management/requirements.md)、[卡牌数据管理设计](card-data-management/design.md) |
| 运营管理中心 | [需求](admin-center/requirements.md)、[设计](admin-center/design.md)、[赛季管理员角色](admin-center/season-admin-role.md) |
| 卡牌数据规范 | [卡牌数据规范](card-data-management/data-spec.md) |
| 卡牌同步 | [专题索引](card-data-sync/README.md)、[同步需求](card-data-sync/requirements.md)、[同步设计](card-data-sync/design.md)、[CloudBase 新卡同步脚本](card-data-sync/cloudbase-new-card-sync.md)、[llocg_db 与 Loveca Excel 格式差异调查](card-data-sync/llocg-vs-xlsx-format-audit-20260626.md) |
| 卡牌效果自动化 | [卡效框架入口](card-effect-framework/README.md)、[目标架构](card-effect-framework/target_architecture.md)、[模块边界](card-effect-framework/module_boundaries.md)、[卡效实现指南](card-effect-framework/card_effect_implementation_guide.md)、[迁移路线](card-effect-framework/migration_roadmap.md)、[旧文档索引](card-effect-framework/legacy_doc_index.md)、[卡效完成状态登记册](card-effect-reuse-audit/existing_module_map.md) |
| MinIO 与图片 | [MinIO 需求与设计](minio-requirements.md)、[图片优化方案](image_optimization.md) |
| 游戏资产目录 | [需求与设计](game-assets/requirements-and-design.md) |
| 玩家桌面壁纸 | [需求与安全边界](player-wallpaper/requirements.md)、[实现设计](player-wallpaper/design.md) |
| 新手引导教程 | [需求](tutorial/requirements.md)、[两套对局模型对应关系](tutorial/match-model-correspondence.md)、[首版动画与引导层设计](tutorial/animation-design.md) |
| Excel 界面 | [实现与验收](frontend-app-architecture/excel-mode.md) |
| 二维回收动效 | [实现与验收](frontend-app-architecture/recovery-animation.md) |
| 起动水墨动效 | [实现与验收](frontend-app-architecture/ability-activation-animation.md) |
| 成员强化反馈 | [实现与验收](frontend-app-architecture/member-feedback.md) |
| 前端外层观测 | [阶段 A 观测基线](frontend-app-architecture/phase-a-observability-baseline.md) |
| 生产发布 | [生产发布 Runbook](production-release-runbook.md) |
| 对墙打模式 | [对墙打模式需求](solitaire-mode-requirements.md) |
| 成员下方堆叠 | [成员下方堆叠](special-member-stacking.md) |
| 卡牌专属演出 | [素材与实现](../client/src/components/game/card-entrance/README.md)、[发布与验收](card-entrance-production-rollout.md) |
| 歌曲专属演出 | [仆光组件契约](../client/src/components/game/song-animation/README.md)、[可操作本地预览](../client/dev/bokuhika/README.md) |

## 编码标准

| 文档                                                 | 说明                                     |
| ---------------------------------------------------- | ---------------------------------------- |
| [开发规范](coding-standard/dev-standard.md)          | 共享引擎、服务端 API、联机边界与测试规范 |
| [联机模式边界规范](online-mode/boundary-standard.md) | 联机 UI、store selector、命令和投影边界  |
| [前端 UI 开发规范](ui-design/standard.md)            | React 组件、主题 token、页面布局和覆盖层 |
| [文档编写规范](doc_writing_guide.md)                 | 文档状态、类型和维护规则                 |

## 计划与历史参考

这些文档可以解释背景或后续方向，但不应替代当前事实文档：

AI 历史实验与单局复盘由[模型验证记录](ai-battle/model-validation.md)集中导航，用于解释输入设计与策略限制，不作为当前能力或验收结论。

| 文档                                                             | 当前用途                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [卡组分享功能方案](deck-management/share-plan.md)                | 历史方案与增强项参考；当前事实以卡组需求/设计文档为准                          |
| [Android App 打包指南草稿](android-app-packaging-guide-draft.md) | Web/PWA/TWA/Capacitor 打包路线规划；PWA/TWA 前置项已开始实施                   |
| [历史迁移说明](historical-migrations.md)                         | 早期外部托管方案的历史参考                                                     |
| [对战模式边界收敛计划](archive/battle-mode-boundary-plan.md)     | 已归档的桌面能力层收敛计划；当前事实以对战模式目的文档、联机边界规范和代码为准 |
| [文档重构需求](archive/documentation-refactor-requirements.md)   | 已归档的阶段性文档重构需求；不作为当前实现事实来源                             |
| [前端外层架构重构需求与设计](frontend-app-architecture/requirements-and-design.md) | 实施中的 Router、Query、运行时拆包与缓存治理计划；当前观测事实以阶段 A 专题为准 |

## 维护与旧入口

- 新增长期文档时先确定权威归属，确需新增才登记到相应专题或本文档；已有专题入口应继续承接细分导航。
- 能力边界与完整验收要求归专题，部署差异与执行记录归 Runbook／迁移说明，任务状态归项目待办；总领文档之间用链接连接。
- 历史与计划资料必须标明用途，不能替代当前事实；过程追溯使用 Git 或明确归档的实验记录。
- [旧进度入口](../progress.md)只重定向，不再维护项目状态。开发与文档检查分别见[开发规范](coding-standard/dev-standard.md)和[文档编写规范](doc_writing_guide.md)。
