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

### Inspection And Public-Reveal Dwell

卡文中的“检视”与“公开”共享 inspection zone，但拥有不同可见性与停留语义：

- 普通检视时，`inspectionCardIds` 是服务端控制列表；检视者看到正面，对手只看到检视区 `BACK` occupancy。只有卡文明示公开的选中牌才加入 `revealedCardIds`。
- `inspectTopCards(..., { reveal: true })` 会把实际检视集合加入 inspection zone 的公开事实，使双方可以看到正面；它本身不会创建 `activeEffect` step，也不会暂停随后的移动、条件判断、奖励或 pending continuation。
- 如果公开结果后只需无输入结算当前 step，workflow 使用 `withPublicRevealDwell`；如果展示结束后还有真实选卡、选项或槽位交互，使用 `createPublicRevealDwellBeforeNextEffect`，先展示、到期后只恢复下一交互。两种模式都只把本次明确公开的卡传入 `revealedCardIds`，不得把完整私密 `inspectionCardIds` 当成展示集合。
- `GameSession` 按 `min(3500ms, 2000ms + (公开卡牌数 - 1) * 300ms)` 写入权威 deadline 和唯一 generation。双方客户端显示同一批正面卡牌，到期后任一参与者都可携带当前 deadline/generation 请求推进；服务端拒绝提前、过期、伪造选择及重复请求。客户端不显示普通确认按钮，不以客户端 command timestamp 为准，服务端也不保留进程级长驻 timer。
- 展示期间不得执行依赖公开结果的移动、奖励或 pending continuation；此前已经合法支付的费用、区域移动和 ability use 保持不变。恢复原 step 时仍由 workflow 重验实时区域与目标。0 张公开卡不创建额外 dwell；重连使用服务端投影的剩余时间，不重新计时。
- 普通“检视 N 张选1”优先复用 `look-top-select-to-hand` 等 shared workflow。未被卡文明示公开的牌对非检视者继续保持 `BACK`；无目标或主动不选时仍应保留适用的私密检视结果与真实后果提示，不得为了统一展示而公开整组。

Public Reveal Dwell 表示“隐藏信息刚刚按卡文变成双方公开”，与 `public-card-selection-confirmation.ts` 的“从既有公开区域确定具体移动目标”语义不同，也不是 queued pending 的 manual confirm-only bridge。已有 public-card-selection 或 public-effect-choice 自动展示不得再包一层 dwell。

费用 11「东条希」的 `PL!-bp6-007` 是“公开后原本立即移动与加分”的延迟结算样本；普通检视选1继续由 shared workflow 承担。focused 测试必须检查双方 FRONT 投影、deadline 前无后续结算、双方到期均可推进、重连/撤销不复用旧窗口，以及成功、条件失败、无目标和短牌库路径。

## Granted Activated Abilities

少数常时能力会让舞台上的 host 获得下方成员的起动能力。当前只落地 `PL!SP-pb2-005` 的窄入口：

- `granted-activated-abilities.ts` 只在 Ren host 位于舞台时，读取同槽 `memberBelow` 中自己的『Liella!』成员。
- 只枚举已实现的 `ACTIVATED / STAGE_MEMBER` definition，并按 host 当前槽位检查 `requiredSourceSlots`。
- UI 查询、GameSession `ACTIVATE_ABILITY` 校验与 activated workflow handler 都以 host `sourceCardId` 记录发动与回合次数。中央命令校验通过不代表 workflow 可以省略自身来源复核。
- 可被该 host 获得的 activated workflow 在启动、能量选择恢复、公开确认恢复、支付确认和 finish 等每一个来源资格复核点，都必须调用 `isDirectOrRenGrantedActivatedAbilitySource(game, playerId, sourceCardId, abilityId, directBaseCardCodes)`；不得再次用 `cardCodeMatchesBase` 或 `doesCardAbilityDefinitionMatchCardCode` 把合法 host 限回原卡。
- `directBaseCardCodes` 必须保留该 abilityId 的全部原生来源；helper 只增加当前合法获得能力的 Ren host，不允许任意成员调用，也不能完全删除“来源当前拥有能力”的校验。shared workflow 只能为明确的 abilityId/config 开启该入口，其他作品与能力继续保留原来源边界。
- 下方成员只提供 ability definition，不接替结算来源。不得把 `sourceCardId` 替换成授予能力的 memberBelow 实例；“此成员”的待机、离场、移动、数值变化、向下叠卡，以及 `ABILITY_USE`、每回合次数与 `sourceLifecycleId` 均继续绑定 host 实例。
- focused 契约测试必须同时覆盖原卡直发、合法 host、无对应下方成员、无关成员、下方移除、原卡与 host 次数隔离、host 第二次发动拒绝，并为多阶段 workflow 覆盖至少一个恢复/确认入口。
- 该入口不是通用 DSL；新增同类 host 或新增 handler 接入时，需要逐卡审查 source/limit/cost 语义。

