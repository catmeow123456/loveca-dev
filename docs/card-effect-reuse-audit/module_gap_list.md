# Loveca card effect module gap list

> 文档类型：专题说明
> 适用范围：卡效模块缺口、已关闭缺口、下一批抽象候选和剩余风险
> 当前状态：缺口跟踪文档；卡牌完成状态以 `existing_module_map.md` 为准
> 最后更新：2026-06-16

本文件基于 `loveca_effect_fragments_catalog.json` 回扫当前已实现卡牌。它只列 Stage 1A-1F 之后仍值得追踪的缺口；已经有主模块的片段不再作为 P0-now 抽象任务重复列出。

## Closed or substantially reduced by staged refactors

| fragments | current module | status |
|---|---|---|
| `F07,F08,F09` | `src/application/effects/zone-selection.ts` + `card-selectors.ts` | 当前 `WAITING_ROOM -> HAND` 单选路径已成为主路径，覆盖 001/002/003/005，并已用 `PL!-pb1-019-N` 费用 2「高坂穗乃果」、`PL!-bp4-003-P` 费用 2「南琴梨」及 35 张同型新卡（含与 `PL!-sd1-002-SD` 对齐）验证非预组起动扩样本；`PL!HS-bp1-003` 费用 13「乙宗梢」验证低费莲之空成员回收，`PL!HS-bp5-001` 费用 11「日野下花帆」验证同名 LIVE 回收，`PL!HS-pb1-020` 费用 9「百生吟子」验证 Cerise Bouquet 成员 + 莲之空 LIVE 分组回收，`PL!-PR-018-PR` 费用 15「东条希」验证分数 >=6 LIVE 回收。后续重点是把分组上限配置化。 |
| `T01,T02,F07,F09,C08,B05,X05` | `src/application/effects/zone-selection.ts` + `card-selectors.ts` + `paySelectedDiscardHandCost` + `live-modifiers.ts` | `LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下花帆」已完成两段：登场回收成员；LIVE 开始弃合计 3 张指定姓名手牌并写入 LIVE 合计分数 +3。 |
| `C01,C02,C03,C04,C05,C06,C07,E01` | `src/application/effects/effect-costs.ts` + active effect visibility fields | 弃手、横置能量、自送休息室、来源成员待机与复合费用已外移。`PL!HS-bp1-002` 费用 11「村野沙耶香」验证支付 2 能量 + 自送，`PL!HS-pb1-020` 费用 9「百生吟子」验证弃 2 手牌，`PL!HS-bp5-001` 费用 11「日野下花帆」验证公开手牌 LIVE 前候选隐私与公开确认窗口。未来补标准 GameEvent 与公开手牌 step helper，而不是回到单卡手写。 |
| `F03,F04,F05,F06,F13` | `src/application/effects/look-top.ts` | 看顶/公开/清理/顶牌入休息室原语已外移。`PL!HS-bp5-001` 费用 11「日野下花帆」验证公开检视顶 4 后确认入休息室并按其中是否存在 LIVE 写入 BLADE，`PL!HS-bp6-001` 费用 4「日野下花帆」验证动态检视舞台成员数 + 2 并选择 1 张控顶，其余入休息室；`PL!SP-bp2-002-R` 费用 2「唐 可可」验证无弃手的检视顶 3、公开费用 >=11 卡入手。`F04/F06/F05` 的 workflow config 仍在 runner orchestration。 |
| `F01,F02` | `src/application/effects/draw.ts` + runner 抽弃壳 | 当前卡效抽牌到底座已覆盖 007 的额外抽 1；F02 已由 `PL!SP-bp4-008-P` 费用 13「若菜四季」左侧登场、`PL!HS-bp1-006-P` 费用 11「藤岛 慈」登场、`PL!HS-pb1-009-R` 费用 15「日野下花帆」LIVE 开始阈值段验证抽 2 弃 1。`F12` 与更复杂抽弃语义等待真实样例。 |
| `B01,B02,B03,B05,B06,B07,B08,T05` | `src/domain/rules/live-modifiers.ts` | Live modifier 主写入路径已建立，legacy fields 是兼容投影；`PL!HS-bp5-001` 费用 11「日野下花帆」验证登场后临时 BLADE +2，`PL!HS-bp1-003` 费用 13「乙宗梢」验证条件型常时 LIVE 合计分数 +1，`PL!HS-bp2-022-L+` 分数 2「アオクハルカ」验证带 `liveCardId` 的此 Live 卡分数 +1，`LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下花帆」验证指定姓名弃手后 LIVE 合计分数 +3，`LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」验证按弃置张数缩放 BLADE，`PL!N-pb1-004` 费用 11「朝香果林」验证未进行成员区位置移动时 continuous BLADE +2，`PL!-bp4-002` 费用 15「绚濑绘里」验证舞台成员来源按 LIVE 文本条件动态投影 SOURCE_MEMBER 紫 Heart +2，`PL!-bp5-003` 费用 11「南琴梨」验证舞台 3 名以上不同名成员条件动态投影 SOURCE_MEMBER 黄 Heart +1，`PL!-bp6-022-L` 分数 9「Dreamin' Go! Go!!」验证成功区 LIVE 来源 continuous requirement modifier 且不叠加。判定窗口已用通用 `scoreModifiers` / `liveCardScoreModifiers` / `requirementModifiers` / 来源成员有效 Heart 投影，不再写前端单卡特例。 |
| `S01,S02,S05,S07` | `src/application/effects/member-state.ts` | 成员状态/站位变换/卡效登场原语已建立；Karin position change 与 `PL!SP-bp4-008-P` 费用 13「若菜四季」LIVE 开始可选站位变换均已复用，且 `positionMovedThisTurn` 已区分登场与成员区位置移动；`PL!SP-bp5-003-AR` 费用 17「岚 千砂都」验证批量成员活跃，`PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」验证选择 1 名待机舞台成员变活跃，`PL!S-bp2-006-P` 费用 11「津岛善子」验证从休息室登场到空槽，`PL!HS-bp1-002` 费用 11「村野沙耶香」验证自送后从休息室登场到来源原区域。 |
| `E02,E03` | `src/application/effects/energy.ts` | 能量卡组顶 -> 能量区放置原语已建立，支持指定活跃/待机状态；能量区方向变更原语也已建立。当前覆盖 `PL!SP-PR-004-PR` 费用 4「唐 可可」的待机能量放置、`PL!-bp5-005-AR` 费用 10「星空凛」的条件满足后活跃能量放置、`PL!SP-bp4-008-P` 费用 13「若菜四季」右侧登场的待机能量变活跃、`PL!SP-bp5-003-AR` 费用 17「岚 千砂都」LIVE 开始全部能量变活跃、`PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」登场选择能量分支后自动处理至多 2 张待机能量、`PL!HS-sd1-006-SD` 费用 15「安养寺姬芽」登场条件成立时活跃 1 张能量，以及 `PL!HS-sd1-001-SD` 费用 9「日野下花帆」relay 离场 AUTO 活跃 2 张能量。能量没有个体差异，不要求玩家逐张选择具体能量卡。 |
| `X08,X11` | `src/domain/rules/cost-calculator.ts` + `play-member.handler.ts` | Stage 1L 已起步：登场费用修正会在规则层生成基础费用、修正后费用、修正明细、换手减免与最终支付方案；`LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」已验证按其他手牌数量减费且自身不计入，并已补齐“无法因换手放置入休息室”，在支付方案与实际登场 action 层拦截；`PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」已验证舞台存在待机状态『虹咲』成员时自身 -2 费，`PL!SP-bp5-003-AR` 费用 17「岚 千砂都」已验证舞台来源使手牌中 10 费 Liella! 成员登场费用 -2 且先减费再换手，`PL!-bp4-008-P` 费用 4「小泉花阳」验证舞台成员有效费用可作为换手减免读取。 |
| `T06,S08,T07,B01,T02,F02` | `src/application/card-effect-runner.ts` trigger enqueue + shared effect primitives；`src/domain/rules/live-modifiers.ts` | Stage 1O 已起步：`PL!HS-bp2-012-N` 费用 5「乙宗 梢」验证舞台成员进休息室触发 AUTO；`PL!HS-bp6-017-N` 费用 11「日野下花帆」验证同触发下的弃手后 LIVE/成员各至多 1 张回收。Stage 1P 已用 `PL!HS-pb1-009-R` 费用 15「日野下花帆」验证舞台成员监听己方「莲之空」成员登场、实例级每回合 2 次、BLADE +2 modifier、LIVE 开始 BLADE 阈值抽弃与手动顺序选择 confirm-only 壳。`PL!HS-sd1-001-SD` 费用 9「日野下花帆」进一步验证 relay 来源条件：离场事件携带换上成员 `replacingCardId`，入队阶段校验费用 >=10 的「莲之空」成员。 |
| `T04,F14,F15,E06` | `src/application/effects/cheer-selection.ts` + `src/application/effects/cheer.ts` + LIVE 成功 / ON_CHEER 入队 | Stage 1S/1T 已起步：`PL!HS-bp6-001` 费用 4「日野下花帆」验证舞台成员来源 LIVE 成功时效果，并可将本次声援公开卡放回卡组顶；`PL!HS-cl1-009` 分数 1「水彩世界」验证成功 LIVE 卡来源从本次声援公开卡中选择费用 4-9 成员加入手牌；`PL!HS-bp6-027-L` 分数 5「月夜見海月」验证 `ON_CHEER` 事件消费、至多3张公开声援卡入休息室与追加等量声援。重做声援仍待样例。 |
| `S01,S03,X05,X06` | `src/application/effects/member-state.ts` + `stage-targets.ts` + `stage-member-target-selection.ts` + `card-selectors.ts` | `PL!HS-bp6-004-R` 费用 13「百生 吟子」已验证选择对手舞台费用 <= 9 成员并调用 `setMemberOrientation(WAITING)`；舞台目标 helper 已抽到 `stage-targets.ts`，目标 active effect 已抽到 `stage-member-target-selection.ts`，弃置卡姓名归一化判断已抽为 `cardNameIs`。`PL!HS-sd1-006-SD` 费用 15「安养寺姬芽」验证 `cardNameAliasIs` 的舞台条件扫描，`PL!HS-bp5-008-R` 费用 4「桂城泉」验证 `costGte` 高费用成员 selector。后续可用第二张同型卡继续验证。 |
| `X01,L01,L02,X13` | `src/application/effects/conditions.ts` + `card-selectors.ts` + application-local state queries | 第一版纯 query helper 已起步，提供区域计数、selector 计数/阈值、按 selector 返回 cardIds、区域 + selector 组合、成功 LIVE 数、成功 LIVE 分数合计、舞台成员数/存在性、其他舞台成员、LIVE 区排除来源卡计数、来源 BLADE 阈值、舞台成员有效费用查询、团体/姓名 alias selector，以及舞台成员/能量按朝向查询等。`PL!-bp4-008` 费用 4「小泉花阳」验证只读 effective cost 查询边界；现有 `costLte` / `costGte` 仍按印刷费用筛选。当前只替换低风险内联计数与 selector，不做 condition AST、typed formula builder 或 declarative steps；完整剩余清单见 `condition_query_remaining_inventory.md`。 |
| same-base rarity sync | `CARD_ABILITY_DEFINITIONS.baseCardCodes` + `src/shared/utils/card-code.ts` | 卡效登记、continuous live modifier registry 与费用修正已支持基础编号匹配；`tests/unit/card-effect-rarity-sync.test.ts` 会防止 exact `cardCodes` 漏掉同基础编号其他罕度。`existing_module_map.md` 已按基础编号记录完成/部分/同型/partial 状态。 |

## Remaining gaps

| priority | fragment_ids | proposed module / next action | current locations | notes |
|---|---|---|---|---|
| P0-next | `T06,S08,S09` broader AUTO event layer | Standard `GameEvent` + trigger matcher | `GameState.eventLog` 已落地；普通手牌登场、卡效从休息室登场、`member-state.ts`、普通 `TAP_MEMBER`、活跃阶段重置、普通 `MOVE_MEMBER_TO_SLOT`、舞台成员进休息室/换手替换/自送费用、LIVE 翻开进入 LIVE 开始检查时机、LIVE 成功效果窗口已写入登场、成员状态、成员槽位移动、离场、LIVE 开始与 LIVE 成功事件；`ON_ENTER_STAGE`、`ON_MEMBER_STATE_CHANGED`、`ON_MEMBER_SLOT_MOVED`、`ON_LEAVE_STAGE`、`ON_LIVE_START` 与 `ON_LIVE_SUCCESS` 已由 `enqueueTriggeredCardEffects` 优先消费事件流，仍保留 fallback | `PL!HS-bp2-012-N` 费用 5「乙宗 梢」与 `PL!HS-bp6-017-N` 费用 11「日野下花帆」已完成 S08 proving；`PL!HS-sd1-001-SD` 费用 9「日野下花帆」验证 `LeaveStageEvent.replacingCardId` relay 来源条件；`PL!HS-pb1-009-R` 费用 15「日野下花帆」已完成登场监听、每回合限制、LIVE 开始条件与无输入 AUTO 手动确认 proving；`PL!N-bp4-018-N` 费用 7「近江彼方」与 `PL!-pb1-015` 费用 7「西木野真姬」已完成成员状态变化事件消费 proving；`PL!SP-bp4-011-P` 费用 7「鬼冢冬毬」已完成 S09 成员移动事件消费 proving；`PL!HS-bp5-019-L` 分数 6「花结」与 `PL!HS-bp6-004-R` 费用 13「百生 吟子」验证 `LiveStartEvent` 消费，`PL!HS-bp6-001` 费用 4「日野下花帆」与 `PL!HS-cl1-009` 分数 1「水彩世界」验证 `LiveSuccessEvent` 消费。后续重点是把更多区域移动/费用支付等 helper 写入 `eventLog`，再继续把 trigger matcher 从逐类型扫描迁到通用 matcher。 |
| P1-soon | `C07,X02,L01,L02` | Reveal-from-hand + conditional exchange step | `PL!-sd1-006-SD` resolver；`PL!HS-bp5-001` 费用 11「日野下花帆」bespoke reveal-hand step | `PL!HS-bp5-001` 已打开公开手牌隐私投影与公开确认窗口，但还没有抽通用 reveal-from-hand step。下一张公开手牌/交换效果出现时再抽。 |
| P1-soon | `X01,X04,X05,X06,X13` | Condition/query AST | 001 success Live condition, 009 waiting room μ's count, 022 success Live scaling, `PL!HS-bp5-019-L` 分数 6「花结」LIVE 区计数, `PL!HS-bp2-022-L+` 分数 2「アオクハルカ」休息室 `Cerise Bouquet` LIVE 计数, `PL!HS-bp1-003` 费用 13「乙宗梢」三面不同名莲之空条件, `PL!HS-pb1-020` 费用 9「百生吟子」休息室 LIVE >=3 条件, `PL!HS-sd1-001` 费用 9「日野下花帆」relay 换上成员费用/团体条件 | `conditions.ts` 已提供第一版纯 query helper，并迁移部分区域/阈值计数；完整 condition AST、倍率公式 builder 与 declarative step 绑定仍未抽。 |
| P1-soon | `X03,B03` | Generic option-choice effect step | 003 Live-start Heart choice, `PL!HS-bp1-006-P` 费用 11「藤岛 慈」Heart choice, `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」target branch | UI shape 已支持 `selectableOptions`，慈已验证第二张 Heart 颜色选择样例，艾玛已验证选项分支后进入成员目标选择或直接结算能量分支；尚未抽成 declarative option resolver。可在下一张选择颜色/模式的卡出现时再抽。 |
| P1-soon | `F03,F04,F05,F06,F13` workflow orchestration | Declarative look-top workflow config | 004/015/019/Karin/`PL!HS-bp5-001`/`PL!HS-bp5-008-R`/`PL!HS-bp6-001`/`PL!HS-PR-019-RM` runner orchestration | 原语已外移；下一步不是再移动底层函数，而是把 `lookN`、动态数量、selector、reveal、rest destination、ordered selection、confirm-only public reveal 等变成 ability config。 |
| P1-soon | `B01,B02,B05,B06,B07,B08,T05` condition-bound builders | Typed Live modifier builders and continuous registry config | 001/009/022/`PL!HS-pb1-009-R`/`PL!HS-bp5-001`/`PL!HS-bp5-019-L`/`PL!HS-bp1-003`/`PL!HS-bp2-022-L+`/`PL!HS-sd1-006-SD`/`PL!HS-PR-019-RM` effect-specific condition + builder code | `addLiveModifier` / `replaceLiveModifier` 已是主写入路径；成员有效 BLADE、此 Live 卡分数与玩家合计分数投影已落地，后续仍可抽 typed builder 与条件 DSL。 |
| P1-soon | `F12` | Draw-then-deck-placement composed steps | none yet | F02 抽 2 弃 1已有第一条 proving path；F12 继续等待实际样例验证 deck placement 与 refresh semantics。 |
| P2-later | unmatched/P2 special fragments | Custom resolver hook with explicit boundaries | none urgent | 继续允许低频特例留在 runner，但内部必须复用 cost/selector/look-top/move/modifier APIs。 |

