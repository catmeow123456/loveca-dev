# Loveca 项目待办

> 文档类型：总览文档
> 适用范围：已确定要推进的任务、完成条件、待决事项与条件任务
> 当前状态：现行任务入口；不承担项目能力或实现基线说明
> 更新时间：2026-10-26

项目能力见[项目现状](docs/current-state.md)，资料定位与文档职责见[文档地图](docs/README.md#总领文档的职责)。以下任务按优先级排列，均为待推进；完成后移除，历史通过 Git 追溯。具体实现与完整验收要求引用专题，不在此复制。

## 当前任务

| 优先级 | 任务 | 完成条件与依据 |
| --- | --- | --- |
| P1 | 普通登场支持选择支付能量 | 普通 `PLAY_MEMBER_TO_SLOT` 不再只能取前 N 张活跃能量；选择、费用重验与支付收口到公共权威路径，覆盖特殊能量及过期选择。入口：`src/application/game-session.ts`。 |
| P1 | 补齐手机基础对局操作并完成验收 | 补可发现的成员自由横置入口，核对资源整理路径；触屏可完成从换牌到成功 LIVE 结算的基础流程，规则权限与只读视角不放宽。按[移动端差距](docs/ui-design/mobile-adaptation-gap-analysis.md)记录仍未通过的具体问题。 |
| P2 | 移除卡组类型的前缀猜测 | 先确定存量盘点与停机转换方案；类型缺失且无法解析时明确拒绝，不再猜为 MEMBER／LIVE；保存、导入与选组正常。当前偏差见[卡组设计](docs/deck-management/design.md#3-数据模型)。 |
| P2 | 核对并修正 AI 决定观察的两项状态提示 | 复现批量 LIVE 命令摘要及结束后观察提示；以权威执行结果和会话状态确认问题，修复仍存在的偏差，已消失的问题关闭记录。依据：[本地 Codex 已知问题](docs/ai-battle/local-codex.md#常见接入问题)。 |
| P2 | 复测并降低大厅加载对局运行时的成本 | 沿用[观测基线](docs/frontend-app-architecture/phase-a-observability-baseline.md)记录当前构建与导航开销，按实际瓶颈拆包；用同口径前后结果验证收益，保留共享对局路径。具体设计见[外层架构计划](docs/frontend-app-architecture/requirements-and-design.md#8-对局运行时拆包)。 |
| P2 | 完成四章教程的人工通关验收 | 完成同局三回合流程，并验证检查点、回看、点选／拖放、键盘、隐藏信息和引导层避让；有问题落为具体修复，通过后关闭本项。依据：[教程需求](docs/tutorial/requirements.md)。 |

## 待决事项与条件任务

这里记录需要先确定范围或启用计划的事项；触发条件成立后再形成具体任务，不表示现在启动实现或生产操作。

| 事项 | 先确定什么 | 后续依据 |
| --- | --- | --- |
| 旧精确卡号定义与下一批卡效 | 从登记册确定影响真实构筑的卡号、效果段与罕度范围，并明确所用导出；按批次修复，不把全卡池或整套 matcher 改造当作一个任务。 | [主登记册](docs/card-effect-reuse-audit/existing_module_map.md)、[卡效框架](docs/card-effect-framework/README.md) |
| 旧密码包装格式收束 | 明确凭据停机转换与账号恢复方案后，再替换登录时升级的读取路径；当前偏差不构成新增运行时兼容的依据。 | [认证现状](docs/system-design.md#8-服务端与数据设计)、[迁移边界](drizzle/migration-notes/auth-v1-to-v2-credential-cutover.md) |
| 大厅、排位增量与维护快照发布 | 确定发布范围和窗口，再核对目标版本、已执行迁移与剩余验收；旧记录中的“待部署”不能直接当作当前生产事实。 | [发布 Runbook](docs/production-release-runbook.md)、[大厅切换](drizzle/migration-notes/community-lobby.md)、[标准／娱乐迁移](drizzle/migration-notes/casual-rule-modes.md) |
| 向真实账号委派赛季管理员 | 确有委派计划时，先补齐角色专题规定的写审计、破坏性操作原因和权限验收；完成前不委派。 | [角色上线条件](docs/admin-center/season-admin-role.md#上线前必须完成的门槛) |
| 主题牌桌开放 | 先确定首期预组和真实试打范围，再按专题完成恢复、指标与双端验收。 | [主题牌桌设计](docs/matchmaking-and-ladder/ROTATING_THEME_TABLE_DESIGN.md) |
| 壁纸、封面与徽章开放 | 先确定本次启用的资源能力，再完成对应存储、清理、迁移与验收；封面孤立对象扫描仍是需实现的前置。 | [壁纸设计](docs/player-wallpaper/design.md)、[封面设计](docs/matchmaking-and-ladder/SEASON_ACTIVITY_COVER_REQUIREMENTS_AND_DESIGN.md)、[徽章迁移](drizzle/migration-notes/activity-badges.md) |

正式联机跨进程恢复、完整确定性重演、实时传输增强、自动运维调度等长期方向由对应专题维护；有明确使用需求、范围与完成条件后再进入本表。全卡池目标与工程约束也不作为可勾选任务重复维护。
