# 成员与 LIVE 数值反馈

从 `feat/card-effect-feedback-next` 的 `c35b7970` 提取二维增益展示，接入当前共享 `GameBoard`。成员实际获得 HEART／BLADE 或有效费用增加后，卡面出现斜向流光，对应图标与实际增量浮起后淡出；常驻加成标记继续由原投影展示。常时 HEART／BLADE 与费用只展示正向净增量，非正变化不播放流光或减值数字；原有显式卡效的 HEART／BLADE 负值及 SCORE／REQUIREMENT 提示保持。多目标并行，同一目标的种类、颜色分别展示。反馈最多 1250ms，不增加命令等待、不截获操作。

已迁移成员心／刀及来源短提示，并继续从同一旧分支提取玩家 LIVE 区心／刀、玩家级与单张 LIVE 分数、单张 LIVE 必要 HEART 变化。LIVE 心／刀使用同类流光和实际图标增量；分数／需求采用弱局部弧光及score token／“需求”数值提示。卡效活跃／待机和能量变化提示暂不接入，不引入 START 或三维舞台。数值反馈与[二维回收](recovery-animation.md)、[起动演出](ability-activation-animation.md)各自独立，普通起动仍保持 1000ms 浮起时序；本批另迁移二维落场纹理与卡面受光，见登场 README。普通起动及支付费用本身不触发强化流光，真实增益生效后才播放。

## 事件与可见性

`src/online/effect-feedback.ts` 复用权威 modifier 与有效数值查询，从已完成的状态转换生成 `EffectFeedback` 公开事件；`GameSession` 负责发布。事件仅携带公开来源／目标对象 ID、区域、心色和实际增量。modifier 必须在前后状态都对双方可见；先排除隐藏的持久修正再收集依赖它们的常时修正，单纯公开或隐藏条件不伪装成增减。

常时及失效变化使用 `UPDATE`，比较同一舞台规则对象的前后有效值，不再拆成移除旧总量、加入新总量。槽位移动保留对象身份，首次登场、离场及重新登场不会把基础属性误报为增长。成员 `COST` 使用已有有效费用查询，包含加减值与最终设值，能量支付本身不属于费用反馈。新持久授予仍按来源与能力生成 `APPLIED`，重复授予按实际次数保留，依赖最后一项生效的修正保留权威顺序；刀数及 LIVE 需求使用钳制后的实际差值。同次权威转换若同一目标兼有常时变化和显式授予，将该目标的正向净变化并入最后一组显式反馈，防止数值被后一个提示覆盖或重复计算。净损失仍保留为 `UPDATE`；只有同一属性本来就包含显式负授予时才保留其 `APPLIED` 减值提示，常时损失不会因合并而产生动画。

事件不改变规则或权威状态，不显示在玩家公共日志和未读计数中。正式联机与本地使用同一条投影和展示路径；前端与共享/API 需一起发布，无新增数据库字段、贴图、第三方依赖或生产配置。

数值动效按 `publicBattleLog.currentPublicSeq` 消费公开事件，不能使用 `view.match.seq`：远程对局中的后者是独立的状态修订号，一次状态更新可能产生多条公开事件，两者没有大小对应关系。联机、对墙与 AI 共用该消费逻辑。远程快照同时提交玩家视图、公开事件水位及随快照附带的事件；晚到的新日志仍可播放，首次进入／重连时补回的历史日志不播放，撤销或恢复后的新事件按新的展示 epoch 消费。

## 展示与清理

`EffectFeedbackLayer` 将流光挂到真实卡牌内，继承卡牌旋转、缩放；图标数值保持屏幕直立并跟随目标。正向 `UPDATE` 的 HEART／BLADE／COST 复用现有增益流光，但不产生来源发动提示；来源提示只由具有可展示目标的 `APPLIED` 触发。LIVE 区域反馈按当前 viewerSeat 映射到已有 self/opponent 桌面锚点；对手区域也有局部定位容器，不依赖旧版 droppable 标记。新事件立即替换同一目标的旧反馈；过滤后无可展示值的后续变化仍清除该目标的旧反馈，避免快速逆转后残留正增量。不跨事件累加、不排队等待；不同目标可以同时展示。

窄屏下增益图标为 22px、数字为 18px，费用／刀／心与多色心结果逐项纵向居中排列，每行保留图标与实际增量，避免横向覆盖相邻成员；费用复用已有费用图标，分数复用卡文的 `[スコア]` token；桌面保持旧版图标和数值大小。

首次进入只建立消费水位，不重播旧日志。切换对局／视角、撤销回退、公开展示 epoch 改变时重置。目标离开原区域、变为隐藏或 DOM 身份替换时立即结束。登场等待期间消费但不展示，观战和回放不播放。减少动态时仅保留约 220ms 的数值淡入淡出；最后一个反馈结束后停止逐帧采样。

## 本地验收

