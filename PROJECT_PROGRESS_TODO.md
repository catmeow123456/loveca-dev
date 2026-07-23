# Loveca 当前进度及待办

更新时间：2026-07-24

> 本文件只保留当前基线、仍有效的缺口和下一步。已经完成的逐窗口施工记录不再重复保存；需要追溯时使用 Git 历史。卡效完成状态以主登记册为准，发布与迁移历史以对应 runbook 和 migration notes 为准。

## 当前基线

### 规则与对局

- `GameSession` / `GameService` 继续作为权威状态和命令处理边界；玩家输入统一通过语义化 `GameCommand` 和中央命令政策校验。
- 新对局默认使用权威 `ManualOperationMode=RULES`。本地调试、对墙打和远程调试可在安全时点直接切换；正式联机开启 `FREE` 需要双方协商，观战与回放始终只读。
- 普通登场、换手、费用支付、LIVE 设置、判定、成功 LIVE 选择、卡效 pending/activeEffect 和主要阶段流已经进入共享规则链路。
- 全卡池完整自动裁判尚未完成；未自动化能力不能依靠 UI 或具体卡牌特例绕过规则边界。

### 卡效框架

- 具体卡效定义集中在 `src/application/card-effects/definitions/index.ts`；单卡与 shared family 分别位于 `workflows/cards/` 和 `workflows/shared/`。
- `card-effect-runner.ts` 的完整卡效 fallback 已清空，只保留调度、生命周期、registry 和尚未迁出的 matcher/relay/trigger 条件胶水。
- 当前已登记的 implemented definition 和基础编号均可在 `docs/card-effect-reuse-audit/existing_module_map.md` 检索；该文件是卡效完成状态的唯一主登记册。
- 新卡效继续优先复用现有费用、检视、区域选择、成员状态、能量、抽弃、声援和 LIVE modifier 底座，不建立大型 resolver DSL。

### 联机、观战与回放

- 正式联机已具备房间号双人房间、云端卡组锁定、双方准备、暗选猜拳、胜者决定先后手、服务端权威命令、轮询同步、请求式撤销/重开和短暂断线恢复。
- 房间号观战使用授权玩家视角，支持同会话切换、跨重开等待和最多 10 个普通观战会话；观战不提供命令、上帝视角或对手隐藏信息。
- 正式联机与服务端可记录对墙打已经写入历史根记录、参与者、卡组快照、timeline、authority checkpoint、public/private event 和部分 decision record。
- 普通历史读取使用 `/api/battle/match-records...`，只返回对应玩家视角的只读 checkpoint 投影；旧 `/api/online/match-records...` 仅保留为已公开协议的临时 alias。
- 对墙打运行态缺失时可以从最近 authority checkpoint 恢复；正式联机进程重启后恢复进行中对局尚未闭环。

### 前端与数据

- 本地调试、对墙打、正式联机、远程调试、观战和历史回放继续复用共享 `GameBoard` / `PlayerArea`。
- 桌面和移动端已完成主要布局、能量牌架、撤销入口、休息室统计、弹层层级、reduced-motion 和异步竞态收口。
- 卡牌数据已区分 `GRAY` 无色 Heart 与 `RAINBOW` All Heart；`double` 展开为两个独立 `GRAY` 判心项。
- 新云端卡组默认包含 12 张 `LL-E-001-SD` 能量卡，并支持复制为新版本、分享管理与 DeckLog/YAML 导入。
- 当前版本为 `3.8.0`。发布、镜像、数据库迁移和卡牌同步仍按 release skill、runbook 与 migration notes 执行，不能从本文件的旧窗口描述推断生产状态。

## 当前事实来源

| 主题               | 权威来源                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 项目范围与产品能力 | `docs/PROJECT_REQUIREMENTS.md`、`docs/system-design.md`                                                           |
| 对战模式与只读边界 | `docs/battle-mode-purpose-and-boundaries.md`                                                                      |
| 联机现状与限制     | `docs/online-mode/preparation.md`、`docs/current-limitations.md`                                                  |
| 对局记录与回放     | `docs/match-replay/requirements.md`、`docs/match-replay/design.md`、`docs/match-replay/serialization-contract.md` |
| 卡效完成状态       | `docs/card-effect-reuse-audit/existing_module_map.md`                                                             |
| 卡效开发规范       | `AGENTS.md`、`docs/card-effect-framework/`、`docs/card-effect-reuse-audit/`                                       |
| 版本与发布         | `VERSION`、package 版本、release runbook、`drizzle/migration-notes/`                                              |
| 历史施工过程       | Git 提交历史                                                                                                      |

## 仍有效的主要缺口

1. 全卡池完整自动裁判、完整 trigger matcher 接线和更广泛的事件语义仍需按真实卡效分批推进。
2. 正式联机运行态持久恢复、完整随机记录、完整 decision record、自由拖拽/手动处理原因结构化和确定性重演尚未闭环。
3. 自动匹配队列、排位体系和 AI 对战基础设施尚未实现；相关产品边界和规则自动化前置条件仍需确认。
4. 前端仍有大 chunk 告警，后续需要继续拆分由全局 store 拉入的 battle runtime。
5. 发布、镜像推送、生产迁移、卡牌数据正式同步和对象存储写入均是独立高风险动作，必须按对应流程取得授权。

## 下一步优先级

1. 若继续 AI 对战方向，先确认产品边界；在设计前优先确认专属卡组的 `RULES` 完整自动化范围、机器可消费的具体合法动作集合和 AI 玩家视角约束。
2. 卡效开发继续以主登记册选择能推进真实事件边界、when-if、selector、公开/检视 workflow 或 LIVE modifier 的样例；每张卡实时更新登记册和 focused tests。
3. 继续缩小 runner 胶水和重复 workflow，但只在出现第二个真实样例时晋升 shared family，不建立任意步骤解释器。
4. 继续完善 LIVE 自动判定、效果顺序、撤销、每回合限制和跨回合事件边界测试。
5. 回放方向只维护当前需求、设计和序列化契约；已完成阶段不再新增实施流水账。
