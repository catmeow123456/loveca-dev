# 调度与来源

适用：定义能力时点、queued 确认、pending/检查时点、每回合次数、跨区域来源或授予起动能力。普通卡复用现有配置时只看涉及的章节；改共享调度时覆盖本文件相关回归。

## 能力分类

| 分类 | 处理方式 |
| --- | --- |
| `CONTINUOUS` 常时 | 不入队，由费用/修正值等计算层按当前场面收集 |
| `ON_ENTER` 登场 | 刚登场成员、`ON_ENTER_STAGE`，进入待处理队列；非手牌登场也按实际来源触发 |
| `ACTIVATED` 起动 | 舞台成员在合法时点主动发动，命令层/runtime 校验来源、费用、目标和次数 |
| `LIVE_START` | 舞台成员或当前 LIVE 区的 LIVE 卡，`ON_LIVE_START`，在统一检查时点选择顺序 |
| `LIVE_SUCCESS` | 符合规则的成员/LIVE 来源，以 `ON_LIVE_SUCCESS` 记录对应 LIVE 成功后入队 |
| `AUTO` 自动 | 按具体 TriggerCondition 诱发并入队，不伪装成常时或静默修正 |

卡文限定左/中/右区域时优先声明 `requiredSourceSlots`，触发时保存/校验 `sourceSlot`；来源区域与“结算时是否仍满足卡文条件”分开判断。状态/移动语义由对应 wrapper 保留。

## 无交互 queued 确认

- 无交互指不需要选择目标、支付、决定分支或查看等真实交互即可结算的效果；直接写 modifier、抽牌、移动或结束 pending 不使它变成有交互。
- 单个无交互 LIVE 开始/成功 pending 先展示 confirm-only，确认后结算。多个 pending 中手动点选该效果同样先确认；复用 `manualConfirmation` / `confirmBeforeResolution` / `skipManualConfirmation` bridge，不在 runner 写单卡结算。
- 点“顺序发动”后，只要剩余候选仍全部属于这次 ordered batch，可连续结算且不逐个确认；新 pending 出现必须回到实时池重新选择。
- 已有选卡、费用、可选发动、检视/公开、颜色或排序等真实交互的 workflow 不再套 confirm-only。旧 always-confirm-only 流程不作为新卡模板。
- 普通纯确认使用“确认”。无交互效果若卡文本身有条件或动态计数，展示时实时追加该条件当前状态与实际结果；不追加时说明具体理由。无条件效果不附加资源数量或引擎状态。文本职责见 [玩家文案](player-visible-action-copy.md)。

## 检查时点与动态待机池

- 自动能力诱发后先进入待机，当前能力完整结算后再处理；不得在效果步骤中间调用新 resolver 或插入另一个 activeEffect。
- 每个能力完成后通过统一 continuation 回同一检查时点：先执行规则处理、收集新事件触发，再从实时 pending 池产生候选。`timingId` 是事件事实，不是队列隔离边界；不按阶段、LIVE_START/SUCCESS 或初始快照分割待机能力。
- 主动玩家从自己当前全部待机能力中选一个完整处理，处理后重新检查；其待机池空后才轮到非主动玩家。后者结算若产生主动玩家能力，规则处理后再次优先主动玩家。
- workflow 不保留私有 pending 队列、不直接启动原队列下一项，也不延迟到阶段结束才 flush 新触发。
- `orderedResolution` 是对当次候选的便捷排序承诺；只有剩余候选均持同一 ordered batch token 时自动续跑，新入队项无该 token，必须与旧项共同重新开放排序。
- 直到规则处理、双方 pending、activeEffect、pendingChoice、pendingCostPayment 都清空才离开检查时点。循环保护须显式失败或留下可诊断状态，不能静默丢弃能力。

入口：`src/application/card-effects/runtime/check-timing-scheduler.ts`、`workflow-helpers.ts` 与 runner 的统一 continuation。触及这些契约时验证 A/B 待机、A 完成产生 X 后可在 B/X 中先选 X；X 不插入 A 中途；X 再产生 Y 仍在同一检查时点；主动/非主动优先级；旧 ordered batch 遇新能力失效。测试入口为 `tests/unit/check-timing-scheduler.test.ts` 及受影响 integration。

queued bridge 的回归覆盖单 pending 确认前不结算、多 pending ordered 自动连续结算、手动点选确认后结算，以及真实交互无双弹窗；优先扩展相应 workflow 测试。

## 来源生命周期与次数