使用 `client/tests/recovery-review/vite.config.ts` 启动现有验收服务，打开 `/feedback.html`。页面复用真实 `GameBoard`、`GameSession` 和卡效命令，提供单体加心、群体加刀、混合增益、起动后强化、LIVE 加分、LIVE 需求减少、横置目标与视角切换。玩家级心／刀／分数另提供明确标记的区域展示样例：以权威差量构造投影，不执行或新增卡效规则；区域归属、实际增量和到期反馈由单元测试覆盖，桌面双方视角与窄屏由浏览器夹具检查。测试卡图复用现有本机缓存，不下载或修改卡牌数据。

- 单元／集成：`tests/unit/effect-feedback.test.ts`、`tests/unit/effect-feedback-continuous.test.ts`、`tests/unit/effect-feedback-presentation.test.ts`、`tests/integration/effect-feedback.test.ts`；验证实际增量、常时条件变化与有效费用、隐藏条件、混合正负结果、生命周期、无目标／非法命令、快速逆转、历史去重与撤销重放。
- 浏览器：`client/tests/recovery-review/feedback.playwright.config.ts`；覆盖桌面和 390×844、横置与对手视角、减少动态、取消清理、起动 1000ms 衔接。截图位于 `output/playwright/member-feedback/`。
- 远程编号回归：`tests/unit/game-store-remote-sync.test.ts` 覆盖三种模式的原子快照更新、日志晚到、重复送达、恢复、撤销重做与旧快照；`feedback-remote.spec.ts` 使用普通 App（`FEEDBACK_APP_URL` 指定现有前端地址）、真实卡效命令和隔离的远程传输夹具，检查三种模式的加心、加刀、LIVE 加分与需求减少，以及高修订号、重连历史与对手窄屏的减少动态。它不连接真实双客户端网络或调用 AI 服务。
- 回归沿用起动及回收验收，以及登场同步、公开日志和玩家投影测试。真实双客户端网络与低端设备性能需在后续发布验收中确认。


本次迁移验证：13 个相关单元／集成文件共 147 项通过，覆盖反馈、落场几何、登场同步、双人接棒、米娅回流、新增高费登场与回收；`pnpm exec tsc --noEmit`、客户端类型检查、验收页类型检查及 `pnpm --dir client build` 通过。构建仍提示既有大 chunk。反馈浏览器共 20 项、落场浏览器共 6 项通过，含桌面／390×844、双方可见目标、减少动态、跳过及贴图失败回退；区域展示样例不作为真实卡效命令验收。没有进行生产或真实双客户端网络验收。

远程编号修复验证（2026-10-18）：6 个单元／集成文件共 78 项、数值反馈浏览器 34 项及以下三处类型检查通过。浏览器首次运行中，对手窄屏用例被已打开的效果面板拦住；修正测试操作为先点“隐藏”再查看对手战场后，该项单独重跑通过，未修改产品交互。相关命令：

```sh
node node_modules/vitest/vitest.mjs run tests/unit/effect-feedback.test.ts tests/unit/effect-feedback-presentation.test.ts tests/integration/effect-feedback.test.ts tests/unit/game-store-remote-sync.test.ts
node node_modules/vitest/vitest.mjs run tests/unit/remote-snapshot-order.test.ts tests/unit/public-battle-log-formatter.test.ts
node client/node_modules/@playwright/test/cli.js test --config client/tests/recovery-review/feedback.playwright.config.ts
node client/node_modules/@playwright/test/cli.js test --config client/tests/recovery-review/feedback.playwright.config.ts feedback-remote.spec.ts --grep 'opponent mobile' --output output/playwright/member-feedback/opponent-rerun
node node_modules/typescript/bin/tsc --noEmit
node client/node_modules/typescript/bin/tsc -p client/tsconfig.app.json
node client/node_modules/typescript/bin/tsc -p client/tests/recovery-review/tsconfig.json
```

常时净增与费用反馈验证（2026-10-31）：15 个单元／集成文件共 527 项通过，shared/server/client 及验收夹具类型检查、格式与 `git diff --check` 通过。复用 `localhost:5174` 普通 App 的隔离传输夹具，21 项浏览器回归全部通过；新增场景覆盖费用11「矢泽日香（矢泽妮可）」的真实规则起动、不同费用种类3→4时费用+2／BLADE+1／桃HEART+1、重复费用零变化、对手窄屏横置与减少动态，以及两张既有绘里的条件计数和快速逆转。截图位于 `output/playwright/continuous-feedback-accepted/`。本机没有该日香卡图，使用既有文字回退；绘里场景使用现有卡图，未下载或修改共享素材。没有操作账号、数据库、用户现有对局或其他工作树服务。

```sh
FEEDBACK_APP_URL='http://localhost:5174/?page=game' FEEDBACK_REVIEW_URL='http://localhost:5174' node client/node_modules/@playwright/test/cli.js test --config client/tests/recovery-review/feedback.playwright.config.ts feedback-remote.spec.ts --output output/playwright/continuous-feedback-accepted
```
