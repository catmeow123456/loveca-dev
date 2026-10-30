# Loveca 项目现状

> 文档类型：总览文档
> 适用范围：快速了解当前项目能力、主要限制与专题阅读入口
> 当前状态：仓库开发基线速览；实现与验收细节以所链接的专题为准
> 更新时间：2026-10-30

Loveca 已具备共享规则引擎、Web 对战桌、卡组管理、联机与观战、历史回放、赛季玩法和管理员 AI 调试。核心对局流程可以通过规则命令推进，卡效仍按卡池和真实构筑分批补齐。

本文中的“已具备”描述仓库能力，不代表目标环境已经部署或完成生产验收。仓库版本见 [VERSION](../VERSION)，部署流程见[部署 Runbook](production-release-runbook.md)，目标环境实际版本须核对该次部署记录；接下来推进的工作见[项目待办](../PROJECT_PROGRESS_TODO.md)。

## 能力与关键边界

| 领域 | 当前能力与边界 | 详细说明 |
| --- | --- | --- |
| 规则与卡效 | 登场、换手、费用、LIVE、声援、判定和卡效队列已接入共享规则链路；全卡池自动裁判尚未完成，单卡完成状态由主登记册维护。 | [运行时链路](runtime-data-flow-and-algorithm-chain.md)、[卡效登记册](card-effect-reuse-audit/existing_module_map.md) |
| 练习与调试 | 对墙打自动处理系统对手流程，双人调试可在同一设备操作双方；服务端对墙打可记录历史，本地离线对局不写正式历史。 | [模式说明](battle-mode-purpose-and-boundaries.md)、[对墙打需求](solitaire-mode-requirements.md) |
| 社区大厅与联机 | 标准／娱乐休闲房间、锁组确认、猜拳、认输、请求式撤销、赛后再战与逐人授权观战已有开发基线；娱乐自由构筑放开总 PT，另有七弹开盒战：半副灰心规则、冻结牌池与草稿恢复、双方同意再战；新增每盒 1/60 的模拟宝藏包及组牌统计（费用、判定、Live）。持久准备记录不等于进行中对局可跨进程恢复。 | [大厅设计](online-mode/community-lobby-design.md)、[开盒战](online-mode/bp7-sealed.md)、[房间生命周期](online-mode/room-exit-and-recovery.md) |
| 赛季排位 | 赛季、候场、评分结算、更正、重建、卡组分类与环境统计已实现；新赛季默认 V4，评分与运营增量仍需按专题完成相应验收。 | [排位专题](matchmaking-and-ladder/README.md)、[当前实现边界](matchmaking-and-ladder/RANKED_INITIAL_IMPLEMENTATION.md) |
| 主题牌桌 | 已接入独立候场、服务端预组候选选择与组合分配；仍处于开发／内测基线，真实组合试打、恢复和运营验收未闭环。 | [主题牌桌设计](matchmaking-and-ladder/ROTATING_THEME_TABLE_DESIGN.md) |
| 历史与回放 | 正式联机和服务端对墙打可按授权玩家视角查看历史节点；回放有保留期，清理后保留元信息。完整随机／决策记录、确定性重演和逐命令动画仍属后续方向。 | [回放专题](match-replay/README.md) |
| AI 对战 | 支持管理员真人对 AI、网页双 AI 观战和本地 CLI 自对弈，提供决定材料、计费与归档；规则窗口覆盖及策略强度有独立边界，不能由少量试打推定整局质量。 | [支持矩阵](ai-battle/support-matrix.md)、[运行与观测](ai-battle/runtime-and-observation.md)、[自对弈](ai-battle/self-play.md) |
| 界面与移动端 | 非对局页面已进入共享视觉系统，手机牌桌已有响应式布局和登场、盖牌等点击路径；13 费赛拉丝已接入全罕度人物登场、沿用原选牌与公开结算的专属检视，以及仅对拥有起动能力且实际受禁止的成员显示的卡面交叉锁链。9费泉已接入全罕度起动柔光返场，衔接目标既有登场及原卡效；己方赛拉丝在场时显示常时保护的白花护符，随真实条件解除，不增加操作等待。当前柔光返场与白玫瑰版本已获用户确认。成员自由横置等触控入口、资源整理和完整手机流程仍有缺口。 | [视觉系统](ui-design/product-visual-system.md)、[游戏桌现状](ui-design/game-table/current-state.md)、[赛拉丝专属外观](../client/src/components/game/seras-inspection/README.md)、[泉返场](../client/src/components/game/card-entrance/izumi-replay/README.md)、[移动端差距](ui-design/mobile-adaptation-gap-analysis.md) |
| 新手教程 | 四章教程已使用真实规则、私密场景和共享牌桌，支持检查点、退出与重开；人工通关及多视口体验仍待验收。 | [教程需求](tutorial/requirements.md) |
| 账号与卡组 | 已实现账号与个人资料、云端／浏览器本地卡组、编辑、分享复制及导入；账号数据、离线存储和对局冻结快照各有明确边界。 | [系统设计](system-design.md#8-服务端与数据设计)、[卡组设计](deck-management/design.md) |
| 运营与资源 | 维护状态、运营管理、候场曲库、壁纸、活动封面与徽章已有实现；赛季管理员委派和资源功能开放仍受各专题前置条件约束。 | [平台运维](platform-operations/README.md)、[赛季管理员](admin-center/season-admin-role.md)、[壁纸设计](player-wallpaper/design.md)、[活动封面](matchmaking-and-ladder/SEASON_ACTIVITY_COVER_REQUIREMENTS_AND_DESIGN.md) |

## 继续阅读

- 想了解产品目标与稳定规则，读[总体需求](PROJECT_REQUIREMENTS.md)。
- 想了解模块、代码入口及数据流，读[系统设计](system-design.md)和[运行时链路](runtime-data-flow-and-algorithm-chain.md)。
- 想确定下一步，读[项目待办](../PROJECT_PROGRESS_TODO.md)；查其他专题与文档归属，读[文档地图](README.md#总领文档的职责)。

本页只随产品能力或关键边界变化同步摘要。具体规则、参数、验收与部署事实以各行所链接的专题为准。
