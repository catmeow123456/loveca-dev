# Loveca card effect module coverage

> 文档类型：专题说明
> 适用范围：卡效通用模块、覆盖的效果碎片、当前边界、proving cards 与测试入口
> 当前状态：模块覆盖说明；卡牌完成状态以 `existing_module_map.md` 为准
> 最后更新：2026-07-30

本文件只记录“哪些通用模块覆盖了哪些效果碎片”。卡牌完成状态请看 `existing_module_map.md`，同构批量扩样本请看 `card_effect_batch_expansions.md`。

## Reusable Modules

| module | covered fragments | current boundary | proving cards |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CARD_ABILITY_DEFINITIONS` in `src/application/card-effects/definitions/index.ts` | `T01,T02,T03,T04,T05,T06,T07` | 集中登记 category、trigger/source zone、queued、per-turn limit、`cardCodes` / `baseCardCodes` 与 UI 文案。ability id 在 `card-effects/ability-ids.ts`，definition 类型在 `card-effects/ability-definition-types.ts`；activeEffect step、activated ability 与 pending starter 结算均为 registry-first，分别走 `step-registry`、`activated-registry` 与 `starter-registry`。`activated-registry` 还允许 workflow 与 resolver 同处登记只读 preflight，供机器决策等调用方完整枚举合法起动动作；未登记项必须作为覆盖缺口处理，不得试跑 resolver。完整卡效 fallback 不应回流 runner；runner 仍保留 pending 生命周期、trigger/relay/matcher 胶水与 workflow 注册。 | 当前所有登记卡 |
| Base card-code matching | card identity | 卡效登记使用 `baseCardCodes`，同基础编号不同罕度自动匹配同一能力；`tests/unit/card-effect-rarity-sync.test.ts` 应阻止 exact `cardCodes` 漏同步，并证明新增/未知罕度无需追加 definition。 | `PL!HS-bp1-004` 费用 15「夕雾缀理」、`PL!HS-bp1-006` 费用 11「藤岛 慈」、`PL!HS-bp6-004` 费用 13「百生 吟子」、`PL!HS-pb1-004` 费用 4「百生吟子」、`PL!HS-PR-019` 费用 2「百生吟子」等 |
| Trigger enqueue functions in `src/application/card-effect-runner.ts` | `T01,T02,T04,T06,S08,E06` | 支持登场、LIVE 开始、LIVE 成功、自己进行声援时、离场 AUTO、成员状态变化 AUTO、成员槽位移动 AUTO、舞台成员监听登场 AUTO 与同一时点/同事件队列。登场与舞台成员 LIVE 开始会记录来源槽位，能力可通过 `requiredSourceSlots` 统一过滤左/中/右区域条件。LIVE 成功已支持成功 LIVE 卡来源与表演玩家舞台成员来源；`ON_CHEER` 优先消费 `CheerEvent`，追加声援事件不二次触发，旧扫描表演玩家 LIVE 区来源只作 fallback；004 重做声援会显式以 `additional=false` 新事件走同一入队路径，且来源已先记录 turn1。登场 AUTO 优先消费 `EnterStageEvent`；成员状态变化 AUTO 优先消费 `MemberStateChangedEvent`，并可读取玩家操作/规则处理/卡效 cause；离场 AUTO 优先消费 `LeaveStageEvent`，可携带换上成员 `replacingCardId` 与目的地区 `toZone` 做离场/relay 来源条件；LIVE 开始优先消费 `LiveStartEvent`；LIVE 成功优先消费 `LiveSuccessEvent`；pending ability 绑定真实 `eventId`。 | `PL!N-bp4-018` 费用 7「近江彼方」、`PL!-pb1-015` 费用 7「西木野真姬」、`PL!HS-bp2-012` 费用 5「乙宗 梢」、`PL!HS-bp5-003` 费用 2「大泽瑠璃乃」、`PL!HS-bp6-017` 费用 11「日野下花帆」、`PL!HS-sd1-001` 费用 9「日野下花帆」、`PL!HS-pb1-009` 费用 15「日野下花帆」、`PL!HS-bp6-004` 费用 13「百生 吟子」、`PL!HS-bp5-019` 分数 6「花结」、`PL!HS-bp6-001` 费用 4「日野下花帆」、`PL!HS-cl1-009` 分数 1「水彩世界」、`PL!HS-bp6-027` 分数 5「月夜見海月」、`PL!S-bp2-004` 费用 11「黒澤ダイヤ」 |
| Success-zone placement boundary in `src/application/game-session.ts` + `workflows/cards/pl-bp6-024-sakkaku-crossroads.ts` | success-zone placement replacement | 当前是窄 hook，不是 replacement DSL：普通成功结算由 `GameSession` 在写入成功区前调用 workflow，`PL!-sd1-006-SD` 公开手牌 LIVE 路径复用同一入口；workflow 只识别 `PL!-bp6-024` 基础编号并提供可跳过 activeEffect，目标限定为自己休息室 μ's LIVE。runner 只注册该 workflow 的 activeEffect handler，不拥有成功区放置决策。 | `PL!-bp6-024-L` 分数 3「錯覚CROSSROADS」 |
| `src/application/effects/card-selectors.ts` + `src/shared/utils/card-identity.ts` | `X04,X05,X06,C08` | 提供 `typeIs`、`groupIs`、`unitIs`、`unitAliasIs`、`unitAliasOrTextAliasIs`、`costLte`、`costGte`、`cardNameIs`、`cardNameAliasIs`、`memberHasHeartColor`、`liveRequiresHeartColor`、`hasNoAbilityOrContinuousAbility`、`and/or/not` 等最小 selector；`unitAliasIs` 委托 `cardBelongsToUnit` / `getCardUnitIdentities`，统一读取结构化 `unitName` 与显式按基础编号登记的常时虚拟 UNIT 身份，并可通过共享身份交集 query 判断两张卡是否持有至少一个相同 UNIT。`PL!HS-bp2-020` 分数 0「Link to the FUTURE」、`PL!HS-bp5-018` 分数 7「AURORA FLOWER」、`PL!HS-sd1-020` 分数 6「Link to the FUTURE（104期Ver.）」的三小组身份按基础编号覆盖所有罕度，不宽泛扫描 `cardText`；只有调用方明确要求读取文本身份时才使用 `unitAliasOrTextAliasIs`。`cardNameAliasIs` 覆盖当前卡库常见角色中日名、空白/中点差异、组合卡 `&` 分隔组件与早期中文误译/异体名；`hasNoAbilityOrContinuousAbility` 只读 `CardData.cardText`，空文本视为无能力，含【常时/常時】视为常时能力；`liveRequiresHeartColor` 只读 LIVE `requirements.colorRequirements`。尚未覆盖舞台状态、成功区分数等复杂条件。 | `LL-bp1-001` 费用 20「上原步梦&涩谷香音&日野下花帆」、`LL-bp2-001` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」、`PL!HS-PR-016` 费用 17「日野下花帆」、`PL!HS-PR-017` 费用 17「村野沙耶香」、`PL!HS-bp2-020` 分数 0「Link to the FUTURE」、`PL!HS-bp5-018` 分数 7「AURORA FLOWER」、`PL!HS-sd1-020` 分数 6「Link to the FUTURE（104期Ver.）」、`PL!HS-bp1-003` 费用 13「乙宗梢」、`PL!HS-bp1-004` 费用 15「夕雾缀理」、`PL!HS-bp6-004` 费用 13「百生 吟子」、`PL!HS-bp2-022` 分数 2「アオクハルカ」、`PL!HS-sd1-006` 费用 15「安养寺姬芽」、`PL!HS-bp5-008` 费用 4「桂城泉」、`PL!HS-pb1-004` 费用 4「百生吟子」、`PL!HS-pb1-020` 费用 9「百生吟子」、`PL!HS-cl1-009` 分数 1「水彩世界」、`PL!-bp6-002` 费用 2「绚濑绘里」、`PL!-bp6-005` 费用 11「星空凛」 |
| `src/application/effects/conditions.ts` / `src/domain/rules/success-live-score.ts` | `X01,L01,L02,X13` | 第一版纯函数 condition/query helper：区域卡牌计数、按 selector 计数与阈值判断、按 selector 返回 cardIds、成功 LIVE 数、成功 LIVE 分数合计、舞台成员数、舞台成员存在性、来源以外其他舞台成员、LIVE 区排除来源卡计数、来源成员有效 BLADE 阈值查询、舞台成员有效费用查询。成功 LIVE 分数合计的只读实现已下沉到 domain，`conditions.ts` 继续作为 application 复用出口；有效费用查询只服务需要读取“场上此成员费用”的路径，现有 `costLte` / `costGte` 仍为印刷费用 selector。当前不做 AST、不做声明式 steps，倍率公式由 workflow / modifier registry 局部承载，尚未抽 typed formula builder。 | `PL!-sd1-001` 费用 7「高坂穗乃果」、`PL!-sd1-009` 费用 11「矢泽妮可」、`PL!-sd1-022` 分数 4「僕らは今のなかで」、`PL!HS-bp5-019` 分数 6「花结」、`PL!HS-bp2-022` 分数 2「アオクハルカ」、`PL!HS-pb1-009` 费用 15「日野下花帆」、`PL!HS-pb1-020` 费用 9「百生吟子」、`PL!HS-sd1-006` 费用 15「安养寺姬芽」、`PL!HS-bp6-001` 费用 4「日野下花帆」、`PL!HS-bp6-031` 分数 8「ファンファーレ！！！」、`PL!HS-bp1-006` 费用 11「藤岛 慈」、`PL!-bp5-005` 费用 10「星空凛」、`PL!-bp5-008` 费用 13「小泉花阳」、`PL!-bp4-008` 费用 4「小泉花阳」 |
| `src/application/effects/stage-targets.ts` | `S03,X06` | 提供按 `playerId + CardSelector` 扫描左/中/右成员区的目标候选 helper，也可作为登场条件扫描。 | `PL!HS-bp6-004` 费用 13「百生 吟子」、`PL!HS-sd1-006` 费用 15「安养寺姬芽」 |
| `src/application/effects/stage-member-target-selection.ts` | `S01,S03,X06` | 提供舞台成员目标 active effect 配置入口：按 `targetPlayerId + CardSelector` 生成候选，创建单选 active effect，并在结算时调用 `setMemberOrientation`。 | `PL!HS-bp6-004` 费用 13「百生 吟子」 |
| `src/application/effects/zone-selection.ts` + `src/application/card-effects/runtime/actions.ts` + waiting-room recovery workflows | `F07,F08,F09` | `zone-selection.ts` 提供选择配置与 effect state；`runtime/actions.ts` 提供回收到手牌、按 caller 指定集合洗切后置底等原子动作。纯 pending、纯自送、支付能量、弃手费用和 grouped recovery 均已迁入 `workflows/shared/`；`PL!-PR-017` 费用 2「矢泽日香」与 `PL!S-bp3-008` 费用 4「小原鞠莉」共享 `self-sacrifice-waiting-room-to-hand.ts` 的有限后处理轴，不再有 `pl-pr-017-nico.ts`。`PL!HS-bp6-031-L` 分数 8「ファンファーレ！！！」的全部成员洗回、门槛与指定成员 BLADE 奖励已由 `workflows/cards/hs-bp6-031-fanfare.ts` 完整承载。公开手牌已有 `runtime/active-effect.ts` 的单张/复数 reveal helper 与多个 workflow 样本；尚未建立的是任意“公开手牌后执行任意交换/奖励”的 steps DSL。 | `PL!-pb1-019` 费用 2「高坂穗乃果」、`PL!-bp4-003` 费用 2「南琴梨」、`PL!HS-bp1-003` 费用 13「乙宗梢」、`PL!HS-bp1-004` 费用 15「夕雾缀理」、`PL!HS-bp6-017` 费用 11「日野下花帆」、`PL!-PR-017` 费用 2「矢泽日香」、`PL!S-bp3-008` 费用 4「小原鞠莉」、`PL!HS-bp6-031-L` 分数 8「ファンファーレ！！！」 |
| `src/application/effects/effect-costs.ts` | `C01,C02,C03,C04,C05,C06,C07,C08,E01` | 提供 `EffectCostDefinition`、弃手选择费用、即时横置能量、自送休息室、将来源成员变为指定方向；复合费用通过多个 definition 顺序组合。隐藏区候选可用 `selectableCardVisibility` 限制投影；公开后的手牌卡以 `revealedCardIds` 表达公开事实，阅读停留由 `runtime/public-reveal-dwell.ts` 统一承接。指定姓名多选弃置已由 `workflows/shared/named-hand-discard-live-start.ts` 用 `cardNameAliasAny + ORDERED_MULTI + discardHandCardsToWaitingRoomAndEnqueueTriggers` 承载。自送休息室费用已写入 `ON_LEAVE_STAGE` eventLog；弃手、横置能量等费用仍主要是 action/audit 语义，后续需要监听这些事件时再补标准事件。 | `LL-bp1-001` 费用 20「上原步梦&涩谷香音&日野下花帆」、`LL-bp2-001` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」、`PL!HS-bp1-002` 费用 11「村野沙耶香」、`PL!HS-bp1-004` 费用 15「夕雾缀理」、`PL!HS-bp5-001` 费用 11「日野下花帆」、`PL!HS-bp5-008` 费用 4「桂城泉」、`PL!HS-pb1-004` 费用 4「百生吟子」、`PL!HS-pb1-020` 费用 9「百生吟子」、`PL!HS-bp6-004` 费用 13「百生 吟子」、`PL!HS-bp6-017` 费用 11「日野下花帆」等 |
| `src/application/card-effects/runtime/public-reveal-dwell.ts` | `C07,F04,F06,F11,F13` | 统一隐藏卡刚变为双方公开后的服务端权威定时展示。`withPublicRevealDwell` 恢复并无输入结算当前 step，`createPublicRevealDwellBeforeNextEffect` 只恢复真实下一交互；只投影本次明确公开的 cardIds，不拥有卡牌条件、移动、奖励或 continuation，也不包装 public-card-selection / public-effect-choice。首批覆盖 94 个基础编号（87 MEMBER、7 LIVE）。 | `PL!HS-bp5-001`、`PL!N-bp1-011`、`PL!N-bp7-009`、`PL!S-bp7-006/015/020/021` 等 |
| `workflows/shared/activated-pay-two-energy-discard-recover-group-live.ts` | `C01,C02,F07,F08,F09` | 固定主阶段起动、每回合1次、支付 `[E][E]`、弃恰好1手并从自己的休息室强制回收1张指定团体 LIVE。配置只表达 ability/source/group 与持久 step/action 名；支付后重扫、特殊能量精确选择、公开确认、stale 保护、无目标保留费用及统一 continuation 均为 family 固定语义，不是费用/selector/steps DSL。 | `PL!N-bp5-014` 费用4「中須かすみ」、`PL!SP-sd2-006` 费用7「桜小路きな子」、`PL!N-sd1-009` 费用7「天王寺璃奈」 |
| `src/application/effects/look-top.ts` + look-top workflow modules | `F03,F04,F05,F06,F13` | `look-top.ts` 提供看顶进入 inspection、清理 inspection、选中入手/其余入休息室、顶牌入休息室、动态检视数量与控顶等原语；`workflows/shared/look-top-select-to-hand.ts` 已迁出无前置费用或费用已由外层完成的“看顶选择入手、必要时公开展示” family，隐藏卡公开后的停留委托 Public Reveal Dwell；`workflows/shared/discard-look-top-select-to-hand.ts` 已承接弃 1 手牌后看顶入手；`workflows/shared/wait-discard-look-top-select-to-hand.ts` 已承接自身待机 + 弃手；`workflows/shared/optional-pay-energy-look-top-select-to-hand.ts` 已承接固定可选支付1张 ACTIVE 能量、顶3/5、可选支付后能量数量门槛、私密精确单选与 grouped remainder。该范围不扩展任意费用/条件/selector DSL，不接 public-card-selection confirmation 或 trigger matcher runner。 | `PL!-sd1-004` 费用 11「园田海未」、`PL!-sd1-007` 费用 7「东条希」、`PL!-bp3-010` 费用 9「高坂穗乃果」、`PL!SP-bp2-002` 费用 2「唐 可可」、`PL!-bp6-002` 费用 2「绚濑绘里」、`PL!HS-bp2-012` 费用 5「乙宗 梢」、`PL!HS-bp5-001` 费用 11「日野下花帆」、`PL!HS-bp5-008` 费用 4「桂城泉」、`PL!HS-bp6-001` 费用 4「日野下花帆」、`PL!HS-pb1-004` 费用 4「百生吟子」、`PL!HS-PR-019` 费用 2「百生吟子」、`PL!SP-bp1-012 / PL!SP-sd1-008 / PL!SP-sd1-017` 费用4、`PL!SP-sd1-009-SD` 费用13「鬼塚夏美」 |
| `src/application/effects/cheer-selection.ts`                                                                                                                 | `F14,F15`                             | 同时区分“当前仍可移动的声援卡”与 event-inclusive“本次曾公开事实”。移动路径支持手牌、卡组顶、卡组底、休息室与多选上限；纯 query 支持卡型/团体/事件范围、不同名、印刷 Heart 覆盖，以及结构化 Blade Heart 的 Heart 色种收集。Blade Heart query 可限制允许颜色，始终排除 DRAW/SCORE，已移出 resolution zone 的本次公开卡仍计入条件。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `PL!HS-bp6-001` 费用 4「日野下花帆」、`PL!HS-cl1-009` 分数 1「水彩世界」、`PL!HS-bp6-027` 分数 5「月夜見海月」、`PL!S-bp2-021` 分数 4「未体験HORIZON」、`PL!N-bp5-001` 费用5「上原歩夢」、`PL!N-bp7-025-SECL` 分数1「Colorful Dreams! Colorful Smiles!」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/application/effects/cheer.ts` | `E06` | 声援公开权威 helper：每次取牌前/后处理即时 refresh，按 `getCheerDeckEdgeForPlayer` 从 TOP 或 BOTTOM 单张公开到解决区，登记 current cheer facts，写入含 `deckEdge` 的 `CheerEvent` 与 `CHEER` action。普通/手动/自动/追加/重做共用入口；`replaceCurrentCheerCards=true` 仍只替换当前玩家 IDs，additional 仍不二次触发 ON_CHEER。当前 BOTTOM 真实样本仅 `PL!S-bp7-022-SECL`，不是任意方向 DSL。 | `PL!HS-bp6-027` 分数 5「月夜見海月」、`PL!S-bp2-004` 费用 11「黒澤ダイヤ」、`PL!S-bp7-022-SECL` 分数 8「想在水族馆恋爱」 |
| `src/application/effects/draw.ts` + `src/application/card-effects/runtime/actions.ts` + `src/application/card-effects/workflows/shared/draw-then-discard.ts` | `F01,F02` | `drawCardsFromMainDeckToHand` 提供底层卡效抽牌语义；`runtime/actions.ts` 承接 `drawCardsForPlayer` / `drawCardsForEachPlayer` 与 exact-count 手札弃置到休息室 helper；`draw-then-discard.ts` 已承接抽 N 后弃 M 的 activeEffect workflow，`PL!HS-pb1-009` 的 BLADE 阈值前置由窄 card workflow 包装。纯抽牌如 `PL!-pb1-015` 仍只走 draw action helper，不并入抽后弃 family。 | `PL!N-bp4-018` 费用 7「近江彼方」、`PL!-pb1-015` 费用 7「西木野真姬」、`PL!SP-bp4-008` 费用 13「若菜四季」、`PL!HS-bp1-006` 费用 11「藤岛 慈」、`PL!HS-pb1-009` 费用 15「日野下花帆」、`PL!-bp5-007` 费用 13「东条希」 |
| `src/application/effects/energy.ts` | `E02,E03` | 提供卡效步骤的 `placeEnergyFromDeckToZone`、`setEnergyOrientation`、`setFirstEnergyCardsOrientation`。普通能量阶段默认放置逻辑不并入此 helper。 | `PL!SP-PR-004` 费用 4「唐 可可」、`PL!-bp5-005` 费用 10「星空凛」、`PL!SP-bp4-008` 费用 13「若菜四季」、`PL!SP-bp5-003` 费用 17「岚 千砂都」、`PL!N-pb1-008` 费用 17「艾玛·维尔德」、`PL!HS-sd1-001` 费用 9「日野下花帆」、`PL!HS-sd1-006` 费用 15「安养寺姬芽」 |
| `src/application/effects/member-state.ts` + `src/domain/rules/member-wait-protections.ts` | `S01,S02,S05,S07,S09` | 提供成员方向、站位移动/交换与休息室登场原语。方向改变会写入 `ON_MEMBER_STATE_CHANGED`；CARD_EFFECT cause 可选记录实际选择玩家，并与效果控制者分离。费用4「松浦果南」新增的窄 LIVE_END 待机保护由通用 WAITING 目标选择按同一 cause 过滤候选，并在公共状态变化边界二次检查 stale/伪造目标；它动态读取当前顶层结构化 Aqours 与印刷 BLADE <=3，以效果控制者判断对方效果，实际选择玩家不改变保护结论，并明确区分既有活跃禁止和新待机保护的阻止结果。成员区移动继续写 `ON_MEMBER_SLOT_MOVED` 与 `positionMovedThisTurn`。 | 既有成员状态/移动样本；`PL!S-bp7-003-SEC`；费用15「セラス 柳田 リリエンフェルト」混合目标、全保护无目标与真实选择玩家 QA。该状态不是任意免疫或 protection DSL。 |
| `src/domain/rules/live-modifiers.ts` + `src/application/card-effects/runtime/actions.ts` | `T05,B01,B02,B03,B05,B06,B07,B08` | `collectLiveModifiers` 是 Live 判定读路径；`addLiveModifier` / `replaceLiveModifier` 是临时修正主写入路径，legacy maps 只作兼容投影。`runtime/actions.ts` 提供 `addBladeLiveModifierForSourceMember` 与通用 `addBladeLiveModifierForMember`，后者已支持经过 workflow 重验的目标成员 BLADE；两者都不承担费用、目标选择、条件或 action payload。`SCORE` 按有无 `liveCardId` 区分玩家合计/此 LIVE；`HEART` 支持 `SOURCE_MEMBER` / `TARGET_MEMBER`；`REQUIREMENT` 支持临时与持续来源。`PL!HS-bp6-031-L` 分数 8「ファンファーレ！！！」已通过单卡 workflow 选择「安养寺姬芽」并写目标成员 BLADE +3，不再是缺口。 | `LL-bp1-001` 费用 20「上原步梦&涩谷香音&日野下花帆」、`LL-bp2-001` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」、`PL!N-pb1-004` 费用 11「朝香果林」、`PL!-bp4-002` 费用 15「绚濑绘里」、`PL!-bp5-003` 费用 11「南琴梨」、`PL!-bp6-022-L` 分数 9「Dreamin' Go! Go!!」、`PL!HS-bp5-003` 费用 2「大泽瑠璃乃」、`PL!HS-bp6-031-L` 分数 8「ファンファーレ！！！」 |
| `src/domain/rules/live-requirement-modifiers.ts` | `B07` | `applyHeartRequirementModifiers` 负责彩色/泛用/All/Rainbow 必要 Heart 数学。`PL!-sd1-022` 分数 4「僕らは今のなかで」与 `PL!HS-bp5-019` 分数 6「花结」等 LIVE 开始 requirement 写入已由 `workflows/shared/conditional-live-modifier.ts` 承载；该 helper 不处理费用、选择或完整 modifier DSL。 | `PL!-sd1-022` 分数 4「僕らは今のなかで」、`PL!HS-bp5-019` 分数 6「花结」 |
| `src/domain/rules/cost-calculator.ts` | `X08,X11` | 生成成员登场支付方案前先计算登场费用修正；当前支持手牌中自身按其他手牌数量减费、手牌中自身按舞台成员状态/团体条件减费，以及舞台来源修正其他手牌登场费用。换手减免可读取调用方传入的舞台成员有效费用，未传入时仍回落到印刷费用；费用修正也使用基础编号匹配。`canMemberBeRelayedAway` 先覆盖换手禁止 proving path，实际登场 handler 也会二次拦截。 | `LL-bp2-001` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」、`PL!N-pb1-008` 费用 17「艾玛·维尔德」、`PL!SP-bp5-003` 费用 17「岚 千砂都」、`PL!-bp4-008` 费用 4「小泉花阳」 |
| Active effect UI shape in `src/domain/entities/game.ts` and `client/src/components/game/GameBoard.tsx` | `C07,X03,F05,F06,F14,F15,B03,S05` | 支持 card selection、ordered multi-select、slot selection、option selection、私有候选投影控制、Public Reveal Dwell、public-card-selection confirmation、public-effect-choice 与普通公开卡展示；这是 UI/状态形状，还不是 resolver DSL。 | 003 Heart choice, 019 ordered top, Karin/Shiki position change, `PL!N-pb1-008` 费用 17「艾玛·维尔德」、`PL!HS-bp5-001` 费用 11「日野下花帆」、`PL!HS-bp6-001` 费用 4「日野下花帆」、`PL!HS-bp6-004` 费用 13「百生 吟子」、`PL!HS-cl1-009` 分数 1「水彩世界」、`PL!HS-PR-019` 费用 2「百生吟子」 |

