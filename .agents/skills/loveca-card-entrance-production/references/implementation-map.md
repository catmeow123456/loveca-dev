# 实现入口与复用检查

本参考用于定位代码，不是第二份运行时参数表。先读取[当前登场说明](../../../../client/src/components/game/card-entrance/README.md)，再核对下面的源码；参数和启用范围以当前实现为准。

## 从已接入样本定位

首个样本为 `PL!N-bp7-006` 费用 17「近江彼方」。人物素材来自另一张官方 SECE 卡面的取景重绘，具体来源与局限见当前登场说明。第二个样本为 `PL!SP-pb2-005` 费用 20「叶月恋」，由 PP 卡面重绘，验证了不依赖 SECE 素材也能接入同一播放流程。两张角色图都不是完整骨骼动画；素材制作顺利不代表任意姿势、遮挡都适合同一形变方案。

| 实现入口 | 后续卡牌需要检查的内容 |
| --- | --- |
| [GameBoard.tsx](../../../../client/src/components/game/GameBoard.tsx) | `CardEntranceLayer`、`canShowCardEntrance`：生产模式边界、权威等待时交互屏蔽、桌面／窄屏本机开关 |
| [CardEntranceToggle.tsx](../../../../client/src/components/game/card-entrance/CardEntranceToggle.tsx) | 共用登场开关；不要每张卡新增一个玩家开关 |
| [card-entrance.ts](../../../../src/shared/card-entrance.ts)、[权威捕获](../../../../src/application/card-entrance.ts)、[game-session.ts](../../../../src/application/game-session.ts) | 共享卡号身份、原子步骤边界捕获、双席 ACK／超时、撤销代际与结算恢复 |
| [CardEntranceLayer.tsx](../../../../client/src/components/game/card-entrance/CardEntranceLayer.tsx) | 消费 `match.entrance`、顺序播放、完成确认、等待另一席与遮挡；图片与卡名跟随当前 profile |
| [cardEntranceProfiles.ts](../../../../client/src/lib/cardEntranceProfiles.ts)、[CardEntrancePortrait.tsx](../../../../client/src/components/game/card-entrance/CardEntrancePortrait.tsx) | 全部角色的基础编号、卡名、取景、光晕与形变配置；登记内绑定按需素材，共用人物绘制 |
| [CardEntrancePlayback.tsx](../../../../client/src/components/game/card-entrance/CardEntrancePlayback.tsx)、[cardEntranceAssets.ts](../../../../client/src/lib/cardEntranceAssets.ts) | 可取消的双图解码、超时／失败释放；资源就绪后启动，迟到回调不能复活已取消演出 |
| [cardEntranceTimeline.ts](../../../../client/src/lib/cardEntranceTimeline.ts) | 共用毫秒时间线、CSS 冲击时长、推导的总时长；人物、飞牌和结束计时使用同一开始时刻 |
| [cardEntranceMesh.ts](../../../../client/src/lib/cardEntranceMesh.ts) | 基于当前素材的局部形变；新图的脸、发束和衣料分区需重新核对 |
| [cardEntranceArticulation.ts](../../../../client/src/lib/cardEntranceArticulation.ts) | 人物时钟上的手臂、身体与衣发跟随进度；可选身体独立起势与缓动，不新增播放器或计时器 |
| [CardLanding.tsx](../../../../client/src/components/game/card-entrance/CardLanding.tsx)、[cardEntranceLanding.ts](../../../../client/src/lib/cardEntranceLanding.ts) | 真实落点、横置尺寸、飞行／压落时序、邻卡深度变化、结束与取消清理 |
| [cardEntrance.css](../../../../client/src/components/game/card-entrance/cardEntrance.css) | 人物居中取景、卡名、平面圆环、减少动态；颜色与构图参数可能需要因卡调整 |
| [BattleAnimationLayer.tsx](../../../../client/src/components/game/BattleAnimationLayer.tsx)、[gameStore.ts](../../../../client/src/store/gameStore.ts) | `battleAnimationOcclusions` 与 `suppressDefaultMovement` 的共用所有权；触地或取消必须释放 |

## 后续卡牌的接入边界

目前已分开三层：`CardEntranceLayer` 消费权威演出实例，管理队列、完成确认和遮挡；`CardEntrancePortrait` 与 `cardEntranceMesh` 共用人物绘制；`CardLanding` 共用飞行、压落与震场。卡牌差异在 `cardEntranceProfiles` 的基础编号、名称、取景、窄屏高度、人物光晕和形变分区，以及同条登记的 `loadArt` 动态导入中。时间线统一定义，落地圈仍共用，不要把它们描述为已有逐卡配置。

