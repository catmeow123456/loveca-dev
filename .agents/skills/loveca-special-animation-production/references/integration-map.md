# 专属演出的接入地图

用于接入或排查“预览有动画、普通对局没有”的问题。按任务追踪相关路径，不把此文件当作运行时参数表，也不把所有样例照抄一遍。

## 共用链路

| 层次 | 当前入口与核对内容 |
| --- | --- |
| 权威事实 | `src/application/card-effects/workflows/cards/` 的单卡工作流；普通登场另见 `src/application/card-entrance.ts`。核对实际成功结果、能力选择与原子步骤边界。 |
| 演出数据 | `src/shared/card-entrance.ts` 的 `EntranceWait` / `EntranceRuntime`，`src/online/types.ts` 与 `src/online/projector.ts` 的公开投影。只携带当前演出使用的公开来源和结果。 |
| 服务与续接 | `src/application/game-session.ts` 的 ACK、截止时间及到期恢复，`src/server/services/online-match-service.ts` 的对墙打单视角／联机双视角配置与服务端超时。共享 continuation 需先核对适用来源，不把仅支持舞台成员的路径直接拿来续接 LIVE。 |
| 牌桌入口 | `client/src/components/game/GameBoard.tsx`，`client/src/lib/cardEntrancePolicy.ts`，`client/src/components/game/card-entrance/CardEntranceLayer.tsx`。核对正常入口确实挂载、模式及开关有效、等待时控件遮挡。 |
| 播放生命周期 | `client/src/components/game/BattleRuntime.ts`，`client/src/lib/effectImageCache.ts`，`client/src/lib/specialEffectPreload.ts`。沿用 ACK 重试、窗口可见性、准备期限和资源清理，加载加播放不能超过权威等待预算。 |
| 规则边界 | `src/application/card-effect-runner.ts` 负责 pending 顺序及一次性续接，单卡条件仍留在 workflow。不要仅延迟 React 弹窗却让权威状态继续运行。 |

登场的完整 profile、人物绘制、飞牌与落场配置见 [既有实现地图](../../loveca-card-entrance-production/references/implementation-map.md)。是否支持某模式以源码与 [模式边界](../../../../docs/battle-mode-purpose-and-boundaries.md) 为准，不因新演出扩大观战、教程或回放范围。

## 按实际需求参考样例

- **17 费百生吟子**：`src/application/card-effects/workflows/cards/hs-bp8-004-ginko.ts`、`client/src/lib/ginkoFlowerTransfer.ts`、`client/src/lib/ginkoKnotTransfer.ts`。分别看真实花帆换手来源、成功获得能力后的公开传递、能力有效期对应的绳结标记；回归在 `tests/integration/ginko-flower-presentation.test.ts` 与 `ginko-knot-marker.test.ts`。
- **15 费天王寺璃奈**：`src/application/card-effects/workflows/cards/n-bp8-009-rina.ts`、`client/src/lib/rinaLiveSwap.ts`、`client/src/components/game/card-entrance/rina-sec/RinaLivePlayback.tsx`。看退回与放置歌曲的不同成功边界及共用续接；回归在 `tests/integration/rina-honoka-presentation.test.ts`。
- **分数 9「我们是合而为一的光芒」**：`src/application/card-effects/workflows/cards/pl-pb2-039-bokutachi-wa-hitotsu-no-hikari.ts`、`client/src/lib/bokuhikaPresentation.ts`、`client/src/components/game/song-animation/`。看规则评估的公开成员名单、确认前演出、自动批次续接和构建内素材；当前行为见 [歌曲演出说明](../../../../client/src/components/game/song-animation/README.md)，服务端 SOLITAIRE / 双席 / 超时回归在 `tests/integration/bokuhika-presentation.test.ts`。

固定肖像可以来自另一张公开卡面；它们仅是身份图例，不代表该卡存在于玩家手牌或卡组。不要把展示素材代码当作规则资格判断。

## 完整性检查

从目标权威事件追到正常 `GameBoard`，并反向核对演出组件的调用者。如果仅在 `dev/`、仓库外试作或测试工具栏中被调用，它仍是原型，即使已经提交。无需引入新的“大一统”事件总线来修补漏接。

手动选择：验证待选队列无误播，选到目标效果后播放，结束或跳过只恢复原确认；确认才产生预期状态变更。自动顺序：确认已有规则是否在演出前应用，再暂停后续批次；恢复后不得再次应用同一个效果。不要对两种流程作不符合代码的统一描述。

联机与对墙打：用服务层测试覆盖实际命令、公开快照与等待释放，而不只直接调用单卡函数。对方是否看见效果、谁应 ACK、是否还有另一席等待，以投影和会话配置为准。权威超时不依赖浏览器在线；重连继承现有截止时间，不重置演出预算。

素材与环境：检查构建是否能解析素材、运行地址是否由正常服务提供、使用的是完整卡面纹理还是横版原图。预览修正先局部处理；对正常图片服务有修改时同时检查主入口。核实前端工作目录、API 目标和后端构建是否匹配，不能仅凭端口可访问或热更新提示宣称接入成功。

发布状态：`git status` 证明未提交内容，提交 diff 证明代码与素材已收录；二者都不证明生产部署。前后端协议或演出字段一起变化时，需要包含它们的对应版本一起发布。具体发布操作见 [登场部署说明](../../../../docs/card-entrance-production-rollout.md)，阅读说明本身不授权发布。