Continuous modifier 的隐藏信息投影已收口到 definition 必填 `visibility` 分类与统一 collector：`PUBLIC` 保持公开，`PLAYER_LIVE_ZONE_CONTENTS / SELF|OPPONENT` 解析真实 LIVE 区拥有者并自动标记本次所有 modifier。当前已审查覆盖 9 个基础编号：`PL!-bp4-002`、`PL!-bp6-022`、`PL!N-bp1-012`、`PL!N-pb1-001`、`PL!N-pb1-007`、`PL!SP-bp5-012`、`PL!SP-bp2-010`、`PL!S-bp5-010`、`PL!S-bp5-011`。权威结算不过滤；只有 projector 过滤成员有效值与 requirement map 等玩家视图。这不代表已覆盖 LIVE 区以外的任意隐藏信息依赖。

## 2026-07 bottom direct-mill coverage

`effects/look-top.ts` + `runtime/main-deck-waiting-room-triggers.ts` 仍只覆盖“卡组底直接进入休息室”的 refresh-aware 原语与分组事件边界；006/015 shared gain-heart 与 020/021 单卡 requirement/draw/score 在 caller 层复用 direct top-mill 的 `revealedCardIds` 公开结果形状，双方展示实际移动卡后才写 Heart/requirement、抽牌或加分。022 另行通过 `drawFromBottom` + `cheer-direction.ts` 覆盖声援公开，目的地为 resolution zone，二者没有合并成 bottom/zone DSL。`cheer-selection.ts` 的三色匹配 query 只处理 event-inclusive 当前声援事实上“不同 cardId 覆盖所需印刷 Heart”的稳定形状；Blade Heart 颜色 query 则只读结构化 `BladeHeartEffect.HEART`，不读普通印刷 Heart、LIVE 必要 Heart或舞台临时 modifier，两者保持独立语义。

