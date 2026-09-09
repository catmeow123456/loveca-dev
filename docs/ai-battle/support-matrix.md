# AI 对战支持矩阵

> 文档类型：专题说明
> 适用范围：精选构筑、卡牌事实与 AI 可选择的规则窗口
> 当前状态：原始 μ's 预组镜像为开发支持范围；绿莲仅为扩展候选

应用已提供管理员 AI 对战与观察入口。目录、运行边界和权限由[运行与观测说明](runtime-and-observation.md)维护；卡效完成状态以[主登记册](../card-effect-reuse-audit/existing_module_map.md)为准。测试策略通局仅证明规则链路，模型强度与生产开放仍需独立验收。

## 构筑与卡牌事实冻结

构筑 SHA-256 对 YAML 原始字节计算。卡牌 SHA-256 对按 YAML 顺序（成员、LIVE、能量）展开前的每条 `[card_code,count,原始卡牌对象]` 的 `JSON.stringify` 计算；只做 NFKC 全半角编号查找，不替换基础编号或其他罕度。实际服务创建时还须核对当前数据、构筑规则及冻结快照；本表不是产品的可创建清单。

### 缪斯

- 来源：[assets/decks/缪预组.yaml](../../assets/decks/缪预组.yaml)
- YAML：`4a085d4710ec06b4a5046a8a8dc48bd5ff66aeb88fcbe1222ee1f52b737133cf`
- 卡牌：`f76355ee3e84cb6f31f2ea65f5a565970dce6bca3f6ef6ea6e20ae9d61fe7171`
- 数量：成员 48；LIVE 12；能量 12。
- 精确印刷数据缺失：无。

