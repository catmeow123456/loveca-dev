# Runtime Action Helpers

> 文档类型：设计文档
> 适用范围：卡效 runtime 原子动作 helper 的参数轴、当前状态与迁移要求
> 当前状态：目标设计与当前落地记录；具体实现以 `src/application/card-effects/runtime/` 为准

runtime action helper 只表达原子动作，不表达完整卡文流程。它们的价值不是立刻减少总代码行数，而是让 workflow 不再重复实现同一套移动、抽牌、弃牌和结果记录语义。

## 目标成员绑定的临时 LIVE modifier

- `addPlayerScoreLiveModifierForTargetMember` 在 `domain/rules/live-modifiers.ts` 写入玩家总分 SCORE，同时显式保存 `targetMemberCardId`、审计 `sourceCardId` 和 `abilityId`；不以来源卡替代目标成员身份。
- `removeTargetMemberBoundLiveModifiersForLeaveStageEvents` 是 LeaveStageEvent 的通用 runtime hook，删除所有绑定离场成员实例的临时 modifier，并通过统一 modifier 底座刷新 `playerScoreBonuses` 等兼容投影。它不识别卡号或 abilityId；成员槽位移动和状态变化不触发删除。普通 action 派发会按 `triggerEventLogStartIndex` 只取得本次新增的 `ON_LEAVE_STAGE` 事件，并让 modifier 清理与离场 AUTO 来源构造复用同一批事件；显式传入的 `leaveStageEvents` 仍为权威输入，历史离场事件不得因后续成员离场而再次消费。
- 成员 HEART 的清理按显式 scope 执行：ACTIVE / WAITING 朝向变化和顶层槽位移动不清除；从顶层舞台进入休息室、手牌、LIVE、成功区、除外区，被占位替换或成为 `memberBelow` 都属于离场。`SOURCE_MEMBER` 随其来源／受益成员实例清除；`TARGET_MEMBER` 只随 `targetMemberCardId` 离场清除，其他来源卡离场不撤销；`PLAYER` 不绑定成员。RULES 与 FREE 手动移动必须产生同一 LeaveStage 清理事实，同实例重登场不会恢复旧 modifier，LIVE 结束统一清空。
- 当前真实样本包括 `PL!S-bp3-001` 与 `PL!-pb2-000`。后者在双换手登场能力结算后把来源和受益者都绑定到费用15「星空凛&小泉花阳」的同一成员实例；这不是对所有 SCORE modifier 施加目标语义，没有 `targetMemberCardId` 的旧 modifier 保持原有生命周期。

## 有限双换手入口

- `shared/rules/double-relay.ts#canUseDoubleRelay` 是服务端成员登场选项查询、费用计算与 play handler 共用的许可入口；当前只登记真实卡样本 `PL!SP-bp4-004`、`PL!SP-pb2-000` 与 `PL!-pb2-000`，不是任意卡文解析器。
- `application/member-play-options.ts` 把双换手作为 `MemberPlayOption(kind=DOUBLE_RELAY)` 投影到统一的手牌成员登场入口；客户端只读取服务端给出的 option id、玩家文案、合法槽位和“恰好选择2个槽位”描述，不再维护双换手卡号白名单。执行仍提交普通 `PLAY_MEMBER_TO_SLOT + relayMode=DOUBLE`，不会进入卡定义特殊登场 pending。
- 服务端始终重验正好2个不同成员槽位、包含登场目标槽位、槽位当前均有自己的可换手成员，并把两名成员当时的 `effectiveCost` 保存到同一个 `relayReplacements` 事件快照。后续登场能力读取该快照，不从结算时休息室卡面重新计算换手减免或费用合计。

## 当前公开声援的 LIVE_SUCCESS 来源

- `collectCurrentRevealedCheerLiveSuccessAbilitySources` 仅收集控制者本次声援集合中、仍位于 `resolutionZone.cardIds` 且仍列于 `revealedCardIds` 的卡，并要求 definition 明确声明 `LIVE_SUCCESS / REVEALED_CHEER_CARD / queued / implemented`。
- 该 helper 服务“能力来源仍因声援公开”的区域事实，不读取 event-inclusive CheerEvent 历史集合；历史集合仍只适合声援计数等条件查询。当前真实样本为 `PL!S-bp3-002`，不是任意区域来源总开关。

## 复数起动能力 UI 查询

- `runtime/activated-ability-ui.ts` 只读取 implemented `ACTIVATED` definitions 与舞台成员动态获得的起动能力，按 `abilityId` 去重并返回复数 `ActivatedAbilityUiConfig`；它不判断费用是否足够、不记录回合次数，也不创建 `activeEffect`。
- `activatedUi.displayOrder` 仅用于同一张卡具有多条起动能力时锁定卡面展示顺序；未配置时保持 definition / granted 查询的稳定顺序。`getActivatedAbilityUiConfig` 继续作为返回第一项的兼容包装，生产投影和新 UI 使用复数 `getActivatedAbilityUiConfigs`。
- 在线卡牌对象同时保留旧单数字段与复数字段；前端只展示一个能力选择菜单，玩家选择后才提交对应 `abilityId`，不会并行创建多个效果窗口。当前首个真实多能力样本是 `PL!N-bp1-006` 费用 13「近江彼方」。
- `runtime/activated-registry.ts` 允许 workflow 在注册 resolver 时同时登记只读 preflight；preflight 复用同一 workflow 的来源、费用和目标启动判定，只回答当前是否可发动，不支付费用、不记录次数、不创建窗口。机器决策等需要完整枚举合法动作的调用方先读取 UI config 与通用每回合限制，再查询该 preflight；缺少 preflight 必须显式视为覆盖缺口，不能试跑 resolver 或假定不可发动。首批证明范围为 AI 认证卡组中的 7 个不重复起动能力。

## 触发事件派发、能量区返回与活跃阶段标记

- `runtime/trigger-event-dispatch.ts` 统一以 `eventId + triggerCondition` 读取和写入
  `DISPATCH_TRIGGER_EVENT` 派发台账；“已派发”表示该事件发生时的合法监听来源已经全部检查，
  不要求实际生成 `TRIGGER_ABILITY`。当前生产接线只覆盖
  `ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK`、`ON_ENERGY_PLACED_BY_CARD_EFFECT` 与
  `ON_ENERGY_PLACED_BELOW_MEMBER`，不代表其他事件类型已经迁移。
- `runtime/energy-placement-triggers.ts` 负责
  `ON_ENERGY_PLACED_BY_CARD_EFFECT` 的 exact-event 入队和历史补扫。一个事件先扫描目标玩家舞台
  上全部合法监听来源，生成 0..N 个 pending，再写一次派发台账；无监听者、空/stale payload
  或全部监听能力达到回合次数上限时仍视为已派发，后续回合不得重新消费该历史事件。
- `runtime/energy-below-placement-triggers.ts` 是卡牌效果把 `ENERGY_ZONE` 能量放到当前己方顶层
  成员下方的统一事件 wrapper。它只在实际非空移动成功后产生一个
  `ON_ENERGY_PLACED_BELOW_MEMBER`，保存实际能量 IDs、目标成员实例、当时槽位、完整
  `CARD_EFFECT` cause 与 `ENERGY_ZONE -> MEMBER_SLOT` 区域事实；随后立即扫描事件发生时己方
  舞台监听来源并写派发台账，runner 的未派发补扫只作恢复防线。无监听者、监听能力已达
  turn limit 或 payload 后续 stale 均不会让该事件在下一回合复活。所有生产卡效的
  `ENERGY_ZONE -> energyBelow` 调用必须走这个 wrapper；从 `ENERGY_DECK` 放到成员下方仍是
  不同动作，不发此事件，也不由此建立任意 below DSL。
- 卡牌效果将能量区能量放回能量卡组统一使用 `runtime/energy-return.ts` 的 `resolveEnergyReturnByCardEffect`。该 helper 负责校验并移动指定能量、清除离区 marker、一次写入一个批量 `ON_ENERGY_MOVED_TO_DECK` 事件，并将本次精确事件传给触发入队；返回值包含实际 `movedEnergyCardIds` 与本次 `energyMovedEvent`，caller 不得根据输入数组推测实际移动结果。card workflow 与其他 card-effect runtime 不得直接调用底层 `moveEnergyZoneCardsToEnergyDeckByCardEffect`。
- `energyActivePhaseSkips` 按具体 energyCardId 绑定，只在该玩家下一次活跃阶段消费；卡牌效果仍可主动将其变为活跃。
- 当前规则资料没有明确离区后的 marker 保留语义，因此采用“能量离开能量区即清除”的实现假设。
- `getEnergySelectionCandidates` 统一四类卡效候选：支付只取 ACTIVE，活跃只取 WAITING，放到成员下方和返回能量卡组取能量区全部能量。后两类在自动处理时固定按 WAITING 优先、ACTIVE 其次；不得退回能量区存储顺序、首张或前 N 张选择。
- `shouldSelectEnergyCards` 在“候选数大于实际处理数，且至少一张候选带 marker”时要求玩家选择；候选数等于处理数或候选中没有 marker 时自动处理。全 marker 与普通/marker 混合采用同一规则。
- `energy-operation-selection.ts` 是 activeEffect 通用前置步骤：卡效原语需要选择时暂停当前 activated/pending/activeEffect step，玩家按明确 energyCardId 选择后恢复原步骤。连续发生多个能量操作时会重放已经确认的选择，不提前提交自送、弃手等不可逆费用。
- 当前生产者覆盖卡牌效果 wrapper，以及 `applyRuleActionResult` 中真实声明 `ENERGY_ZONE -> ENERGY_DECK` 的规则批量移动；同一规则结果中的多张能量合并为一个事件。
- raw remove、目标不是能量卡组的移动和调试/手动工具移除只清理 marker，不产生返回事件，因为这些入口本身不具备完整目标区域或规则触发语义。
- `createOptionalEnergyReturnWindow` / `resolveOptionalEnergyReturn` 只承接“可选返回 N 张能量”的发动或具体能量选择、精确候选校验，并将实际执行委托给 `resolveEnergyReturnByCardEffect`；006的休息室回收与007的 BLADE 奖励仍留在各自单卡 workflow。强制费用或卡牌专属分支可不使用 optional window，但选择完成后的返回执行必须复用同一个 energy-return helper。
- `hasPlayerMovedEnergyFromZoneToDeckThisTurn` 是只读标准事件 query；workflow 不直接解释 eventLog。`hasAbilityInstance` 统一检查 pending、activeEffect 与已结算的同 pendingAbilityId，保证事件重复入队幂等。

