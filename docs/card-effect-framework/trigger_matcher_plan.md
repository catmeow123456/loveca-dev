# Trigger matcher T-0 / T-1 plan

> 文档类型：历史/计划文档
> 适用范围：卡效 trigger matcher 的 T-0/T-1 字段边界、非目标与后续迁移判断
> 当前状态：T-0/T-1 已落地为纯 matcher；尚未接入 runner，后续迁移需单独审查

本文档记录 Trigger T-0 盘点与 T-1 第一版纯 matcher 的字段边界。当前目标不是实现新卡效，也不是接入 runner，而是确认“事件是否匹配能力”的最小模型不会只适配当前已实现样本。

## 1. 当前 runner 中承担 trigger matching 的分支

当前 `enqueueTriggeredCardEffects` 仍是触发入口总分发。它按传入的 `TriggerCondition[]` 分支扫描事件或 fallback 来源，并在各分支内部完成能力定义过滤、事件事实绑定和 pending ability 入队。

- `ON_ENTER_STAGE`
  - `enqueueOnEnterCardEffects`：处理自身登场类能力，来源为刚登场的成员，category 为 `ON_ENTER`，sourceZone 为 `PLAYED_MEMBER`。
  - `enqueueOnEnterStageAutoCardEffects`：处理舞台成员监听“成员登场”的 AUTO，来源为舞台成员，事件主体为刚登场成员。
- `ON_LEAVE_STAGE`
  - `enqueueOnLeaveStageCardEffects`：消费 `LeaveStageEvent` 或旧 action fallback，来源为离场成员，必要时读取 `replacingCardId` 这类事件关系。
- `ON_LIVE_START`
  - `enqueueLiveStartCardEffects`：扫描表演玩家舞台成员与本次 LIVE 卡，绑定 `LiveStartEvent.eventId`。
- `ON_LIVE_SUCCESS`
  - `enqueueLiveSuccessCardEffects`：扫描成功玩家舞台成员与成功 LIVE 卡，绑定 `LiveSuccessEvent.eventId` 或 fallback synthetic id。
- `ON_MEMBER_STATE_CHANGED`
  - `enqueueMemberStateChangedCardEffects`：消费 `MemberStateChangedEvent`，当前仍有 ability-specific guard，例如自身 `ACTIVE -> WAITING` 或自己的卡效使对方成员 `ACTIVE -> WAITING`。
- `ON_CHEER`
  - `enqueueCheerCardEffects`：消费最新 `CheerEvent`，扫描表演玩家 LIVE 区来源；`additional=true` 的追加声援不二次触发。
- `ON_MEMBER_SLOT_MOVED`
  - `enqueueMemberSlotMovedCardEffects`：消费 `MemberSlotMovedEvent`，来源为移动后的成员，绑定移动事件 id。

这些分支现在实际承担了 trigger matching、来源枚举、eventId 绑定、每回合次数检查、重复 pending 防护和 pending 入队。T-1 只抽出其中“事件事实是否匹配 ability/source”的纯判断，不迁移后四件事。

## 2. 现有代表样本

- `PL!SP-bp4-011` 费用 7「鬼冢冬毬」是第一版 matcher 的核心 proving sample。
  - 登场段登记为同一 abilityId，category `ON_ENTER`，sourceZone `PLAYED_MEMBER`，triggerCondition `ON_ENTER_STAGE`。
  - 成员区移动/交换段登记为同一 abilityId，category `AUTO`，sourceZone `STAGE_MEMBER`，triggerCondition `ON_MEMBER_SLOT_MOVED`。
  - 两段 effect text 与 baseCardCodes 一致，但 triggerCondition、category、sourceZone 不同。
  - 当前 runner 在登场段消费 `EnterStageEvent`，在移动段消费 `MemberSlotMovedEvent`；登场不重复视为移动。
  - 无合法 BLADE <= 3 目标时仍应入队，后续由 no target / skip 结算处理，matcher 不应提前吞掉。
  - T-1 shadow test 已覆盖 `ON_ENTER_STAGE` / `ON_MEMBER_SLOT_MOVED` 的纯 matcher 输入、同基础编号 `PL!SP-bp4-011-P` / `PL!SP-bp4-011-SEC` 匹配，以及 source card、controller、sourceSlot、sourceZone、triggerCondition 误配不命中。