| 基础编号 | 印刷/数量 | 卡牌事实 | 卡文要求的窗口（当前 definition 分类） | workflow 核对入口 |
| --- | --- | --- | --- | --- |
| `PL!-sd1-001` | SD × 4 | 费用 11「高坂 穂乃果」 | CONTINUOUS、ON_ENTER | [waiting-room-to-hand.ts](../../src/application/card-effects/workflows/shared/waiting-room-to-hand.ts) |
| `PL!-sd1-002` | SD × 2 | 费用 2「絢瀬 絵里」 | ACTIVATED | [self-sacrifice-waiting-room-to-hand.ts](../../src/application/card-effects/workflows/shared/self-sacrifice-waiting-room-to-hand.ts) |
| `PL!-sd1-003` | SD × 4 | 费用 13「南 ことり」 | ON_ENTER、LIVE_START | [live-start-discard-gain-heart.ts](../../src/application/card-effects/workflows/shared/live-start-discard-gain-heart.ts)、[waiting-room-to-hand.ts](../../src/application/card-effects/workflows/shared/waiting-room-to-hand.ts) |
| `PL!-sd1-004` | SD × 4 | 费用 11「園田海未」 | ON_ENTER | [look-top-select-to-hand.ts](../../src/application/card-effects/workflows/shared/look-top-select-to-hand.ts) |
| `PL!-sd1-005` | SD × 2 | 费用 2「星空 凛」 | ACTIVATED | [self-sacrifice-waiting-room-to-hand.ts](../../src/application/card-effects/workflows/shared/self-sacrifice-waiting-room-to-hand.ts) |
| `PL!-sd1-006` | SD × 2 | 费用 9「西木野 真姫」 | ON_ENTER | [pl-sd1-006-maki.ts](../../src/application/card-effects/workflows/cards/pl-sd1-006-maki.ts) |
| `PL!-sd1-007` | SD × 2 | 费用 7「東條 希」 | ON_ENTER | [pl-sd1-007-nozomi.ts](../../src/application/card-effects/workflows/cards/pl-sd1-007-nozomi.ts) |
| `PL!-sd1-008` | SD × 2 | 费用 4「小泉 花陽」 | ACTIVATED | [pl-sd1-008-hanayo.ts](../../src/application/card-effects/workflows/cards/pl-sd1-008-hanayo.ts) |
| `PL!-sd1-009` | SD × 2 | 费用 15「矢澤 にこ」 | LIVE_START | [conditional-live-modifier.ts](../../src/application/card-effects/workflows/shared/conditional-live-modifier.ts) |
| `PL!-sd1-011` | SD × 2 | 费用 4「絢瀬 絵里」 | ON_ENTER | [discard-look-top-select-to-hand.ts](../../src/application/card-effects/workflows/shared/discard-look-top-select-to-hand.ts) |
| `PL!-sd1-012` | SD × 4 | 费用 4「南 ことり」 | ON_ENTER | [discard-look-top-select-to-hand.ts](../../src/application/card-effects/workflows/shared/discard-look-top-select-to-hand.ts) |
| `PL!-sd1-013` | SD × 4 | 费用 4「園田海未」 | 无效果文本 | 普通规则 |
| `PL!-sd1-014` | SD × 2 | 费用 9「星空 凛」 | 无效果文本 | 普通规则 |
| `PL!-sd1-015` | SD × 2 | 费用 9「西木野 真姫」 | ON_ENTER | [discard-look-top-select-to-hand.ts](../../src/application/card-effects/workflows/shared/discard-look-top-select-to-hand.ts) |
| `PL!-sd1-016` | SD × 2 | 费用 4「東條 希」 | ON_ENTER | [discard-look-top-select-to-hand.ts](../../src/application/card-effects/workflows/shared/discard-look-top-select-to-hand.ts) |
| `PL!-sd1-017` | SD × 2 | 费用 9「小泉 花陽」 | 无效果文本 | 普通规则 |
| `PL!-sd1-018` | SD × 2 | 费用 9「矢澤 にこ」 | 无效果文本 | 普通规则 |
| `PL!-sd1-010` | SD × 4 | 费用 4「高坂 穂乃果」 | 无效果文本 | 普通规则 |
| `PL!-sd1-019` | SD × 4 | 分数 1「START:DASH!!」 | LIVE_SUCCESS | [arrange-inspected-deck-edge.ts](../../src/application/card-effects/workflows/shared/arrange-inspected-deck-edge.ts) |
| `PL!-sd1-020` | SD × 4 | 分数 2「きっと青春が聞こえる」 | 无效果文本 | 普通规则 |
| `PL!-sd1-021` | SD × 2 | 分数 3「これからのSomeday」 | 无效果文本 | 普通规则 |
| `PL!-sd1-022` | SD × 2 | 分数 4「僕らは今のなかで」 | LIVE_START | [conditional-live-modifier.ts](../../src/application/card-effects/workflows/shared/conditional-live-modifier.ts) |
| `PL!-sd1-023` | P × 2 | 能量「高坂 穂乃果」 | 无效果文本 | 普通规则 |
| `PL!-sd1-024` | P × 2 | 能量「絢瀬 絵里」 | 无效果文本 | 普通规则 |
| `PL!-sd1-025` | P × 2 | 能量「南 ことり」 | 无效果文本 | 普通规则 |
| `PL!-sd1-026` | P × 1 | 能量「園田海未」 | 无效果文本 | 普通规则 |
| `PL!-sd1-027` | P × 1 | 能量「星空 凛」 | 无效果文本 | 普通规则 |
| `PL!-sd1-028` | P × 1 | 能量「西木野 真姫」 | 无效果文本 | 普通规则 |
| `PL!-sd1-029` | P × 1 | 能量「東條 希」 | 无效果文本 | 普通规则 |
| `PL!-sd1-030` | P × 1 | 能量「小泉 花陽」 | 无效果文本 | 普通规则 |
| `PL!-sd1-031` | P × 1 | 能量「矢澤 にこ」 | 无效果文本 | 普通规则 |

能量条目已逐项核对卡种，无效果文本；不因能量卡没有 definition 判为缺失。

### 绿莲-6弹ver

- 来源：[assets/decks/绿莲-6弹ver.yaml](../../assets/decks/绿莲-6弹ver.yaml)
- YAML：`8bd34fe220c73043a30434276749f64ac2acca6ef1b83048aca59612cb4764bd`
- 卡牌：`e48dd847c5da80295442ec590783f0f1f7f96068f6676214c50581290fddda67`
- 数量：成员 48；LIVE 12；能量 12。
- 精确印刷数据缺失：无。