## Still-inline implemented effects

| card | inline part | why not migrated yet |
|---|---|---|
| `PL!-sd1-006-SD` | 公开手牌 Live，成功区 Live 入手，公开牌放成功区 | 涉及 C07、条件“如此做”、双区域交换；当前只有一个 proving card。 |
| `PL!HS-PR-001-PR` 费用 10「日野下花帆」 | 登场看顶 3 选 1 与 LIVE 开始支付 `[E][E]` 获得 `[BLADE]` 的流程串联 | 登场段和 LIVE 开始段均已落地；`effect-costs`、`look-top`、固定 BLADE live modifier 支付壳已复用。剩余问题是完整 step pipeline 尚未配置化。 |
| `PL!-sd1-003-SD` / `PL!HS-bp1-006-P` 费用 11「藤岛 慈」 / `PL!HS-bp1-004-P` 费用 15「夕雾缀理」 | Heart color / pay-or-decline option step | UI 支持已存在，且已有第二张 Heart 颜色选择样例；夕雾缀理也复用 `selectableOptions` 做 LIVE 开始支付/不发动选择。尚未抽成 generic option-choice step。 |
| `PL!-sd1-004-SD` | 公开被选 Live 后确认入手的流程串联 | look-top 原语已复用；workflow config 尚未抽。 |
| `PL!-sd1-009-SD` / `PL!HS-bp2-022-L+` 分数 2「アオクハルカ」 | 休息室卡牌数量条件 | 区域计数已开始复用 `conditions.ts`；condition AST 尚未建立。 |
| `PL!-sd1-022-SD` / `PL!HS-bp5-019-L` 分数 6「花结」 | 按区域数量缩放的 requirement builder | 区域计数已开始复用 `conditions.ts`，live modifier 写入已统一；倍率/条件表达仍在 resolver。 |
| `PL!HS-sd1-006-SD` 费用 15「安养寺姬芽」 | 登场条件成立后活跃能量 + 回收 LIVE，LIVE 开始支付能量得 BLADE 的流程串联 | 舞台成员存在性已开始复用 `conditions.ts`；energy、zone-selection、effect-costs、live-modifiers 均已复用；条件 AST 与复合 step pipeline 尚未抽。 |
| `PL!HS-bp5-008-R` 费用 4「桂城泉」 | 自身待机 + 弃手后看顶 5 公开高费成员 | C05/C06 与 `costGte` 已复用；look-top workflow config 尚未抽。 |
| `PL!HS-pb1-004-R` 费用 4「百生吟子」 | 支付能量 + 弃手、顶 3 入休息室后回收 Cerise Bouquet LIVE | C03/C01/F06/F08 原语已复用；“支付成功后连续执行两步”的 step pipeline 尚未抽。 |
| `PL!HS-PR-019-RM` 费用 2「百生吟子」 | 公开检视顶 3、确认后入休息室、全为绿色 Heart 成员则得绿色 Heart | inspection 与 live modifier 已复用；公开确认窗口与条件判断仍在 runner orchestration。 |
| `PL!HS-bp5-001` 费用 11「日野下花帆」 | 登场公开检视顶 4 后条件 BLADE；起动公开手牌 LIVE 并回收同名 LIVE | inspection、live modifier、能量费用、zone-selection、私有候选投影与公开确认窗口均已复用/起步；公开手牌 step 和同名候选 selector 仍在 runner。 |
| `PL!HS-bp1-003` 费用 13「乙宗梢」 | 起动低费莲之空成员回收；三面不同名莲之空常时分数 | zone-selection 与 continuous registry 已复用；三面不同名条件仍是 effect-specific helper，未抽 condition AST。 |
| `PL!HS-pb1-020` 费用 9「百生吟子」 | 条件弃 2 手牌后 Cerise Bouquet 成员 + 莲之空 LIVE 分组回收 | 弃手与 zone-selection 已复用；分组上限/强制选择仍在 runner 校验。 |
| `PL!HS-bp6-001` 费用 4「日野下花帆」 / `PL!HS-cl1-009` 分数 1「水彩世界」 / `PL!HS-bp6-027` 分数 5「月夜見海月」 | 声援公开卡选择、回顶/入手/入休息室、追加声援 | `PL!HS-bp6-001` 登场段的舞台成员数已开始复用 `conditions.ts`；`cheer-selection.ts` 已支持手牌、卡组顶、休息室与多选；`cheer.ts` 已支持追加公开、登记本次声援卡并写入 `CheerEvent`。卡组底目的地与重做声援仍待样例。 |
| `PL!SP-PR-004-PR` | 可选弃手后放置待机能量的流程串联 | C01 与 E03 原语已复用；完整 step pipeline 尚未配置化。 |
| `PL!SP-bp4-008-P` 费用 13「若菜四季」 | 左侧/右侧登场确认流程仍在 runner 串联 | 来源槽位条件、F02 抽弃组合步骤、E02 能量方向 helper 已复用；LIVE 开始 S05 已通过通用站位变换壳复用 `member-state.ts`。 |
| `S07` / 非手牌方式登场 | 更多来源区域与事件 ordering 边界 | `PL!S-bp2-006-P` 费用 11「津岛善子」已验证从休息室登场后继续触发被登场成员自己的登场能力；当前通过 `enqueueTriggeredCardEffects` 显式登场来源入队，触发逻辑不写进 S07 移动原语。后续扩卡组/成功区/能量下方等来源时，继续复用同一入口并补 ordering 样例。 |
| `PL!HS-bp2-012-N` 费用 5「乙宗 梢」 | AUTO look-top workflow orchestration 与完整事件层 | 已完成最小 `ON_LEAVE_STAGE` 能力；看顶5公开成员入手流程仍在 runner 串联，完整 declarative look-top workflow 与标准 `GameEvent` 后续再抽。 |
| `PL!HS-bp6-017-N` 费用 11「日野下花帆」 | AUTO grouped recovery workflow 与完整事件层 | 已完成同一 `ON_LEAVE_STAGE` 能力下的可选弃手和 LIVE/成员各至多1张回收；分组上限仍在 runner 校验，后续可抽 grouped zone selection config。 |

