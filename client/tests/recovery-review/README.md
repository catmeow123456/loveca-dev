# 二维休息室回收验收

同一环境的 `/activation.html` 提供[起动边缘特效对比](../../../docs/frontend-app-architecture/ability-activation-animation.md)，使用原生卡牌起动按钮。顶部“边缘特效”默认使用七彩流光，可切换沿边流光 1.5 倍速、沿边流光原速与墨染，切换后自动重新准备；也可使用 `?edge=rainbow` / `?edge=flow` / `?edge=flow-original` / `?edge=ink` 直接进入对应版本。浮起动作和 1 秒时长完全一致。支持舞台、手牌和休息室三种来源，额外只读卡图为 `PL!HS-bp6-014-R.png`、`PL!N-bp1-002-P.png`；浏览器配置为 `activation.playwright.config.ts`。

此本地入口挂载项目原有 `GameBoard`，使用真实 `GameSession` / card-effect 命令、投影、公开展示和撤销。只有初始局面由测试夹具准备，没有独立对战 UI、生产 API 或账号卡组写入。动画接入说明见[二维休息室回收动画](../../../docs/frontend-app-architecture/recovery-animation.md)。

从仓库根目录启动（Node.js 22.13+，使用现有依赖）：

```sh
node client/node_modules/vite/bin/vite.js --config client/tests/recovery-review/vite.config.ts
```

打开 `http://127.0.0.1:5186/`。默认读取已有 `../references/llocg_db/img/cards_cn` 内白名单卡图，也可用 `RECOVERY_REVIEW_ART_DIR=/已有卡图目录` 指定路径；只读、不下载或初始化子模块。所需文件为 `PL!N-bp5-014-N.png`、`PL!N-SD01-028.png`、`PL!HS-pb1-020-N.png`、`PL!HS-sd1-012-SD.png`、`PL!HS-bp2-022-L.png`，牌背使用本仓库已有资源。卡牌夹具仅保留验收所需字段，不作为卡库数据源。

## 复现

1. 默认场景为 `PL!N-bp5-014-N` 费用 4「中须霞」，休息室目标为 `PL!N-sd1-028-SD` 分数 4「Dream with You」。点“下一步”发动，再点“下一步”支付能量并弃牌；原生选牌窗口出现后，点目标卡，等原有公开展示结束，即播放回收。也可以全部使用桌面原生能力与选牌控件；“下一步”仅方便调用当前真实命令。
2. 回收完成后点顶部“撤销上一步”，再点“下一步”。同一目标应再次弹起、悬停和飞回。也可在悬停期间撤销，确认没有旧飞牌、提前显露的真手牌或残留隐藏。
3. 下拉选择“百生吟子 · 双张回收”：`PL!HS-pb1-020-N` 费用 9「百生吟子」的真实登场卡效已在初始局面进入待处理；依次支付两张弃牌并选择回收。目标为 `PL!HS-sd1-012-SD` 费用 4「百生吟子」与 `PL!HS-bp2-022-L` 分数 2「AOKUHARUKA」，两张均应收尾。
4. “无目标”场景支付费用后应结束，不播放回收；选牌时点“尝试非法选择”应拒绝，保持原局面。飞行中调整窗口大小、切换视角、重新准备新对局，均不得残留飞牌或遮挡。系统减少动态开启时只保留短提示。

预期节奏：从休息室展开 160ms → 原弃牌展示位置停留 720ms → 收入手牌 300ms，共 1180ms，按弃牌动画反向采样。复用弃牌卡牌样式和多张扇形排列，不显示数量提示，也不再使用蓄光／光束／拖尾。最终大小、位置、扇形角度应连续接上真实手牌；同批多张同步展开。

## 自动验证

先启动上述本地服务器，再运行：

```sh
node node_modules/vitest/vitest.mjs run tests/unit/recovery-card-motion.test.ts tests/integration/recovery-animation.test.ts tests/unit/battle-animation-events.test.ts tests/unit/discard-presentation-batch-ui.test.ts tests/unit/public-discard-reveal-queue.test.ts tests/integration/activated-pay-two-energy-discard-recover-group-live.test.ts tests/integration/grouped-recovery.test.ts
node client/node_modules/@playwright/test/cli.js test --config client/tests/recovery-review/playwright.config.ts
node client/node_modules/typescript/bin/tsc -b client
node client/node_modules/typescript/bin/tsc -p client/tests/recovery-review/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit
```

