# Snow halation 可操作测试局

> 文档类型：专题说明
> 当前状态：独立内存对局；使用共用正式动画接入，不连接账号或后端

从仓库根目录启动：

```sh
pnpm --dir client exec vite --config dev/snow-halation/vite.config.mjs
```

打开 `http://127.0.0.1:5191/`。仅监听回环地址，端口冲突直接失败，不自动换端口或关闭其他服务。屏蔽 `/api/` 请求，不依赖数据库或子模块初始化。正常客户端的声援点亮接入位于共用 GameBoard/JudgmentPanel，正式绘制没有对本预览图片中间件的依赖。

## 操作

1. 双方依次点击「Live Start!」，将手牌歌曲拖入己方 LIVE 区，双方确认放置。
2. 按原面板发动 LIVE 开始效果，可用「顺序发动」；再确认完成，自动声援。符合条件的牌在翻开、跳心时点亮。
3. 接受自动判定，再按原确认面板「继续处理」。满足条件时正常加分并继续流程，不播放成功专属演出。

这是实际 `GameBoard`、`GameSession`、命令和玩家投影，可拖牌、发动、推进阶段和切换双方视角。初始舞台与牌序为确定性验证夹具，不是构筑合法性示范。手牌另留一张费用4成员，可自行进行主阶段操作；修改阵容会按真实规则改变声援与判定结果。

默认场景为六张授予、LIVE成功，歌曲最终7分。「测试选项」可重置为五张不加分、五张授予加一张原生橙、两张歌曲顺序发动、LIVE失败、授予后改成紫色。后两个场景通过初始既有modifier构造，不改印刷卡文；失败时歌曲按规则进入休息室。多歌曲场景需将两张歌曲都放入LIVE区，再在成功效果选择「顺序发动」，最终合计14分。

重置只替换当前内存测试局，可重新进行真实声援以反复观察点亮。减少动态可从测试选项或系统设置启用，动画开关沿用原对战设置。完整橙海试作仅保留在备份分支 `backup/snow-halation-effect-prototype-20261110`；当前入口没有橙海重播或定格按钮。

## 素材与证据

`cards.json` 是任务指定 `cards_export_2026-11-07.json` 中六张公开卡的精简快照，包含规则、身份与公开卡面字段，不替代正式数据源。五张SD卡图沿用仓库 `dev/bokuhika/images/` 的已有样本。歌曲原图为[公开日文SECL卡图](https://636c-cloud1-4gcb7ly9845b2f5b-1356571968.tcb.qcloud.la/cardlist/BP08/PL%21-bp8-023-SECL.png)，原文字与SAMPLE完整保留，未重绘；预览启动时仅将横图转为既有桌面组件要求的竖版纹理，实际LIVE区仍正确横向展示。

视觉节奏、权威边界、正常对局接入与清理契约见 [演出说明](../../src/components/game/song-animation/snow-halation/README.md)。浏览器证据放在忽略目录 `output/playwright/snow-halation/`；本地真实操作及服务层确定性测试不代表生产部署或真实远端联机验收。

```sh
pnpm --dir client exec tsc --noEmit -p dev/snow-halation/tsconfig.json
pnpm test:run tests/integration/pl-bp8-023-snow-halation.test.ts tests/unit/cheer-effective-projection.test.ts tests/unit/orange-cheer-hearts.test.ts
```
