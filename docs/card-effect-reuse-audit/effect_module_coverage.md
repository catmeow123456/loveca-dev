# Loveca card effect module coverage

> 文档类型：专题说明
> 适用范围：卡效通用模块、覆盖的效果碎片、当前边界、proving cards 与测试入口
> 当前状态：模块覆盖说明；卡牌完成状态以 `existing_module_map.md` 为准
> 最后更新：2026-06-16

本文件只记录“哪些通用模块覆盖了哪些效果碎片”。卡牌完成状态请看 `existing_module_map.md`，同构批量扩样本请看 `card_effect_batch_expansions.md`。

## Reusable Modules

| module | covered fragments | current boundary | proving cards |
|---|---|---|---|
| `CARD_ABILITY_DEFINITIONS` in `src/application/card-effect-runner.ts` | `T01,T02,T03,T04,T05,T06,T07` | 集中登记 category、trigger/source zone、queued、per-turn limit、`cardCodes` / `baseCardCodes` 与 UI 文案。resolver dispatch 仍是 switch + effect-specific function。 | 当前所有登记卡 |
| Base card-code matching | card identity | 卡效登记支持 `baseCardCodes`，同基础编号不同罕度自动匹配同一能力；`tests/unit/card-effect-rarity-sync.test.ts` 会阻止 exact `cardCodes` 漏同步同编号罕度。 | `PL!HS-bp1-004` 费用 15「夕雾缀理」、`PL!HS-bp1-006` 费用 11「藤岛 慈」、`PL!HS-bp6-004` 费用 13「百生 吟子」、`PL!HS-pb1-004` 费用 4「百生吟子」、`PL!HS-PR-019` 费用 2「百生吟子」等 |
| Trigger enqueue functions in `src/application/card-effect-runner.ts` | `T01,T02,T04,T06,S08,E06` | 支持登场、LIVE 开始、LIVE 成功、自己进行声援时、离场 AUTO、成员状态变化 AUTO、成员槽位移动 AUTO、舞台成员监听登场 AUTO 与同一时点/同事件队列。登场与舞台成员 LIVE 开始会记录来源槽位，能力可通过 `requiredSourceSlots` 统一过滤左/中/右区域条件。LIVE 成功已支持成功 LIVE 卡来源与表演玩家舞台成员来源；`ON_CHEER` 优先消费 `CheerEvent`，追加声援事件不二次触发，旧扫描表演玩家 LIVE 区来源只作 fallback；登场 AUTO 优先消费 `EnterStageEvent`；成员状态变化 AUTO 优先消费 `MemberStateChangedEvent`，并可读取玩家操作/规则处理/卡效 cause；离场 AUTO 优先消费 `LeaveStageEvent`，可携带换上成员 `replacingCardId` 做 relay 来源条件；LIVE 开始优先消费 `LiveStartEvent`；LIVE 成功优先消费 `LiveSuccessEvent`；pending ability 绑定真实 `eventId`。 | `PL!N-bp4-018` 费用 7「近江彼方」、`PL!-pb1-015` 费用 7「西木野真姬」、`PL!HS-bp2-012` 费用 5「乙宗 梢」、`PL!HS-bp6-017` 费用 11「日野下花帆」、`PL!HS-sd1-001` 费用 9「日野下花帆」、`PL!HS-pb1-009` 费用 15「日野下花帆」、`PL!HS-bp6-004` 费用 13「百生 吟子」、`PL!HS-bp5-019` 分数 6「花结」、`PL!HS-bp6-001` 费用 4「日野下花帆」、`PL!HS-cl1-009` 分数 1「水彩世界」、`PL!HS-bp6-027` 分数 5「月夜見海月」 |
| `src/application/effects/card-selectors.ts` | `X04,X05,X06,C08` | 提供 `typeIs`、`groupIs`、`unitIs`、`unitAliasIs`、`unitAliasOrTextAliasIs`、`costLte`、`costGte`、`cardNameIs`、`cardNameAliasIs`、`and/or/not` 等最小 selector；`unitAliasIs` 用于真实导入数据中 `unitName=スリーズブーケ` / 英文效果文本 `Cerise Bouquet` 这类小组名别名条件，`unitAliasOrTextAliasIs` 才会额外读取 `cardText` 处理“视为”类文本身份；`cardNameAliasIs` 覆盖当前卡库常见角色中日名、空白/中点差异、组合卡 `&` 分隔组件与早期中文误译/异体名，并已用于指定姓名手牌弃置候选。尚未覆盖 cardCode 集合、舞台状态、成功区分数等复杂条件。 | `LL-bp1-001` 费用 20「上原步梦&涩谷香音&日野下花帆」、`LL-bp2-001` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」、`PL!HS-bp1-003` 费用 13「乙宗梢」、`PL!HS-bp1-004` 费用 15「夕雾缀理」、`PL!HS-bp6-004` 费用 13「百生 吟子」、`PL!HS-bp2-022` 分数 2「アオクハルカ」、`PL!HS-sd1-006` 费用 15「安养寺姬芽」、`PL!HS-bp5-008` 费用 4「桂城泉」、`PL!HS-pb1-004` 费用 4「百生吟子」、`PL!HS-pb1-020` 费用 9「百生吟子」、`PL!HS-cl1-009` 分数 1「水彩世界」 |
| `src/application/effects/stage-targets.ts` | `S03,X06` | 提供按 `playerId + CardSelector` 扫描左/中/右成员区的目标候选 helper，也可作为登场条件扫描。 | `PL!HS-bp6-004` 费用 13「百生 吟子」、`PL!HS-sd1-006` 费用 15「安养寺姬芽」 |
| `src/application/effects/stage-member-target-selection.ts` | `S01,S03,X06` | 提供舞台成员目标 active effect 配置入口：按 `targetPlayerId + CardSelector` 生成候选，创建单选 active effect，并在结算时调用 `setMemberOrientation`。 | `PL!HS-bp6-004` 费用 13「百生 吟子」 |
| `src/application/effects/zone-selection.ts` | `F07,F08,F09` | 提供 `ZoneCardSelectionConfig`、`createWaitingRoomToHandEffectState`、`moveSelectedCardsFromZone`；当前主力是 `WAITING_ROOM -> HAND`，已支持单选与 `maxCount` 多选配置。分组上限仍由具体 runner 校验。 | `PL!-pb1-019` 费用 2「高坂穗乃果」、`PL!-bp4-003` 费用 2「南琴梨」、`PL!HS-bp1-003` 费用 13「乙宗梢」、`PL!HS-bp1-004` 费用 15「夕雾缀理」、`PL!HS-bp2-002` 费用 13「村野沙耶香」、`PL!HS-bp5-001` 费用 11「日野下花帆」、`PL!HS-bp6-017` 费用 11「日野下花帆」、`PL!HS-sd1-006` 费用 15「安养寺姬芽」、`PL!HS-pb1-020` 费用 9「百生吟子」 |
| `src/application/effects/effect-costs.ts` | `C01,C02,C03,C04,C05,C06,C07,C08,E01` | 提供 `EffectCostDefinition`、弃手选择费用、即时横置能量、自送休息室、将来源成员变为指定方向；复合费用通过多个 definition 顺序组合。隐藏区候选可用 `selectableCardVisibility` 限制投影，公开后的手牌卡通过 `revealedCardIds` 显示确认窗口；指定姓名多选弃置当前由 runner 用 `cardNameAliasIs + ORDERED_MULTI + paySelectedDiscardHandCost` 组合。自送休息室费用已写入 `ON_LEAVE_STAGE` eventLog；弃手、横置能量等费用仍主要是 action/audit 语义，后续需要监听这些事件时再补标准事件。 | `LL-bp1-001` 费用 20「上原步梦&涩谷香音&日野下花帆」、`LL-bp2-001` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」、`PL!HS-bp1-002` 费用 11「村野沙耶香」、`PL!HS-bp1-004` 费用 15「夕雾缀理」、`PL!HS-bp5-001` 费用 11「日野下花帆」、`PL!HS-bp5-008` 费用 4「桂城泉」、`PL!HS-pb1-004` 费用 4「百生吟子」、`PL!HS-pb1-020` 费用 9「百生吟子」、`PL!HS-bp6-004` 费用 13「百生 吟子」、`PL!HS-bp6-017` 费用 11「日野下花帆」等 |
| `src/application/effects/look-top.ts` | `F03,F04,F05,F06,F13` | 提供看顶进入 inspection、清理 inspection、选中入手/其余入休息室、顶牌入休息室、动态检视数量与控顶等原语；完整流程 orchestration 仍在 runner。 | `PL!-sd1-004` 费用 11「园田海未」、`PL!-sd1-007` 费用 7「东条希」、`PL!-bp3-010` 费用 9「高坂穗乃果」、`PL!HS-bp2-012` 费用 5「乙宗 梢」、`PL!HS-bp5-001` 费用 11「日野下花帆」、`PL!HS-bp5-008` 费用 4「桂城泉」、`PL!HS-bp6-001` 费用 4「日野下花帆」、`PL!HS-pb1-004` 费用 4「百生吟子」、`PL!HS-PR-019` 费用 2「百生吟子」 |
| `src/application/effects/cheer-selection.ts` | `F14,F15` | 提供从“因声援公开且仍在处理区”的本次声援卡中筛选、创建选择步骤并移动到目标区域；当前支持手牌、卡组顶、休息室与多选上限配置，卡组底仍待样例。 | `PL!HS-bp6-001` 费用 4「日野下花帆」、`PL!HS-cl1-009` 分数 1「水彩世界」、`PL!HS-bp6-027` 分数 5「月夜見海月」 |
| `src/application/effects/cheer.ts` | `E06` | 提供声援公开 helper：从主卡组顶公开到解决区、登记本次 `liveResolution.*CheerCardIds`、写入 `CheerEvent`、记录 `CHEER` action，并沿用即时 refresh 检查。当前用于自动声援与追加声援；追加声援事件带 `additional=true`，不二次触发 `ON_CHEER`。 | `PL!HS-bp6-027` 分数 5「月夜見海月」 |
| `src/application/effects/draw.ts` + draw-discard shell | `F01,F02` | `drawCardsFromMainDeckToHand` 提供卡效步骤抽牌；`startDrawThenDiscardOneEffect` / `finishDrawThenDiscardOneEffect` 组合抽 N 后弃 1。 | `PL!N-bp4-018` 费用 7「近江彼方」、`PL!-pb1-015` 费用 7「西木野真姬」、`PL!SP-bp4-008` 费用 13「若菜四季」、`PL!HS-bp1-006` 费用 11「藤岛 慈」、`PL!HS-pb1-009` 费用 15「日野下花帆」 |
| `src/application/effects/energy.ts` | `E02,E03` | 提供卡效步骤的 `placeEnergyFromDeckToZone`、`setEnergyOrientation`、`setFirstEnergyCardsOrientation`。普通能量阶段默认放置逻辑不并入此 helper。 | `PL!SP-PR-004` 费用 4「唐 可可」、`PL!SP-bp4-008` 费用 13「若菜四季」、`PL!SP-bp5-003` 费用 17「岚 千砂都」、`PL!N-pb1-008` 费用 17「艾玛·维尔德」、`PL!HS-sd1-001` 费用 9「日野下花帆」、`PL!HS-sd1-006` 费用 15「安养寺姬芽」 |
| `src/application/effects/member-state.ts` | `S01,S02,S05,S07,S09` | 提供 `setMemberOrientation` / `setMembersOrientation`、`moveMemberBetweenSlots` 与 `playMembersFromWaitingRoomToEmptySlots`。方向改变会写入 `ON_MEMBER_STATE_CHANGED` eventLog，事件可携带玩家操作、规则处理或卡片效果来源；成员区空槽移动/交换会写入 `ON_MEMBER_SLOT_MOVED` eventLog，并继续记录 `positionMovedThisTurn`；卡效从休息室登场会写入 `ON_ENTER_STAGE` eventLog。普通 `TAP_MEMBER` / 活跃阶段重置 / `MOVE_MEMBER_TO_SLOT` 也写入同族事件；`enqueueTriggeredCardEffects` 已消费成员状态变化、成员槽位移动与登场事件。 | `PL!N-bp4-018` 费用 7「近江彼方」、`PL!-pb1-015` 费用 7「西木野真姬」、`PL!N-pb1-004` 费用 11「朝香果林」、`PL!SP-bp4-008` 费用 13「若菜四季」、`PL!SP-bp4-011` 费用 7「鬼冢冬毬」、`PL!SP-bp5-003` 费用 17「岚 千砂都」、`PL!N-pb1-008` 费用 17「艾玛·维尔德」、`PL!S-bp2-006` 费用 11「津岛善子」、`PL!HS-bp1-002` 费用 11「村野沙耶香」、`PL!HS-bp6-004` 费用 13「百生 吟子」 |
| `src/domain/rules/live-modifiers.ts` | `T05,B01,B02,B03,B05,B06,B07,B08` | `collectLiveModifiers` 是 Live 判定读路径；`addLiveModifier` / `replaceLiveModifier` 是临时 Live 修正主写入路径；legacy maps 作为兼容投影。`SCORE` 不带 `liveCardId` 表示玩家 LIVE 合计分数，带 `liveCardId` 表示此 Live 卡分数；最终分数草案只有在该玩家至少一首 LIVE 成功时才应用玩家合计分数修正，全部失败时仍为 0。Continuous modifier registry 也支持基础编号匹配；`PL!N-pb1-004` 通过 `positionMovedThisTurn` 区分登场与位置移动。 | `LL-bp1-001` 费用 20「上原步梦&涩谷香音&日野下花帆」、`LL-bp2-001` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」、`PL!N-pb1-004` 费用 11「朝香果林」、`PL!-sd1-001` 费用 7「高坂穗乃果」、`PL!HS-bp1-003` 费用 13「乙宗梢」、`PL!HS-bp1-004` 费用 15「夕雾缀理」、`PL!HS-bp1-006` 费用 11「藤岛 慈」、`PL!HS-bp5-001` 费用 11「日野下花帆」、`PL!HS-pb1-009` 费用 15「日野下花帆」、`PL!HS-bp6-004` 费用 13「百生 吟子」、`PL!HS-bp5-019` 分数 6「花结」、`PL!HS-bp2-022` 分数 2「アオクハルカ」、`PL!HS-sd1-006` 费用 15「安养寺姬芽」、`PL!HS-PR-019` 费用 2「百生吟子」 |
| `src/domain/rules/live-requirement-modifiers.ts` | `B07` | `applyHeartRequirementModifiers` 负责彩色/泛用/All/Rainbow 必要 Heart 数学。effect 创建逻辑仍在 runner。 | `PL!-sd1-022` 分数 4「僕らは今のなかで」、`PL!HS-bp5-019` 分数 6「花结」 |
| `src/domain/rules/cost-calculator.ts` | `X08,X11` | 生成成员登场支付方案前先计算登场费用修正；当前支持手牌中自身按其他手牌数量减费、手牌中自身按舞台成员状态/团体条件减费，以及舞台来源修正其他手牌登场费用。费用修正也使用基础编号匹配。`canMemberBeRelayedAway` 先覆盖换手禁止 proving path，实际登场 handler 也会二次拦截。 | `LL-bp2-001` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」、`PL!N-pb1-008` 费用 17「艾玛·维尔德」、`PL!SP-bp5-003` 费用 17「岚 千砂都」 |
| Active effect UI shape in `src/domain/entities/game.ts` and `client/src/components/game/GameBoard.tsx` | `C07,X03,F05,F06,F14,F15,B03,S05` | 支持 card selection、ordered multi-select、slot selection、option selection、公开检视后继续处理、私有候选投影控制、公开手牌确认窗口与公开卡展示；这是 UI/状态形状，还不是 resolver DSL。 | 003 Heart choice, 019 ordered top, Karin/Shiki position change, `PL!N-pb1-008` 费用 17「艾玛·维尔德」、`PL!HS-bp5-001` 费用 11「日野下花帆」、`PL!HS-bp6-001` 费用 4「日野下花帆」、`PL!HS-bp6-004` 费用 13「百生 吟子」、`PL!HS-cl1-009` 分数 1「水彩世界」、`PL!HS-PR-019` 费用 2「百生吟子」 |

