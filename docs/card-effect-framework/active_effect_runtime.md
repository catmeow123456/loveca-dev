# Active Effect Runtime

> 文档类型：设计文档
> 适用范围：activeEffect、stepId、metadata、可见性与 step handler registry
> 当前状态：step handler registry 已落地；runner 完整卡效 fallback 已清空，runner 仍保留 pending/trigger 胶水

`activeEffect` 是多步卡效的运行时状态。runner 膨胀的核心原因之一，是每张卡都在 runner 中手写 activeEffect 创建、step 校验、候选可见性和 finish 分发。当前已建立 step handler registry，`confirmActiveEffectStep` 先查 registry；未命中 registry 时不再 fallback 到旧完整卡效分支，而是保持状态不变并返回。新增或迁移多步卡效必须注册 starter / step handler。

## Target Responsibilities

activeEffect runtime 应统一处理：

- step 创建。
- `awaitingPlayerId` 校验。
- 候选卡、候选对象、候选槽位、选项的可见性。
- `abilityId + stepId` 到 handler 的分发。
- step 完成后的 `activeEffect: null` 与 pending 继续。
- reveal confirm / private inspection / public selection 的通用投影字段。

它不应该处理：

- 单卡卡文条件。
- 特殊分支奖励。
- 费用语义变更。
- trigger matcher 接线。

## Step Handler Registry

Current API shape:

```ts
registerActiveEffectStepHandler(abilityId, stepId, handler);
```

Current resolve shape:

```ts
export function resolveActiveEffectStepWithRegistry(game, input): GameState {
  const effect = game.activeEffect;
  const handler = findStepHandler(effect.abilityId, effect.stepId);
  return handler(game, input);
}
```

Benefits:

- `confirmActiveEffectStep` 不再有数百行 `if abilityId && stepId`。
- workflow 拥有自己的 step handler。
- 新卡不需要修改 runner 的大型分发函数。

### Public Zone-Selection Confirmation

`runtime/public-card-selection-confirmation.ts` 是“从公开来源确定具体卡牌后，移动前向双方展示本次选择”的两阶段边界。metadata 通过 `source: 'WAITING_ROOM' | 'REVEALED_CHEER'` 声明来源（缺省仍为 `WAITING_ROOM`），目的地支持手牌、主卡组位置与休息室。声援来源只接受当前玩家本次声援 ID 中、仍在 `resolutionZone.cardIds` 与 `resolutionZone.revealedCardIds` 且归属正确的可移动卡；不用 event-inclusive 条件事实代替当前可移动目标。workflow 在首次提交时只安装 `revealedCardIds` 展示并保存可序列化的 `originalEffect` / `originalInput`，不移动、不发放奖励、不推进 pending。

`GameSession` 按 `min(3500ms, 2000ms + (公开卡牌数 - 1) * 300ms)` 写入服务端权威 `publicCardSelectionAutoAdvanceAt`；双方客户端在展示结束后均可请求推进，命令必须带回当前 deadline generation token。到期后恢复原 step/input，由原 workflow 重新校验目标并完成移动、turn1、追加声援、奖励和 continuation。自动推进合并回原选卡撤销条目，不恢复过期窗口；空 optional 选择不展示。`PL!S-bp2-004` 这类服务端确定全部目标的窄路径可使用 cardIds 入口进入同一生命周期，但卡专属条件与 reroll 仍留在单卡 workflow，且展示集合与最终移动集合不一致时必须安全不移动。

### Public Effect-Choice Confirmation

`runtime/public-effect-choice-confirmation.ts` 负责卡文中的真实单选/多选效果分支，不替代普通 `selectableOptions`。workflow 用 `activeEffect.effectChoice` 声明服务端拥有的选项 ID、完整玩家文本、`SINGLE | MULTI`、选择数量边界和当前可选性；选卡、选成员、选槽位、队列顺序、发动/不发动、支付/不支付与数值输入继续使用原有字段。客户端只提交 `selectedEffectOptionIds`，服务端拒绝重复、伪造或当前不可选的 ID，并按 `effectChoice.options` 的卡文顺序归一化，多选效果不得用组合 ID 表达所有排列。