## 2026-07 bp7 member shared-family expansion

- `workflows/shared/member-on-enter-draw.ts` 新增有限的主舞台有效费用门槛/可选结构化团体轴，并将 `PL!-bp3-009` 费用2「矢澤にこ」ON_ENTER 段从单卡 workflow 晋升到 shared ownership；`PL!S-bp7-002-P` 费用4「樱内梨子」是第二个真实样本。本轴不接受 callback/条件 AST，不是 ON_ENTER DSL。
- `workflows/shared/on-move-gain-blade.ts` 新增 +2 配置样本 `PL!SP-bp7-014-N` 费用4「岚千砂都」，并收窄 stale 边界：消费 pending、写可审计 no-op action、统一 continuation，不给 BLADE。旧 +1 样本保持。这不是通用移动奖励 DSL。
- `domain/rules/live-modifiers.ts` continuous registry 新增基础编号 `PL!S-bp7-016`（当前公开版本 N）费用15「国木田花丸」：己方三个主舞台顶层达3名时为来源动态收集 `SOURCE_MEMBER` 红/绿/蓝 Heart 各1，不写 player-level Heart，不建立 continuous Heart DSL。

## Compatibility Layers

| compatibility field/path | why it remains |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `liveResolution.playerScoreBonuses` / `playerHeartBonuses` / `liveRequirementReductions` / `liveRequirementModifiers` | 现在由 `liveModifiers` 投影维护，供既有 UI/online projection/tests 兼容；新增 Live 修正不应主写这些字段。`SOURCE_MEMBER` 与 `TARGET_MEMBER` Heart 不投影到 `playerHeartBonuses`。 |
| `GameService.drawTopMainDeckCard` / debug `DRAW_CARD_TO_HAND` | 规则流程抽牌和桌面调试命令暂不并入 card-effect draw helper，避免提前改变刷新/事件语义。 |
| registry 未命中行为 | 旧完整卡效 fallback 已清空；starter / step / activated registry 未命中时保持状态不变。runner 仍保留 pending 队列推进、trigger/relay/matcher 胶水和 workflow 注册；steps-lite / declarative resolver 未落地。 |