新增同类卡牌时，在共享 `entranceCards` 补身份，并用该身份添加完整 profile（配置和 `loadArt`），接入既有权威筛选与落点查询；不要分别维护两份卡号白名单，也不要复制播放控制器。按新素材重新检查脸和手的稳定区域、发束／衣料遮罩、桌面居中与窄屏取景。恋的较小形变幅度和窄屏收边是这张素材的选择，不是后续卡牌的默认值。

如果新卡需要另一侧发束、独立部件、不同长宽比或新动作，先判断现有绘制假设是否成立，再扩展确有需要的配置或专属绘制能力；不能只替换图片后强套现有左侧发束遮罩。只有真实需求出现时，才增加逐卡时间线、落地配色、骨骼或音效等能力。

已有 `armLayers` 支持身体与完整手臂或第二人物图集。`bodyPlacement`／`independentBody` 处理双人构图，`behindBody` 控制前后绘制；`bodyMotion`／`easing` 处理动作先后与速度，`bodyBlendY` 定义躯干软过渡，`rigidBodyFollow` 保持整条手臂和道具的统一权重，`sleeveAnchor` 仅用于局部连接，`armTravelStart` 可让起始姿态靠近目标。按实际需要选用，缺省行为与坐标含义读源码；不把全部配置视为新卡必填项。形变和接触的视觉边界见[人物质量参考](portrait-quality.md)，不能只以字段名称判断其作用区域安全。

图片、卡名与参数必须跟随当前队列条目。回归混合角色连续进场、取消后下一条、旧卡罕度和来源失效，避免串素材、回调或遮挡。保留彼方已确认的参数，新增角色的调参应只影响自身。

## 验证入口

- [card-entrance-events.test.ts](../../../../tests/unit/card-entrance-events.test.ts)：基础编号、公开进场事件、去重与历史重置。
- [card-entrance-landing.test.ts](../../../../tests/unit/card-entrance-landing.test.ts)：落点几何、横置与来源生命周期。
- [card-entrance-presentation.test.ts](../../../../tests/integration/card-entrance-presentation.test.ts)：真实命令产生的公开事件与双方玩家投影。
- [battle-animation-events.test.ts](../../../../tests/unit/battle-animation-events.test.ts)：修改共用移动逻辑时的相关回归。

这些测试不证明视觉观感、WebGL 素材形变或按钮中断完全正确；对应结论需要真实浏览器证据。不要只断言参数数字或文案来代替播放、取消和最终状态验证。

仓库外独立预览应尽量导入真实人物组件及配置，避免复制一份后来失真的实现。人物预览只能验证素材、形变、取景与淡出；真实命令测试只能验证事件和公开投影。完整飞行落点、邻卡恢复、开关中断与队列衔接仍需对局浏览器验证，交付时分别说明已验证与未验证范围。

共享身份与美术登记的一一覆盖由自动测试验证，不复制卡号字符串。登记清单维护在当前登场说明中，记录基础编号、名称／费用、印刷、素材来源和开放状态；skill 不重复维护完整名单。新增登记须运行素材解析与重复身份检查，不新增独立白名单、角色枚举或播放器素材映射。

共用浏览器验收优先使用仓库外 `animation-prototypes/shared-entrance/`，读取实际登记和真实桌面；新增卡只补素材夹具，不复制控制器。隔离页需要正确解析单份 React、加载项目 theme、Tailwind 扫描源、卡背与静态资源；先排除环境缺失再判断产品回归。慢图、加载失败／超时、混合角色接续与取消都是共用检查。媒体查询替身只能证明减少动态分支，不等于操作系统偏好实测。

- [card-entrance-assets.test.ts](../../../../tests/unit/card-entrance-assets.test.ts)：全登记素材解析、冲突、加载／解码／取消／超时与时间线衔接。
- [card-entrance-articulation.test.ts](../../../../tests/unit/card-entrance-articulation.test.ts)：动作进度不反转、身体可提前、衣发收势和减少动态固定姿态；不证明素材关节或实际观感自然。

- [card-entrance-synchronization.test.ts](../../../../tests/integration/card-entrance-synchronization.test.ts)、[online-card-entrance.test.ts](../../../../tests/integration/online-card-entrance.test.ts)：真实卡效延后、两席确认／超时、排位时钟、越权与过期确认。
- [作者部署说明](../../../../docs/card-entrance-production-rollout.md)：前后端同版本发布、素材分发、生产烟测与回退边界；读该文不代表取得生产操作授权。