## Design Rules

- helper 应返回新 `GameState` 与必要结果，例如抽到或弃置的 cardIds。
- helper 不调用 `continuePendingCardEffects`。
- helper 不创建完整 pending / activeEffect。
- helper 不改变费用支付时机或事件消费时机。
- helper 不吞掉现有 action payload 需要的事实。
- helper 有 focused unit test 或被 integration test 覆盖。

## Current Runtime Actions

当前 `src/application/card-effects/runtime/actions.ts` 已起步：

| helper                                         | responsibility                                                                       | current semantic boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drawCardsForPlayer`                           | 单个玩家按现有卡效抽牌语义抽 N 张。                                                  | 复用 `drawCardsFromMainDeckToHand`；按 `detail_rules.md` 5.6 的“抽 N 张 = 重复抽 1 张”和 10.2 的卡组更新规则处理牌库不足。主卡组为空且休息室有卡时会在抽牌处理中断点先执行刷新，再继续抽；若刷新后仍无可抽卡，则只抽实际可抽数量。                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `drawCardsForEachPlayer`                       | 按传入玩家顺序让每名玩家抽同样张数。                                                 | 返回 `drawnCardIdsByPlayer`；用于双方依次抽。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `discardHandCardsToWaitingRoomForPlayer`       | 指定玩家从手牌精确弃置若干张到休息室。                                               | exact count；可传候选集合；内部复用现有弃手费用移动语义；非 0 张时记录同批 `ON_ENTER_WAITING_ROOM` 事件但不自动入队。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `discardOneHandCardToWaitingRoomForPlayer`     | 单张手牌弃置便捷 helper。                                                            | 基于 exact-count helper；透传同批进入休息室事件。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `recoverCardsFromWaitingRoomToHandForPlayer`   | 指定玩家将已选择的休息室卡加入手牌。                                                 | 固定 `WAITING_ROOM -> HAND`；候选集合必传；支持 exact 或 min/max 计数；不创建 activeEffect。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `placeHandLiveCardInLiveZoneForPlayer`         | 指定玩家将已选择的手牌 LIVE 卡放置到 LIVE 卡置场。                                   | 固定 `HAND -> LIVE_ZONE`；候选集合必传；caller 指定正面/背面；只移动当前手牌中的 LIVE 卡并记录 `ON_ENTER_LIVE_ZONE` 事件，不检查自然 Live Set 上限、不创建 activeEffect、不推进 pending。当前真实样本是 `PL!N-bp4-026-L` 主要阶段从手牌正面放置「DIVE!」。                                                                                                                                                                                                                                                                                                                                                                                              |
| `placeWaitingRoomLiveCardInLiveZoneForPlayer`  | 指定玩家将已选择的休息室 LIVE 卡放置到 LIVE 卡置场。                                 | 固定 `WAITING_ROOM -> LIVE_ZONE`；候选集合必传；caller 指定正面/背面；只移动当前休息室中的己方 LIVE 卡并记录 `ON_ENTER_LIVE_ZONE` 事件，不检查自然 Live Set 上限、不创建 activeEffect、不推进 pending。当前真实样本是 `PL!HS-bp2-018-N` 费用 7「安養寺 姫芽」支付2能量后的正面放置。                                                                                                                                                                                                                                                                                                                                                                    |
| `shuffleHandCardsToDeckBottomForPlayer`        | 将 caller 已确定的手牌子集洗切后放到该玩家主卡组底。                                 | 固定 `HAND -> MAIN_DECK_BOTTOM`；要求 cardIds 唯一且提交时仍全部位于该玩家手牌，只洗切该子集并保持其余手牌与既有主卡组顺序；空集合为原状态 no-op。不扫描“保留手牌”规则、不创建 activeEffect、不抽牌或推进 pending。当前公开样本是 `PL!S-bp7-004-P` 费用13「黑泽黛雅」，效果按基础编号覆盖。                                                                                                                                                                                                                                                                                                                                                             |
| `shuffleWaitingRoomCardsToDeckBottomForPlayer` | 将 caller 已确定的休息室卡洗切后放到主卡组底。                                       | 固定 `WAITING_ROOM -> MAIN_DECK_BOTTOM`；真实非空移动写一条 grouped `ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK`，`movedCardIds` 为实际洗切顺序、destination 为 `SHUFFLED_BOTTOM`；生产 workflow 必须调用对应 `...AndEnqueueTriggers` wrapper。                                                                                                                                                                                                                                                                                                                                                                                                           |
| `moveWaitingRoomCardsToDeckBottomForPlayer`    | 将 caller 已有序确定的休息室卡按传入顺序放到主卡组底。                               | 固定 `WAITING_ROOM -> MAIN_DECK_BOTTOM`；候选集合必传；真实非空移动写一条 grouped event，destination 为 `BOTTOM`；生产 workflow 必须调用对应 wrapper。真实 0–1 LIVE 样本为 `PL!S-bp2-008` 费用 17「小原鞠莉」。                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `moveWaitingRoomCardsToDeckTopForPlayer`       | 将 caller 已有序确定的休息室卡按传入顺序放到主卡组顶。                               | 固定 `WAITING_ROOM -> MAIN_DECK_TOP`；候选集合必传；真实非空移动写一条 grouped event，destination 为 `TOP`；生产 workflow 必须调用对应 wrapper。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `moveWaitingRoomCardToDeckPositionForPlayer`   | 将 caller 已确定的 1 张休息室卡插入主卡组第 N 张位置。                               | 固定 `WAITING_ROOM -> MAIN_DECK`；目标位置从卡组顶 1-based 计数，剩余卡组不足时插入底部；真实移动写 grouped event，并同时保存请求的 `positionFromTop` 与实际 `insertIndex`；生产 workflow 必须调用 `moveWaitingRoomCardToDeckPositionAndEnqueueTriggers`。                                                                                                                                                                                                                                                                                                                                                                                              |
| `moveHandCardToDeckTopForPlayer`               | 将 caller 已确定的 1 张手牌放到主卡组顶。                                            | 固定 `HAND -> MAIN_DECK_TOP`；候选集合必传；只覆盖当前真实卡样本 `PL!N-bp4-009` 的单张手牌回顶动作；不洗切、不扫描 selector、不写 action、不处理 activeEffect。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `moveHandCardToDeckBottomForPlayer`            | 将 caller 已确定的 1 张手牌放到主卡组底。                                            | 固定 `HAND -> MAIN_DECK_BOTTOM`；候选集合必传；重新验证目标仍在该玩家手牌，按主卡组底追加；不洗切、不扫描 selector、不写 action、不创建 activeEffect、不处理 pending。真实样本包括 `PL!S-bp2-007` 费用 4「国木田花丸」公开手牌 LIVE 后置底，以及 `PL!S-bp5-014` / `PL!S-sd1-017` / `PL!S-sd1-018` 的抽1后选择1张手牌置底 family。                                                                                                                                                                                                                                                                                                                       |
| `moveHandCardsToDeckTopForPlayer`              | 将 caller 已有序确定的多张手牌按顺序放到主卡组顶。                                   | 固定 `HAND -> MAIN_DECK_TOP`；候选集合必传；exact count；当前真实样本是 `PL!N-bp4-031` 抽 3 后强制选择 3 张当前手牌按玩家指定顺序回顶；不洗切、不扫描 selector、不写 action、不处理 activeEffect。                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `stackMemberCardBelowStageMember`              | 将指定玩家手牌或休息室的 1 张成员卡放到舞台主成员下方。                              | 固定 `HAND / WAITING_ROOM -> memberBelow`；校验 host 是该玩家舞台顶层 MEMBER、cardId/槽位匹配、移动卡 owner/类型/来源区正确且未在任一 memberBelow；不登场、不换手、不 enqueue trigger。                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `playMemberBelowCardToEmptySlot`               | 将指定舞台 host 下方的 1 张成员卡登场到空成员区。                                    | 固定 `memberBelow -> empty MEMBER_SLOT`；校验来源卡确在指定 host/sourceSlot 的 `memberBelow`、目标槽为空且移动卡为成员；写入 FACE_UP / ACTIVE 与 `ON_ENTER_STAGE` 事件，但不自动入队 trigger。                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `playMemberFromZoneToStageSlotWithReplacement` | 将 HAND / WAITING_ROOM 的 1 张成员因卡效登场到指定成员区，占用区域执行重复成员规则。 | 只校验来源区、owner 与 MEMBER；caller 必须在展示和确认时重验 `movedToStageThisTurn` 区域限制。占用区域不是换手：不调用 `canMemberBeRelayedAway`，不写 `replacingCardId` / `replacedMemberCardId` / effective-cost / `relayReplacements`，不产生 `ON_RELAY`。权威状态原子处理 energyBelow 返能量卡组与旧成员/memberBelow 进休息室，但事件顺序为新成员 `ON_ENTER_STAGE` 先于旧成员 `ON_LEAVE_STAGE` / `ON_ENTER_WAITING_ROOM`，并记录 `RULE_ACTION/DUPLICATE_MEMBER`。caller 决定费用、selector、窗口、action、trigger enqueue 与 continuation。当前真实调用者为 `PL!SP-sd1-002`、`PL!N-bp1-002` 与 shared `on-enter-pay-two-play-low-cost-hand-member`。 |
| `rearrangeStageMembers`                        | 按最终布局一次性重排当前自己舞台上的主成员。                                         | 输入必须覆盖当前全部主舞台成员；cardId 与目标成员区唯一，成员必须属于该玩家且当前在舞台。energyBelow/memberBelow 跟随各自主成员移动；空槽清空下方堆叠；只为实际 fromSlot != toSlot 的成员记录 `positionMovedThisTurn` 与 `ON_MEMBER_SLOT_MOVED`。                                                                                                                                                                                                                                                                                                                                                                                                       |
| `rearrangeStageMembersByMoveHistory`           | 从当前权威舞台状态 replay 站位变换操作序列，再一次性写入最终舞台。                   | 每步校验 `cardId` 当前在己方舞台、`toSlot` 合法；移到同槽忽略；移到空槽记移动者 moved；移到已有成员槽按交换处理且双方 moved。最终 energyBelow/memberBelow 跟随各自主成员移动；可用 `expectedPlacements` 校验前端提交的最终布局。为降低旧触发器重复连锁风险，同一成员一次站位变换最多发 1 个 `ON_MEMBER_SLOT_MOVED`，事件槽位取该成员第一次真实移动；完整 `moveHistory` 由 workflow 写入 action payload。                                                                                                                                                                                                                                                |
| `addBladeLiveModifierForSourceMember`          | 为真实能力来源成员本身写入 `SOURCE_MEMBER` BLADE。                               | source 必须是该玩家的顶层舞台成员；不根据卡型或 ID 相等性推测 scope。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `addBladeLiveModifierForTargetMember`          | 为指定受益成员写入 `TARGET_MEMBER` BLADE，分别保留真实 source 与 target。              | target 必须是该玩家的顶层舞台成员；`sourceCardId === targetMemberCardId` 仍写 TARGET，不折叠为 SOURCE。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `addBladeLiveModifiersForTargetMembers`        | 为调用方已快照的一个或多个玩家舞台成员逐一写入等量 `TARGET_MEMBER` BLADE。            | targets 必须是唯一的 `playerId + targetMemberCardId` 对；任一目标非法时整体返回 `null`，不会暴露部分写入状态。只批量执行 modifier 原子动作，不扫描舞台、不决定目标、条件、窗口、action 或 continuation。真实样本为 `PL!N-PR-022` 费用2「艾玛·维尔德」与 `LL-PR-004` 分数3「愛♡スクリ～ム！」。                                                                                                                                                                                                                                                                                                                                                              |
| `addBladeLiveModifierForPlayer`                | 为玩家本次 LIVE 写入 `PLAYER` BLADE。                                                | 只验证 player 存在且 amount 为正整数；`sourceCardId` 仅保留真实来源，不检查来源卡型或区域，来源 WAITING/离场不撤销。                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `clearRemainingHeartsForPlayer`                | 清空指定玩家本次 LIVE 判定后的余剰/剩余 Heart。                                      | 只操作 `liveResolution.playerRemainingHearts` 的 plain `HeartIcon[]`；返回 `lostHearts` 与 `lostTotalCount`；不写 action，不消费 pending，不用于只读取剩余 Heart 的卡。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Adjacent Runtime Rule Helpers

这些 helper 不在 `runtime/actions.ts` 内，但属于卡效 workflow 可复用的窄 runtime 能力：

| helper                                                                                                                                                    | responsibility                                                                                    | current semantic boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `addLiveProhibitionUntilLiveEnd` / `clearLiveProhibitionsUntilLiveEnd`                                                                                    | 写入并清除“直到 Live 结束时为止不能 Live”的临时限制。                                             | `PL!HS-bp2-014` 使用 `expiresAt: 'LIVE_END'` 状态；清除点是 Live 结果收尾/离开 Live 结果阶段。该状态独立于场面，不能用来表达随舞台变化即时失效或恢复的常时限制。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `collectContinuousLiveProhibitionSources` / `isPlayerContinuouslyLiveProhibited` / `isPlayerLiveProhibited` / `liveProhibitedPlayerLiveZoneToWaitingRoom` | 从当前场面实时收集常时禁止来源，并把临时或常时任一命中统一交给双方 Live Set 完成后的既有处理。    | `PL!SP-bp1-001` 是首个 continuous 样本：只读取控制者三个主舞台顶层合法 MEMBER，单独一张合法 001 时禁止；其他己方顶层成员使其即时失效，对方成员与 memberBelow 不计入，两张 001 互为其他成员。查询不写状态、不创建 action、不进入 `liveModifiers`。`SET_LIVE_CARD` 仍不拒绝盖牌，玩家分别按规则抽牌；先攻盖下的卡在后攻确认前保持非公开，双方完成后才把受限玩家 liveZone 全部放入休息室。不要扩展成任意 condition callback、期限 DSL 或 phase prohibition framework。                                                                                                                                                                                          |
| `addMemberWaitProtectionUntilLiveEnd` / `isMemberWaitProtectedFromChange` / `clearMemberWaitProtectionsUntilLiveEnd`                                      | 写入、查询并在真实 LIVE_END 清除费用4「松浦果南」所需的窄成员待机保护。                           | 通用 `createStageMemberOrientationTargetSelection` 在 CARD_EFFECT 目标为 WAITING 时用同一 cause 删除受保护候选；`setMemberOrientation` / `setMembersOrientation` 在实际 ACTIVE -> WAITING 边界继续防御 stale/伪造目标。cause 的 `playerId` 是效果控制者并决定是否属于对方效果，`selectionPlayerId` 只记录作出选择的玩家，不能让受影响玩家绕过保护。因此费用15「セラス 柳田 リリエンフェルト」有未保护成员时只能从中选择，全部受保护时什么也不发生。目标动态限当前主舞台顶层、结构化 Aqours、印刷 BLADE <=3；来源离场不撤销，LIVE_END 才清理。单/批量返回分别明确区分既有 activation prohibition 与 waiting protection。不是任意免疫、期限或 protection DSL。 |
| `addMemberActivePhaseSkip` / `consumeMemberActivePhaseSkipsForPlayer` / `collectContinuousActivePhaseSkippedMemberCardIds`                                | 写入并消费“下一次该玩家活跃阶段此成员不自动 active”的成员级标记，并收集已落地常时活跃阶段跳过。   | 一次性标记仍只支持下一次自己的 active phase；消费点是活跃阶段自动处理。被标记成员保持 WAITING 且不产生 WAITING -> ACTIVE 事件，其他待机成员和能量仍正常 ACTIVE；来源离场时安全消费标记，不影响其他成员。常时跳过目前只覆盖两种真实语义：`PL!N-bp5-006` 自身在自己的活跃阶段不 ACTIVE，以及 `PL!HS-pb1-008` 位于对手舞台时使当前玩家舞台成员不因活跃阶段 ACTIVE。能量仍正常 ACTIVE；来源离开对应舞台后立即失效，不扩展为通用 phase prohibition framework。                                                                                                                                                                                                    |
| `canLiveCardEnterSuccessZone` / `isLiveCardProhibitedFromSuccessZone` / `getSuccessLiveSelectionCandidateIds`                                             | 读取本轮成功 Live 入成功区是否合法，并为 RESULT_SETTLEMENT 生成当前胜者候选。                     | 当前只落地 `PL!S-bp2-024` 不能放置入成功 LIVE 卡区的真实规则；覆盖自然成功 Live 选择、`PL!-bp6-024` 替代候选、Maki 成功区交换候选与手动/通用移动到 SUCCESS_ZONE 校验。不创建 activeEffect、不移动卡、不抽 replacement DSL。                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `buildPlayMemberCostResources` / `getHandMemberEffectivePlayCost`                                                                                         | 从当前 `GameState` 为一张己方手牌成员构造与普通登场一致的费用资源，并只读查询其当前有效登场费用。 | `GameSession.preparePlayMemberCostPayment` 与 `PL!SP-bp1-003` 共用同一资源构造；caller 必须传入权威的完整手牌快照。查询包含当前主舞台顶层成员、成功 LIVE、能量、朝向与本回合移动事实，不移动卡、不支付费用、不复制费用规则，也不把任意资源或费用轴抽成 DSL。                                                                                                                                                                                                                                                                                                                                                                                                 |
| `addLiveSetLimitReduction` / `getLiveSetCardLimitForPlayer` / `consumeLiveSetLimitReductionsForPlayer`                                                    | 写入、读取并消费“下一次 LIVE 卡设置阶段可放置卡数上限减少”的玩家级标记。                          | 当前只支持 player-scoped、下一次自己的 Live Set 阶段消费的正整数减少；自然 `SET_LIVE_CARD` 校验读取有效上限，但“本阶段已放置张数”必须读取 `liveSetCardCounts`，不能用 LIVE 区总张数（卡效预放的 LIVE 不计入本次 SET 张数）；Live Set 抽卡自动子阶段按 `liveSetCardCounts` 抽牌、清理该玩家计数并消费该玩家的减额标记；下限 clamp 到 0。不进入 liveModifiers，不重构 phase engine。                                                                                                                                                                                                                                                                           |
| `createEnterWaitingRoomEvent`                                                                                                                             | 创建卡牌进入休息室事件，支持同批多张进入休息室的 `cardInstanceIds` 与可选 `CardEffectCause`。     | `cardInstanceId` 保留首张兼容旧读取；卡效移动可保存 `playerId/sourceCardId/abilityId/pendingAbilityId` 因果，普通规则移动保持缺省。runner 目前只为真实 `OWN_LIVE_SUCCESS_ABILITY` 样本读取 cause category，不提供任意 cause expression DSL。raw 弃手 helper 会记录手牌到休息室事件，但不入队触发能力。                                                                                                                                                                                                                                                                                                                                                       |
| `inspectBottomCards` / `moveInspectedCardsToDeckBottomRestToWaitingRoomAndEnqueueTriggers`                                                                | 私密检视主卡组底并把已检视卡完整分配回卡组底或休息室。                                            | `inspectBottomCards` 复用现有 refresh / inspection owner/viewer 语义，返回顺序固定为“当前最下方在前”；归位 helper 要求两个目的地唯一且恰好覆盖全部 inspected cards。玩家选择中的数字1表示最终卡组最下方，因此写回 `mainDeck.cardIds` 时反向追加；休息室子集只产生一个 grouped `MAIN_DECK -> WAITING_ROOM` 事件并可透传 cause。当前公开样本是 `PL!S-bp7-004-P` 费用13「黑泽黛雅」，效果按基础编号覆盖；不代表任意卡组边缘 DSL。                                                                                                                                                                                                                               |
| `moveInspectedCardsToDeckTopAndBottom`                                                                                                                    | 将同一次私密检视的卡完整、有序地分配到主卡组顶和卡组底。                                          | caller 必须传入无重复且恰好覆盖当前 inspection 的两个有序列表；顶牌按数组顺序前置，底牌输入顺序按“最底一张在前”解释并反向追加，成功后统一清理 inspection。当前真实使用者是 DRAFT `PL!S-bp7-008` 的登场能力；helper 不创建 activeEffect、不决定任意张数选择、不发休息室事件、不推进 pending，也不扩展为任意 zone partition DSL。                                                                                                                                                                                                                                                                                                                                                   |
| `discardHandCardsToWaitingRoomAndEnqueueTriggers` / `discardOneHandCardToWaitingRoomAndEnqueueTriggers`                                                   | 从手牌弃到休息室，并把 helper 返回的本次事件显式交给 runner 入队。                                | workflow 默认使用这层 wrapper；只消费当前 result 的 `enterWaitingRoomEvent`；不从 `eventLog` 查 latest/all，不 resolve pending，不改变当前 workflow 后续 step。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `enqueueEnterWaitingRoomTriggersFromDiscardResult`                                                                                                        | 将已取得的弃手 result 事件显式交给 runner 入队的底层胶水。                                        | 供 wrapper 和少数底层衔接使用；普通业务 workflow 不应直接重复调用。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `partitionInspectedCardsToHandDeckTopWaitingRoomAndEnqueueTriggers`                                                                                       | 将 caller 已分配的 inspected cards 原子移动到手牌、卡组顶与休息室。                               | 校验三个目的地无重复且恰好全量覆盖传入 inspected cards，并确认每张仍在 inspectionZone；一次性更新三个目的地并统一清理 inspection。只为 waiting-room 子集发同批 `MAIN_DECK -> WAITING_ROOM` 事件；可选透传当前卡效 `CardEffectCause`，shared arrange/look-top 用它保留 LIVE_SUCCESS 因果。不限定各目的地数量、不表达单卡分配规则、不创建 activeEffect 或推进 pending。                                                                                                                                                                                                                                                                                        |
| `moveExactTopDeckCardsToWaitingRoomAsCostAndEnqueueTriggers`                                                                                              | 从当前主卡组顶精确支付 N 张到休息室，保留 grouped moved IDs，并在支付后处理规则刷新。             | 支付前要求当前主卡组至少有 N 张，不用 refresh 补足；一次移动只产生一个 `MAIN_DECK -> WAITING_ROOM` 分组事件。若移动后主卡组为空，先完成标准刷新，再以原事件事实继续 caller 的效果；refresh 洗回不并入 moved IDs。wrapper 只负责移动、刷新、prepare callback 与标准 enqueue，不判断卡牌命中、不推进 continuation。当前公开样本是 `PL!N-bp7-006-SEC` 的顶3费用，效果按基础编号覆盖。                                                                                                                                                                                                                                                                           |
| `moveTopDeckCardsForPlayersWithRefreshAndEnqueueTriggers`                                                                                                 | 在同一效果内为多个明确 owner 分别执行 refresh-aware 顶牌直送休息室，并在全部移动后统一入队。      | 每位玩家独立 owner、moved IDs、refresh count 与 grouped event；移动顺序显式以主动玩家优先，来源 controller 不替代主动玩家。只有全部 owner 的移动事实建立后才调用一次标准 enqueue；不合并成跨 owner 事件、不维护私有 pending 队列、不推进 continuation。当前公开样本是 `PL!N-bp7-009-P` 的双方顶7，效果按基础编号覆盖。                                                                                                                                                                                                                                                                                                                                       |
| `stackEnergyFromEnergyZoneBelowMember`                                                                                                                    | 将指定玩家 energyZone 的 N 张能量放到目标主成员下方。                                             | 位于 `src/application/effects/energy-below.ts`；候选为能量区全部能量，并统一经过 `resolveEnergySelectionForOperation`。无需玩家选择时保留 WAITING-first、再 ACTIVE 的既有自动顺序；存在 marker 且候选多于处理数时由通用 activeEffect 前置步骤取得明确 cardId。能量不足或目标槽无主成员时返回 `null` 且不部分移动；`count=0` 保持 no-op。                                                                                                                                                                                                                                                                                                                     |
| `returnEnergyBelowMemberToEnergyDeck` / `returnEnergyBelowMemberToEnergyDeckForPlayer`                                                                    | 主成员离场或被替换前，将同槽 `energyBelow` 归还能量卡组。                                         | 位于 `src/application/effects/energy-below.ts`；复用 `popEnergyBelowMember`，按当前下方顺序追加到 `energyDeck`；不移动主成员或 memberBelow。换手、普通成员替换和来源成员自送费用应主动调用它，domain rule cleanup 只作为空槽残留兜底。                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `placeEnergyFromEnergyDeckBelowStageMember`                                                                                                               | 从玩家 ENERGY_DECK 顶将实际至多 N 张合法 ENERGY 放到指定成员实例下方。                            | 只接受该玩家当前己方顶层舞台 MEMBER，并按实例查找当前槽位；空卡组返回空 IDs，非法/stale/memberBelow/对方目标返回 null，异常顶牌不跳过。保持卡组顶 index 0 与剩余顺序，返回精确 `targetSlot/placedEnergyCardIds`。不创建 activeEffect、不推进 pending、不发只表示 ENERGY_DECK→ENERGY_ZONE 的 `ON_ENERGY_PLACED_BY_CARD_EFFECT`，也不是任意区域/任意 below DSL。                                                                                                                                                                                                                                                                                               |
| `moveMemberBetweenSlotsAndEnqueueTriggers` / `rearrangeStageMembersAndEnqueueTriggers` / `rearrangeStageMembersByMoveHistoryAndEnqueueTriggers`           | 成员区实际移动后，将本次新产生的 `ON_MEMBER_SLOT_MOVED` 事件显式交给 runner 入队。                | workflow 默认使用这层 wrapper；只包底层移动 helper + 本次新事件入队；caller 仍负责选择/校验、action payload、pending continue；不从 `eventLog` 查 latest/all，不做通用站位 DSL。卡效移动应传 `cause: { kind: 'CARD_EFFECT', ... }`，玩家手动移动保持不传 cause。批量站位变换 wrapper 支持 caller 先写 `RESOLVE_ABILITY`，再统一 enqueue 所有本次移动事件。                                                                                                                                                                                                                                                                                                   |

`moveInspectedCardToDeckPositionFromTop` 是窄 `INSPECTION_ZONE -> MAIN_DECK_POSITION_N` 原子 helper：只接受当前 inspection owner 从主卡组检视的唯一1张卡，重验卡牌 owner、sourceZone、目标未在主卡组且 `positionFromTop` 为正整数。实际 `insertIndex` 为 `min(positionFromTop - 1, remainingDeckLength)`，短卡组因此夹到卡组底；成功后清理 inspection/context，但不创建事件、action、activeEffect 或 pending。当前真实样本是 DRAFT `PL!S-bp7-010-N` 费用4「高海千歌」的卡组底私密检视后可选置入卡组顶第4张；不是任意 inspection 区域移动或卡组位置 DSL。

`runtime/member-slot-moved-observers.ts` 是窄注册调度器，不是任意 observer DSL。`PL!SP-pb2-022` 的 5yncri5e!/CENTER 条件、同次交换匹配事件优先和 pending 审计快照全部归属其单卡 workflow handler；runner 只在普通成员移动入队后调用 `enqueueMemberSlotMovedObserverCardEffects`，不得保留该卡 abilityId、团体或位置 gate。observer 的回合次数预占必须复用 `runtime/ability-turn-limit.ts`，按 `playerId + abilityId + sourceCardId + sourceLifecycleId` 统一统计已结算 use、pending 与 activeEffect；不得只查已结算 action 或 exact eventId pending。

`runtime/ability-source-lifecycle.ts` 统一解释“1回合 N 次”的来源规则对象。实体 `CardInstance.instanceId` 跨区保持稳定，成员或 LIVE 卡跨区域重新进入来源区域时则由最近的 `ON_ENTER_STAGE.eventId` / `ON_ENTER_LIVE_ZONE.eventId` 形成新的 `sourceLifecycleId`；成员区到成员区、LIVE 区到 LIVE 区和方向状态变化不产生新 lifecycle。没有入口事件的测试直置对象使用稳定 initial sentinel。per-turn pending 在入队后按自身 `eventIds` 的 eventLog sequence 回溯并捕获 lifecycle，activeEffect 与 `ABILITY_USE` 在通用 dispatch 边界传播同一值，因此旧 pending/active 不会占用新对象次数，审计历史也无需删除。
| `enqueueMemberStateChangedTriggersFromOrientationResult` | 将已取得的成员方向变化 result 产生的本次 `ON_MEMBER_STATE_CHANGED` 事件显式交给 runner 入队。 | 已用于当前卡效 workflow 中的成员横置/竖置路径；保留 `setMemberOrientation` / `resolveStageMemberOrientationTargetSelection` 写入的 cause；caller 仍负责 action payload、activeEffect/后续 step、pending continue；普通操作、费用支付或未来 raw orientation wrapper 仍需另审。 |
| `paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers` | 支付来源成员自送到休息室费用，并把本次 `ON_LEAVE_STAGE` 事件显式交给 runner 入队。 | 只覆盖来源成员自送到休息室；可保留同一次费用支付中自送前的能量费用；caller 仍负责 action payload、activeEffect/后续 step、pending continue；不泛化任意 zone move，不改变费用支付时机。 |
| `getRemainingHeartCount` / `getRemainingHeartTotalCount` / `hasRemainingHearts` / `hasRemainingHeartColor` / `hasNoRemainingHearts` | 读取本次 LIVE 判定后的余剰/剩余 Heart。 | 位于 `src/application/effects/remaining-hearts.ts`；只读 `liveResolution.playerRemainingHearts`，不改变状态；指定颜色查询严格匹配该颜色，`RAINBOW` / ALL 不会被当作绿色等指定颜色，总数查询会计入 `RAINBOW`。 |

## Draw Helper Parameters

### `drawCardsForPlayer`

| parameter  | meaning            |
| ---------- | ------------------ |
| `game`     | 当前 `GameState`。 |
| `playerId` | 抽牌玩家。         |
| `count`    | 抽牌张数。         |

Return:

- `gameState`
- `drawnCardIds`

Rules:

- 只用于卡效步骤抽牌。
- 不接管开局、阶段规则抽牌或调试命令。
- 不改变牌库不足语义：抽多张时逐张执行；每次抽牌前后都允许触发 `detail_rules.md` 10.2 的主卡组更新。主卡组为空且休息室有牌时先刷新再继续；主卡组与休息室都无可用牌时停止，返回实际抽到的 `drawnCardIds`。

### `drawCardsForEachPlayer`

| parameter   | meaning              |
| ----------- | -------------------- |
| `game`      | 当前 `GameState`。   |
| `playerIds` | 按此顺序连续抽牌。   |
| `count`     | 每名玩家抽同样张数。 |

Return:

- `gameState`
- `drawnCardIdsByPlayer`

当前不支持不同玩家不同抽牌数；没有实卡证明前不提前泛化。

## Discard Helper Parameters

### `discardHandCardsToWaitingRoomForPlayer`

| parameter          | meaning                          |
| ------------------ | -------------------------------- |
| `game`             | 当前 `GameState`。               |
| `playerId`         | 手牌被弃置的玩家。               |
| `selectedCardIds`  | 选择弃置的手牌实例。             |
| `count`            | 必须精确弃置的张数。             |
| `candidateCardIds` | 可选候选集合；用于防止选择越界。 |

Return:

- `gameState`
- `discardedCardIds`
- `enterWaitingRoomEvent?`

Current boundary:

- 只覆盖 exact count。
- 目的地固定为休息室。
- 非 0 张弃置会记录一个同批 `ON_ENTER_WAITING_ROOM` 事件；0 张不记录事件。
- raw helper 不自动调用 `enqueueTriggeredCardEffects`；需要触发“手牌进入休息室”自动能力的 workflow 必须调用 `discardHandCardsToWaitingRoomAndEnqueueTriggers` / `discardOneHandCardToWaitingRoomAndEnqueueTriggers`，只消费 helper 返回的本次新事件。
- workflow 不允许裸调 raw hand-discard helper。raw helper 仅供 `runtime/actions.ts`、底层 action/unit test，或明确不触发卡效的特殊底层路径使用；特殊路径必须在代码注释说明为什么不入队。
- 不区分 `actingPlayerId` / `discardPlayerId` / `selectingPlayerId`；这部分属于 activeEffect step 层。
- 不表达“弃到 N 张”“可选弃置”“费用期间事件消费”等复杂语义。

## Recovered Cards Helper Parameters

### `recoverCardsFromWaitingRoomToHandForPlayer`

| parameter               | meaning                              |
| ----------------------- | ------------------------------------ |
| `game`                  | 当前 `GameState`。                   |
| `playerId`              | 休息室与手牌所属玩家。               |
| `selectedCardIds`       | 已选择并按此顺序加入手牌的卡牌实例。 |
| `candidateCardIds`      | 必传候选集合；用于防止选择越界。     |
| `exactCount`            | 精确选择张数；与 min/max 互斥。      |
| `minCount` / `maxCount` | 选择数量范围；与 exactCount 互斥。   |

Return:

- `gameState`
- `movedCardIds`
- `selectedCardIds`
- `remainingCandidateIds`

Current boundary:

- source/destination 固定为 `WAITING_ROOM -> HAND`。
- 不扫描候选；selector 与 UI step 属于 workflow。
- 不处理 no-target 确认、公开确认、分组上限或后续奖励。
- 从休息室自由选择的卡必须先由 `runtime/public-card-selection-confirmation.ts` 暂停原 step 并向双方公开；本 helper 保持纯移动，不创建 UI 或推进 step。
- 不表达费用支付或 pending 继续。
- 非空移动会为每张加入手牌的卡记录 `ON_ENTER_HAND` 事件，事件事实为 `WAITING_ROOM -> HAND`；普通 recovery workflow 仍由调用方负责何时触发/继续 pending。

### `moveRevealedCheerCards` 与公开展示边界

- `effects/cheer-selection.ts` 只负责把已重校验的当前声援可移动卡放入 `HAND` / `MAIN_DECK_TOP` / `MAIN_DECK_BOTTOM` / `WAITING_ROOM`，不创建 UI、deadline、turn1 或追加声援。
- 玩家从声援处理区确定具体卡牌后，原 workflow 必须先通过 `runtime/public-card-selection-confirmation.ts` 展示；展示期间卡仍在 resolution zone，不记录 turn1、不追加声援、不推进 pending。
- 条件查询的 `CheerEvent.revealedCardIds` 是历史事实；公开窗口和实际移动用的是当前声援 ID 中仍在 resolution zone 且 revealed 的交集，两者不可混用。

## Waiting Room Shuffle-To-Deck Helper Parameters

### `shuffleWaitingRoomCardsToDeckBottomForPlayer`

| parameter  | meaning                                                             |
| ---------- | ------------------------------------------------------------------- |
| `game`     | 当前 `GameState`。                                                  |
| `playerId` | 休息室与主卡组所属玩家。                                            |
| `cardIds`  | caller 已确定要从休息室移走并洗切的卡牌实例。                       |
| `cause`    | 必传 `CardEffectCause`；保留效果发动者、来源卡与 ability identity。 |

Return:

- `gameState`
- `movedCardIds`
- `originalCardIds`
- `waitingRoomCardsMovedToMainDeckEvent`（仅真实非空移动）

Current boundary:

- 只校验 player 存在、`cardIds` 无重复、且所有指定卡当前都在该玩家休息室。
- 只洗切 `cardIds` 这组卡，再追加到主卡组底；不洗整个主卡组。
- `cardIds=[]` 是 no-op，返回空 `movedCardIds`。
- 真实非空移动只写一条 grouped `ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK`，destination 为 `SHUFFLED_BOTTOM`，`movedCardIds` 保存实际洗切顺序。
- 生产 workflow 必须调用 `shuffleWaitingRoomCardsToDeckBottomAndEnqueueTriggers`，不得只调用 raw helper 后遗漏触发分发。
- 不扫描成员/LIVE 等 selector；`miraCraMemberCount`、合计移动数量、奖励、回收、activeEffect、pending continue 与 action payload 都由 caller 负责。
- 不作为万能 `moveAnyZoneToAnyZone`；休息室登场与 grouped recovery 由各自 workflow 独立承载，不并入此 helper。手牌公开确认已有 `active-effect.ts` 的 reveal-from-hand 胶水 helper，但它不移动区域。

### `moveWaitingRoomCardsToDeckBottomForPlayer`

| parameter               | meaning                                |
| ----------------------- | -------------------------------------- |
| `game`                  | 当前 `GameState`。                     |
| `playerId`              | 休息室与主卡组所属玩家。               |
| `selectedCardIds`       | 已选择并按此顺序放到卡组底的卡牌实例。 |
| `candidateCardIds`      | 必传候选集合；用于防止选择越界。       |
| `minCount` / `maxCount` | 允许选择数量范围。                     |
| `cause`                 | 必传 `CardEffectCause`。               |

Return:

- `gameState`
- `movedCardIds`
- `selectedCardIds`
- `remainingCandidateIds`
- `waitingRoomCardsMovedToMainDeckEvent`（仅真实非空移动）

Current boundary:

- source/destination 固定为 `WAITING_ROOM -> MAIN_DECK_BOTTOM`。
- 按 `selectedCardIds` 的顺序追加到主卡组底；`mainDeck.cardIds[0]` 仍是卡组顶。
- `selectedCardIds=[]` 是 no-op，返回原 `gameState`。
- 真实非空移动只写一条 grouped `ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK`，destination 为 `BOTTOM`；生产 workflow 必须调用 `moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers`。
- 不洗切、不扫描成员/LIVE 等 selector；候选筛选、activeEffect、pending continue 与 action payload 都由 caller 负责。
- 不替代 `shuffleWaitingRoomCardsToDeckBottomForPlayer`；需要“洗切后置底”的卡效继续使用 shuffle helper。
- 不作为万能 `moveAnyZoneToAnyZone`。
- `PL!S-bp2-008` 费用 17「小原鞠莉」以真实公开 0–1 选择传入自己的休息室 LIVE 候选；workflow 负责候选扫描、窗口、stale 与 pending continuation，helper 不扩大职责。

### `moveHandCardToDeckTopForPlayer`

| parameter          | meaning                           |
| ------------------ | --------------------------------- |
| `game`             | 当前 `GameState`。                |
| `playerId`         | 手牌与主卡组所属玩家。            |
| `selectedCardId`   | 已选择放到卡组顶的 1 张手牌实例。 |
| `candidateCardIds` | 必传候选集合；用于防止选择越界。  |

Return:

- `gameState`
- `movedCardId`
- `remainingCandidateIds`

Current boundary:

- source/destination 固定为 `HAND -> MAIN_DECK_TOP`。
- 只覆盖 1 张当前手牌放到卡组顶；`mainDeck.cardIds[0]` 仍是卡组顶。
- 不洗切、不扫描 selector、不创建 activeEffect、不写 action、不推进 pending。
- 目前真实样本是 `PL!N-bp4-009` 抽 2 后强制选择 1 张当前手牌回顶；多张排序使用 `moveHandCardsToDeckTopForPlayer`，可选回顶、公开手牌或其他来源区仍需另审。

### `moveHandCardToDeckBottomForPlayer`

| parameter          | meaning                           |
| ------------------ | --------------------------------- |
| `game`             | 当前 `GameState`。                |
| `playerId`         | 手牌与主卡组所属玩家。            |
| `selectedCardId`   | 已选择放到卡组底的 1 张手牌实例。 |
| `candidateCardIds` | 必传候选集合；用于防止选择越界。  |

Return:

- `gameState`
- `movedCardId`
- `remainingCandidateIds`

Current boundary:

- source/destination 固定为 `HAND -> MAIN_DECK_BOTTOM`。
- 只覆盖 1 张当前手牌放到卡组底，按主卡组 `cardIds` 末尾追加。
- 候选外、非法或已离开手牌的选择返回 `null`，不移动其他卡。
- 不洗切、不扫描 selector、不创建 activeEffect、不写 action、不推进 pending；公开/私有选择、抽牌与后续 workflow 全由 caller 管理。
- 当前真实样本包括 `PL!S-bp2-007` 费用 4「国木田花丸」公开手牌 LIVE 后置底，以及 `workflows/shared/draw-one-place-hand-bottom.ts` 的 `PL!S-bp5-014` / `PL!S-sd1-017` / `PL!S-sd1-018` 抽1后选择1张手牌置底。多张、回顶或其他来源区仍需另审。

### `moveHandCardsToDeckTopForPlayer`

| parameter          | meaning                                |
| ------------------ | -------------------------------------- |
| `game`             | 当前 `GameState`。                     |
| `playerId`         | 手牌与主卡组所属玩家。                 |
| `selectedCardIds`  | 已选择并按此顺序放到卡组顶的手牌实例。 |
| `candidateCardIds` | 必传候选集合；用于防止选择越界。       |
| `exactCount`       | 必须精确选择并移动的张数。             |

Return:

- `gameState`
- `movedCardIds`
- `selectedCardIds`
- `remainingCandidateIds`

Current boundary:

- source/destination 固定为 `HAND -> MAIN_DECK_TOP`。
- 按 `selectedCardIds` 的顺序放到主卡组顶；`mainDeck.cardIds[0]` 仍是卡组顶。
- 当前只覆盖 exact count，多选顺序由 workflow/activeEffect 负责。
- 不洗切、不扫描 selector、不创建 activeEffect、不写 action、不推进 pending。
- 目前真实样本是 `PL!N-bp4-031` 抽 3 后强制选择 3 张当前手牌回顶。

## Member-Below Stack Helper Parameters

### `stackMemberCardBelowStageMember`

| parameter     | meaning                        |
| ------------- | ------------------------------ |
| `game`        | 当前 `GameState`。             |
| `playerId`    | 来源区与舞台 host 所属玩家。   |
| `sourceZone`  | `HAND` 或 `WAITING_ROOM`。     |
| `movedCardId` | 要移动到下方的成员卡实例。     |
| `hostCardId`  | 目标槽位上的顶层 MEMBER 实例。 |
| `targetSlot`  | 目标 host 当前所在成员槽位。   |

Return:

- `gameState`
- `movedCardId`
- `sourceZone`
- `hostCardId`
- `targetSlot`

Current boundary:

- 只覆盖 1 张成员卡从手牌或休息室放到己方舞台顶层成员下方。
- 显式校验 player 存在、host 在该玩家舞台目标槽且是 MEMBER、hostCardId 与 targetSlot 匹配、移动卡属于该玩家且是成员卡、移动卡当前在声明来源区、且不能重复移动已在 `memberBelow` 中的卡。
- 旧的 host 卡号白名单与手动压人命令已退役；只有已实现 workflow 能调用这个原子 helper。
- 先从来源区移除，再调用 domain 的 `addMemberBelowMember` 写入 `memberBelow`。
- 不调用 zone-operations 的普通移动/登场回退，不 enqueue trigger；这不是进入休息室或登场事件。
- 不扫描候选、不公开手牌、不写 action history、不处理 LIVE 修正或 pending continue；这些都由 workflow 负责。

`BLADE` live modifier 必须显式声明 `target: 'SOURCE_MEMBER' | 'TARGET_MEMBER' | 'PLAYER'`，读取端不再根据 `sourceCardId` 所属卡牌类型推断受益对象。workflow 必须在 `addBladeLiveModifierForSourceMember`、`addBladeLiveModifierForTargetMember`、`addBladeLiveModifiersForTargetMembers` 和 `addBladeLiveModifierForPlayer` 中显式选择 scope，并始终用 `sourceCardId` 保留真实能力来源。批量 TARGET helper 只处理 caller 已按结算时场面快照出的唯一目标，不把“全舞台”解释或扫描藏进 runtime；任一目标非法时整体拒绝。TARGET API 不根据 source/target ID 相等而折叠 scope；PLAYER API 不根据 source 卡型或区域推断生命周期；旧 equality-inference generic API 已移除。成员级 modifier 只通过对应的活跃受益成员计入声援，`PLAYER` 则直接计入玩家合计一次；成员离场只清理以该成员为 `SOURCE_MEMBER` 或 `TARGET_MEMBER` 受益者的 modifier，不会因 `PLAYER` modifier 的来源恰好是成员而误清理。真实样本包括 `PL!SP-bp7-001-P` 的下方来源、`PL!S-bp7-005-SEC` 的多 host 常时、`PL!N-PR-022` / `LL-PR-004` 的跨玩家舞台快照，以及 `live-start-target-member-gain-blade.ts` family 中真实来源与选中成员不同的 `PL!S-bp2-025-L` / `PL!-bp4-014` / `PL!-bp4-024`。该 family 在写入前仍由 workflow 重验来源，写入后的 LIVE 来源离区不撤销目标 modifier。`MEMBER_ORIGINAL_HEART_REPLACEMENT.hearts` 只支持完整印刷 `HeartIcon[]` 快照，普通 Heart bonus 仍在替换后追加，来源成员实例离场/重登时清理；真实样本为 `PL!N-bp7-003-SEC`。

### `playMemberBelowCardToEmptySlot`

| parameter    | meaning                               |
| ------------ | ------------------------------------- |
| `game`       | 当前 `GameState`。                    |
| `playerId`   | 舞台 host 所属玩家。                  |
| `hostCardId` | 来源槽位上的顶层舞台成员实例。        |
| `fromSlot`   | host 当前所在成员槽位。               |
| `cardId`     | 要从 `memberBelow` 登场的成员卡实例。 |
| `toSlot`     | 空成员槽位。                          |

Return:

- `gameState`
- `playedMember.cardId`
- `playedMember.fromSlot`
- `playedMember.toSlot`
- `playedMember.hostCardId`

Current boundary:

- 只覆盖 1 张成员卡从指定顶层舞台 host 的下方登场到自己的空成员区。
- 显式校验 player 存在、host 仍在 `fromSlot`、目标槽为空、移动卡属于该玩家且是成员卡、移动卡当前确实在 `fromSlot` 的 `memberBelow` 中。
- 从 `memberBelow` 移除后放入目标槽，并写入 `FACE_UP / ACTIVE` 成员状态。
- 记录 `fromZone: MEMBER_SLOT` 的 `ON_ENTER_STAGE` 事件；workflow 需要用本次新事件显式调用 `enqueueTriggeredCardEffects`，helper 自身不 enqueue trigger。
- 不处理普通登场费用、换手、锁槽、候选扫描、activeEffect、action history 或 pending continue。

## Live Modifier Action Parameters

### Explicit BLADE writers

| parameter      | meaning                                        |
| -------------- | ---------------------------------------------- |
| `game`         | 当前 `GameState`。                             |
| `playerId`     | 获得 BLADE modifier 的玩家。                   |
| `sourceCardId` | 真实能力来源卡实例。                         |
| `abilityId`    | 写入 modifier 的能力来源。                     |
| `amount`       | 正整数 BLADE 数量；`amount <= 0` 返回 `null`。 |

`addBladeLiveModifierForTargetMember` 另传 `targetMemberCardId`，它可以与 `sourceCardId` 相同，但仍写入 `target: 'TARGET_MEMBER'`。`addBladeLiveModifierForPlayer` 不传 member target，`sourceCardId` 只用于来源追踪。

Return:

- `gameState`
- `modifier`
- `bladeBonus`

Current boundary:

- source writer 验证 source 是己方顶层舞台成员；target writer 验证显式 target 是己方顶层舞台成员；player writer 只验证 player 与 amount。
- 不生成 action history；`bladeBonus`、费用、弃置、公开、洗回等 payload 仍由 caller 保持原样。
- 不根据 source 卡型、所在区域或 source/target ID 是否相等推测 scope。
- 不处理 `PL!-sd1-001`、`PL!N-pb1-004` 这类 continuous / dynamic projection。

### Explicit HEART writers

`domain/rules/live-modifiers.ts` 提供三组互斥的 factory / writer：`create/addHeartLiveModifierForSourceMember`、`create/addHeartLiveModifierForTargetMember`、`create/addHeartLiveModifierForPlayer`。SOURCE writer 要求来源是该玩家当前顶层舞台成员；TARGET writer 要求受益者是指定玩家当前顶层舞台成员，但真实来源可以是 LIVE、其他玩家卡或与 target 同一实例；PLAYER writer 不绑定成员。三者都要求非空 HEART 向量、合法 `HeartColor` 与正安全整数数量。

scope 只由卡文决定，不由来源卡型、区域、ID 相等或字段缺失推断。“选择／指定成员”即使选到来源自身仍使用 TARGET writer，同时保留真实 `sourceCardId` 与 `targetMemberCardId`。通用 `addLiveModifier` / `replaceLiveModifier` 仍是持久化底座，但生产 workflow 和 continuous registry 必须先通过上述显式 factory / writer 构造 HEART 形状。

## Reveal-From-Hand ActiveEffect Helper

`revealHandCardForActiveEffect` lives in `src/application/card-effects/runtime/active-effect.ts`, not `runtime/actions.ts`, because it advances activeEffect state and writes the reveal action rather than performing a zone move.

Current boundary:

- validates that the current activeEffect exists, the selected card is in `effect.selectableCardIds`, the player exists, and the selected card is still in that player's hand;
- switches to the caller-provided next `stepId` / `stepText`;
- appends the selected hand card to `activeEffect.revealedCardIds`, preserving existing revealed ids and de-duplicating;
- inserts the shared Public Reveal Dwell for the newly selected batch; no-input next steps resolve automatically after the dwell, while a real follow-up interaction opts into restore-next mode;
- applies caller-provided next-step candidate/visibility/label/metadata patches;
- writes `RESOLVE_ABILITY` with the caller-provided action step and payload fields.

It deliberately does not pay costs, move cards, recover cards, swap success-zone cards, compute same-name targets, continue pending, or decide skip semantics. The dwell exposes only the newly public card ids; earlier cumulative `revealedCardIds` remain workflow context and are not replayed as the new display batch. Current real users include HS_BP5_001 activated reveal-hand-LIVE recovery and MAKI on-enter hand-LIVE reveal before success-zone swap.

## Public Reveal Dwell

`runtime/public-reveal-dwell.ts` owns the generic pause between “a hidden card has become public” and subsequent automatic or interactive processing.

- `withPublicRevealDwell(effect, revealedCardIds?)` is for a current step whose original handler needs no player input. It projects only the explicit public batch, then restores the original effect and invokes its handler with empty input after the authoritative deadline.
- `createPublicRevealDwellBeforeNextEffect(game, nextEffect, { revealedCardIds })` is for a real next interaction. It displays the public batch first and restores `nextEffect` after the deadline without selecting or resolving anything for the player.
- The session assigns `min(3500ms, 2000ms + (count - 1) * 300ms)`, plus a unique generation. Either participant may submit the exact deadline/generation after expiry; early, stale, duplicate or selection-bearing commands are rejected.
- Valid reconnect snapshots preserve their original deadline. Automatic continuation merges into the triggering undo entry. No server process timer is retained, no 0-card dwell is created, and existing public-card/public-choice auto-confirmation states must not be wrapped again.
- `inspectionCardIds` and continuation metadata remain authoritative server context. Only explicit `revealedCardIds` are projected as public fronts.

## Optional Discard-Hand ActiveEffect Shell

`createOptionalDiscardHandToWaitingRoomActiveEffect` also lives in `src/application/card-effects/runtime/active-effect.ts`. It is documented here because it exposes the standard discard-hand cost metadata, but it is not a runtime action helper: it only builds an `ActiveEffectState`.

Current boundary:

- constructs an optional exact fixed-count discard-hand window with `selectableCardVisibility: AWAITING_PLAYER_ONLY`; `discardCount` defaults to 1;
- keeps the default single-card step text and labels, and for counts above 1 projects exact multi-select bounds while callers may supply the corresponding step copy; all counts keep the `不发动` skip label, `canSkipSelection: true`, `effectCosts`, and `handToWaitingRoomCost`;
- merges caller metadata with `orderedResolution` and the fixed discard cost metadata;
- preserves caller-provided `selectableCardIds` exactly.

It deliberately does not remove pending abilities, write action history, discard cards, pay costs, continue pending, decide skip semantics, or model category-grouped / hand-adjust discard flows. Current users are KEKE, HS_BP6_004, HS_BP5_003 live-start Heart, live-start discard-gain-Heart, and discard-look-top selection windows.

## Wait Selected Stage Members + State-Change Triggers

`waitStageMembersAndEnqueueTriggers` lives in `src/application/card-effects/runtime/wait-stage-members.ts`. It is a narrow atomic helper for an already validated list of the same player's main-stage members:

- rechecks that each requested instance is still a top-level main-stage member;
- applies `ACTIVE -> WAITING` through `setMemberOrientation` with the caller's exact card-effect cause;
- completes every legal state change in the call before enqueueing the standard `ON_MEMBER_STATE_CHANGED` events once as one batch; the event log still keeps one event per actually changed member;
- returns the updated state, actually changed member IDs, and event IDs.

It deliberately does not choose candidates, filter groups, decide optional/mandatory semantics, create an activeEffect, calculate rewards, or continue pending. `PL!-pb1-008` uses the returned actual count to draw; `PL!N-sd2-027` uses it to update the source LIVE's SCORE. This is an atomic state/event boundary, not a configurable “wait members then run reward callback” workflow.

## Event wrapper follow-up candidates

当前已完成 hand-discard wrapper、成员区移动 wrapper、当前卡效 workflow 中的成员方向变化事件胶水，以及来源成员自送离场 wrapper。以下只是剩余后续候选，不代表已落地，也不表示 trigger matcher 或 steps DSL 已完成。

### 成员横置/竖置 + `ON_MEMBER_STATE_CHANGED` 触发

- 现状模式：当前卡效 workflow 中的 `setMemberOrientation` / `setMembersOrientation` / `resolveStageMemberOrientationTargetSelection` 方向变化，已复用 `enqueueMemberStateChangedTriggersFromOrientationResult` 显式入队。
- 公共状态边界：当目标玩家存在本回合成员卡效活跃限制时，仅阻止 `CARD_EFFECT` 造成的成员 `WAITING -> ACTIVE`；活跃阶段 `RULE_ACTION` 不受影响，能量状态变化不在此范围。单成员结果用 `changed` / `blockedByEffectActivationProhibition`，批量结果用实际 `updatedMemberCardIds` / `blockedMemberCardIds` 表达真实变化，禁止把请求状态伪报为已发生状态。
- 建议候选：若后续普通操作、费用支付或更多底层路径也需要统一收束，再审查是否需要 `setMemberOrientationAndEnqueueTriggers` / `setMembersOrientationAndEnqueueTriggers`，或更窄命名。
- 优先级：中。
- 原因：普通操作、费用支付、卡效 cause 边界较复杂，要先盘点调用点。
- 边界：不能吞掉 cause 语义，不能改变费用支付时机。

### 自送/离场费用 + `ON_LEAVE_STAGE` 触发

- 现状模式：当前来源成员自送到休息室费用已复用 `paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers` 显式入队。
- 已落地 helper：`paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers`。
- 优先级：高。
- 原因：离场触发漏掉很隐蔽；`PL!HS-bp1-002` 自送后从休息室登场已补上自送离场入队。
- 边界：只适用于来源成员自送到休息室，不泛化成任意 zone move。

### 卡效特殊登场 + `ON_ENTER_STAGE` 触发

- 现状模式一：workflow 从休息室/手牌通过卡效无费用登场时，复用窄 `playMemberFromZoneToEmptySlot` 或既有卡效登场 helper，并正常 enqueue `ON_ENTER_STAGE`。
- 现状模式二：需要在“打出此卡时”改变本次支付流程的真实样本，使用服务端权威 `BEGIN/CONFIRM_SPECIAL_MEMBER_PLAY` 有限模式。`application/special-member-play-procedures.ts` 的显式 procedure registry 当前只登记 `LL-bp7-001` 费用15的指定三名支付→本次基准费用10，以及 `PL!N-bp7-011` 费用13「米娅·泰勒」的休息室全部成员洗切置底→本次基准费用11；每个 procedure 分别拥有 begin/confirm 校验、pending 建立、pending 玩家文案配置和原子结算，`GameSession` / projector 只做通用 dispatch、对象 ID 映射、公共事件与 sealed audit 包装。
- 入口：`application/member-play-options.ts` 同时把上述 `CARD_DEFINED` procedure 与 `DOUBLE_RELAY` 投影成每个手牌对象的 `memberPlayOptionsByObjectId`。客户端不识别基础编号，也不按具体 mode 拼接标题、说明或槽位。
- 自由模式：卡定义 procedure 仍执行卡面规定的程序成本/动作，但不检查或支付登场能量，三个成员区均可作为目标且不受 `movedToStageThisTurn` 限制；占用区域继续沿用普通 FREE 登场的单换手/重复成员规则。RULES 模式的费用计划、换手合法性和同回合槽位限制保持不变。
- 原子性：确认时必须重验来源、目标槽、候选/区域事实和费用常量；先在不可变状态上完成卡牌移动与费用计划，任一步失败都返回原状态，成功后才支付并走标准登场/单换手路径。
- 只读确认查询：`querySpecialMemberPlayConfirmation` 复用 procedure 当前候选、来源/目标/费用常量与 `costCalculator` 费用计划，返回确认是否可用、稳定 witness 与费用预览；不能完成确认时调用方仍可提交 cancel。查询不试跑 resolve，也不执行程序成本。
- 事件：所有休息室→主卡组移动必须经过中央事件 wrapper，登场仍经过标准 `ON_ENTER_STAGE` 管线；前端只消费服务端投影的来源、模式和合法槽位。
- 边界：这是两个显式模式，不是任意替代费用、任意区域支付或特殊登场 DSL。不得让客户端自行推导费用、候选、换手合法性或移动结果。

## Planned Helpers

### Inspect Top Choose

Target helper family:

- `createInspectTopChooseStep`
- `resolveInspectTopChooseStep`

Important axes:

- `playerId`
- `viewingPlayerId`
- `topCount`
- `chooseMin` / `chooseMax` / `exactCount`
- selector
- selected destination
- unselected destination
- selected reveal behavior
- order strategy
- no-target behavior

This family should not be named only `RevealTop` because many effects are private inspection and only reveal selected cards.

### Zone Move

Target helper family:

- public-zone selection and move helpers beyond `WAITING_ROOM -> HAND`
- grouped selection helpers
- destination-specific helpers for deck top / bottom / success zone / resolution zone

## 卡组底直接进入休息室

- `moveBottomDeckCardsToWaitingRoom` 是纯区域移动小原语：`mainDeck.cardIds[0]` 为卡组顶，数组末尾为卡组底，返回顺序为实际从最底开始取出的 cardId 顺序。它不经过 inspection，不创建事件或 pending。
- `moveBottomDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers` 与现有顶牌 WithRefresh helper 保持同一刷新语义：主卡组耗尽时按现有规则更新卡组并继续从新卡组底处理；`movedCardIds` 只记录实际发生的 `MAIN_DECK -> WAITING_ROOM` 移动，单纯被 refresh 洗回的卡不会自动计入。
- 同一能力实际移动的卡作为一个分组 `ON_ENTER_WAITING_ROOM` 事件入队一次；0张不发事件。本边界不覆盖检视后入休息室、从卡组底声援、休息室自由选卡或任意 zone-move DSL。
- 区域/事件 helper 本身不创建玩家展示。若 caller 还要按实际底牌身份给予 Heart、修改必要 Heart、抽牌或加分等后续奖励，应仿照 direct top-mill workflow：移动后用 Public Reveal Dwell 向双方展示本次 `movedCardIds`，展示结束后才写 modifier/奖励并回到统一 continuation。`PL!S-bp7-006-P` 费用2「津岛善子」、`PL!S-bp7-015-N` 费用5「津岛善子」、`PL!S-bp7-020-SECL` 分数3「快乐派对火车」与 `PL!S-bp7-021-L` 分数5「我们的旅程永不落幕」是当前真实样本。

## 卡组顶进入休息室：费用与多 owner 同一效果

- 冒号前“从卡组顶 N 张放置入休息室”的费用使用 `moveExactTopDeckCardsToWaitingRoomAsCostAndEnqueueTriggers`。它与 WithRefresh direct mill 的边界是：起动时当前主卡组不足 N 张即不能支付，不能先 refresh 或在移动途中 refresh 来凑足；支付完成后因主卡组为空触发的规则刷新仍必须执行，但条件继续读取本次 grouped event 保存的 moved IDs。
- 同一效果要求多个玩家分别执行 refresh-aware direct mill 时，使用 `moveTopDeckCardsForPlayersWithRefreshAndEnqueueTriggers`。每位玩家的 owner、移动结果和进入休息室事件保持独立；主动玩家先处理规则刷新。全部移动事实完成后才统一 enqueue，新产生的 waiting-room pending 不得插入两位玩家的移动之间。
- 两个 wrapper 都不创建卡牌选择窗口、不做卡文命中查询、不解析最终休息室内容，也不直接调用某个固定后续 pending。它们是已落地卡文所需的窄 runtime 边界，不是 direct-mill steps DSL。

## 声援卡组边缘与底部单张抽取

- `domain/rules/cheer-direction.ts` 的 `getCheerDeckEdgeForPlayer` 只读当前 GameState；默认 TOP，当前唯一真实 BOTTOM 样本的公开版本是 `PL!S-bp7-022-SECL` 分数8「想在水族馆恋爱」，规则按基础编号匹配 owner 正确且仍在自己 LIVE 区的来源实例。它不写 modifier、pending 或事件，也不是 continuous DSL。
- `drawFromBottom` 是与 `drawFromTop` 对称的 zone 小原语：移除数组末尾一张，不反转剩余顺序，不创建事件/action/刷新。
- `revealCheerCardsFromMainDeck` 在每次公开前先处理即时 refresh，再重读当前边缘，取牌后再处理 refresh。普通、手动、自动、追加与重做声援共用该入口；每批在 `CheerEvent` 写入后立即且仅一次结算 DRAW BLADE HEART，之后才进入适用的 `ON_CHEER` 检查时点或继续当前卡效。`CheerEvent` 与原有唯一一条 `CHEER` action 记录实际公开顺序及 `deckEdge`；存在 DRAW 时，`CHEER` action 还记录 `cheerEventId`、`bladeHeartDrawCount` 与 `bladeHeartDrawnCardIds`，但不记录剩余卡组顺序。旧事件缺少 `deckEdge` 时按 TOP 读取。
- 该边界没有与 `moveBottomDeckCardsToWaitingRoom*` 合并：后者仍只负责 `MAIN_DECK -> WAITING_ROOM`，声援的目的地是 resolution zone。

## Migration Requirement

### Inspect Top Cards Until Match

`effects/look-top.ts` 的 `inspectTopCardsUntilMatch` 是“逐张检视卡组顶直到 predicate 首次命中”的窄原子 helper。它每次调用现有 refresh-aware `inspectTopCards(..., { count: 1, reveal: true })`，按顺序返回 `inspectedCardIds` 与 `hitCardId`；predicate 接收每次检视后的实时 `GameState`，因此可读取 refresh 或检视造成的当前状态。已检视牌保留在 inspectionZone/revealed，不会参与后续刷新；主卡组与可刷新休息室均耗尽时以 `hitCardId: null` 终止。

当前真实使用者是费用 13「高坂穂乃果」`PL!-pb1-001` 与费用 9「ミア・テイラー」`PL!N-bp1-011`。helper 不选择命中类型、不移动命中牌或余牌、不创建 activeEffect、不支付费用、不写事件或推进 pending，也不是任意 reveal DSL；这些职责仍属于各自单卡 workflow 与 inspection-to-waiting wrapper。

When a runtime helper becomes available:

- New workflow must use it instead of hand-writing the same action.
- Existing runner call sites should be migrated in batches.
- Remaining hand-written call sites must be listed as either non-card-effect rule paths or explicit exceptions.
- If a helper only moves lines without reducing runner size, continue to the next layer: workflow module extraction and step handler registry.

# Delegatable definition query

`getWaitingRoomDelegatableOnEnterDefinitions(cardCode)` 是休息室虚拟登场的窄查询：只返回显式 `delegatedOnEnterFromWaitingRoomPolicy.decision === 'ALLOW'` 的 implemented + queued + ON_ENTER + PLAYED_MEMBER definition。policy 是带窄 `reason` 的 typed ALLOW/DENY 决策；未登记或 DENY 均不会成为候选。它不解析文本或 notes，也不改变既有 COMPASS / N-PR-026 的 `getDelegatableQueuedAbilityDefinitions` 语义。

# Hand reveal activeEffect helper

`runtime/active-effect.ts` 的 `revealHandCardsForActiveEffect` 是“同一效果窗口一次公开多张仍在手牌中的卡”的窄原子 helper。它校验选择集合无重复、全部属于原候选且仍在指定玩家手牌中；随后一次写入累计 `revealedCardIds`、一次记录可审计的 `RESOLVE_ABILITY` action，并为本次新公开集合建立一个 shared Public Reveal Dwell。它会清理上一阶段的卡牌选择数量、模式、按钮及其他选择字段；不移动手牌、不创建多个逐张公开窗口，也不判断卡号、LIVE 条件或执行奖励。

原 `revealHandCardForActiveEffect` 保持兼容，并委托复数 core 处理单张集合。dwell 只展示本次传入的 `selectedCardIds`，不会因 activeEffect 保留历史公开记录而重复展示旧牌。`PL!-PR-014` 是复数入口的首个真实样本；其匿名候选与 stale token 版本由 blind selection utility / projector / GameSession 边界负责，公开集合的规则快照与后续抽牌仍由单卡 workflow 负责。

## Special-member-play transaction

`LL-bp7-001`（当前公开版本 `R+`）的确认复用 `discardHandCardsToWaitingRoomAndEnqueueTriggers`，但在弃手、能量支付、普通换手和登场整个动作完成后，才通过 `enqueueEnterWaitingRoomTriggersFromDiscardResult` 将 grouped `HAND -> WAITING_ROOM` 事件动态入池，避免新触发插入支付中间。这是基础编号覆盖下的原子组合边界，不是任意 steps runtime DSL。

## 待机能量放置并跳过下次活跃（2026-07-23）

`runtime/waiting-energy-placement.ts#placeWaitingEnergyWithActivePhaseSkip` 是“从自己的能量卡组实际放置若干能量到能量区、以 WAITING 入场，并让这些实际放置的能量跳过下一个自己的活跃阶段”的窄原子组合。它复用 `placeEnergyFromDeckToZoneByCardEffect`，只对返回的 `placedEnergyCardIds` 写 marker，并把该次返回的精确 `EnergyPlacedByCardEffectEvent` 通过 `energyPlacedByCardEffectEvents: [event]` 入队一次。