## Tests By Coverage Area

| area | tests |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Ability classification and queue metadata | `tests/unit/card-effect-classification.test.ts` |
| Same-base rarity synchronization | `tests/unit/card-effect-rarity-sync.test.ts` |
| Card selectors | `tests/unit/card-selectors.test.ts` |
| Condition/query helpers | `tests/unit/conditions.test.ts` |
| Zone selection/move | `tests/unit/zone-selection.test.ts` |
| Effect costs | `tests/unit/effect-costs.test.ts` |
| Look-top primitives | `tests/unit/look-top.test.ts` |
| Live modifiers | `tests/unit/live-modifiers.test.ts`, `tests/unit/live-judgment-settlement.test.ts`, `tests/unit/heart-live.test.ts` |
| Member state / position change | `tests/unit/member-state.test.ts` |
| Draw helper | `tests/unit/draw.test.ts` |
| Energy placement/orientation helper | `tests/unit/energy.test.ts` |
| Integrated sample behavior | `tests/integration/sample-card-effect-runner.test.ts` |

## 2026-07-18 BP7 memberBelow 能力覆盖

| 能力边界                      | 真实样本                                                                 | 覆盖状态                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 卡效原子创建 `memberBelow`    | 香音 AUTO、雫 ACTIVATED、曜 ON_ENTER；及旧 Ren/Rina/Kotori/Kinako/Sayaka | 通用 stage-host helper，无 host 白名单、无手动命令                                                                                                      |
| 来源/目标分离的 BLADE         | 下方香音 -> Liella! host；舞台曜 -> 多个 Aqours host                     | 有 target 时只随 target 清理；无 target 的旧 BLADE 仍随 source 清理；写入要求目标为当前己方顶层成员                                                     |
| 完整印刷 Heart replacement    | 雫压入成员的 `data.hearts` 快照                                          | 保留颜色/数量/多色向量，bonus 后追加，latest wins；来源实例离场/重登清理                                                                                |
| 强制委托 ON_ENTER 子序列      | 曜 CENTER 起动                                                           | 每名成员选1段、玩家定顺序、两段间不回全局 pending；兼容舞台历史 sourceZone；只有真实交互、终局或 sequence 实际推进才算进展，缺 starter/无进展安全跳过   |
| 休息室有序置于卡组底          | `PL!S-bp7-019-L`、`PL!SP-bp7-004-P`                                      | 复用窄 `WAITING_ROOM -> MAIN_DECK_BOTTOM` action 与 shared public confirmation；0张直接结算，非空选择先公开，deadline 后整组重验，任一 stale 不移动子集 |

