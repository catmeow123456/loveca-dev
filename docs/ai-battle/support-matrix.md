# AI 对战支持矩阵

> 文档类型：专题说明
> 适用范围：精选构筑、卡牌事实与 AI 可选择的规则窗口
> 当前状态：原始 μ's 预组、绿莲-6弹ver与 Like a Treasure 支持镜像及交叉对局；蓝紫作为 AI 专用超 PT 构筑接入；真实模型策略尚未验收

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
| `PL!-sd1-006` | SD × 2 | 费用 9「西木野 真姫」 | ON_ENTER | [reveal-hand-live-swap-success-card.ts](../../src/application/card-effects/workflows/shared/reveal-hand-live-swap-success-card.ts) |
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

### 蓝紫

目录 ID：`blue-purple-nijigasaki`；策略手册：`blue-purple-nijigasaki-tempo`。本构筑只允许 AI 席选择；当前测试 PT 表下为 20/9pt。加载时只豁免 AI 的 PT 总数上限，仍校验 48 名成员、12 张 LIVE、12 张能量、同基础编号至多 4 张、卡种、当前发布状态及 YAML 哈希。真人席仍执行完整 PT 校验。

- 来源：[assets/decks/蓝紫.yaml](../../assets/decks/蓝紫.yaml)
- YAML：`040ba2258970d6804146985605088c926f12898d9a22736ec4164ff46c2d077e`
- 测试冻结卡牌事实：`0d61f31c84ee5757e4509a81d1fd0a9b197dd0bb159d0cbbb42b0b8826c76260`
- 数量：成员 48；LIVE 12；能量 12。
- 当前范围：目录、加载、AI-only 边界、PT 事实、独立策略手册及下表已列卡效窗口的 AI 专项回归；完整确定性通局、全部蓝紫窗口专项回归与真实模型强度尚未验收。

### Like a Treasure

目录 ID 与手册 ID 均为 `like-a-treasure`。用户指定截图版固定 48 成员、12 LIVE，补 12 张普通能量；不归类为“无豆虹”，不以文章旧构筑替换附件卡位。真人与 AI 均可选择，执行完整 PT 校验。2026-09-20 本机已发布卡库与当前 PT 表的只读加载校验通过（9/9pt）；初次浏览器检查已核实双席选择与手册联动；后续已有用户本地真人对战及归档复盘，策略强度仍待持续验证。

- 构筑：[Like a Treasure.yaml](../../assets/decks/Like%20a%20Treasure.yaml)；策略：[基础打法 v0.2](../../assets/ai-battle/handbooks/like-a-treasure.md)。
- YAML：`5d696a1ebcf00dd7b394cf0dabd935eefacb2eb46355c62b758192b0530ccd35`。
- 测试冻结卡牌事实：`44a526b2bdc044450a75afada3b4fecec6bf07fb997267cfa3035f1f5b8c38eb`；混合学校按实际 series 映射，不能一律视为虹咲。
- 已验证：两局固定种子镜像经玩家视角输入、确定性测试策略和正常命令自然终局；普通/减费换手费用与洗底结果、只确认的特殊登场机械执行、休息室起动及单槽选择、彼方私密有序检视与非法输入拒绝。回归入口 `tests/integration/ai-battle-like-a-treasure.test.ts`。
- 策略 v0.2 结合攻略文章、构筑事实与有限历史样本；已有本地真人/模型试玩，包含概率辅助下的多曲比较。样本不足以判定固定风险偏好优劣，两局流程回归也不覆盖所有可能局面或证明策略强度。

### 绿莲-6弹ver

目录 ID：`green-hasunosora-bp6`；策略手册：`green-hasunosora-recovery`。管理员可为真人或 AI 独立选择本构筑，沿用当前卡库/PT 校验与共享牌桌。

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

## 已查询的能力资源