| 基础编号 | 印刷/数量 | 卡牌事实 | 卡文要求的窗口（当前 definition 分类） | workflow 核对入口 |
| --- | --- | --- | --- | --- |
| `PL!HS-PR-014` | RM × 4 | 费用 2「日野下花帆」 | ACTIVATED | [self-sacrifice-waiting-room-to-hand.ts](../../src/application/card-effects/workflows/shared/self-sacrifice-waiting-room-to-hand.ts) |
| `PL!HS-sd1-001` | SD × 4 | 费用 9「日野下花帆」 | AUTO | [relay-replacement-activate-energy.ts](../../src/application/card-effects/workflows/shared/relay-replacement-activate-energy.ts) |
| `PL!HS-sd1-012` | SD × 4 | 费用 4「百生吟子」 | 无效果文本 | 普通规则 |
| `PL!HS-sd1-009` | SD × 4 | 费用 2「日野下花帆」 | ACTIVATED | [self-sacrifice-waiting-room-to-hand.ts](../../src/application/card-effects/workflows/shared/self-sacrifice-waiting-room-to-hand.ts) |
| `PL!HS-PR-019` | RM × 4 | 费用 2「百生 吟子」 | ON_ENTER | [mill-top-gain-live-modifier.ts](../../src/application/card-effects/workflows/shared/mill-top-gain-live-modifier.ts) |
| `PL!HS-bp6-017` | N × 3 | 费用 11「日野下花帆」 | AUTO | [grouped-recovery.ts](../../src/application/card-effects/workflows/shared/grouped-recovery.ts) |
| `PL!HS-bp5-001` | SEC × 3 | 费用 11「日野下花帆」 | ON_ENTER、ACTIVATED | [hs-bp5-001-kaho.ts](../../src/application/card-effects/workflows/cards/hs-bp5-001-kaho.ts) |
| `PL!HS-sd1-006` | SD × 3 | 费用 15「安養寺 姫芽」 | ON_ENTER、LIVE_START | [hs-sd1-006-hime.ts](../../src/application/card-effects/workflows/cards/hs-sd1-006-hime.ts)、[pay-energy-gain-blade.ts](../../src/application/card-effects/workflows/shared/pay-energy-gain-blade.ts) |
| `PL!HS-pb1-004` | R × 1 | 费用 4「百生吟子」 | ON_ENTER | [hs-pb1-004-ginko.ts](../../src/application/card-effects/workflows/cards/hs-pb1-004-ginko.ts) |
| `PL!HS-bp6-001` | R+ × 4 | 费用 4「日野下花帆」 | ON_ENTER、LIVE_SUCCESS | [arrange-inspected-deck-edge.ts](../../src/application/card-effects/workflows/shared/arrange-inspected-deck-edge.ts)、[revealed-cheer-selection.ts](../../src/application/card-effects/workflows/shared/revealed-cheer-selection.ts) |
| `PL!HS-pb1-020` | N × 1 | 费用 9「百生吟子」 | ON_ENTER | [grouped-recovery.ts](../../src/application/card-effects/workflows/shared/grouped-recovery.ts) |
| `PL!HS-bp1-003` | SEC × 2 | 费用 13「乙宗 梢」 | ACTIVATED、CONTINUOUS | [pay-energy-waiting-room-to-hand.ts](../../src/application/card-effects/workflows/shared/pay-energy-waiting-room-to-hand.ts) |
| `PL!HS-bp1-002` | RM × 3 | 费用 11「村野さやか」 | ACTIVATED | [play-waiting-room-member-to-source-slot.ts](../../src/application/card-effects/workflows/shared/play-waiting-room-member-to-source-slot.ts) |
| `PL!HS-bp5-008` | R × 4 | 费用 4「桂城 泉」 | ON_ENTER | [wait-discard-look-top-select-to-hand.ts](../../src/application/card-effects/workflows/shared/wait-discard-look-top-select-to-hand.ts) |
| `PL!HS-pb1-009` | R × 2；P+ × 2 | 费用 15「日野下花帆」 | AUTO、LIVE_START | [hs-pb1-009-kaho.ts](../../src/application/card-effects/workflows/cards/hs-pb1-009-kaho.ts) |
| `PL!HS-bp6-027` | L × 3 | 分数 5「月夜見海月」 | AUTO | [revealed-cheer-selection.ts](../../src/application/card-effects/workflows/shared/revealed-cheer-selection.ts) |
| `PL!HS-bp5-019` | L × 4 | 分数 6「ハナムスビ」 | LIVE_START | [conditional-live-modifier.ts](../../src/application/card-effects/workflows/shared/conditional-live-modifier.ts) |
| `PL!HS-bp2-022` | L+ × 4 | 分数 2「アオクハルカ」 | LIVE_START | [conditional-live-modifier.ts](../../src/application/card-effects/workflows/shared/conditional-live-modifier.ts) |
| `PL!HS-cl1-009` | CL × 1 | 分数 1「水彩世界」 | LIVE_SUCCESS | [revealed-cheer-selection.ts](../../src/application/card-effects/workflows/shared/revealed-cheer-selection.ts) |
| `PL!HS-bp6-E04` | PE+ × 4 | 能量「日野下花帆」 | 无效果文本 | 普通规则 |
| `PL!HS-bp6-E05` | PE+ × 4 | 能量「村野さやか」 | 无效果文本 | 普通规则 |
| `PL!HS-bp6-E06` | PE+ × 4 | 能量「大沢瑠璃乃」 | 无效果文本 | 普通规则 |

