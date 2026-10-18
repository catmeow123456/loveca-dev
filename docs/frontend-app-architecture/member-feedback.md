# 成员与 LIVE 数值反馈

从 `feat/card-effect-feedback-next` 的 `c35b7970` 提取二维增益展示，接入当前共享 `GameBoard`。成员实际获得 HEART／BLADE 后，卡面出现斜向流光，对应图标与实际增量浮起后淡出；常驻加成标记继续由原投影展示。多目标并行，同一目标的混合种类、颜色与正负变化逐项保留。反馈最多 1250ms，不增加命令等待、不截获操作。

已迁移成员心／刀及来源短提示，并继续从同一旧分支提取玩家 LIVE 区心／刀、玩家级与单张 LIVE 分数、单张 LIVE 必要 HEART 变化。LIVE 心／刀使用同类流光和实际图标增量；分数／需求采用弱局部弧光及score token／“需求”数值提示。卡效活跃／待机和能量变化提示暂不接入，不引入 START 或三维舞台。二维回收、起动的 1.5 倍速流光和 1000ms 浮起时序保持原实现；本批另迁移二维落场纹理与卡面受光，见登场 README。普通起动及支付费用本身不触发强化流光，真实增益生效后才播放。

## 事件与可见性

`src/online/effect-feedback.ts` 复用权威 modifier 与有效数值查询，从已完成的状态转换生成 `EffectFeedback` 公开事件；`GameSession` 负责发布。新增事件仅携带公开来源／目标对象 ID、区域、心色和实际增量。modifier 必须在前后状态都对双方可见，单纯公开或隐藏条件不伪装成增减。重复授予保留次数，刀数及 LIVE 需求减至零时使用钳制后的实际变化；移除和持续条件变化使用较弱的 UPDATE。

事件不改变规则或权威状态，不显示在玩家公共日志和未读计数中。正式联机与本地使用同一条投影和展示路径；前端与共享/API 需一起发布，无新增数据库字段、贴图、第三方依赖或生产配置。

数值动效按 `publicBattleLog.currentPublicSeq` 消费公开事件，不能使用 `view.match.seq`：远程对局中的后者是独立的状态修订号，一次状态更新可能产生多条公开事件，两者没有大小对应关系。联机、对墙与 AI 共用该消费逻辑。远程快照同时提交玩家视图、公开事件水位及随快照附带的事件；晚到的新日志仍可播放，首次进入／重连时补回的历史日志不播放，撤销或恢复后的新事件按新的展示 epoch 消费。

## 展示与清理

`EffectFeedbackLayer` 将流光挂到真实卡牌内，继承卡牌旋转、缩放；图标数值保持屏幕直立并跟随目标。LIVE 区域反馈按当前 viewerSeat 映射到已有 self/opponent 桌面锚点；对手区域也有局部定位容器，不依赖旧版 droppable 标记。新事件立即替换同一目标的旧反馈，不跨事件累加、不排队等待；不同目标可以同时展示。

窄屏下增益图标为 22px、数字为 18px，混合刀／心与多色心结果逐项纵向居中排列，每行保留图标与实际增量，避免横向覆盖相邻成员；分数复用卡文的 `[スコア]` token；桌面保持旧版图标和数值大小。

首次进入只建立消费水位，不重播旧日志。切换对局／视角、撤销回退、公开展示 epoch 改变时重置。目标离开原区域、变为隐藏或 DOM 身份替换时立即结束。登场等待期间消费但不展示，观战和回放不播放。减少动态时仅保留约 220ms 的数值淡入淡出；最后一个反馈结束后停止逐帧采样。

## 本地验收

使用 `client/tests/recovery-review/vite.config.ts` 启动现有验收服务，打开 `/feedback.html`。页面复用真实 `GameBoard`、`GameSession` 和卡效命令，提供单体加心、群体加刀、混合增益、起动后强化、LIVE 加分、LIVE 需求减少、横置目标与视角切换。玩家级心／刀／分数另提供明确标记的区域展示样例：以权威差量构造投影，不执行或新增卡效规则；区域归属、实际增量和到期反馈由单元测试覆盖，桌面双方视角与窄屏由浏览器夹具检查。测试卡图复用现有本机缓存，不下载或修改卡牌数据。

- 单元／集成：`tests/unit/effect-feedback.test.ts`、`tests/unit/effect-feedback-presentation.test.ts`、`tests/integration/effect-feedback.test.ts`；验证实际增量、隐藏条件、混合结果、无目标／非法命令、历史去重与撤销重放。
- 浏览器：`client/tests/recovery-review/feedback.playwright.config.ts`；覆盖桌面和 390×844、横置与对手视角、减少动态、取消清理、起动 1000ms 衔接。截图位于 `output/playwright/member-feedback/`。
- 远程编号回归：`tests/unit/game-store-remote-sync.test.ts` 覆盖三种模式的原子快照更新、日志晚到、重复送达、恢复、撤销重做与旧快照；`feedback-remote.spec.ts` 使用普通 5173 App、真实卡效命令和隔离的远程传输夹具，检查三种模式的加心、加刀、LIVE 加分与需求减少，以及高修订号、重连历史与对手窄屏的减少动态。它不连接真实双客户端网络或调用 AI 服务。
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