- `PL!SP-bp4-008` 费用 13「若菜四季」证明 `requiredSourceSlots` 是 trigger matching 字段：左侧登场、右侧登场、LIVE 开始站位变换分别由定义上的 source slot 过滤。
- `PL!HS-bp6-027` 分数 5「月夜見海月」证明 `ON_CHEER` 需要事件主体玩家、sourceZone `LIVE_CARD` 与事件 id；追加声援 `additional=true` 属于事件分支 guard。
- `PL!N-bp4-018` 费用 7「近江彼方」与 `PL!-pb1-015` 费用 7「西木野真姬」证明状态变化触发不仅要看 `ON_MEMBER_STATE_CHANGED`，还要能表达事件主体、controller 关系、`ACTIVE -> WAITING` 方向与 cause 关系。第一版 matcher 只放入通用字段，phase、cost、目标与 selector 仍留在 runner/resolver。
- `PL!HS-bp6-001` 费用 4「日野下花帆」与 `PL!HS-cl1-009` 分数 1「水彩世界」证明 `ON_LIVE_SUCCESS` 同时存在舞台成员来源与 LIVE 卡来源。
- `PL!HS-bp2-012` 费用 5「乙宗 梢」、`PL!HS-bp6-017` 费用 11「日野下花帆」与 `PL!HS-sd1-001` 费用 9「日野下花帆」证明离场触发需要 source card、from slot、controller 与可能的 replacing card 关系，但选择、弃手费用、回收移动仍不属于 matcher。

## 3. 未实现 / 未覆盖记录中的触发形态观察

从现有登记册的 remaining inline behavior、condition/query inventory 与已记录 gap 看，未完成部分不是缺少单一 triggerCondition，而是同一触发时机下的后续关系与 workflow 尚未配置化：

- 登场时：大量 `ON_ENTER_STAGE` 能力已经存在，但未覆盖完的形态集中在登场后 look-top、公开手牌、区域交换、分组选择、费用后回收等 workflow。触发匹配只需要确认来源为刚登场成员或舞台监听成员，目标/选择不属于 matcher。
- LIVE 开始时：舞台成员来源和 LIVE 卡来源都存在；未覆盖部分多为数量到修正值、支付选项、Heart 颜色或站位变换 workflow。matcher 需要能表达 sourceZone 与本次 `LiveStartEvent.liveCardIds` / performer 关系。
- LIVE 成功时：已有舞台成员来源与 LIVE 卡来源。未覆盖方向主要是声援公开卡的后续选择、卡组顶/底移动等 resolver 行为，matcher 只需要确认成功玩家、成功 LIVE 列表与 sourceZone。
- 声援时：`ON_CHEER` 已证明 LIVE 卡来源、公开卡列表、totalBlade、additional flag 等事件 payload 会影响分支。第一版 matcher 只负责 `ON_CHEER` 与 controller/sourceZone/source card 的匹配；公开卡筛选与追加声援不属于 matcher。
- 离场时：`ON_LEAVE_STAGE` 已有 proving path，但 replacing card、是否换手、离场目的地等关系会影响特定 ability。第一版 matcher 应支持 event subject、from slot、controller；relay 条件继续留在 runner guard。
- 成员区移动/交换时：`ON_MEMBER_SLOT_MOVED` 需要区分 fromSlot / toSlot，sourceSlot 通常是移动后所在槽位。交换对象 id 是事件 payload，后续是否需要匹配由真实卡驱动。
- 状态或区域变化时：`ON_MEMBER_STATE_CHANGED` 已证明需要 previous/next orientation、controller 同/异、cause player/source 关系。`ON_ENTER_HAND`、`ON_ENTER_WAITING_ROOM` 等 enum 已存在，但尚未有稳定 runner proving path；第一版 matcher 先记录为可由同一字段模型表达，不新增事件消费时机。

结论：第一版 matcher 不需要 steps DSL。它需要的是稳定表达 ability 定义字段、source facts、event facts 与少量方向关系的薄模型。

## 4. 第一版 matcher 必须支持的最小字段

- ability definition facts
  - `triggerCondition`
  - `category`
  - `sourceZone`
  - `queued` / `implemented`
  - `cardCodes` / `baseCardCodes`
  - `requiredSourceSlots`
- source facts
  - source card instance id
  - source card code / base card code
  - source controller
  - source zone
  - source slot
- event facts
  - event id / event ids
  - event triggerCondition / eventType
  - event subject card id, if the event has one
  - event controller / player / performer
  - event card id list, such as liveCardIds or successfulLiveCardIds
  - event fromSlot / toSlot / current slot where relevant
  - state-change direction when the event is `ON_MEMBER_STATE_CHANGED`
- required relation facts
  - source card is the event subject
  - source card is included in the event card list
  - event controller is same as source controller
  - event controller is different from source controller
  - sourceSlot equals event fromSlot / toSlot / current slot
  - member state transition matches from/to orientation

这些字段足够表达当前 proving samples 和未覆盖记录中的触发形态，同时仍保持 matcher 是纯函数。

## 5. 明确不属于 matcher 的内容

以下内容不进入 T-1 matcher：

- 目标选择、目标合法性、no-target 结算。
- 费用、费用支付时机、费用期间产生事件的消费时机。
- 移动、抽卡、等待室处理、公开/检视、回收、站位变换的实际 resolver。
- pending ability 生成、pending 顺序、重复 pending 防护、每回合次数消耗。
- runner 接线、事件扫描窗口、eventLog 消费时机。
- steps 解释器、steps DSL、workflow 配置化。
- 卡效 selector / condition AST。matcher 只看事件事实与 ability/source 字段，不读取 `GameState`。