能量条目已逐项核对卡种，无效果文本；不因能量卡没有 definition 判为缺失。

## 真实输入窗口与权威路径

两份候选构筑当前卡文没有直接要求对手弃手或替对手选择目标的段落；仍必须覆盖先后手、双方分数确认，以及任一参与者推进公共展示。以下“自己”始终指该能力控制者，不能硬编码当前回合玩家。

| 窗口 | 输入责任 | 命令 | 约束来源 | 现有验证入口 / AI 待补 |
| --- | --- | --- | --- | --- |
| 换牌（任意手牌子集，含全保留） | 当前换牌席位 | MULLIGAN | GameSession + mulligan.handler | AI decision 测试；重复对象拒绝与真实换牌 |
| 普通登场/换手 | 自己主要阶段 | PLAY_MEMBER_TO_SLOT | normal-member-play + cost-calculator + member-turn-state | AI decision 测试；实际支付/槽位/离场结果 |
| 起动选择；同来源多能力 | 自己主要阶段 | ACTIVATE_ABILITY | activated UI/turn-limit/start query + workflow | 首批自送回收/支付两能量已提取查询；其他 workflow 无查询时明确未覆盖 |
| 结束主要阶段 | 当前主要阶段玩家 | END_PHASE | player-command-policy + GameSession | AI decision 测试 |
| 盖下任意手牌、撤回本轮里侧牌、完成 | 当前 LIVE 设置席位 | SET/UNSET_LIVE_CARD、CONFIRM_STEP | getLiveSetCardCount/Limit/Ids + live-set.handler | AI decision 测试；不是仅 LIVE 类型可盖 |
| pending 顺序/confirm-only | 实时检查时点的等待席位 | CONFIRM_EFFECT_STEP | pending runtime/order-selection | ai-battle-effect-decision；同来源不同 pending 独立映射、手动选择后 confirm-only 实际结算 |
| 可选弃手费用；支付后私密检视 | 来源控制者 | CONFIRM_EFFECT_STEP | discard-look-top-select-to-hand + active-effect | ai-battle-effect-decision；唯一目标仍可不发动，已付费用后的强制取一拒绝空选 |
| 休息室回收/自送后回收 | 来源控制者 | CONFIRM_EFFECT_STEP | zone-selection + self-sacrifice-waiting-room-to-hand | ai-battle-decision / ai-battle-effect-decision；强制回收、无目标完成及真实区域移动 |
| 私密检视顶牌、公开选中卡 | 来源控制者，公开展示可双方推进 | CONFIRM_EFFECT_STEP | look-top + public-reveal-dwell | ai-battle-effect-decision；私密检视→仅公开选中牌→双方均可到期推进→手牌/休息室结果 |
| 手中 LIVE 公开后交换成功 LIVE | 来源控制者 | CONFIRM_EFFECT_STEP | pl-sd1-006-maki | ai-battle-effect-decision；公开 deadline 后恢复强制目标，两种成功区目标实际交换 |
| 弃手后选颜色 | 来源控制者 | CONFIRM_EFFECT_STEP | live-start-discard-gain-heart | ai-battle-effect-decision；完整三色候选、费用实际移动、展示前后有效成员 Heart |
| LIVE 成功后顶牌有序保留、其余弃置 | 成功 LIVE 控制者 | CONFIRM_EFFECT_STEP | arrange-inspected-deck-edge | ai-battle-effect-decision；穷举三张牌的 16 种有序子集，断言最终卡组顶顺序和休息室 |
| 判定提交、确认判定/分数、成功 LIVE 入区 | 当前表演者/分数确认双方/成功结算席位 | SUBMIT_JUDGMENT、CONFIRM_STEP、SUBMIT_SCORE、SELECT_SUCCESS_LIVE | GameSession + live-judgment + live-settlement | ai-battle-flow；两席位经正常命令完成自动判定、双方分数确认、成功入区及自然终局 |
| 公共选卡/选项展示，Public Reveal Dwell | 任一可推进参与者 | CONFIRM_EFFECT_STEP | 三种 public-* runtime | 三种真实 workflow 的候选映射已验证；ai-battle-service-runtime 额外覆盖真人控制展示由 AI 定时推进、无浏览器轮询或模型调用 |
| 阶段完成 TIME_GATE | 服务层当前窗口责任席位 | 既有阶段命令 | OnlineMatchService | 同一时钟/队列；合法登场立即提交，选择阶段完成则保留当前选择到 deadline，等待不计失败 |
| 绿莲追加：弃二、两组回收、重叠组 | 效果等待席位 | CONFIRM_EFFECT_STEP | grouped-recovery + grouped-selection | sample-card-effect-runner；P2 后扩展，不能取候选前 N 张 |
| 绿莲追加：支付能量/公开手中 LIVE/按名称回收 | 效果等待席位 | CONFIRM_EFFECT_STEP | hs-bp5-001-kaho、pay-energy-waiting-room-to-hand | hs-bp5-001-kaho；起动 query 与多步约束待补 |
| 绿莲追加：声援卡移动/追加声援/登场指定原槽位 | 效果等待席位 | CONFIRM_EFFECT_STEP | revealed-cheer-selection、play-waiting-room-member-to-source-slot | sample-card-effect-runner、cheer-blade-heart-ordering；实际可移动交集和重新观察 |

