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
| `T02` | P0 | LIVE开始时能力 | trigger registry: `onLiveStart()` | `core_v1` | 已有样例，但需要纳入通用 trigger matcher。 |
| `T03` | P0 | 起动能力 | activated ability shell | `core_v1` | 需要统一合法时点、来源、费用、次数限制、UI 展示。 |
| `T04` | P0 | LIVE成功时能力 | trigger registry: `onLiveSuccess()` | `core_v1` | 已由 019 验证；应作为自动诱发时点。 |
| `T05` | P0 | 常时能力 | continuous modifier registry | `core_v1` | Stage 1D 已起步：`001` 常时 BLADE 通过 registry 由 `collectLiveModifiers` 动态收集，不入队、不写状态。 |
| `T06` | P1 | 自动能力 | generic event trigger: `onEvent(predicate)` | `core_v1` | 必须在框架层预留；2026-06-13 决定因 μ's 预组缺少合适 AUTO proving case 暂缓，后续接真实自动能力卡牌时再设计/验证。 |
| `T07` | P0 | 每回合1次限制 | limit/gate module | `core_v1` | 不限于起动，未来自动/其他能力也可能有次数限制。 |
| `C01` | P0 | 可选弃N张手牌 | cost: `optional(discardHand(n, selector?))` | `core_v1` | Stage 1B 已落地 N=1 手选弃手移动；后续需支持 N>1 与 selector。 |
| `C02` | P0 | 弃N张手牌 | cost: `discardHand(n, selector?)` | `core_v1` | Stage 1B 已落地手牌 -> 休息室移动 API；强制/效果弃牌后续继续复用。 |
| `C03` | P0 | 支付N点能量 | cost: `payEnergy(n, optional?)` | `core_v1` | Stage 1B 已落地横置前 N 张活跃能量；后续需要产生 `ENERGY_PAID` event。 |
| `C04` | P0 | 自身从舞台进休息室 | cost: `moveSourceMemberToWaitingRoom()` | `core_v1` | Stage 1B 已落地来源成员和下方附属卡进休息室；后续必须产生 `CARD_MOVED` event，供未来自动监听。 |
| `C05` | P1 | 自身转为待机 | cost: `setSourceMemberState(WAITING)` | `core_v1` | 不是 μ's 预组重点，但要和 S01/S02 状态模块同源。 |
| `C06` | P1 | 复合费用：待机自身并弃手 | cost composition | `core_v1` | 由 C05 + C01 组合，框架需支持多费用顺序与失败回滚策略。 |
| `C07` | P1 | 公开手牌/公开手牌中的卡 | cost/pre-step: `revealFromHand(selector,count,optional)` | `core_v1` | 用户指出的典型非 μ's 简单效果；必须纳入费用/前置动作模型。 |
| `C08` | P2 | 从手牌弃指定名称/组别卡 | selector-constrained discard cost | `core_v2` | 可由 C02 + selector 覆盖，不必第一批做完整。 |
| `C09` | P2 | 休息室卡洗/放回卡组底 | zone move/reorder: WR -> deck | `core_v2` | 低频，但应复用通用 zone move + order/shuffle。 |
| `F01` | P0 | 抽N张牌 | effect step: `drawCards(n)` | `core_v1` | Stage 1F 已对当前 μ's 验证集收口：`drawCardsFromMainDeckToHand` 覆盖卡效步骤的主卡组顶抽牌到手牌；007 额外抽 1 已迁入，并覆盖翻到/未翻到 LIVE 两条路径。 |
| `F02` | P0 | 抽N弃M | composed step: `drawThenDiscard(n,m)` | `core_v1` | 由 F01 + C02/effect discard 组合；等待实际样例再迁移，避免只为未来卡空转抽象。 |
| `F03` | P0 | 看顶N，选任意/固定数量入手，其余进休息室 | look-top pipeline | `core_v1` | Stage 1C 已落地基础检视/选中入手其余入休息室原语，当前 011/012/016 可验证。 |
| `F04` | P0 | 看顶N，公开符合条件的卡入手，其余进休息室 | look-top select + reveal pipeline | `core_v1` | Stage 1C 已复用基础检视/清理/移动原语，当前 004/015 可验证；公开确认步骤仍在 runner。 |
| `F05` | P0 | 看顶N，任意张按任意顺序放回卡组顶，其余进休息室 | look-top reorder pipeline | `core_v1` | Stage 1C 已复用看顶进入检视区原语，当前 019 可验证；排序完成步骤仍在 runner。 |
| `F06` | P0 | 从卡组顶将N张置入休息室 | deck move: top -> waitingRoom | `core_v1` | Stage 1C 已落地检视牌入休息室与卡组顶 N 张直接入休息室原语，当前 007/008 可验证。 |
| `F07` | P0 | 从休息室将卡加入手牌 | zone selection/move | `core_v1` | Stage 1A 第一版已落地到 `src/application/effects/zone-selection.ts`，当前覆盖 `WAITING_ROOM -> HAND` 单选路径。 |
| `F08` | P0 | 从休息室回收LIVE卡 | F07 specialization with selector `type=LIVE` | `core_v1` | Stage 1A 已用 `typeIs(LIVE)` 配置 001/005，不做单独硬编码函数。 |
| `F09` | P0 | 从休息室回收成员卡 | F07 specialization with selector `type=MEMBER` | `core_v1` | Stage 1A 已用 `typeIs(MEMBER)` 与组合 selector 配置 002/003。 |
| `F10` | P1 | 从休息室放回卡组顶/底 | zone selection/move + deck position | `core_v2` | 与 F07 共用 source selector，与 F05 共用 deck order。 |
| `F11` | P2 | 公开卡组顶直到满足条件，目标入手，其余进休息室 | reveal-until pipeline | `special_hook` | 低频且流程特殊；先用 custom step，内部复用 reveal/move。 |
| `F12` | P1 | 抽牌后将手牌放到卡组顶/底 | draw + hand selection + deck placement | `core_v2` | 需要 ordered hand selection；等待实际样例再扩展。 |
| `F13` | P1 | 看/公开卡组顶单张后处理 | peek/reveal top pipeline | `core_v1` | Stage 1C 已复用公开看顶单张进入检视区原语，Karin 样例可验证；后续可继续抽单张 reveal-and-route step。 |
| `F14` | P1 | 从声援公开的卡中选择加入手牌 | cheer revealed selection | `core_v2` | 全卡池重要；依赖独立 `cheerRevealedCards` 区域/上下文。 |
| `F15` | P2 | 处理声援公开的卡：放入休息室/卡组顶/底 | cheer revealed movement | `core_v2` | 与 F14 同属声援公开卡子系统，低频但需预留。 |
| `B01` | P0 | LIVE结束时为止获得BLADE | live modifier: `grantBlade(untilLiveEnd)` | `core_v1` | 高频，必须进入 modifier/duration layer。 |
| `B02` | P0 | LIVE结束时为止获得HEART | live modifier: `grantHeart(untilLiveEnd)` | `core_v1` | 高频，必须进入 modifier/duration layer。 |
| `B03` | P1 | 选择颜色后获得对应HEART | option choice + B02 | `core_v1` | Stage 1D 已迁移：当前 003 Live-start 通过 `addLiveModifier` 写入 `HEART`，旧 Heart Map 仅为兼容投影。 |
| `B04` | P1 | 将自身原本HEART改成选择的HEART | printed stat replacement modifier | `core_v2` | 与普通 grantHeart 不同，要区分替换基础 HEART。 |
| `B05` | P0 | LIVE合计分数增加 | live modifier: total score delta | `core_v1` | Stage 1D 已迁移：当前 009 通过 `addLiveModifier` 写入 `SCORE`，自动判定读取 `collectLiveModifiers`。 |
| `B06` | P0 | 此LIVE卡分数增加 | live modifier: this live score delta | `core_v1` | 虽当前样例少，但 P0，设计层必须有。 |
| `B07` | P1 | 减少LIVE必要HEART | requirement modifier | `core_v1` | Stage 1D 已迁移：当前 022 通过 `replaceLiveModifier` 写入 `REQUIREMENT`，旧 requirement Map 仅为兼容投影。 |
| `B08` | P1 | 条件成立期间获得BLADE/HEART | continuous printed stat modifier | `core_v1` | Stage 1D 已有 continuous registry；当前 001 动态 BLADE 可验证，更多条件型常时修正后续增 definition。 |
| `B09` | P2 | 将LIVE必要HEART改为指定组合 | requirement set/replace modifier | `core_v2` | 与 B07 的 delta 不同，需预留 set semantics。 |
| `S01` | P0 | 将成员变为待机 | state step: `setMemberOrientation(WAITING)` | `core_v1` | Stage 1E 已起步：`member-state.ts` 提供卡效层成员状态原语；普通规则 TAP_MEMBER 不迁入 card effects。 |
| `S02` | P0 | 将成员变为活跃 | state step: `setMemberOrientation(ACTIVE)` | `core_v1` | Stage 1E 已起步：与 S01 共用 `setMemberOrientation`，后续接具体卡效时再补目标选择。 |
| `S03` | P1 | 按费用≤N待机对方成员 | target selector + S01 | `core_v2` | 由 selector + setMemberOrientation 组合；先预留对手目标选择。 |
| `S04` | P1 | 按原本BLADE≤N待机对方成员 | target selector + S01 | `core_v2` | 需要 printed stat selector。 |
| `S05` | P1 | 站位变换/区域移动 | position change step | `core_v1` | Stage 1E 已起步：Karin 站位变换已调用 `moveMemberBetweenSlots`，支持空槽移动/成员交换并携带下方卡。 |
| `S06` | P1 | 从手牌登场成员 | put member from hand to stage | `core_v2` | 涉及登场事件和登场费用/限制，需谨慎。 |
| `S07` | P1 | 从休息室登场成员 | put member from WR to stage | `core_v2` | 同 S06，但来源为公开区域。 |
| `S08` | P1 | 成员从舞台进休息室时触发 | event trigger: stage -> WR | `core_v1` | 支撑真正 AUTO 的关键事件；随 Stage 1G 暂缓，等 AUTO proving card 一起做。 |
| `S09` | P2 | 成员区域移动时触发 | event trigger: member area moved | `core_v2` | 低频，但由通用 `CARD_MOVED/AREA_MOVED` event 覆盖。 |
| `S10` | P2 | 将卡放到成员下/从成员下登场或移动 | attached card subsystem | `special_hook` | 涉及成员下方附属卡结构，先用 custom hook，内部复用标准 move/event。 |
| `E01` | P0 | 支付能量/文本涉及能量支付 | energy cost parser/payment | `core_v1` | 与 C03 同模块；Stage 1B 已落地基础能量支付函数。 |
| `E02` | P1 | 将能量变为活跃 | energy state step | `core_v2` | 与 S01/S02 类似，但目标是 energy zone。 |
| `E03` | P1 | 从能量卡组放置能量 | energy deck movement | `core_v2` | 需要 energy deck source 和 active/wait placement。 |
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
| `X03` | P1 | 多选一/从选项中选择 | option choice step | `core_v1` | UI 已有 selectableOptions 雏形。 |
| `X04` | P1 | 按组别/团体名筛选 | selector: group | `core_v1` | 不应硬编码 μ's。 |
| `X05` | P1 | 按成员名/卡名筛选 | selector: name/card name | `core_v1` | 全卡池高频。 |
| `X06` | P1 | 按费用/分数/必要HEART等数值筛选 | selector: numeric predicate | `core_v1` | 成本、分数、BLADE、必要 HEART 都要统一。 |
| `X07` | P2 | 所有区域中视为多个组别 | identity override | `core_v2` | 影响 selector 结果，先预留 identity layer。 |
| `X08` | P2 | 换手/バトンタッチ相关条件或禁止 | baton touch condition/restriction | `core_v2` | 数量不低，但规则边界独立，暂后置。 |
| `X09` | P2 | 无效能力/不会活跃/禁止操作 | prohibition/disable effect | `special_hook` | 需要限制系统，不宜第一批抽象。 |
| `X10` | P2 | 发动/无效其他卡的能力 | referenced ability resolver | `special_hook` | 复杂度高，custom resolver 挂接。 |
| `X11` | P1 | 手牌中成员/登场费用减少 | cost modifier | `core_v2` | 不是当前第一批，但费用系统设计必须预留 modifier。 |
| `X12` | P2 | 无能力/能力类型筛选 | selector: ability presence/type | `core_v2` | 可纳入 selector AST。 |
| `X13` | P2 | 按数量每N个/每1张换算效果 | scaling expression | `core_v1` | 001/022 这类按数量换算已出现；表达层必须有。 |

## Coverage summary

- `core_v1`: 45 fragments
- `core_v2`: 23 fragments
- `special_hook`: 7 fragments
- `defer`: 0 fragments
- `needs_review`: 0 fragments

这里的分配重点是：**设计层不遗漏当前 catalog 中的任何 fragment，但实现层仍按风险和验证样本分批推进。**

Stage 1A-1F 已把 `F07/F08/F09`、`C01/C02/C03/C04/E01`、`F03/F04/F05/F06/F13`、`F01`、`B03/B05/B07/B08/T05`、`S01/S02/S05` 的当前验证集主路径落到模块底座。Stage 1H 已用 catalog 回扫当前已实现卡牌，并刷新 `docs/card-effect-reuse-audit/` 下的 existing module / gap / safe plan。

下一批实现建议从非 `PL!-sd1` 低风险 proving card 开始，例如 `LL-bp1-001-R＋` 的 `T01,F07,F09`，或 `PL!HS-PR-001-PR` / `PL!HS-PR-002-PR` 的 `T01,C01,F03`。event trigger、公开手牌、声援公开卡、费用修正等仍在框架边界内预留；其中 Stage 1G AUTO/event layer 已明确暂缓，等真实 AUTO proving card 再实现。