该覆盖不表示任意区域移动、任意 stat-copy、任意 continuous 扫描或通用卡效解释器已实现。

## 2026-07-19 BP7 energyBelow 第三批覆盖

| 边界 | 当前公开样本 | 覆盖状态 |
| ------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ENERGY_ZONE → energyBelow | `PL!N-bp7-004-P` | 继续由既有 `stackEnergyFromEnergyZoneBelowMember` 处理 WAITING-first、特殊 marker 精确选择；公开中文 API 的“能量卡组”不作为规则依据。 |
| ENERGY_DECK → 当前己方顶层成员 energyBelow | `PL!N-bp7-005-P`、`PL!N-bp7-007-SEC`、`PL!N-bp7-019-N` | 新窄 helper 保持顶牌/剩余顺序、按成员实例追踪移槽、返回精确 IDs；不接受对方/memberBelow/stale 目标。 |
| 强制二选一 stale continuation | `PL!N-bp7-005-P` | 卡文分支为“活跃2张能量”；不足2张时尽可能处理。原本展示的分支或成员目标确认时失效会消费当前 pending、记录空实际 IDs 并回到统一 continuation；从未展示的伪造输入仍被拒绝。 |
| exact member-slot-moved observer registry | `PL!SP-pb2-022` | 卡牌专属 5yncri5e!/CENTER 事件筛选与 pending 构造归属单卡 workflow 的窄 registry handler；runner 仅保留通用 observer 调度。 |
| 动态成员红 Heart | `PL!N-bp7-007`（当前公开版本 SEC） | 基础编号 continuous registry 分别按来源 energyBelow 与 `max(0, own energyZone count - 6)` 收集 SOURCE_MEMBER Heart，可与普通 modifier 叠加。 |
| replacement 事件绑定 | `PL!N-bp7-019-N` | 只消费真实 LeaveStageEvent 的 replacingCardId，来源结算时不必仍在休息室；replacement 必须为当前顶层结构化虹咲成员。 |