## 覆盖与验证入口

首批 22 个成员/LIVE 基础编号的效果登记按基础编号覆盖，未知罕度不需要增加 definition。测试中的罕度替换只验证这一领域不变量，不代表新增公开印刷构筑已经验收。精选 YAML 与卡牌事实哈希由 `tests/helpers/ai-muse-deck.ts` 核对；产品创建时仍使用当前发布卡库与 PT 规则。

- `tests/integration/ai-battle-decision.test.ts`：普通操作、登场费用、起动可用性、隐藏信息和选择协议。
- `tests/integration/ai-battle-effect-decision.test.ts`：费用、强制/空目标、公开展示、颜色、pending 实例、有序选择及正常命令结果。
- `tests/integration/ai-battle-flow.test.ts`：完整能力段数、罕度集合和原始构筑两席位的确定性自然终局。
- `tests/integration/ai-battle-service-runtime.test.ts`：异步任务、同队列过期校验、失败停止、展示门禁和结束封存。
- `tests/integration/ai-battle-admin-route.test.ts`：权限、归属、容量和错误响应。
- `tests/unit/ai-battle-presets.test.ts`：目录与当前数据校验、冻结参考的逐色 LIVE 需求、配置扩展和材料隔离。

模型输入和观察容量由[运行与观测说明](runtime-and-observation.md)维护。真实 HTTP、数据库、浏览器与模型的复现条件见[完整环境验证](full-environment-validation.md)，历史模型结果及其局限见[模型验证](model-validation.md)。未完成事项统一登记在[项目待办](../../PROJECT_PROGRESS_TODO.md)。