- “1回合 N 次”在 definition 的 `perTurnLimit` 声明，通用 `ABILITY_USE` 以 `playerId + abilityId + sourceCardId + sourceLifecycleId + turnCount` 判断已用次数，并考虑当前 pending/active 占用；不由单卡删除或清理历史次数。
- `sourceCardId` 是跨区域保持不变的实体 ID；`sourceLifecycleId` 是这次成为能力来源的规则对象。`STAGE_MEMBER` / `PLAYED_MEMBER` 取最近跨区域 `ON_ENTER_STAGE.eventId`，`LIVE_CARD` 取 `ON_ENTER_LIVE_ZONE.eventId`；测试直置对象无入口事件时用确定性 initial sentinel。
- 槽位内移动、LIVE 区内移动和 ACTIVE/WAITING 不重置 lifecycle；离开再进入来源区形成新对象，不受旧对象已结算或未结算次数占用。旧 action/event 历史保留。
- 入口：`src/application/card-effects/runtime/ability-source-lifecycle.ts`；回归：`tests/unit/ability-source-lifecycle.test.ts` 及涉及多步骤起动、跨区域重登场的 integration。

## 下方成员授予能力：PL!SP-pb2-005 / LL-bp8-001

新增/修改自己『Liella!』成员的 `ACTIVATED / STAGE_MEMBER`，或矢泽日香、宫下爱、赛拉丝成员的起动／LIVE开始能力时，检查 abilityId 能否由对应宿主获得；任务仅描述原卡也不能漏掉适用的授予路径。叶月恋只获得 Liella! 起动，LL 三人卡只获得三个姓名的起动／LIVE开始。

- 对可授予起动 abilityId，启动、能量选择恢复、公开/支付确认、finish 等全部来源复核点使用 `isDirectOrGrantedActivatedAbilitySource`。不能仅替换首个 gate，也不能保留要求宿主匹配原卡编号的 direct-only gate。
- `directBaseCardCodes` 包含此 abilityId 的所有原生来源；shared config 只对目标能力开启授予来源，无关作品/能力维持原边界。不能删除来源资格校验使任意成员发动。
- 实际宿主是 `sourceCardId/sourceLifecycleId`，费用、动作记录、“此成员”的状态/离场/移动/modifier/叠卡均绑定宿主。下方授予卡不是效果来源。
- 每张授予卡具有服务端生成的 opaque `abilityInstanceId`；UI/query 每实例独立返回，命令只能透传，不解析或拼接。服务端重验实例仍在当前宿主下方且 abilityId 匹配；直接发动不带此字段。
- activeEffect 与最终 `ABILITY_USE` 保留同一实例标识。授予次数按宿主来源身份与能力实例联合计算；两张同能力下方卡可各使用一次，单实例第二次拒绝，原卡与宿主次数不互占。
- LIVE开始按触发时的每份授予分别产生带实例标识的 pending；后续使用 `isDirectOrGrantedTriggeredAbilitySource` 校验捕获身份，不能因下方卡在触发后移除而取消已诱发能力。两份同 abilityId 必须分别排序、结算并叠加；SCORE replacement 也按实例区分。
- 宿主生命周期失效不反向阻止不依赖宿主的合法费用，且旧调用不能向重登的新对象授予自身奖励。待机费用与“此成员获得常时分数”等自身效果绑定宿主；后者随宿主离场清理。动态确认文案需反映实际可结算结果。
- 修改相关能力时扩展 `tests/integration/sp-pb2-005-ren-granted-activated-abilities.test.ts` 的显式能力清单：原卡直发、合法宿主、缺授予/无关成员、下方移除、次数隔离、同能力双实例、伪造/错配/移除实例拒绝；多阶段路径完成后续支付/确认且不丢身份。
- LL授予路径另维护 `tests/integration/ll-bp8-001-granted-member-below-abilities.test.ts` 的14种唯一能力清单，覆盖原卡／宿主完整结算、双实例叠加、触发前后授予移除、费用与规则对象生命周期。
- 在本次修改的 workflow 范围搜索 `isDirectOrGrantedActivatedAbilitySource`、`isDirectOrGrantedTriggeredAbilitySource`、`cardCodeMatchesBase`、`doesCardAbilityDefinitionMatchCardCode`，核对残留 direct-only gate 是否为非目标能力；无需每次全库扫描并报告。

授予入口：`src/application/card-effects/runtime/granted-member-below-abilities.ts`。公开/定时恢复涉及的其他不变量见 [公开与可见性](reveal-and-visibility.md)。