首次提交只创建双方可见的选项公开窗口，不执行分支动作、不打开后续选卡窗口、不推进 pending。`GameSession` 写入固定 1500ms 的权威 `publicEffectChoiceAutoAdvanceAt`；任一对局参与者到期后可以带回当前 deadline generation token 请求推进。恢复时清除已消费的 `effectChoice`，再由原 workflow 重新校验来源、选项与目标；如果同一步还包含 public-card selection，顺序固定为“公开效果选项 -> 公开所选卡牌 -> 原 handler 结算”。自动推进合并进最初选项提交的 undo entry，重连使用投影的剩余时间，旧 timer/deadline 不得推进新窗口。

选择阶段双方都可以看到印刷选项文本，但只有等待玩家收到动态 `selectable`；公开阶段双方只收到同一组 `selectedOptionIds` 与对应服务端文本。workflow 可以在权威状态暂留 legacy `selectableOptions` 供旧 handler 校验，但 projector 在存在 `effectChoice` 时不得再投影它，前端也不得渲染两套按钮。由选项进入卡牌、成员、槽位或另一个选项步骤时必须清除旧 `effectChoice`；只有下一步本身也是新的卡文选项时才重新创建。

## Granted Activated Abilities

少数常时能力会让舞台上的 host 获得下方成员的起动能力。当前只落地 `PL!SP-pb2-005` 的窄入口：

- `granted-activated-abilities.ts` 只在 Ren host 位于舞台时，读取同槽 `memberBelow` 中自己的『Liella!』成员。
- 只枚举已实现的 `ACTIVATED / STAGE_MEMBER` definition，并按 host 当前槽位检查 `requiredSourceSlots`。
- UI 查询、GameSession `ACTIVATE_ABILITY` 校验与已接入的 activated workflow handler 都以 host `sourceCardId` 记录发动与回合次数。
- 该入口不是通用 DSL；新增同类 host 或新增 handler 接入时，需要逐卡审查 source/limit/cost 语义。

## ActiveEffect Fields

Important fields:

| field | responsibility |
|---|---|
| `abilityId` | 当前处理能力。 |
| `sourceCardId` | 来源卡实例。 |
| `controllerId` | 效果控制者。 |
| `awaitingPlayerId` | 当前需要输入的玩家。 |
| `stepId` | 当前步骤。 |
| `selectableCardIds` | 可选卡牌候选。 |
| `selectableObjectIds` | 可选公开对象候选。 |
| `selectableSlotPositions` | 可选槽位候选。 |
| `selectableOptions` | 普通动作、支付、发动、队列或 legacy handler 使用的通用选项；不再作为真实多效果分支的玩家展示入口。 |
| `effectChoice` | 卡文中的真实单选/多选效果分支，包含服务端选项文本、数量边界、动态可选性与公开结果。 |
| `publicEffectChoiceAutoAdvanceAt` | 效果选项公开阶段的服务端权威截止时间。 |
| `revealedCardIds` | 已公开给双方的隐藏区卡。 |
| `selectableCardVisibility` | 候选投影模式：`PUBLIC`、`AWAITING_PLAYER_ONLY` 或 `AWAITING_PLAYER_BLIND`。 |
| `metadata` | workflow 私有上下文。 |

## Metadata Rule

`metadata` 可以保存 workflow 上下文，例如：

- discarded card ids
- selected branch
- source slot
- inspected card ids
- replacement origin

Rules:

- metadata 不应替代权威 zone/card 状态。
- step handler 必须重新校验目标仍合法。
- 跨玩家可见性不能仅靠 metadata 控制，必须配合投影字段。

### Blind Card Selection

`AWAITING_PLAYER_BLIND` 用于“等待玩家从自己看不到内容的卡牌中选择”这一窄交互：

- 权威状态中的 `selectableCardIds` 保留真实候选，供 workflow 在选择后重新校验区域与初始候选快照。
- 在线投影只向 `awaitingPlayerId` 提供匿名牌背；非等待玩家不接收候选标记。
- 匿名候选使用 `shared/utils/blind-card-selection.ts` 的位置 token，不投影真实实例 ID、`frontInfo` 或 `cardType`，避免通过历史公开对象关联身份。
- GameSession 只接受能映射到当前候选快照的位置 token；workflow 解析后仍必须确认真实卡当前位于规则要求的区域。
- 选择完成并公开时，继续使用 `revealedCardIds` / `revealHandCardForActiveEffect`，此后双方才可看到正面。