## ActiveEffect Fields

Important fields:

| field                             | responsibility                                                                                                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `abilityId`                       | 当前处理能力。                                                                                                                                                                                                                                      |
| `sourceCardId`                    | 来源卡实例。                                                                                                                                                                                                                                        |
| `sourceCardDisplayCode`           | 来源在公开区域离开后仍用于当前效果窗口与重连显示的卡面快照；只可从曾对双方公开的来源建立，不授予隐藏来源可见性。                                                                                                                                    |
| `sourceLifecycleId`               | `perTurnLimit` 能力来源规则对象的生命周期；从 pending 或 activated dispatch 捕获并跨 activeEffect steps 保持，避免来源跨区再进入后把旧 active 占用算到新对象。                                                                                      |
| `controllerId`                    | 效果控制者。                                                                                                                                                                                                                                        |
| `awaitingPlayerId`                | 当前需要输入的玩家。                                                                                                                                                                                                                                |
| `stepId`                          | 当前步骤。                                                                                                                                                                                                                                          |
| `selectableCardIds`               | 可选卡牌候选。                                                                                                                                                                                                                                      |
| `selectableObjectIds`             | 可选公开对象候选。                                                                                                                                                                                                                                  |
| `selectableSlotPositions`         | 可选槽位候选。                                                                                                                                                                                                                                      |
| `selectableOptions`               | 普通动作、支付、发动、队列或 legacy handler 使用的通用选项；不再作为真实多效果分支的玩家展示入口。                                                                                                                                                  |
| `inspectionCardIds`               | 权威 activeEffect 中的检视卡实例列表，供服务端校验、排序和结算；不得作为普通玩家视图字段直接下发。                                                                                                                                                  |
| `inspectionObjectIds`             | 从权威 `inspectionCardIds` 映射出的玩家视图控制列表。仅当查看者是 `inspectionContext.viewerPlayerId ?? ownerPlayerId` 且同时是 `activeEffect.awaitingPlayerId` 时投影，用于操作当前检视对象；非控制方（包括跨玩家检视中的区域 owner）不接收该列表。 |
| `effectChoice`                    | 卡文中的真实单选/多选效果分支，包含服务端选项文本、数量边界、动态可选性与公开结果。                                                                                                                                                                 |
| `publicEffectChoiceAutoAdvanceAt` | 效果选项公开阶段的服务端权威截止时间。                                                                                                                                                                                                              |
| `publicRevealAutoAdvanceAt`       | 通用公开卡牌停留阶段的服务端权威截止时间。                                                                                                                                                                                                          |
| `publicRevealGeneration`          | 当前公开卡牌停留实例的唯一代数，用于拒绝旧客户端 timer。                                                                                                                                                                                            |
| `revealedCardIds`                 | 已公开给双方的隐藏区卡。                                                                                                                                                                                                                            |
| `selectableCardVisibility`        | 候选投影模式：`PUBLIC`、`AWAITING_PLAYER_ONLY` 或 `AWAITING_PLAYER_BLIND`。                                                                                                                                                                         |
| `metadata`                        | workflow 私有上下文。                                                                                                                                                                                                                               |

`inspectionObjectIds` 与普通检视区投影是两条不同边界：非控制方可能仍因检视区的公共 occupancy 看到 `BACK` 对象，但不会获得 activeEffect 的可操作控制列表；卡牌加入 `revealedCardIds` 后，双方对应检视对象可按公开规则显示为 `FRONT`。

### Active-Effect Source Display Snapshot

`sourceCardId` 是权威结算身份，但来源在自己的效果中离开舞台、LIVE 区或其他公开区域后，不能再仅靠当前 zone 投影恢复“处理中的效果”标题和左侧来源卡图。`runtime/active-effect-source-display.ts#preserveActiveEffectSourceDisplay` 因此维护可序列化的 `sourceCardDisplayCode`：

