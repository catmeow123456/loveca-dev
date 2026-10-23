# 仆光可操作对战预览

> 文档类型：专题说明
> 当前状态：本地视觉评审入口；独立内存对局，不连接账号或后端

## 运行

安装仓库及客户端现有依赖后，从仓库根目录执行：

```sh
pnpm --dir client exec vite --config dev/bokuhika/vite.config.mjs
```

打开 `http://127.0.0.1:5190/`。端口已占用时启动会失败，不自动切换或关闭其他服务。此入口在正式客户端构建之外；无需数据库、子模块初始化或额外图片下载。已启动的 5174 也可打开 `/dev/bokuhika/index.html` 使用同一个内存牌桌；正常对墙打则直接使用共用 GameBoard 中的正式接入。

## 操作与触发

页面使用真实 `GameBoard`、`GameSession`、命令和玩家投影，支持拖牌、换手和按通常流程进行 LIVE。顶部「重播歌曲演出」可重复观看当前效果；「测试控制」提供减速、暂停、时间轴、关键帧、减少动态和成员图例选择。成员勾选只影响手动预览，不改对局状态或分数。`?narrow=1`、`?wide=1` 为窄屏/宽屏容器，`?reduced=1` 启用减少动态。

「准备 LIVE 阵容」将三位 μ's 成员放在舞台上，仆光留在手牌。双方依次开始 LIVE，将仆光拖入 LIVE 区并确认放置，按原面板结算 LIVE 开始效果与声援。选中仆光的 LIVE 成功效果后，先播放莲花，再恢复「继续处理」确认框；确认后由原规则加分。本阵容计入六位成员，最终分数为 15。

「准备双 LIVE · 选择顺序」提供仆光与 `START:DASH!!` 两首歌。两首均放入 LIVE 区后，可先选另一首的成功效果验证没有莲花；只有轮到仆光时才播放。该阵容计入四位成员，两首合计分数为 14。普通胜者流程保留，不再次播放莲花。

演出中牌桌不可交互，由正式 `EntranceRuntime` 等待窗口遮住确认面板。结束和跳过通过共用 ACK 恢复原确认框，超时由权威状态释放；跳过不代替「继续处理」，不提前加分。同一等待窗口的重复 UI 更新不会重播。

## 素材与规则链路

`cards.json` 是用户指定 `cards_export_2026-10-21.json` 中十五张预览用卡的精简快照，仅包含公开卡面与规则字段；不替代正式卡牌数据源。`images/` 中的对战牌面使用本次任务提供的中文图片：歌曲保留原始横图，牌桌纹理归一化为竖版、宽度最多 700 像素的 WebP，供 GameBoard 按正式方向展示。正式组件 `song-animation/assets/` 内的歌曲横图和九人肖像由静态导入共用；肖像采用固定的 `PL!-bp5-001-P` 至 `PL!-bp5-009-P` 仆光服装日文卡图，按每位成员调整运行时裁切；该版本 SAMPLE 的位置较低，处于头像取景之外。肖像图片仅作图例，不加入可操作牌组，也不取隐藏卡对象。保存的完整图片保留原文字和 SAMPLE 标记，没有人物重绘或共享图片修改。

预览与正式对局都消费单卡 workflow 产生的公开演出信息，不再使用预览专用的权威快照适配器。手动重播/定格仅由工具栏调用 Scene；真实卡效播放完全交给共用 CardEntranceLayer。5190 服务器仅监听回环地址，屏蔽 `/api/` 请求，不访问生产数据。

视觉契约与正式接入边界见 [歌曲演出组件](../../src/components/game/song-animation/README.md)。

## 检查

```sh
pnpm --dir client exec tsc --noEmit -p dev/bokuhika/tsconfig.json
pnpm exec vitest run tests/integration/bokuhika-presentation.test.ts tests/unit/bokuhika-score-presentation.test.ts tests/integration/bp8-pb2-new-effects.test.ts -t 'Bokuhika|PL!-pb2-039'
```
