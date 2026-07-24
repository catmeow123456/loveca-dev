# Loveca 联机模式准备文档

> 文档类型：设计文档
> 适用范围：联机首版已落地能力、剩余边界、命令/事件/视图约束
> 当前状态：正式联机基础闭环已实现；卡效自动化第一阶段已部分接入；正式联机运行期 snapshot / command response 已走 JSON-native DTO 热路径；历史记录、timeline、authority checkpoint、public/private event 明细和玩家视角只读回放已阶段性落地；服务端可记录对墙打已具备运行态缺失后的 checkpoint 恢复；实时传输、正式联机进程重启后恢复运行中对局、完整随机/决策覆盖、确定性重演和全卡池完整自动裁判仍为后续方向
> 最后更新：2026-07-22

## 1. 文档目的

本文档用于固定联机首版的现状边界，避免设计和实现继续被多份草案拆散。

当前保留的联机文档为：

- `docs/online-mode/preparation.md`：联机模式总览与当前实现边界。
- `docs/online-mode/visibility-matrix.md`：可见性、投影、公共对象跟踪。
- `docs/online-mode/free-drag-checklist.md`：自由拖拽权限模型与最小回归测试。
- `docs/online-mode/room-exit-and-recovery.md`：返回主页、退出房间、公共牌桌配对放弃与房间恢复入口的现行语义。
- `docs/online-mode/remote-undo-requirements-design.md`：正式联机、服务端可记录对墙打撤销的历史实施记录，以及远程调试撤销的剩余计划；当前桌面场景边界以 `docs/battle-mode-purpose-and-boundaries.md` 为准。
- `docs/online-mode/transport-serde-performance.md`：正式联机 snapshot / command response 的 JSON-native transport 热路径、性能基准和后续 snapshot diff / 增量同步边界。
- `docs/match-replay/README.md`：历史记录、玩家视角 checkpoint 回放与运行态恢复专题入口。

编码约束另见：

- `docs/online-mode/boundary-standard.md`

## 2. 当前实现事实

当前代码已经具备正式双人联机的基础产品闭环：房间、卡组锁定、双方准备、开局猜拳与胜者决定先后手、服务端权威对局、轮询同步、运行期玩家视角 snapshot、房间号观战入口、同会话授权视角切换、跨重开局间等待与自动续看、离开房间、短暂恢复和管理员观测。普通玩家专用观战链接已完整移除；同一房间最多 10 个活跃普通观战会话，恢复会话、快照、公开日志和视角切换受服务端频率窗口保护。正式联机响应侧已改为 JSON-native DTO 热路径，并继续优化了服务端投影、客户端 snapshot 应用和 recorder checkpoint 写入策略；相关性能边界见 `docs/online-mode/transport-serde-performance.md`。历史记录与回放已经具备阶段性闭环：正式联机与服务端可记录对墙打会写入历史根记录、卡组快照、timeline、authority checkpoint、public/private event 明细和部分 decision record，普通玩家可以按自己的历史视角读取详情、timeline 和只读 checkpoint 桌面；服务端可记录对墙打运行态缺失时，可从最新 authority checkpoint 与公共事件尾部恢复到最近保存点。卡效自动化第一阶段已经接入普通成员登场费用、Live 判定与修正、部分触发/起动/自动能力和第一批登记卡效。剩余缺口主要集中在实时传输、正式联机进程重启后恢复运行中对局与观战会话、完整随机记录、完整决策覆盖、确定性重演、全卡池完整自动裁判和完整重放恢复语义。

相关代码路径：

- `src/application/game-session.ts`
- `src/application/game-commands.ts`
- `client/src/store/gameStore.ts`
- `client/src/components/game/GameBoard.tsx`
- `client/src/components/game/PlayerArea.tsx`
- `client/src/lib/zoneUtils.ts`
- `src/server/routes/online.ts`
- `src/server/services/online-room-service.ts`
- `src/server/services/online-match-service.ts`
- `src/online/projector.ts`
- `client/src/components/pages/OnlineRoomPage.tsx`
- `client/src/components/pages/OnlineSpectatorPage.tsx`
- `client/src/lib/apiClient.ts`
- `client/src/lib/onlineClient.ts`
- `client/src/lib/spectatorPolling.ts`