共享 workflow 提供只读费用/目标事实，AI 层仅映射已经可见的对象：自送回手、支付能量回手、自送并从休息室登场到原槽位三族已登记；其他起动能力仍以原合法候选和卡文表达，不宣称已有完整收益预测。自送费用会将来源及其下方成员加入结算时的休息室候选，只有当下可见者才进入模型输入。

`PL!HS-sd1-006` 费用 15「安养寺姬芽」的登场同伴条件、回能上限与 LIVE 回收目标已从实际 workflow 复用到 `entryResources`。这不是通用多步模拟器：其他 AUTO、常时变化、随机抽牌、声援和多 LIVE 合计仍须另行评价。三段日志局面的正常命令回归见 `tests/integration/ai-battle-planning.test.ts`，策略证据见[空费与回合规划复测](reviews/2026-09-10-f978-planning.md)。

## 真实输入窗口与权威路径

上述构筑当前所列卡文没有直接要求对手弃手、盲选或替对手选择目标的段落；仍必须覆盖先后手、双方分数确认，以及任一参与者推进公共展示。以下“自己”始终指该能力控制者，不能硬编码当前回合玩家。

| 窗口 | 输入责任 | 命令 | 约束来源 | 现有验证入口 / AI 待补 |
| --- | --- | --- | --- | --- |
| 换牌（任意手牌子集，含全保留） | 当前换牌席位 | MULLIGAN | GameSession + mulligan.handler | AI decision 测试；重复对象拒绝与真实换牌 |
| 普通登场/换手 | 自己主要阶段 | PLAY_MEMBER_TO_SLOT | normal-member-play + cost-calculator + member-turn-state | AI decision 测试；实际支付/槽位/离场结果 |
| 起动选择；同来源多能力 | 自己主要阶段 | ACTIVATE_ABILITY | activated UI/turn-limit/start query + workflow | 自送回收、支付能量回收、公开手中 LIVE 同名回收和原槽位登场已提供查询；其他 workflow 无查询时明确未覆盖 |
| 只需确认的特殊登场 | 自己主要阶段 | BEGIN_SPECIAL_MEMBER_PLAY、CONFIRM_SPECIAL_MEMBER_PLAY | 原 special-member-play-procedures + cost-calculator | 按 min/max=0 的通用形状适配；费用13米娅减费与普通换手分别报价，选择后确认由机械策略执行；需额外选卡的特殊登场仍明确未支持；真人 HTTP 入口支持 BEGIN/CONFIRM/CANCEL 三步，共用既有 mode 定义并交原规则链重验，见 ai-battle-admin-route |
| 手牌/休息室起动与单槽选择 | 来源控制者 | ACTIVATE_ABILITY、CONFIRM_EFFECT_STEP | 原 sourceZone 起动 UI/start query + workflow 单槽 SLOTS 契约 | 费用2霞从休息室复出：真实支付、弃手、合法区域、登场及后续检视；AI 仅转换当前席位可见来源与候选 |
| Like a Treasure 的卡效选择 | 来源控制者；私密检视只对本人 | CONFIRM_EFFECT_STEP | workflow 自有 CARDS/OPTIONS/CONFIRM 查询 | 费用17彼方两段起动、费用13艾玛/米娅、Poppin、TOKIMEKI、Treasure 与共享休息室置顶步骤；效果计算继续由原 workflow 执行 |
| 结束主要阶段 | 当前主要阶段玩家 | END_PHASE | player-command-policy + GameSession | AI decision 测试 |
| 一次选择最终盖牌完整集合并完成设置 | 当前 LIVE 设置席位 | SET/UNSET_LIVE_CARD、CONFIRM_STEP（同队列批次） | getLiveSetCardCount/Limit/Ids + live-set.handler | AI decision / service runtime 测试；可选任意手牌，不限 LIVE 类型；撤回、追加与确认不再重复请求模型 |
| pending 顺序/confirm-only | 实时检查时点的等待席位 | CONFIRM_EFFECT_STEP | pending runtime/order-selection | ai-battle-effect-decision；同来源不同 pending 独立映射、手动选择后 confirm-only 实际结算 |
| 可选弃手费用；支付后私密检视 | 来源控制者 | CONFIRM_EFFECT_STEP | discard-look-top-select-to-hand + active-effect | ai-battle-effect-decision；唯一目标仍可不发动，已付费用后的强制取一拒绝空选 |
| 休息室回收/自送后回收 | 来源控制者 | CONFIRM_EFFECT_STEP | zone-selection + self-sacrifice-waiting-room-to-hand | ai-battle-decision / ai-battle-effect-decision；强制回收、无目标完成及真实区域移动 |
| 私密检视顶牌、公开选中卡 | 来源控制者，公开展示可双方推进 | CONFIRM_EFFECT_STEP | look-top + public-reveal-dwell | ai-battle-effect-decision；私密检视→仅公开选中牌→双方均可到期推进→手牌/休息室结果 |
| 手中 LIVE 公开后交换成功 LIVE | 来源控制者 | CONFIRM_EFFECT_STEP | pl-sd1-006-maki | ai-battle-effect-decision；公开 deadline 后恢复强制目标，两种成功区目标实际交换 |
| 弃手后选颜色 | 来源控制者 | CONFIRM_EFFECT_STEP | live-start-discard-gain-heart | ai-battle-effect-decision；完整三色候选、费用实际移动、展示前后有效成员 Heart |
| 蓝紫：LIVE 开始将休息室两张成员有序置底 | 来源控制者，公开展示可双方推进 | CONFIRM_EFFECT_STEP | n-bp3-009-rina + queryCardSelection + public-card-selection-confirmation | 费用 10「天王寺璃奈」`PL!N-bp3-009` 全罕度共享契约；ai-battle-effect-decision 覆盖可跳过/恰好两张、非法输入拒绝、公开展示后真实入底顺序及费用合计 6/8/25/其他值的结算；n-bp3-009-rina 覆盖目标不足、stale 与后续 pending |
| 蓝紫：起动待机、弃手并回收虹咲 LIVE | 来源控制者，公开展示可双方推进 | ACTIVATE_ABILITY、CONFIRM_EFFECT_STEP | n-bp3-004-karin + activated-registry + queryCardSelection | `PL!N-bp3-004` 费用 13「朝香果林」全罕度共用起动条件查询与两步选卡契约；ai-battle-blue-purple-effects 覆盖只读枚举、费用实际支付、强制选择/非法输入、刚弃置 LIVE 回收、无目标结束、公开展示续行及每回合次数；原卡效测试保留 stale 与后续 pending 回归 |
| 蓝紫：LIVE 开始付能量选择 Heart | 来源控制者，公开展示可双方推进 | CONFIRM_EFFECT_STEP | pay-energy-gain-heart + queryOptionSelection + public-effect-choice-confirmation | `PL!N-bp1-003` 费用 10「樱坂雫」全罕度共用支付/不发动和六色必选查询；ai-battle-pay-energy-gain-heart 覆盖只读查询、能量不足、真实扣费、非法选色、公开后仅来源获得 Heart 及后续 pending |
| 蓝紫：首回合 LIVE 加分后指定成员获得 BLADE | 来源控制者 | CONFIRM_EFFECT_STEP | n-bp4-029-rise-up-high + queryCardSelection | `PL!N-bp4-029` 分数 1「Rise Up High!」全罕度共用强制单选查询；ai-battle-blue-purple-effects 覆盖多目标中仅选中成员获得 BLADE、只读枚举、非法/失效目标、重复提交、SCORE 仅加一次及后续 pending；零/单目标和非首回合分支无需选卡 |
| 蓝紫：LIVE 成功放置能量/成员回收 | 来源控制者，公开展示可双方推进 | CONFIRM_EFFECT_STEP | n-bp4-030-daydream-mermaid + queryOptionSelection + queryCardSelection | `PL!N-bp4-030` 分数 3「Daydream Mermaid」全罕度提供合法单选与条件双选；AI 按选项数量约束枚举完整组合，保持印刷顺序。ai-battle-blue-purple-effects 覆盖双方成功区归属、资源不足、只读枚举、非法/失效输入、公开展示后待机能量/成员回手及后续 pending |
| 蓝紫：LIVE 开始付能量将休息室两张成员有序置顶 | 来源控制者，公开展示可双方推进 | CONFIRM_EFFECT_STEP | live-start-pay-energy-stack-waiting-members-to-deck-top + queryOptionSelection + queryCardSelection + public-card-selection-confirmation | `PL!HS-PR-020`／`PL!HS-PR-023` 费用 11「桂城泉」同型共享契约（PR-023 按 JP cards.json 与 PR-020 同 abilityId 登记）；ai-battle-blue-purple-effects 覆盖支付/不发动双选项、真实扣 1 能量、恰好两张成员有序选择、休息室非成员卡排除、单张子集协议拒绝、公开展示后真实置顶顺序与不发动无损续行；原卡效集成测试保留非法输入、stale 与目标/能量不足分支回归 |
| 蓝紫：LIVE 开始抽 1 待机对方低费成员，并按对方待机数置顶虹咲成员 | 来源控制者，公开展示可双方推进 | CONFIRM_EFFECT_STEP | n-bp4-004-karin + queryCardSelection + public-card-selection-confirmation | `PL!N-bp4-004` 费用 15「朝香果林」全罕度共享契约；ai-battle-blue-purple-effects 覆盖真实抽 1、强制单选排除费用大于 9 与已待机成员、空选拒绝、选后目标实际待机、无合法目标只保留抽牌不开窗、0..N 有序置顶排除非虹咲候选、上限取对方待机数、空选映射显式跳过、公开展示后真实置顶顺序；原卡效测试保留双能力同时触发的顺序窗口、跳过拒绝与费用 10 不成目标回归 |
| 特殊能量：精确选择后恢复原卡效 | 能量操作等待席位 | CONFIRM_EFFECT_STEP | energy-operation-selection + queryActiveEffectSelection | 通用步骤独立提供已公开能量的精确数量选卡契约；ai-battle-pay-energy-gain-heart 验证一/二张支付、重复/非法/失效引用拒绝、扣费一次及恢复奖励；不代表其他原卡效的全部步骤已适配 |
| LIVE 成功后顶牌有序保留、其余弃置 | 成功 LIVE 控制者 | CONFIRM_EFFECT_STEP | arrange-inspected-deck-edge | ai-battle-effect-decision；穷举三张牌的 16 种有序子集，断言最终卡组顶顺序和休息室 |
| 判定提交、确认判定/分数、成功 LIVE 入区 | 当前表演者/分数确认双方/成功结算席位 | SUBMIT_JUDGMENT、CONFIRM_STEP、SUBMIT_SCORE、SELECT_SUCCESS_LIVE | GameSession + live-judgment + live-settlement | ai-battle-flow；两席位经正常命令完成自动判定、双方分数确认、成功入区及自然终局 |
| 公共选卡/选项展示，Public Reveal Dwell | 任一可推进参与者 | CONFIRM_EFFECT_STEP | 三种 public-* runtime | 三种真实 workflow 的候选映射已验证；ai-battle-service-runtime 额外覆盖真人控制展示由 AI 定时推进、无浏览器轮询或模型调用 |
| 阶段完成 TIME_GATE | 服务层当前窗口责任席位 | 既有阶段命令 | OnlineMatchService | 同一时钟/队列；合法登场立即提交，选择阶段完成则保留当前选择到 deadline，等待不计失败 |
| 绿莲追加：弃二、两组回收、重叠组 | 效果等待席位 | CONFIRM_EFFECT_STEP | grouped-recovery + grouped-selection | ai-battle-green-effects；精确弃二、各组 min/max、缺失分组、非法组合拒绝与完整合法兜底；重叠组由 ai-battle-grouped-selection 验证 |
| 绿莲追加：支付能量/公开手中 LIVE/按名称回收 | 效果等待席位 | CONFIRM_EFFECT_STEP | hs-bp5-001-kaho、pay-energy-waiting-room-to-hand | ai-battle-green-effects；起动费用/目标只读查询、真实扣费、公开手中 LIVE 后同名回收及每回合次数 |
| 绿莲追加：声援卡移动/追加声援/登场指定原槽位 | 效果等待席位 | CONFIRM_EFFECT_STEP | revealed-cheer-selection、play-waiting-room-member-to-source-slot | ai-battle-green-effects；0/1/3张追加声援、回顶/加入手牌的公开停留、原槽位登场后继续登场效果 |