## Next non-`PL!-sd1` proving candidates from catalog

这些候选来自 catalog 回扫，优先选择已有底座可覆盖、风险较低、能证明“不是只为 μ's 预组写死”的卡。

| candidate | fragments | why useful |
|---|---|---|
| `PL!HS-PR-002-PR` 费用 10「村野さやか」 | `T01,C01,F03` | 同上，可作为第二张同构样例，验证配置化而不是单卡分支。 |

已可继续选择真实 AUTO / LIVE 开始 / LIVE 成功样例扩边界；本批 `绿莲-6弹ver.yaml` 已落地 `PL!HS-bp5-001` 费用 11「日野下花帆」、`PL!HS-bp1-003` 费用 13「乙宗梢」、`PL!HS-bp1-002` 费用 11「村野沙耶香」、`PL!HS-sd1-001` 费用 9「日野下花帆」、`PL!HS-pb1-020` 费用 9「百生吟子」、`PL!HS-bp6-001` 费用 4「日野下花帆」、`PL!HS-cl1-009` 分数 1「水彩世界」、`PL!HS-bp6-031` 分数 8「ファンファーレ！！！」与 `PL!HS-bp6-027` 分数 5「月夜見海月」。下一步建议继续抽 condition / look-top / reveal-hand / grouped selection 配置；重做声援与更完整 cheer loop 语义等待新样例。仍不建议一次性上完整事件系统或 refresh 语义；保持一张卡一条事件边界的小步节奏。