当前事实：

- `GameSession` 维护权威状态，正式联机对局由 `OnlineMatchService` 持有内存会话并通过 REST 命令入口驱动。
- 新对局拥有权威 `ManualOperationMode`，默认 `RULES`。正式联机开启 `FREE` 需对方同意，任意一方可在安全时点单方恢复 `RULES`。历史 authority checkpoint 缺少该字段时，仅在回放/对墙打恢复复水边界规范化为 `FREE`；这不是运行中命令路径的旧状态 fallback。观战和历史回放投影为只读。
- 前端正式视图使用 `PlayerViewState` 与 store selector，不应直接消费权威态。
- 命令入口已经在向语义化命令收敛；历史桌面自由移动能力只在权威 `FREE` 下作为兼容操作保留。
- `RULES` 已接入中央玩家命令白名单：普通手动区域移动、能量操作、成员换位、手工判定/改分及与当前阶段或 pending 无关的输入会被拒绝。服务端会按权威模式重写命令中的兼容标记，不信任客户端单方声明。
- 正式房间 REST 链路已经存在：创建/加入房间、锁定云端卡组、双方准备、暗选石头/剪刀/布、平局重选、猜拳胜者选择自己先手或后手、读取房间、离开房间、读取对局快照、提交命令、阶段推进。
- 当前同步方式是短间隔 HTTP 轮询，不是 WebSocket；普通玩家观战使用请求完成后再计时的串行轮询，快照与按公开水位拉取的日志增量不并发重入。短暂断线通过房间码与服务端 `presence/lastSeenAt` 恢复，长期恢复仍受内存态生命周期限制。
- 普通观战会话的恢复、快照、公开日志与视角切换共享服务端频率窗口。频率保护响应提供结构化等待时间，客户端按同一观战会话共享退避；已进入桌面的观战者保留最后一份有效桌面并自动恢复，容量达到上限导致的新会话失败仍作为入口阻断。
- 观战视角切换会暂停轮询并作废旧代际的在途同步结果；未变化的视角元数据保持会话对象引用稳定，避免轮询 effect 因等价快照反复重建。
- 房间号观战资格和客户端会话归属于不可复用的房间代际；当前 `matchId`、席位、视角版本和单局游标只是可替换绑定。管理员观战仍是单局链接，不跟随房间重开。
- 双方接受重开并成功封存旧局后，普通观战 snapshot 返回结构化 `WAITING_NEXT_MATCH`，等待会话继续计入房间上限并由同一客户端恢复。新局创建后按 preferred 玩家身份解析新席位；授权 fallback 只改变 effective 目标，preferred 重新开放时自动恢复。
- 房间销毁、等待期间参赛成员变化、会话过期或全部授权关闭会产生稳定终止原因；相同房间号重新创建不会继承旧房间代际的观战资格。等待心跳只续期观战会话，不更新参赛玩家 presence。
- snapshot 与 public-events 会校验房间代际和绑定代际。客户端进入等待即清空旧单局 store 与公共日志，只继续轮询房间级会话结果；收到新局首份完整安全投影后才建立新远程会话，旧绑定公开事件不会跨局追加。
- 运行期玩家视角 snapshot 与正式联机响应 DTO 已落地；历史记录、timeline、authority checkpoint、public/private event 明细和玩家视角只读 checkpoint 回放已阶段性落地。正式联机进程重启后的运行中对局恢复尚未落地；服务端可记录对墙打在运行态缺失时已支持从最新 authority checkpoint 与公共事件尾部恢复到最近保存点。
- 当前自动化卡效范围以 `docs/card-effect-reuse-audit/existing_module_map.md` 为准；未登记卡效仍按显式操作与审计边界处理。

## 3. 联机首版定位

联机首版不以“全卡池完整自动裁判”为目标，而是以“服务端权威 + 已登记自动化能力 + 规则模式语义化命令 + 可协商的自由模式兜底 + 可审计过程”为目标。

核心链路（当前已落地）：