## Compatibility Layers

| compatibility field/path | why it remains |
|---|---|
| `liveResolution.playerScoreBonuses` / `playerHeartBonuses` / `liveRequirementReductions` / `liveRequirementModifiers` | 现在由 `liveModifiers` 投影维护，供既有 UI/online projection/tests 兼容；新增 Live 修正不应主写这些字段。 |
| `GameService.drawTopMainDeckCard` / debug `DRAW_CARD_TO_HAND` | 规则流程抽牌和桌面调试命令暂不并入 card-effect draw helper，避免提前改变刷新/事件语义。 |
| runner 内 resolver switch | 当前仍作为稳定样例入口；等更多步骤模块稳定后再考虑 declarative resolver/step pipeline。 |

## Tests By Coverage Area

| area | tests |
|---|---|
| Ability classification and queue metadata | `tests/unit/card-effect-classification.test.ts` |
| Same-base rarity synchronization | `tests/unit/card-effect-rarity-sync.test.ts` |
| Card selectors | `tests/unit/card-selectors.test.ts` |
| Zone selection/move | `tests/unit/zone-selection.test.ts` |
| Effect costs | `tests/unit/effect-costs.test.ts` |
| Look-top primitives | `tests/unit/look-top.test.ts` |
| Live modifiers | `tests/unit/live-modifiers.test.ts`, `tests/unit/live-judgment-settlement.test.ts`, `tests/unit/heart-live.test.ts` |
| Member state / position change | `tests/unit/member-state.test.ts` |
| Draw helper | `tests/unit/draw.test.ts` |
| Energy placement/orientation helper | `tests/unit/energy.test.ts` |
| Integrated sample behavior | `tests/integration/sample-card-effect-runner.test.ts` |