energyBelow 继续随主成员移动/交换，并在离场、换手或替换时由既有清理路径返回能量卡组。below 放置不发仅表示放置入能量区的事件。本表不宣称任意 below DSL 或完整能量事件体系。

## 2026-07-19 BP7 七弹第一批卡效覆盖

| 边界 | 当前公开样本 | 覆盖状态 |
| -------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 支付能量后私密检视并全部有序回顶 | `PL!N-bp7-006-SEC` 第一段 | 复用标准能量支付、inspection 和 ordered-top；只有支付成功才消耗独立 turn1。确认重验 inspection owner、卡集合、覆盖和顺序，对手不投影卡号或顺序。 |
| exact 顶牌作为费用并保留事件事实 | `PL!N-bp7-006-SEC` 第二段 | `moveExactTopDeckCardsToWaitingRoomAsCostAndEnqueueTriggers`；当前主卡组不足3张则不可支付，不通过刷新补足。恰好3张时移动后执行规则刷新，条件与公开展示仍只读该 grouped event 保存的 moved IDs。未命中用 Public Reveal Dwell 阻断 continuation；命中由现有二选一窗口兼任公开展示，不产生双弹窗。 |
| 结构化移动结果命中与强制二选一 | `PL!N-bp7-006-SEC` 第二段 | 团体、LIVE/MEMBER 与 BLADE HEART 分别走 selector/query；不扫休息室。能量分支复用通用 WAITING 能量活跃和 marker 精确选择；BLADE 分支复用真实来源成员实例的 LIVE_END modifier。二选一提交按钮明确为“结算所选效果”。 |
| 多 owner 同一 refresh-aware direct-mill 效果 | `PL!N-bp7-009-P` | `moveTopDeckCardsForPlayersWithRefreshAndEnqueueTriggers`；每位玩家独立 owner/moved IDs/refresh count/grouped event，主动玩家先处理规则刷新。全部移动完成并统一 enqueue 后，按效果控制者（发动方）、对方的 owner 顺序至多打开两个连续 Public Reveal Dwell，每个窗口只展示该 owner 的实际移动结果；到期后双方均可请求推进，空结果跳过，最后一个非空展示结束后才只推进一次 continuation，双方均0张时直接结束。metadata/action/event 保留各 owner 原始顺序及重复事实。 |