`Command -> Validate -> Apply -> Project View`。具备事件语义的公共变化还应同步 `Emit Events`；第一阶段自动卡效中尚未标准化事件的步骤，暂以权威状态快照、玩家视图投影和 sealed audit 作为过渡边界。

历史记录、timeline、authority checkpoint 与玩家视角只读 checkpoint 回放已经进入当前链路；完整随机记录、完整决策覆盖、确定性重演、逐命令动画播放和正式联机进程重启后的运行中对局恢复仍属于后续增强。这不否定当前已经落地的运行期 snapshot 轮询、JSON-native 响应热路径、阶段性 replay 读模型与服务端可记录对墙打恢复。

首版必须做到：

- 服务端维护权威状态。
- 服务端校验可见性、时机、顺序、随机结果、座位权限和命令上下文。
- 客户端只把本地拖拽作为交互预览；正式事实以服务端接受的命令结果为准。
- 公共可观察变化长期需要能映射到公共事件语义；第一阶段自动卡效中尚未标准化事件的步骤必须至少保证投影、审计和测试覆盖正确，并在限制或卡效登记文档中标注过渡边界。
- 玩家视图必须来自投影，不能从权威态临时删敏生成正式 UI。

首版允许保留：

- 未登记或未接线的复杂费用链、替代支付、置换效果等不能在 `RULES` 中靠普通拖拽绕过；需要人工落实时先协商进入 `FREE`，再通过显式桌面操作处理。
- 未登记或未接线的复杂卡文条件和自动能力连锁，先以 `FREE` 中的声明、确认和审计流程为兜底。
- 普通成员登场费用、换手减费、已登记卡效费用、活跃阶段恢复和 Live 修正可以由高层命令或卡效框架处理；未纳入该链路的资源处理仍不得静默代扣或自动挑选。

## 4. 硬边界

服务端必须拒绝以下情况：

- 非当前操作者或非当前座位执行命令。
- 非法读取、移动或公开隐藏信息。
- 不符合当前阶段、子阶段、窗口的命令。
- 破坏公开区、检视区、解决区和有序隐藏区顺序真值的操作。
- 试图静默撤销已进入公共世界的事实。

系统自动处理不应做无投影、无审计、无测试的静默状态修正。普通规则自动处理应优先显式进入事件和回放语义；第一阶段自动卡效可以先以 snapshot/audit 语义落地，但如果要支持事件持久化、回放、观战增量同步或被其他自动能力监听，必须先补齐标准事件。当前优先补齐事件语义的重点包括：

- 更新。
- 胜利处理。
- 重复成员处理。
- 不正卡牌处理。
- 不正解决领域处理。
- 演出阶段开始时 Live 统一翻开及后续客观处理。
- Live 胜败判定后的客观清理和先后攻调整。

## 5. 阶段与拖拽窗口

以下历史自由拖拽能力仅在权威 `FREE` 下按阶段窗口开放；`RULES` 不因为进入这些窗口就允许普通手动区域整理，只接受当前规则流程明确开放的语义化命令：

- 主阶段：`FREE` 下双方都可以整理自己的桌面，包括成员登场/换位、能量附着、公开卡移动、抽牌/放置能量等；阶段推进仍只属于当前操作窗口。`RULES` 下普通成员登场只允许当前行动玩家走正式登场命令。
- Live 设置阶段：`FREE` 下双方可以整理自己的桌面；`RULES` 下手牌放入 Live 区只走 `SET_LIVE_CARD` 及其阶段上下文。
- 表演阶段：`FREE` 下双方可以整理自己的桌面；`RULES` 下判定、应援和成功 Live 选择只走当前子阶段的专用命令，判定结果由服务端自动计算。
- Live 结果阶段：`FREE` 下双方可以整理自己的桌面；`RULES` 下结果确认、结算确认和成功 Live 选择只走对应子阶段专用命令，分数不可手工调整。
- `FREE` 的 Live 卡桌面豁免：Live 卡从 Live 区回手/进休息室，或在 Live 区/成功区相关公开桌面目标之间移动时，不按普通阶段窗口锁死，但仍受卡种、来源、目标和检视流程上下文校验；`RULES` 不开放这类普通手动移动。
- `FREE` 的检视窗口：允许检视区内移动、排序、公开和结束检视，也允许检视拥有者把己方手牌/休息室卡牌移入当前检视区；`RULES` 只接受当前卡效/pending 明确要求的检视输入。
- `FREE` 的判定/解决窗口：`PERFORMANCE_JUDGMENT` 或结果成功效果窗口中，允许解决区卡牌按当前命令边界移动到手牌、休息室或主卡组顶；`RULES` 使用自动判定与专用成功 Live 选择命令。
- `memberBelow` 只能由已登记卡效 runtime 创建；旧 host 白名单和手动压人命令已退役。普通拖拽到已有主成员的槽位仍走登场/换手，普通移动命令不得创建堆叠；既有公开桌面拖出行为保持。