## 覆盖与验证入口

缪斯 22 个、绿莲 19 个成员/LIVE 基础编号的效果登记均按基础编号覆盖，未知罕度不需要增加 definition。测试中的罕度替换只验证这一领域不变量，不代表新增公开印刷构筑已经验收。精选 YAML 与卡牌事实哈希由 `tests/helpers/ai-curated-decks.ts` 核对；产品创建时仍使用当前发布卡库与 PT 规则。

- `tests/integration/ai-battle-green-flow.test.ts`：原始绿莲与缪斯交叉先后手、绿莲镜像自然终局，另以未知罕度镜像锁定全部能力覆盖；使用确定性测试策略，不证明真实模型强度。
- `tests/integration/ai-battle-green-effects.test.ts`：真实卡牌数据下的分组回收、起动资源/次数、私密检视、手中 LIVE 公开回收、声援移动/追加和原槽位登场的正常命令结果。
- `tests/unit/ai-battle-grouped-selection.test.ts`：逐个枚举重叠组合法集合，核对模型协议与权威约束一致及合法兜底。
- `tests/integration/ai-battle-decision.test.ts`：普通操作、登场费用、起动可用性、隐藏信息和选择协议。
- `tests/integration/ai-battle-effect-decision.test.ts`：费用、强制/空目标、公开展示、颜色、pending 实例、有序选择及正常命令结果。
- `tests/integration/ai-battle-blue-purple-effects.test.ts`：蓝紫朝香果林（费用 13）的起动、弃手和 LIVE 回收，「Rise Up High!」加分后指定成员获得 BLADE，「Daydream Mermaid」LIVE 成功单选/双选、放置待机能量和成员回手，费用 11「桂城泉」LIVE 开始付能量将休息室两张成员有序置顶，以及费用 15「朝香果林」LIVE 开始抽 1 待机对方低费成员、按对方待机数有序置顶虹咲成员的正常命令链；仅覆盖已列窗口，不代表蓝紫整副通局已验收。
- `tests/integration/ai-battle-pay-energy-gain-heart.test.ts`：蓝紫樱坂雫的支付/不发动、六色选择与公开续行；同时验证共享特殊能量精确一/二张支付和失效输入。
- `tests/integration/ai-battle-flow.test.ts`：完整能力段数、罕度集合和原始构筑两席位的确定性自然终局。
- `tests/integration/ai-battle-service-runtime.test.ts`：异步任务、同队列过期校验、失败停止、展示门禁和结束封存。
- `tests/integration/ai-battle-admin-route.test.ts`：权限、归属、容量和错误响应；真人特殊登场经真实 HTTP 入口完成开始/取消/确认，覆盖米娅实际4费换手、洗底与LIVE保留、客户端席位覆盖、非法参数/过期/重复提交及费用不足无状态变化。
- `tests/unit/ai-battle-presets.test.ts`：目录与当前数据校验、冻结参考的逐色 LIVE 需求、配置扩展和材料隔离。

模型输入和观察容量由[运行与观测说明](runtime-and-observation.md)维护。真实 HTTP、数据库、浏览器与模型的复现条件见[完整环境验证](full-environment-validation.md)，历史模型结果及其局限见[模型验证](model-validation.md)。未完成事项统一登记在[项目待办](../../PROJECT_PROGRESS_TODO.md)。