本表只说明两个窄 runtime 边界及其当前公开样本，不表示所有 direct-mill、多玩家效果或费用 pipeline 已配置化。

## 2026-07-20 LL-bp7-001-R+ 覆盖

| 边界 | 当前公开样本 | 覆盖状态 |
| -------------------- | ----------------------- | -------------------------------------------------------------------------- |
| 姓名一对一最大分配 | `LL-bp7-001-R+` | shared identity query；联合名成员每张最多占一槽，不依赖贪心候选顺序。 |
| 可复水特殊登场 | `LL-bp7-001`（当前公开版本 R+） | 基础编号专属 pending/command/projector；对手仅等待态，旧 payload 缺字段安全默认。 |
| 单次 play 费用基准10 | `LL-bp7-001-R+` | 服务端窄输入；登场后仍是印刷/有效费用15，不写持久修正。 |
| 休息室回收 | 登场LIVE / LIVE成功成员 | 扩展既有 `waiting-room-to-hand` 与 public confirmation family。 |

不表示通用替代费用、任意指定姓名支付或特殊登场 DSL 已完成。

# 2026-07-23 BP7 LIVE 能量返回/待机放置覆盖

| 边界                                 | 当前公开样本                                                                                      | 覆盖状态                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIVE 开始可选返还1能量后实时比较     | `PL!S-bp7-023-L` 分数4「夜空是否全然知晓？」、`PL!SP-bp7-027-L` 分数5「What a Wonderful Dream!!」 | 有限 shared family；S023 只统计主舞台顶层 Aqours 并支持对方领先1/+1、至少2/+2，SP027 支持己方严格领先/+1。两者都在返还后比较并 replacement 来源 SCORE。 |
| 标准能量返回事件                     | 同上及既有 optional-energy-return 调用者                                                          | 实际移动1张后产生一次精确 `ON_ENERGY_MOVED_TO_DECK` event，保留 moved ID 与 `CARD_EFFECT` cause；现有 SP005 observer focused 锁定只入队一次。           |
| WAITING 放置并跳过下次自己的活跃阶段 | `PL!SP-bp7-005-SEC`、`PL!SP-bp7-007-SEC`、`PL!SP-bp7-027-L` LIVE 成功段                           | 共用窄 runtime helper；marker 只绑定实际放置 IDs，身份取自 event cause，精确 placement event 只入队一次。0张不产生 event/marker。                       |
| 无资源与 stale 交互                  | S023/SP027                                                                                        | 无能量使用 confirm-only 玩家窗口并在确认后消费 pending；门槛/来源 stale 不移动资源，伪造选择不推进。                                                    |