## Continue Pending

Production continuation now returns through `runtime/check-timing-scheduler.ts` while a
serializable `checkTimingContext` is active. After one ability finishes completely, the
scheduler runs rule processing, dispatches resulting rule events, and rebuilds the active
player's choice from the live pending pool. Trigger timing ids are event facts, not queue
batch boundaries. A normal activated ability with no new pending AUTO does not open this
loop; one that produces pending AUTO opens a new check timing.

step handler 完成后应明确决定：

- 是否清空 `activeEffect`。
- 是否调用 `continuePendingCardEffects`。
- 是否保持 ordered resolution。
- 是否只结束当前效果，不推进后续。

这些决策应由 workflow helper 统一承接，而不是每张卡重复写相同样板。

## Current Glue Helpers

Current helper modules outside `runtime/actions.ts`:

| helper | file | responsibility | boundary |
|---|---|---|---|
| `startPendingActiveEffect` | `src/application/card-effects/runtime/active-effect.ts` | 移除对应 pending ability，安装调用方已经拼好的 `activeEffect`，并写入 start `RESOLVE_ABILITY` action。 | 不构造卡文条件，不支付费用，不移动卡，不写 modifier，不 enqueue trigger，不决定 finish/continue 策略。 |
| `startConfirmOnlyActiveEffect` | `src/application/card-effects/runtime/active-effect.ts` | 为只有确认窗口的流程拼装 `activeEffect`，设置 step/awaiting player/orderedResolution metadata，并复用 `startPendingActiveEffect` 写入 `START_CONFIRM` action。 | 不判断条件是否满足，不选择 modifier 策略，不重算确认时数值，不清空 activeEffect，不推进 pending。 |
| `createOptionalDiscardHandToWaitingRoomActiveEffect` | `src/application/card-effects/runtime/active-effect.ts` | 构造“可选弃 1 手牌到休息室”的 activeEffect shell，统一旧 step text、候选可见性、selection/skip label、`effectCosts` 与 `handToWaitingRoomCost` metadata。 | 只返回 `ActiveEffectState`；不移除 pending，不写 action，不执行弃牌，不支付费用，不处理额外费用、分组选择、hand-adjust、skip 或 pending continuation。 |
| `revealHandCardForActiveEffect` | `src/application/card-effects/runtime/active-effect.ts` | 校验当前 activeEffect 的手牌候选，确认所选卡仍在该玩家手牌，将该卡加入 `revealedCardIds`，切换到调用方指定的下一 step，并写入调用方指定 action payload。 | 不支付费用，不扫描后续目标，不移动区域，不回收/交换，不清空 activeEffect，不推进 pending，不决定 skip 语义。 |
| `startConfirmOnlyPendingAbilityEffect` | `src/application/card-effects/runtime/active-effect.ts` | 为手动选择 pending ability 后需要先确认的流程安装 confirm-only `activeEffect`，保留原 pending ability，不写 start action；可用 `stepText` 覆盖默认提示。 | 不移除 pending，不结算卡效，不调用 starter，不应替代 `startConfirmOnlyActiveEffect`。 |
| `finishConfirmOnlyPendingAbilityEffect` | `src/application/card-effects/runtime/active-effect.ts` | 确认 confirm-only pending bridge 后，清空 `activeEffect`，通过调用方传入的 callback 以 `skipManualConfirmation` 重新进入 pending starter。 | 不 import runner，不知道具体卡效，不改变 pending 顺序；重新进入哪个 starter 由调用方注入。 |
| `delegatePendingAbility` | `src/application/card-effects/runtime/starter-registry.ts` / `step-registry.ts` context | 供 workflow 代发调用方已经构造好的 synthetic pending ability，runner context 只负责跳过手动确认并进入对应 pending starter。 | 不查找目标，不筛 ability，不支付费用，不改变自然 pending 顺序，不移除同源自然 pending，不替代 trigger matcher 或 ability activation DSL。 |
| `finishSkippedActiveEffect` | `src/application/card-effects/runtime/active-effect.ts` | 清空当前 `activeEffect`，写入 `RESOLVE_ABILITY` with `step: 'SKIP'` by default，并按 metadata 中的 `orderedResolution` 继续 pending。 | 不处理费用、不检查目标、不 enqueue trigger、不决定卡文策略。 |
| `getAbilityEffectText` | `src/application/card-effects/runtime/workflow-helpers.ts` | 按 abilityId 读取卡效文本，供 workflow 创建 activeEffect。 | 不创建 activeEffect，不处理 step 或 metadata。 |
| `recordAbilityUseForContext` | `src/application/card-effects/runtime/workflow-helpers.ts` | 写入旧语义的 `RESOLVE_ABILITY` / `ABILITY_USE` action。 | 不支付费用，不判断发动条件。 |
| `recordPayCostAction` | `src/application/card-effects/runtime/workflow-helpers.ts` | 写入 `PAY_COST` action，并保留调用方传入的 payload 字段。 | 不支付费用，不移动卡，不判断费用能否支付，不决定卡效策略。 |
| `getSourceMemberSlot` | `src/application/card-effects/runtime/source-member.ts` | 查询来源成员当前所在舞台槽位。 | 只读查询；不移动成员，不判断卡文是否合法。 |
| `getNewEnterStageEvents` | `src/application/card-effects/runtime/events.ts` | 从 before/after game 的 eventLog 差异中取新产生的 `ON_ENTER_STAGE` 事件。 | 只读查询；不 enqueue trigger，不构造事件，不移动卡。 |
| `getNewMemberStateChangedEvents` | `src/application/card-effects/runtime/events.ts` | 从 before/after game 的 eventLog 差异中取新产生的 `ON_MEMBER_STATE_CHANGED` 事件。 | 只读查询；不 enqueue trigger，不构造事件，不改变成员状态。 |