目标玩家与 marker 的 `sourceCardId` / `abilityId` 全部直接取必填 `CARD_EFFECT` cause，不维护第二套来源身份；event 保留目标玩家、实际卡 ID、WAITING orientation 与完整 cause。能量卡组不足时只处理实际数量，0张时不产生 marker 或 placement event。真实调用者为 `PL!SP-bp7-005-SEC` 费用9「叶月恋」、`PL!SP-bp7-007-SEC` 费用17「米女芽衣」与 `PL!SP-bp7-027-L` 分数5「What a Wonderful Dream!!」。

helper 不校验效果来源区域、不创建/消费 pending、不决定确认窗口，也不替代普通 `place-waiting-energy.ts` workflow；这些职责仍由调用卡的 workflow 持有。它也不是任意能量放置 DSL。

## LIVE 卡从 LIVE 区回手（2026-07-23）

`runtime/actions.ts#returnLiveZoneCardToHandForPlayer` 是单张己方结构化 LIVE 卡的窄 `LIVE_ZONE -> HAND` 原子移动。它校验 owner、卡型与当前区域，移除 LIVE 区 stateful card state、加入手牌，并记录精确卡 ID 与来源区域的 `ON_ENTER_HAND` 事件；失败时不改变状态。

helper 不决定来源卡号、pending 生命周期或后续弃牌，也不直接扫描/入队 ON_ENTER_HAND definition。真实调用者目前仅为 `PL!N-bp7-030-L` 分数0「Cheer Mode」：单卡 workflow 在回手后从实时手牌强制弃1张，再由统一 continuation 扫描未处理事件。若刚回手的来源又被弃置，结算结束时它已不在 HAND，现有来源区域规则不会为其创建伪 ON_ENTER_HAND pending；本批没有扩大这一全局触发语义。

## 成员下方全部能量放置入能量区（2026-07-27）

`effects/energy-below.ts#moveAllEnergyBelowMemberToEnergyZoneByCardEffect` 是“一名当前己方顶层成员下方的完整能量堆 → 己方能量区”的窄原子动作。调用者必须提供选择窗口建立时锁定的完整 `expectedEnergyCardIds`；helper 逐项重验成员实例、槽位、顺序、owner 与 ENERGY 类型，任一事实变化就整体拒绝，不移动子集。

成功时所有能量以 `WAITING / FACE_UP` 加入能量区，清空该槽位的 energyBelow，并用实际完整 IDs 与必填 `CARD_EFFECT` cause 发出、转发恰好一个 `ON_ENERGY_PLACED_BY_CARD_EFFECT` event。helper 不选择目标、不检查来源卡号或奖励门槛、不创建/消费 pending，也不写 SCORE；这些职责由当前唯一调用者 `PL!N-bp7-029-L` 分数7「Burn!!」的单卡 workflow 持有。