浏览器使用临时隔离上下文，验收截图和失败 trace 写入 `output/playwright/recovery-2d/`。不使用当前 Chrome 的生产管理员会话。

## 成员强化反馈

打开同一服务的 `/feedback.html`，可验收单体加心、群体加刀、混合增益和起动后强化；支持横置目标、重新准备、撤销与双方视角。点击“演示一次”通过真实卡效命令逐步执行；验收起动浮起请在“自身待机费用 → 获得 HEART”场景直接点击源卡的起动按钮。测试使用 `feedback.playwright.config.ts`。

同一配置还运行 `feedback-remote.spec.ts`，需要 5173 普通前端服务（可通过 `FEEDBACK_APP_URL` 指定）。测试在普通 App 中使用真实卡效命令生成事件，通过模拟远程传输接入实际快照／公开日志读取流程，覆盖联机、对墙和 AI 的四类数值反馈、日志晚到、两种编号大小关系、重连历史和对手窄屏减少动态。初始化与 API 响应均隔离，不读取账号、不连接真实对局或 AI 模型；这组检查不替代真实网络验收。

## 声援心汇入验收

`/cheer.html` 复用共享 `GameBoard` / `JudgmentPanel`，通过真实声援命令播放。支持三张、二十张和“两张 LIVE 整组判定”，默认速度为原来的一半；可以切回原速度或原有效果对比，中途重新准备。

动画已接入 5173 普通对局的自动声援与手动追加声援。规则状态立即结算，展示层在面板首帧准备好牌背和起始心数，随面板滑入后启动统一时钟。当前实际时间：单牌翻转 400ms，转到正面（200ms）即浮出光棒心，再飞行 640ms 汇入数字；牌间最多错开 76ms，整个错峰窗口最多 1120ms，三张翻牌／汇入约 1.15 秒、二十张约 2.12 秒（不含面板滑入与成功提示的淡出）。牌列连续向左移动，使最新翻开的牌保持在可见区，结束停在最后一张；飞出的心在离开卡牌时固定出发点，不跟随牌列滑走。

展示心数首次满足整组 LIVE 的合并需求时，LIVE 需求区出现金色扫光及“LIVE成功”，约 1.15 秒自然消退；画面只保留标题，不代替玩家确认、不推进规则。判断复用正式预判的颜色分配规则；初始成员心已足够时，在第一张翻开时提示一次；需求不完整、尚未满足或已经成功后的追加牌不重复提示。双方普通玩家共用相同的公开投影展示逻辑。

追加只播新增牌，回顶重翻可重播。关闭／重置／切换查看玩家／手动滚动／缩放会清理动画，恢复真实界面；自动跟随不会触发误取消。减少动态直接呈现牌和心数，只保留静态成功提示。颜色使用替换效果处理后的判心，不读取隐藏牌。

浏览器检查使用 `cheer.playwright.config.ts`，覆盖桌面与 390×844、重播、中断、原有效果、减少动态、实际 5173 自动声援／追加／回顶重翻、二十张首帧遮罩／同步计数／最新牌可见／颜色替换，以及双方视角下多张 LIVE 的整组成功阈值。测试使用隔离浏览器和临时离线局面，不使用已有账号，不保存卡组或修改生产数据；截图写入 `output/playwright/cheer-preview/`。普通入口检查需要同时保留 5173 与 5186 服务。

## LIVE 数值与二维落场迁移验收

- `/feedback.html`：成员反馈及真实卡效的 LIVE 加分、需求减少；不启用方向或能量文字提示。
- `/landing.html`：真实普通登场／米娅特殊登场，场上预置横置邻卡、横置 LIVE 与匿名背面。落场绘制使用产品 `CardLanding`，不另造展示实现。
- 验收矩阵：桌面1600×900及窄屏390×844查看数值、落点、纹理和受光；命令结算后校验实际反馈目标及残留清理；对手视角、隐藏 LIVE、减少动态、冲击中跳过、纹理失败验证边界。数值区域级差量由单元测试覆盖，浏览器通过明确标记的展示夹具检查双方桌面与窄屏的实际落点。该样例只更新测试页投影，不执行或新增玩家级增益规则。
- 浏览器脚本：`pnpm --dir client exec playwright test --config tests/recovery-review/feedback.playwright.config.ts`、`pnpm --dir client exec playwright test --config tests/recovery-review/landing.playwright.config.ts`。截图保存在 `output/playwright/member-feedback/` 与 `output/playwright/landing-migration/`。