本表不表示任意能量差表达式、能量区 placement DSL 或统一 pending workflow 已完成；SP027 的 LIVE 成功段仍由 card-owned workflow 持有基础编号来源校验和确认语义。

# 2026-07-23 BP7 第三、第四批覆盖

| 边界                              | 当前公开样本                                          | 覆盖状态                                                                                                              |
| --------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 弃至多2张后选择等量目标           | `PL!N-bp7-026-SECL` 分数5「Just Believe!!!」          | 单卡 workflow；实时限缩弃牌上限，标准弃牌事件，等量且不重复的虹咲顶层目标，target-bound BLADE。                       |
| event-inclusive 声援条件          | N026 与 `PL!SP-bp7-028-L` 分数8「能够听见未来的声音」 | N026 统计 MEMBER 且无任何 BLADE HEART；SP028 要求非空并全部结构化 Liella!，均使用本次声援事件事实而非仅当前可移动卡。 |
| 精确9张公开集合洗切置底           | SP028                                                 | public confirmation 为 unordered，恢复时整体重验；只洗切所选子集，提交顺序不参与结果，失败不部分移动或发奖励。        |
| 顶3任意有序回顶、其余入休息室     | `PL!N-bp7-030`（当前公开版本 L）分数0「Cheer Mode」 | 扩展既有 arrange family 的 TOP 配置，来源按基础编号覆盖，支持0～实际检视数与短牌库，余牌继续使用 grouped event。        |
| LIVE_ZONE→HAND 后强制弃1          | N030                                                  | 窄 runtime 原子动作记录精确 ON_ENTER_HAND；单卡 workflow 可从更新后的手牌弃刚回手来源或其他卡，弃牌走标准事件。       |
| 公开二选一：对方低费成员待机或抽1 | `PL!S-bp7-025-L` 分数3「Guilty Night, Guilty Kiss!」  | card-owned effectChoice；0～2个印刷费用<=4的对方顶层目标，真实状态变化才写目标玩家下一 Active Phase skip marker。     |

本表不表示通用“支付数量→目标数量”、unordered multi、任意 LIVE 离区、任意 arrange 配置或 effectChoice callback DSL 已完成。

## 2026-07-24 BP7 基础编号覆盖 guard

- 同一基础编号各罕度的卡牌类型与完整卡效相同；BP7 definition、workflow gate、continuous registry 与 cost/modifier 查询统一使用 `baseCardCodes` 或等价基础编号 matcher。当前公开罕度只作为数据事实记录。
- `cardCodes` 不能作为未知罕度隔离手段。本地 `cards.json` 缺失或 API / Excel 仅有某个罕度时，仍按基础编号登记。
- classification / rarity-sync 应用同一基础编号的替代罕度验证 definition 与 owner route；continuous/cost/modifier 覆盖也须验证替代罕度，无需为未来新增罕度追加 definition。

# PR 第1至第4批覆盖（2026-07-23）

| 形状 | 真实卡 | 当前覆盖 |
| --- | --- | --- |
| 能量恰好7张时来源 BLADE +2 | `PL!-PR-021-PR` 费用7「矢泽日香（妮可）」 | 直接扩入 `PL!SP-PR-025-PR` 费用7「唐可可」现有 continuous identity，无 workflow。 |
| 休息室补到8后可选本次磨入 LIVE 回顶 | 三张费用5同文 PR 成员 | 新 shared family；direct mill、刷新、分组进入休息室事件与公开选卡确认均复用既有原语。 |
| 费用7换手抽2弃1 | `PL!S-PR-045-PR` 费用11「津岛善子」 | `relay-enter-draw-discard` 新增事件快照有效费用条件，旧姓名条件不变。 |
| 中央且 LIVE 区有效分数达到8后获得玩家 SCORE +1 | `PL!-PR-020-PR` 费用13「高坂穗乃果」；`PL!SP-PR-026-PR` 费用13「鬼冢夏美」 | `conditional-live-modifier` 新配置 + `live-zone-score.ts` 纯 query；目标绑定来源实例。 |

本批没有建立任意 relay predicate、区域分数 AST、目的地 callback 或奖励 DSL。
以上卡牌按基础编号覆盖全部罕度；表中的 `-PR` 只表示当前公开印刷，不是 definition、workflow gate 或 continuous registry 的规则边界。