- 只有来源在状态变化前或变化后确实为公共正面，才可捕获卡面编号；隐藏手牌、隐藏卡组和未公开处理区来源不得借此获得快照。
- 同一 `activeEffect.id` 的后续 step 继承已有快照；public-card-selection、public-effect-choice 与 public-reveal dwell 的中间包装也必须保留该字段。
- 快照只服务当前效果窗口和断线重连显示，不改变区域 occupancy、`publicObjectId`、事件事实或来源当前规则合法性；workflow 仍按 `sourceCardId` 与实时状态重验。
- `activeEffect` 结束时快照随状态一起消失，不形成跨效果的公开历史。

focused 测试应覆盖公开来源离区后双方仍得到相同 `sourceCardDisplayCode`、中间确认步骤继续携带快照、从未公开的隐藏来源不生成快照，以及已有快照不会被后续隐藏区域状态覆盖。

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

| helper                                                                                           | file                                                                                    | responsibility                                                                                                                                                       | boundary                                                                                                                                                |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `startPendingActiveEffect`                                                                       | `src/application/card-effects/runtime/active-effect.ts`                                 | 移除对应 pending ability，安装调用方已经拼好的 `activeEffect`，并写入 start `RESOLVE_ABILITY` action。                                                               | 不构造卡文条件，不支付费用，不移动卡，不写 modifier，不 enqueue trigger，不决定 finish/continue 策略。                                                  |
| `startConfirmOnlyActiveEffect`                                                                   | `src/application/card-effects/runtime/active-effect.ts`                                 | 为只有确认窗口的流程拼装 `activeEffect`，设置 step/awaiting player/orderedResolution metadata，并复用 `startPendingActiveEffect` 写入 `START_CONFIRM` action。       | 不判断条件是否满足，不选择 modifier 策略，不重算确认时数值，不清空 activeEffect，不推进 pending。                                                       |
| `createOptionalDiscardHandToWaitingRoomActiveEffect`                                             | `src/application/card-effects/runtime/active-effect.ts`                                 | 构造“可选弃 1 手牌到休息室”的 activeEffect shell，统一旧 step text、候选可见性、selection/skip label、`effectCosts` 与 `handToWaitingRoomCost` metadata。            | 只返回 `ActiveEffectState`；不移除 pending，不写 action，不执行弃牌，不支付费用，不处理额外费用、分组选择、hand-adjust、skip 或 pending continuation。  |
| `revealHandCardForActiveEffect`                                                                  | `src/application/card-effects/runtime/active-effect.ts`                                 | 校验当前 activeEffect 的手牌候选，确认所选卡仍在该玩家手牌，将该卡加入 `revealedCardIds`，切换到调用方指定的下一 step，并写入调用方指定 action payload。             | 不支付费用，不扫描后续目标，不移动区域，不回收/交换，不清空 activeEffect，不推进 pending，不决定 skip 语义。                                            |
| `withPublicRevealDwell`                                                                          | `src/application/card-effects/runtime/public-reveal-dwell.ts`                           | 把已构造的无输入公开结果 step 包装为双方定时展示；到期后恢复原 step 并以空输入结算。                                                                                 | 只接受本次明确公开的卡；不用于仍需选择的 step，不包装已有 public-card/public-choice 自动展示，0 张不创建 dwell。                                        |
| `createPublicRevealDwellBeforeNextEffect`                                                        | `src/application/card-effects/runtime/public-reveal-dwell.ts`                           | 在本次公开结果与真实下一交互之间插入定时展示；到期后只恢复 nextEffect。                                                                                              | 不代替玩家选择、不执行 nextEffect handler、不公开完整私密 inspection，也不决定卡牌专属奖励或 continuation。                                             |
| `startConfirmOnlyPendingAbilityEffect`                                                           | `src/application/card-effects/runtime/active-effect.ts`                                 | 为手动选择 pending ability 后需要先确认的流程安装 confirm-only `activeEffect`，保留原 pending ability，不写 start action；可用 `stepText` 覆盖默认提示。             | 不移除 pending，不结算卡效，不调用 starter，不应替代 `startConfirmOnlyActiveEffect`。                                                                   |
| `finishConfirmOnlyPendingAbilityEffect`                                                          | `src/application/card-effects/runtime/active-effect.ts`                                 | 确认 confirm-only pending bridge 后，清空 `activeEffect`，通过调用方传入的 callback 以 `skipManualConfirmation` 重新进入 pending starter。                           | 不 import runner，不知道具体卡效，不改变 pending 顺序；重新进入哪个 starter 由调用方注入。                                                              |
| `delegatePendingAbility`                                                                         | `src/application/card-effects/runtime/starter-registry.ts` / `step-registry.ts` context | 供 workflow 代发调用方已经构造好的 synthetic pending ability，runner context 只负责跳过手动确认并进入对应 pending starter。                                          | 不查找目标，不筛 ability，不支付费用，不改变自然 pending 顺序，不移除同源自然 pending，不替代 trigger matcher 或 ability activation DSL。               |
| `registerPendingAbilityPreflightHandler` / `resolveFirstNonActionablePendingAbilityWithRegistry` | `src/application/card-effects/runtime/pending-ability-preflight.ts`                     | 允许单卡 workflow 显式登记不可逆的无事结算判定；runner 在展示实时候选池前每次至多自动结算一个确定不可行动的 pending，写入独立 `RESOLVE_ABILITY` 后重入统一检查时点。 | 不改变 trigger 或 pending 创建，不合并/去重仍有效的来源×事件组合，不记录 ability use，不批量跳过 observer；卡牌专属目标、来源与次数判断必须留在注册方。 |
| `registerPendingOrderOptionHintHandler` / `getPendingOrderOptionHintWithRegistry`                | `src/application/card-effects/runtime/pending-order-option-hints.ts`                    | 允许单卡 workflow 为效果顺序选项显式提供实时辅助提示；runner 只把非空提示追加到原卡名与完整 `effectText` 后。                                                        | 不改变 trigger、pending 合法性、顺序或结算，不自行解释 metadata 或读取隐藏目标；提示内容与可见性责任留在注册方，未注册能力保持原标签。                  |
| `finishSkippedActiveEffect`                                                                      | `src/application/card-effects/runtime/active-effect.ts`                                 | 清空当前 `activeEffect`，写入 `RESOLVE_ABILITY` with `step: 'SKIP'` by default，并按 metadata 中的 `orderedResolution` 继续 pending。                                | 不处理费用、不检查目标、不 enqueue trigger、不决定卡文策略。                                                                                            |
| `getAbilityEffectText`                                                                           | `src/application/card-effects/runtime/workflow-helpers.ts`                              | 按 abilityId 读取卡效文本，供 workflow 创建 activeEffect。                                                                                                           | 不创建 activeEffect，不处理 step 或 metadata。                                                                                                          |
| `recordAbilityUseForContext`                                                                     | `src/application/card-effects/runtime/workflow-helpers.ts`                              | 写入旧语义的 `RESOLVE_ABILITY` / `ABILITY_USE` action。                                                                                                              | 不支付费用，不判断发动条件。                                                                                                                            |
| `recordPayCostAction`                                                                            | `src/application/card-effects/runtime/workflow-helpers.ts`                              | 写入 `PAY_COST` action，并保留调用方传入的 payload 字段。                                                                                                            | 不支付费用，不移动卡，不判断费用能否支付，不决定卡效策略。                                                                                              |
| `getSourceMemberSlot`                                                                            | `src/application/card-effects/runtime/source-member.ts`                                 | 查询来源成员当前所在舞台槽位。                                                                                                                                       | 只读查询；不移动成员，不判断卡文是否合法。                                                                                                              |
| `getNewEnterStageEvents`                                                                         | `src/application/card-effects/runtime/events.ts`                                        | 从 before/after game 的 eventLog 差异中取新产生的 `ON_ENTER_STAGE` 事件。                                                                                            | 只读查询；不 enqueue trigger，不构造事件，不移动卡。                                                                                                    |
| `getNewMemberStateChangedEvents`                                                                 | `src/application/card-effects/runtime/events.ts`                                        | 从 before/after game 的 eventLog 差异中取新产生的 `ON_MEMBER_STATE_CHANGED` 事件。                                                                                   | 只读查询；不 enqueue trigger，不构造事件，不改变成员状态。                                                                                              |

These helpers are intentionally small. If a proposed helper starts to own payment timing, grouped recovery policy, trigger matching, or full activeEffect construction, it belongs in a separate audit before implementation.

`startConfirmOnlyActiveEffect` and `startConfirmOnlyPendingAbilityEffect` are deliberately separate. Use the active-effect version when the workflow is truly starting and should remove the pending ability immediately. Use the pending-ability bridge only for ordered/manual pending selection where the player must confirm a no-input ability before the same pending ability resumes through its starter.

`revealHandCardForActiveEffect` is only for “selected hand card becomes public while the same activeEffect advances to a follow-up step.” It preserves the workflow's cumulative `revealedCardIds`, but the dwell itself displays only the newly selected batch. A no-input next step uses the resolve-current dwell mode; a real follow-up interaction opts into restore-next mode. The helper leaves all card-specific facts in caller-supplied metadata/action payload and is not a reveal DSL for look-top inspection, cheer processing-zone reveal, cost payment, or zone movement.

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