注意：前端 UI 层可能在部分非正式窗口仍允许拖起己方卡牌，但正式事实以 `GameSession` 接受命令为准。换牌阶段、活跃/能量/抽卡等自动通常阶段的普通桌面移动应被服务端拒绝。

详细拖拽回归项见 `docs/online-mode/free-drag-checklist.md`。

## 6. 可见性与公共对象

联机首版采用“局部强跟踪，进入混淆态后断跟踪”。

统一术语：

- `Authoritative State`：服务端完整权威状态。
- `Player View`：按座位投影后的安全视图。
- `publicObjectId`：一局内稳定的共享牌桌对象标识。当前实现为 `obj_${instanceId}` 的命名空间派生值；客户端不得把它当作可请求权威对象的实例 ID，也不得把其可逆性误当成隐藏信息安全边界。
- `surface`：某座位看到该对象的牌面，取值为 `NONE | BACK | FRONT`。
- `Public Event`：可安全发送给双方的公共事件。
- `Private Event`：仅发送给某一座位的私密事件。
- `Sealed Audit`：仅服务端保存的密封审计记录。

关键结论：

- 检视区、解决区、Live 放置区和公开区中的连续桌面过程，允许对象级跟踪。
- 手牌、主卡组、能量卡组等隐藏混淆区，对非持有者默认只保留张数或必要摘要。
- 已公开对象进入手牌、主卡组或能量卡组时，进入目标区这一步仍可作为公共移动被观察；之后对非持有者不再持续投影该对象。
- 对象之后重新进入公开链路时，首版可继续沿用同一个 `publicObjectId`。

详细矩阵见 `docs/online-mode/visibility-matrix.md`。

## 7. 事件输出原则

当前不再维护独立的事件分类草案和公共事件 schema 草案。首版开发只保留以下原则：

- 公共事件描述双方都能安全观察到的过程事实。
- 私密事件补充单侧可见信息。
- 密封审计保存完整候选、顺序、随机结果和选择细节。
- 事件不是世界本体；事件是权威状态变化经过可见性投影后的输出。
- 公共移动统一围绕共享牌桌对象、区域引用、数量摘要和公开牌面信息表达。
- 规则自动处理如果影响公共世界，长期应有可回放的事件语义；第一阶段自动卡效的未标准化步骤可以暂以 snapshot/audit 语义过渡，但不得被描述为已支持事件回放。

首版优先覆盖的公共事实类型：

- 阶段、子阶段、窗口变化。
- 共享牌桌对象出现、移动、重排、离场。
- 卡面公开或展示。
- 检视区对象进入、离开、重排。
- 玩家声明、确认和提交。
- 系统规则处理导致的公共变化。

## 8. 后续实施顺序

建议顺序：

1. 保持命令入口语义化，避免新增旧式万能 action 依赖。
2. 持续补齐 `PlayerViewState` 投影，确保联机 UI 不直接读权威态。
3. 为公共世界变化补齐公共事件语义。
4. 在现有运行期 snapshot / JSON-native 响应和阶段性 replay 读模型基础上，继续补完整随机记录、完整决策覆盖、手动处理原因结构化、确定性重演和正式联机进程重启后的运行中对局恢复。
5. 在持久化与恢复语义继续收口后，再把轮询替换或增强为 WebSocket/SSE 等实时传输。

WebSocket 只是传输层；当前首版已经用轮询完成产品闭环，后续重点应先保证事件、投影、快照和恢复语义可持久化。