These helpers are intentionally small. If a proposed helper starts to own payment timing, grouped recovery policy, trigger matching, or full activeEffect construction, it belongs in a separate audit before implementation.

`startConfirmOnlyActiveEffect` and `startConfirmOnlyPendingAbilityEffect` are deliberately separate. Use the active-effect version when the workflow is truly starting and should remove the pending ability immediately. Use the pending-ability bridge only for ordered/manual pending selection where the player must confirm a no-input ability before the same pending ability resumes through its starter.

`revealHandCardForActiveEffect` is only for “selected hand card becomes public while the same activeEffect advances to a follow-up step.” It preserves existing `revealedCardIds` and de-duplicates them, defaults the next step's selectable-card visibility to `PUBLIC`, and leaves all card-specific facts in caller-supplied metadata/action payload. It is not a reveal DSL and should not be used for look-top inspection, cheer processing-zone reveal, cost payment, or zone movement.

`createOptionalDiscardHandToWaitingRoomActiveEffect` is only the reusable selection-window shell for optional single-card hand discard costs. The caller still decides when to remove the pending ability, what action payload starts the window, how skip resolves, and how the selected card is discarded later. Do not use it for windows with extra energy/source costs, grouped selection, discard-to-N hand adjustment, or other effects whose metadata would require a mini configuration interpreter.

## Common Energy Operation Selection

`runtime/energy-operation-selection.ts` owns the shared pre-step used when a card effect must distinguish ordinary energy from energy carrying an `energyActivePhaseSkips` marker. Workflows keep their original ability step and cost ordering; the adapter stores the original activated ability, pending starter, or activeEffect input, opens `COMMON_ENERGY_OPERATION_SELECTION`, then resumes the original path with exact selected energy card ids.

The adapter is entered only when the operation has more legal candidates than its resolved count and at least one legal candidate is marked. It does not add an extra window when all legal candidates must be processed or when no legal candidate is marked. Consecutive energy operations replay previously confirmed selections from the original immutable state so a later selection cannot duplicate an earlier payment or prematurely commit another cost.

## Migration Target

Priority:

1. 继续迁出 `confirmActiveEffectStep` 中剩余 workflow family。
2. 迁出特殊卡 workflow。
3. 收窄重复 activeEffect 创建/finish 样板。
4. runner 最终只保留 registry dispatch 与旧逻辑 fallback 被移除后的生命周期入口。
# Waiting-room delegated ON_ENTER selection

休息室虚拟登场能力选择使用玩家语言展示 `发动：${effectText}`。synthetic pending 的内部 metadata 记录 parent、target、原区域；这些字段不进入 `effectText`/`stepText`。多能力才创建能力选择 step，单能力直接进入原 workflow。
