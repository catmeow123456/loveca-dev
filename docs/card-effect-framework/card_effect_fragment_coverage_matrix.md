# Loveca card effect fragment coverage matrix

日期：2026-06-13  
输入：`references/codex_loveca_reuse_audit_pack.zip` 中的 `loveca_effect_fragments_catalog.json`。  
范围：覆盖 catalog 当前 75 个 fragment。这里的“全覆盖”指当前审查包中的 fragment 全覆盖，不代表未来新商品或规则更新不会出现新 fragment。

## Classification

| bucket | meaning |
|---|---|
| `core_v1` | 框架第一版设计必须纳入；代码第一阶段至少要有可落地路径或明确接口。 |
| `core_v2` | 框架第一版要预留模块边界，但可等第一批卡效迁移稳定后再实现。 |
| `special_hook` | 不适合先抽成通用模块，但必须能通过 custom resolver 挂入，并复用公共 cost/selector/event/move/modifier API。 |
| `defer` | 暂不单独抽象；仅记录原因，后续出现更多同类卡再上提。 |
| `needs_review` | 需要规则文本、FAQ 或用户确认后才能定边界。 |

## Matrix

| fragment_id | tier | fragment_name | intended_framework_module | bucket | notes |
|---|---|---|---|---|---|
| `T01` | P0 | 登场时能力 | trigger registry: `onEnterStage()` | `core_v1` | 登场本质上是标准自动诱发时点，不应和 `AUTO` 分开设计。 |
| `T02` | P0 | LIVE开始时能力 | trigger registry: `onLiveStart()` | `core_v1` | 已有多张样例；`PL!HS-bp6-004-R` 费用 13「百生 吟子」验证同一来源卡在同一 LIVE 开始窗口产生两条能力时，顺序选择可用 option 按具体效果区分。仍需纳入完整通用 trigger matcher。 |
| `T03` | P0 | 起动能力 | activated ability shell | `core_v1` | 需要统一合法时点、来源、费用、次数限制、UI 展示。 |
| `T04` | P0 | LIVE成功时能力 | trigger registry: `onLiveSuccess()` | `core_v1` | 已由 019 验证；应作为自动诱发时点。 |
| `T05` | P0 | 常时能力 | continuous modifier registry | `core_v1` | Stage 1D 已起步：`001` 常时 BLADE 通过 registry 由 `collectLiveModifiers` 动态收集，不入队、不写状态。 |
| `T06` | P1 | 自动能力 | generic event trigger: `onEvent(predicate)` | `core_v1` | Stage 1O 已用 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」与 `PL!HS-bp6-017-N` 费用 11「日野下花帆」打开离场 AUTO；Stage 1P 已用 `PL!HS-pb1-009-R` 费用 15「日野下花帆」打开舞台成员监听 `ON_ENTER_STAGE` 的 AUTO，并验证手动顺序选择无输入 AUTO 时的 confirm-only active effect。完整 `GameEvent -> trigger matcher` 仍后续扩。 |
| `T07` | P0 | 每回合1次限制 | limit/gate module | `core_v1` | 已由 `PL!-sd1-008-SD` 费用未登记「小泉 花陽」和 `PL!HS-pb1-009-R` 费用 15「日野下花帆」验证；按来源卡实例而非卡名/玩家同名能力计数。 |
| `C01` | P0 | 可选弃N张手牌 | cost: `optional(discardHand(n, selector?))` | `core_v1` | Stage 1B 已落地 N=1 手选弃手移动；`PL!HS-bp6-004-R` 费用 13「百生 吟子」继续复用该步骤，并在结算时按弃置卡姓名判断额外 BLADE。后续需支持 N>1 与 selector 约束。 |
| `C02` | P0 | 弃N张手牌 | cost: `discardHand(n, selector?)` | `core_v1` | Stage 1B 已落地手牌 -> 休息室移动 API；强制/效果弃牌后续继续复用。 |
| `C03` | P0 | 支付N点能量 | cost: `payEnergy(n, optional?)` | `core_v1` | Stage 1B 已落地横置前 N 张活跃能量；后续需要产生 `ENERGY_PAID` event。 |
| `C04` | P0 | 自身从舞台进休息室 | cost: `moveSourceMemberToWaitingRoom()` | `core_v1` | Stage 1B 已落地来源成员和下方附属卡进休息室；后续必须产生 `CARD_MOVED` event，供未来自动监听。 |
| `C05` | P1 | 自身转为待机 | cost: `setSourceMemberState(WAITING)` | `core_v1` | 不是 μ's 预组重点，但要和 S01/S02 状态模块同源。 |
| `C06` | P1 | 复合费用：待机自身并弃手 | cost composition | `core_v1` | 由 C05 + C01 组合，框架需支持多费用顺序与失败回滚策略。 |
| `C07` | P1 | 公开手牌/公开手牌中的卡 | cost/pre-step: `revealFromHand(selector,count,optional)` | `core_v1` | 用户指出的典型非 μ's 简单效果；必须纳入费用/前置动作模型。 |
| `C08` | P2 | 从手牌弃指定名称/组别卡 | selector-constrained discard cost | `core_v2` | 可由 C02 + selector 覆盖，不必第一批做完整。 |
| `C09` | P2 | 休息室卡洗/放回卡组底 | zone move/reorder: WR -> deck | `core_v2` | 低频，但应复用通用 zone move + order/shuffle。 |
| `F01` | P0 | 抽N张牌 | effect step: `drawCards(n)` | `core_v1` | Stage 1F 已对当前 μ's 验证集收口：`drawCardsFromMainDeckToHand` 覆盖卡效步骤的主卡组顶抽牌到手牌；007 额外抽 1 已迁入，并覆盖翻到/未翻到 LIVE 两条路径。 |
| `F02` | P0 | 抽N弃M | composed step: `drawThenDiscard(n,m)` | `core_v1` | Stage 1J 已起步：`PL!SP-bp4-008-P` 费用 13「若菜四季」左侧登场与 `PL!HS-bp1-006-P` 费用 11「藤岛 慈」登场均复用 `drawCardsFromMainDeckToHand` 与手牌进休息室 helper；Stage 1P 已由 `PL!HS-pb1-009-R` 费用 15「日野下花帆」LIVE 开始 BLADE 阈值段复用同一抽 2 弃 1 流程。弃 M 张/抽牌刷新语义等继续等样例扩展。 |
| `F03` | P0 | 看顶N，选任意/固定数量入手，其余进休息室 | look-top pipeline | `core_v1` | Stage 1C 已落地基础检视/选中入手其余入休息室原语，当前 `PL!-sd1-011/012/016-SD` 与 `PL!HS-PR-001-PR` 可验证。 |
| `F04` | P0 | 看顶N，公开符合条件的卡入手，其余进休息室 | look-top select + reveal pipeline | `core_v1` | Stage 1C 已复用基础检视/清理/移动原语，当前 `PL!-sd1-004-SD`、`PL!-sd1-015-SD`、`PL!-bp3-010-N` 可验证；公开确认步骤仍在 runner。 |
| `F05` | P0 | 看顶N，任意张按任意顺序放回卡组顶，其余进休息室 | look-top reorder pipeline | `core_v1` | Stage 1C 已复用看顶进入检视区原语，当前 019 可验证；排序完成步骤仍在 runner。 |
| `F06` | P0 | 从卡组顶将N张置入休息室 | deck move: top -> waitingRoom | `core_v1` | Stage 1C 已落地检视牌入休息室与卡组顶 N 张直接入休息室原语，当前 007/008 可验证。 |
| `F07` | P0 | 从休息室将卡加入手牌 | zone selection/move | `core_v1` | Stage 1A 第一版已落地到 `src/application/effects/zone-selection.ts`，当前覆盖 `WAITING_ROOM -> HAND` 单选路径；`PL!-pb1-019-N` 费用 2「高坂穗乃果」与 `PL!-bp4-003-P` 费用 2「南琴梨」已验证非预组起动扩样本。 |
| `F08` | P0 | 从休息室回收LIVE卡 | F07 specialization with selector `type=LIVE` | `core_v1` | Stage 1A 已用 `typeIs(LIVE)` 配置 001/005；`PL!-bp4-003-P` 费用 2「南琴梨」继续复用同一路径，不做单独硬编码函数。 |
| `F09` | P0 | 从休息室回收成员卡 | F07 specialization with selector `type=MEMBER` | `core_v1` | Stage 1A 已用 `typeIs(MEMBER)` 与组合 selector 配置 002/003；`PL!-pb1-019-N` 费用 2「高坂穗乃果」继续复用同一路径。 |
| `F10` | P1 | 从休息室放回卡组顶/底 | zone selection/move + deck position | `core_v2` | 与 F07 共用 source selector，与 F05 共用 deck order。 |
| `F11` | P2 | 公开卡组顶直到满足条件，目标入手，其余进休息室 | reveal-until pipeline | `special_hook` | 低频且流程特殊；先用 custom step，内部复用 reveal/move。 |
| `F12` | P1 | 抽牌后将手牌放到卡组顶/底 | draw + hand selection + deck placement | `core_v2` | 需要 ordered hand selection；等待实际样例再扩展。 |
| `F13` | P1 | 看/公开卡组顶单张后处理 | peek/reveal top pipeline | `core_v1` | Stage 1C 已复用公开看顶单张进入检视区原语，Karin 样例可验证；后续可继续抽单张 reveal-and-route step。 |
| `F14` | P1 | 从声援公开的卡中选择加入手牌 | cheer revealed selection | `core_v2` | 全卡池重要；依赖独立 `cheerRevealedCards` 区域/上下文。 |
| `F15` | P2 | 处理声援公开的卡：放入休息室/卡组顶/底 | cheer revealed movement | `core_v2` | 与 F14 同属声援公开卡子系统，低频但需预留。 |
| `B01` | P0 | LIVE结束时为止获得BLADE | live modifier: `grantBlade(untilLiveEnd)` | `core_v1` | `PL!HS-pb1-009-R` 费用 15「日野下花帆」AUTO 第一段已通过 `addLiveModifier` 写入 BLADE +2；同卡第二段已用 `getMemberEffectiveBladeCount` 统计印刷 BLADE + 同来源 BLADE modifier。`PL!HS-bp6-004-R` 费用 13「百生 吟子」验证可选弃手后按弃置卡姓名写入 BLADE +1/+2。 |
| `B02` | P0 | LIVE结束时为止获得HEART | live modifier: `grantHeart(untilLiveEnd)` | `core_v1` | 高频，必须进入 modifier/duration layer。 |
| `B03` | P1 | 选择颜色后获得对应HEART | option choice + B02 | `core_v1` | Stage 1D 已迁移：当前 003 Live-start 通过 `addLiveModifier` 写入 `HEART`，旧 Heart Map 仅为兼容投影。 |
| `B04` | P1 | 将自身原本HEART改成选择的HEART | printed stat replacement modifier | `core_v2` | 与普通 grantHeart 不同，要区分替换基础 HEART。 |
| `B05` | P0 | LIVE合计分数增加 | live modifier: total score delta | `core_v1` | Stage 1D 已迁移：当前 009 通过 `addLiveModifier` 写入 `SCORE`，自动判定读取 `collectLiveModifiers`。 |
| `B06` | P0 | 此LIVE卡分数增加 | live modifier: this live score delta | `core_v1` | 虽当前样例少，但 P0，设计层必须有。 |
| `B07` | P1 | 减少LIVE必要HEART | requirement modifier | `core_v1` | Stage 1D 已迁移：当前 022 通过 `replaceLiveModifier` 写入 `REQUIREMENT`，旧 requirement Map 仅为兼容投影。 |
| `B08` | P1 | 条件成立期间获得BLADE/HEART | continuous printed stat modifier | `core_v1` | Stage 1D 已有 continuous registry；当前 001 动态 BLADE 可验证，更多条件型常时修正后续增 definition。 |
| `B09` | P2 | 将LIVE必要HEART改为指定组合 | requirement set/replace modifier | `core_v2` | 与 B07 的 delta 不同，需预留 set semantics。 |
| `S01` | P0 | 将成员变为待机 | state step: `setMemberOrientation(WAITING)` | `core_v1` | Stage 1E 已起步：`member-state.ts` 提供卡效层成员状态原语；普通规则 TAP_MEMBER 不迁入 card effects。 |
| `S02` | P0 | 将成员变为活跃 | state step: `setMemberOrientation(ACTIVE)` | `core_v1` | Stage 1E 已起步：与 S01 共用 `setMemberOrientation`；Stage 1M 已补 `setMembersOrientation` 批量方向 helper，并由 `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」LIVE 开始验证批量活跃 Liella! 成员；Stage 1N 已由 `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」验证选择 1 名待机舞台成员变活跃。 |
| `S03` | P1 | 按费用≤N待机对方成员 | target selector + S01 | `core_v2` | Stage 1Q 已由 `PL!HS-bp6-004-R` 费用 13「百生 吟子」起步：通过 `stage-targets.ts` 舞台成员目标 helper + `card-selectors.ts` 组合 selector 筛选对方费用 <= 9 成员，并复用 `setMemberOrientation(WAITING)`。后续可把目标选择 active effect 配置化。 |
| `S04` | P1 | 按原本BLADE≤N待机对方成员 | target selector + S01 | `core_v2` | 需要 printed stat selector。 |
| `S05` | P1 | 站位变换/区域移动 | position change step | `core_v1` | Stage 1E 已起步：Karin 站位变换已调用 `moveMemberBetweenSlots`；`PL!SP-bp4-008-P` 费用 13「若菜四季」LIVE 开始可选站位变换也已复用该 helper，支持空槽移动/成员交换并携带下方卡。 |
| `S06` | P1 | 从手牌登场成员 | put member from hand to stage | `core_v2` | 涉及登场事件和登场费用/限制，需谨慎。 |
| `S07` | P1 | 从休息室登场成员 | put member from WR to stage | `core_v2` | Stage 1M 已起步：`playMembersFromWaitingRoomToEmptySlots` 支持卡效从休息室登场到空成员区，`PL!S-bp2-006-P` 费用 11「津岛善子」验证支付4能量后选择至多2张费用合计≤4成员登场；当前不走普通登场费用/换手。非手牌方式登场的成员已通过 `enqueueTriggeredCardEffects` 的显式登场来源继续触发自己的登场能力。 |
| `S08` | P1 | 成员从舞台进休息室时触发 | event trigger: stage -> WR | `core_v1` | Stage 1O 已起步：`PL!HS-bp2-012-N` 费用 5「乙宗 梢」验证普通舞台进休息室、换手替换离场 AUTO 入队，以及与同动作登场能力共享顺序选择窗口；`PL!HS-bp6-017-N` 费用 11「日野下花帆」继续验证同触发下的弃手后分组回收。 |
| `S09` | P2 | 成员区域移动时触发 | event trigger: member area moved | `core_v2` | 低频，但由通用 `CARD_MOVED/AREA_MOVED` event 覆盖。 |
| `S10` | P2 | 将卡放到成员下/从成员下登场或移动 | attached card subsystem | `special_hook` | 涉及成员下方附属卡结构，先用 custom hook，内部复用标准 move/event。 |
| `E01` | P0 | 支付能量/文本涉及能量支付 | energy cost parser/payment | `core_v1` | 与 C03 同模块；Stage 1B 已落地基础能量支付函数。 |
| `E02` | P1 | 将能量变为活跃 | energy state step | `core_v2` | Stage 1I 已起步：`src/application/effects/energy.ts` 提供 `setEnergyOrientation` / `setFirstEnergyCardsOrientation`，`PL!SP-bp4-008-P` 费用 13「若菜四季」右侧登场验证最多 2 张待机能量变活跃；Stage 1M 已由 `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」LIVE 开始验证全部能量变活跃；Stage 1N 已由 `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」验证选择能量分支后自动按能量区顺序处理至多 2 张待机能量。能量没有个体差异，不要求玩家逐张选择具体能量卡。 |
| `E03` | P1 | 从能量卡组放置能量 | energy deck movement | `core_v2` | Stage 1I 已起步：`src/application/effects/energy.ts` 提供 `placeEnergyFromDeckToZone`，`PL!SP-PR-004-PR` 验证从能量卡组顶放置 1 张待机能量。 |
| `E04` | P2 | 能量放到成员下/从成员下返回 | attach/return energy under member | `special_hook` | 与附属卡/成员下方结构相关，先保留 hook。 |
| `E05` | P2 | 能量数量作为条件 | condition: energy count | `core_v2` | 可纳入 condition AST。 |
| `E06` | P2 | 追加声援/重做声援 | cheer action step | `core_v2` | 依赖声援公开卡子系统。 |
| `L01` | P1 | 参照成功LIVE区 | zone query: success live zone | `core_v1` | 001/022 等已用，需要 query module。 |
| `L02` | P1 | 参照LIVE卡置场/正在LIVE | zone query: current live/live zone | `core_v1` | Live modifier 和成功时能力需要。 |
| `L03` | P2 | ALL_BLADE当任意颜色HEART | special marker rule | `special_hook` | 属于判定规则 override，不是普通 effect step。 |
| `L04` | P2 | SCORE标记增加成功LIVE合计分数 | cheer marker resolver | `core_v2` | 可纳入 marker resolution subsystem。 |
| `L05` | P2 | DRAW标记抽牌 | cheer marker resolver | `core_v2` | 同 L04。 |
| `L06` | P2 | 不可放入成功LIVE区 | replacement/prohibition rule | `special_hook` | 需要 replacement/prohibition hook，不先通用化。 |
| `X01` | P0 | 如果/条件成立才执行 | condition combinator | `core_v1` | 整个 DSL 的基础。 |
| `X02` | P0 | 支付/执行成功后“如此做的场合” | previous step result binding | `core_v1` | 不能用模糊 boolean，需要 step result。 |
| `X03` | P1 | 多选一/从选项中选择 | option choice step | `core_v1` | UI 已有 `selectableOptions`，Stage 1N 已由 `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」验证成员/能量目标类型二选一；Stage 1Q 已由 `PL!HS-bp6-004-R` 费用 13「百生 吟子」验证同源多 pending ability 的顺序选择 option。成员分支进入后续选择步骤时清空旧选项，能量分支直接自动结算。 |
| `X04` | P1 | 按组别/团体名筛选 | selector: group | `core_v1` | 不应硬编码 μ's。 |
| `X05` | P1 | 按成员名/卡名筛选 | selector: name/card name | `core_v1` | `cardNameIs` 已落地，使用姓名去空白归一化；`PL!HS-bp6-004-R` 费用 13「百生 吟子」已复用它判断弃置成员是否为「百生吟子」。后续可继续补 cardCode/nameIn 等 selector。 |
| `X06` | P1 | 按费用/分数/必要HEART等数值筛选 | selector: numeric predicate | `core_v1` | 成本、分数、BLADE、必要 HEART 都要统一。 |
| `X07` | P2 | 所有区域中视为多个组别 | identity override | `core_v2` | 影响 selector 结果，先预留 identity layer。 |
| `X08` | P2 | 换手/バトンタッチ相关条件或禁止 | baton touch condition/restriction | `core_v2` | 数量不低，但规则边界独立，暂后置。 |
| `X09` | P2 | 无效能力/不会活跃/禁止操作 | prohibition/disable effect | `special_hook` | 需要限制系统，不宜第一批抽象。 |
| `X10` | P2 | 发动/无效其他卡的能力 | referenced ability resolver | `special_hook` | 复杂度高，custom resolver 挂接。 |
| `X11` | P1 | 手牌中成员/登场费用减少 | cost modifier | `core_v2` | Stage 1L 已起步：`cost-calculator.ts` 支持登场费用修正明细，`LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」验证手牌中的自身按其他手牌数量每张 -1 费且自身不计入数量；`PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」验证舞台存在待机状态『虹咲』成员时自身 -2 费；`PL!SP-bp5-003-AR` 费用 17「岚 千砂都」验证舞台来源使手牌中 10 费 Liella! 成员登场费用 -2，且先减费再换手。 |
| `X12` | P2 | 无能力/能力类型筛选 | selector: ability presence/type | `core_v2` | 可纳入 selector AST。 |
| `X13` | P2 | 按数量每N个/每1张换算效果 | scaling expression | `core_v1` | 001/022 这类按数量换算已出现；表达层必须有。 |

## Coverage summary

- `core_v1`: 45 fragments
- `core_v2`: 23 fragments
- `special_hook`: 7 fragments
- `defer`: 0 fragments
- `needs_review`: 0 fragments

这里的分配重点是：**设计层不遗漏当前 catalog 中的任何 fragment，但实现层仍按风险和验证样本分批推进。**

Stage 1A-1F 已把 `F07/F08/F09`、`C01/C02/C03/C04/E01`、`F03/F04/F05/F06/F13`、`F01`、`B03/B05/B07/B08/T05`、`S01/S02/S05` 的当前验证集主路径落到模块底座。Stage 1I 已把 `E03` 的能量卡组放置与 `E02` 的能量方向变更起步到底座，并用 `requiredSourceSlots` 打开来源槽位条件过滤。Stage 1J 已用 `PL!SP-bp4-008-P` 费用 13「若菜四季」左侧登场与 `PL!HS-bp1-006-P` 费用 11「藤岛 慈」登场验证 `F02` 抽 2 弃 1 组合步骤，并用 `PL!-pb1-019-N` 费用 2「高坂穗乃果」和 `PL!-bp4-003-P` 费用 2「南琴梨」验证自送休息室后的成员/LIVE 回收扩样本。Stage 1K 已补完 `PL!SP-bp4-008-P` 费用 13「若菜四季」LIVE 开始可选站位变换，继续复用 `member-state.ts`。Stage 1L 已用 `LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」、`PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」和 `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」打开 `X11` 登场费用修正底座。Stage 1M 已用 `PL!SP-bp5-003-AR` 费用 17「岚 千砂都」与 `PL!S-bp2-006-P` 费用 11「津岛善子」验证批量活跃与 `S07` 卡效登场边界。Stage 1N 已用 `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」验证 `X03` 二选一目标类型，并复用 `S02/E02` 方向 helper。Stage 1O 已用 `PL!HS-bp2-012-N` 费用 5「乙宗 梢」与 `PL!HS-bp6-017-N` 费用 11「日野下花帆」打开 AUTO / `S08` 离场触发 proving path；Stage 1P 已用 `PL!HS-pb1-009-R` 费用 15「日野下花帆」打开 `ON_ENTER_STAGE` 监听型 AUTO、`T07` 实例级每回合限制、`B01` BLADE modifier、成员有效 BLADE helper、`F02` 阈值抽弃与 confirm-only 无输入确认壳。Stage 1H 已用 catalog 回扫当前已实现卡牌，并刷新 `docs/card-effect-reuse-audit/` 下的 existing module / gap / safe plan。

下一批建议继续选择真实 AUTO 卡推进 `GameEvent -> trigger matcher`、when-if、对手目标或状态事件边界，或选择低风险同构卡继续减少 runner inline orchestration。公开手牌、声援公开卡、完整事件层等仍在框架边界内预留。
