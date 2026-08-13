# Workflow Module Guide

> 文档类型：编码标准
> 适用范围：卡效 workflow family、特殊卡 workflow、runner dispatch 的组织方式
> 当前状态：现行写法；旧 runner 逻辑按 `migration_roadmap.md` 分批迁移，完整卡效 fallback 不得回流
> 最后更新：2026-08-06

## ON_LEAVE_STAGE activate stage member

`workflows/shared/on-leave-activate-stage-member.ts` 服务 `PL!-PR-001` / `PL!-PR-002` 两个同文样本。固定轴为 `ON_LEAVE_STAGE`，且仅 `toZone === WAITING_ROOM` 时生效；候选仅包含双方主舞台的 WAITING 成员，可跳过。它不承载费用、奖励、团体筛选或任意状态 DSL。

Workflow finish handlers keep using the compatibility `continuePendingCardEffects`
callback, but must not choose the next ability or retain a private queue snapshot. The
runtime check-timing scheduler owns rule-processing re-entry, active/non-active priority,
and live-pool reselection. `orderedResolution` only applies to the selected batch; a newly
waiting ability cancels the shortcut and reopens player choice.

workflow 是卡效流程的主要承载层。它可以是一类同型效果，也可以是一张特殊卡的单独流程。

## Granted Activated Ability Source Contract

当前 `PL!SP-pb2-005` 会让舞台上的 Ren host 获得同槽下方自己『Liella!』成员已经实现的 `ACTIVATED / STAGE_MEMBER` 能力。GameSession 的中央命令校验只负责允许合法命令进入 workflow；workflow 自己在后续步骤重复检查来源时仍必须兼容同一宿主契约。

- 只要 abilityId 可以由该 host 获得，启动 handler 以及能量选择恢复、公开确认恢复、支付确认、finish 等所有来源复核点，都使用 `isDirectOrRenGrantedActivatedAbilitySource`。不得只替换第一个 `cardCodeMatchesBase` / `doesCardAbilityDefinitionMatchCardCode` 后就结束审查。
- helper 的 `directBaseCardCodes` 保存该 abilityId 的全部原生来源；Ren-granted 分支继续检查 host、同槽下方授予卡、definition 与槽位限制。workflow 自己原有的 owner、成员类型、舞台位置、状态、资源与目标校验也必须保留，不得以“支持宿主”为由完全删除来源拥有能力或其他合法性校验。
- `sourceCardId` 始终是实际发动的 host 实例，不是下方授予能力的卡。“此成员”的费用与效果、`sourceLifecycleId`、activeEffect 来源和 action audit 都绑定 host；memberBelow 实例只提供授予资格与独立能力实例身份，绝不得替代 `sourceCardId`。
- 每张授予能力的 memberBelow 成员在 UI/query 中生成一个由服务端生成并持有的 opaque `abilityInstanceId`。Ren-granted `ACTIVATE_ABILITY` 必须原样透传它，中央命令会重验该下方成员仍属于当前 host 且能授予所请求的 abilityId；不得自行拼接或解析该 ID。直接发动不携带它。
- `ABILITY_USE` 仍记录 host `sourceCardId/sourceLifecycleId`，但 Ren-granted 发动还要记录 `abilityInstanceId`，并把 per-turn identity 扩展为 host 来源身份 + 授予能力实例。因此同一恋下方两张相同成员的同 abilityId 能力各自每回合计次；单张下方成员的第二次发动仍应拒绝。多阶段 workflow 的 activeEffect 和最终 `ABILITY_USE` 必须保留同一实例标识。
- shared family 只能对明确的 abilityId/config 开启 Ren-granted 来源。相同文件内其他作品、其他 abilityId 继续使用原 direct-only 边界；同一 abilityId 有多个原生基础编号时，必须全部保留在 `directBaseCardCodes`。
- 新增或修改可被获得的『Liella!』起动能力时，同步扩展 `tests/integration/sp-pb2-005-ren-granted-activated-abilities.test.ts` 的显式能力清单，并执行 direct-only source gate 静态审计。代表性测试还要证明待机、离场、移动、modifier 或向下叠卡等“此成员”语义作用于 host，并覆盖同 abilityId 的两份授予实例分别使用、伪造/错配/移除实例拒绝及多阶段实例身份传递。

## Public Reveal Dwell

隐藏卡牌按卡文变为双方公开后，如果接下来会自动移动、判断、发放奖励、推进 pending，或打开另一项真实交互，workflow 必须在两者之间接入 `runtime/public-reveal-dwell.ts`。当前 step 恢复后只需无输入结算时使用 `withPublicRevealDwell`；展示结束后还有真实选卡、选项或槽位交互时使用 `createPublicRevealDwellBeforeNextEffect`，到期只恢复 next effect。

workflow 继续拥有公开集合、卡牌条件、费用、区域移动、奖励、事件和 continuation；dwell 只拥有本次明确公开 cardIds 的权威 deadline/generation、双方展示及恢复。恢复后必须重验实时区域、来源与目标，不得在展示期间提前执行依赖公开结果的结算。不得传入完整私密 `inspectionCardIds`，不得自行实现确认按钮、客户端计时或服务端 `setTimeout`，也不得再次包装已有 public-card-selection / public-effect-choice 自动展示。

Public Reveal Dwell 与 public-card-selection confirmation 不同：前者表示“隐藏信息刚刚公开”，不要求玩家作规则选择；后者表示“玩家从既有公开区域确定了将要移动的具体卡牌”，仍保存原输入并在到期后回到原 workflow。无交互 queued pending 的 manual confirm-only 又是第三种语义，三者不能互换。

## 有限成员登场选项与卡定义特殊流程

手牌成员卡上由玩家主动选择的额外登场方式统一由 `application/member-play-options.ts` 查询并投影为 `MemberPlayOption`。当前 option 只有两种执行族：`DOUBLE_RELAY` 仍走普通 `PLAY_MEMBER_TO_SLOT`，`CARD_DEFINED` 才进入 `BEGIN/CONFIRM_SPECIAL_MEMBER_PLAY`。前端只渲染服务端给出的 label、title、description、targetSlots 与 selection descriptor，不维护基础编号白名单，也不从卡文推导规则。

`application/special-member-play-procedures.ts` 是 `CARD_DEFINED` 的有限注册表。每个真实 mode 显式实现 begin/confirm 校验、pending 快照、pending 玩家文案配置和原子 resolve；新增样本必须新增有限 procedure 与 focused RULES/FREE 测试，不得把支付区域、费用公式、移动步骤或任意 callback 扩成通用 DSL。`GameSession` 只保留通用 dispatch、会话级公共事件和 sealed audit 包装，projector 只负责把 registry 配置与 candidate card ID 转成当前玩家对象投影。

FREE 只放宽这次登场的能量支付与目标槽位限制：卡面规定的程序成本/动作仍必须完成；占用槽仍沿用普通 FREE 登场的单换手或重复成员规则。RULES 继续按服务端费用计划、换手合法性和 `movedToStageThisTurn` 限制结算。审计必须明确记录 manualOperationMode 与实际支付能量，不能把 FREE 的0能量或真实换手伪报成规则模式计划。

`PL!S-bp3-001` 与 `PL!S-bp3-002` 是同一窗口但流程无关的两个单卡 ownership 样本：前者是主阶段选择成员待机费用并授予目标成员临时能力，后者是 LIVE_SUCCESS 从当前公开声援来源固定回手。它们分别保留在 `cards/s-bp3-001-chika.ts`、`cards/s-bp3-002-riko.ts`，只复用原子状态变化、modifier、声援移动和来源收集 helper，不拼成批次 workflow 或参数 DSL。

`workflows/shared/discard-cost-waiting-room-to-hand.ts` 也承接 `PL!-PR-003` / `PL!-PR-004`：两张卡因 Excel 玩家文本和指定 Heart 颜色不同而保留独立 abilityId，selector 分别读取 LIVE 自身印刷 `requirements.colorRequirements` 的黄 / 桃 Heart >=3。固定流程仍为强制弃2手牌、通过标准 enter-waiting-room wrapper 支付、支付后重扫自己的休息室、强制选1张合法目标并走 public-card-selection confirmation；因此本次弃置的合格 LIVE 可被回收。该扩展未新增 workflow/helper，也不需要 runner 注册。

`workflows/shared/activated-pay-two-energy-discard-recover-group-live.ts` 是 `PL!N-bp5-014`、`PL!SP-sd2-006` 在新增 `PL!N-sd1-009` 第三个真实同型样本时晋升的有限起动 family。三张卡各自保留 ability identity、Excel/既有玩家文本、per-turn identity 与持久 stepId；配置轴仅为 abilityId、来源基础编号、结构化 `groupAlias`、玩家可见团体名和 action/step 名。family 固定主阶段、每回合1次、支付 `[E][E]`、弃恰好1手、支付后重扫自己的休息室并强制回收1张指定团体 LIVE；能量支付使用通用特殊能量选择，弃手使用 enter-waiting-room trigger wrapper，回收使用 waiting-room-to-hand 公开确认并在统一 continuation 后才处理新 pending。它不开放能量数、弃牌数、目标卡种、来源/目的区域或任意后续步骤，因此不是复合费用 DSL。

同一 family 现在也承接 `PL!N-bp1-008` 费用9「艾玛·维尔德」。新增动态轴是有限判别规则 `LOWER_PRINTED_COST_THAN_DISCARDED_MEMBER`：费用候选仅为手牌成员，支付成功后保存该成员的印刷 `card.data.cost`，并在创建回收窗口与 public confirmation deadline 恢复时重扫当前自己的休息室，只保留 owner 正确、类型为 MEMBER、印刷费用严格更低的卡。无目标直接结束，不创建空确认。该轴不是任意 callback、recovery AST、cost-calculator 接口或“弃手后执行任意效果” DSL；既有静态 selector、弃2手与 LIVE 回收配置保持不变。

`PL!N-bp1-006` 费用13「近江彼方」的第一条起动能力保留单卡 workflow `workflows/cards/n-bp1-006-kanata.ts`：以 `SINGLE` 单卡直点窗口选择弃1手，并提供支付前唯一的“不发动”入口；支付成功后调用纯 query 判断本回合虹咲成员登场事件事实，再复用通用能量操作将至多2张 WAITING 能量变为 ACTIVE。第二条同文“支付 `[E][E]` 抽1”只扩展 `workflows/shared/activated-pay-energy-draw.ts` 对应 definition 的 `baseCardCodes`；两条能力拥有独立 abilityId/turn-use，不共享次数。复数 `activatedUi` 由 `runtime/activated-ability-ui.ts` 按卡面顺序投影为同一个能力选择菜单，玩家选定 abilityId 后才进入对应 workflow；不创建两个并行 `activeEffect`。单卡段不复制能量 selection continuation，特殊 marker 超额选择恢复原弃手步骤并原子提交。

## Structured Effect Choices

卡文写“从以下选择一项/多项”、选择 Heart/必要 Heart 组合、选择卡组顶/底等处理模式，或在多个真实效果分支间决定时，workflow 使用 `activeEffect.effectChoice`，不再把这些玩家可见分支只建模为通用 `selectableOptions`。每个 option 的 `text` 直接采用完整卡文分句并保留已支持的 Heart/BLADE token；服务端用稳定 ID 结算，前端不解析整段卡文生成分支。

`SINGLE` 固定提交一个原子 ID；`MULTI` 以 `minSelections` / `maxSelections` 表达数量，按 options 的卡文顺序结算，不创建 `A+B` 组合 option。印刷选项应保持完整，即使当前没有合法资源/目标也保留该项并设 `selectable: false`。真实分支的提交统一先进入 1500ms 双方公开，再由原 handler 重验来源、资源、目标和规则条件；如果选项后还要选卡或选成员，也不能跳过该公开阶段。

选目标卡/成员/槽位、选择作用玩家、pending/ability 顺序、动态委托能力、单纯发动/不发动、支付/不支付、数字输入与继续/停止不属于 `effectChoice`。真正的 skip 仍使用 `canSkipSelection` + `skipSelectionLabel`，没有选择正向效果时不创建空公开窗口。迁移期只有旧 handler 仍依赖 `effect.selectableOptions` 校验时才在权威状态保留 legacy 字段；projector/UI 在存在 `effectChoice` 时必须隐藏它。选项进入下一步骤时清除旧 `effectChoice`，避免后续窗口重复公开或误用旧选择。

## 2026-08-06 DRAFT 第二批 family 与 observer 边界

`workflows/shared/live-start-wait-nijigasaki-member-gain-live-modifier.ts` 由旧 `PL!N-sd2-006` 在 `PL!N-bp7-012` 成为第二个真实样本时晋升。稳定核心是 LIVE_START 可选将己方活跃虹咲成员 WAITING 作为费用，再给来源成员写 LIVE modifier；有限奖励轴只有固定 BLADE 与六色普通 Heart 强制单选。费用经 member-state wrapper 支付并先入队事件；后续来源 stale 只取消 modifier，不回滚已支付费用。晋升必须保留旧 N-sd2-006 持久 step ID。

`workflows/shared/choose-player-bottom-waiting-members.ts` 由旧 `PL!N-bp3-010` 与 `PL!S-bp7-013` 证明。family 只承载“选自己／对方 -> 效果控制者从该玩家休息室有序选0～2张 MEMBER -> public-card-selection confirmation -> 按选择顺序置该玩家卡组底”的完整核心，不扩展为任意卡种、数量、目的地或后续奖励 DSL。旧 N-bp3-010 step ID 继续是持久恢复合同。

`runtime/member-state-changed-observers.ts` 是与 member-slot observer 对称的通用 registry；runner 只在通用 member-state definition matcher 之后调用它。使用该 registry 自行绑定精确事件的 definition 必须标记 `observerOnly: true`，通用 matcher 必须排除这些 definition，防止未来增加 matcher 时双重入队。`member-waited-discard-activate.ts` 当前只覆盖 `PL!N-bp7-022` / `PL!N-sd2-010` 的己方虹咲成员 `ACTIVE -> WAITING`、可选弃1手、同批候选聚合后再活跃核心；同一批中每个来源成员只创建一个 pending，弃手支付成功后才从本批仍合法的 WAITING 成员中选择回正目标。完整规则 Live 阶段（`LIVE_SET_PHASE` / `PERFORMANCE_PHASE` / `LIVE_RESULT_PHASE`）门禁与目标 BLADE +2 是有限配置轴。两张来源卡按各自 abilityId／来源实例独立保留每回合1次；只有成功弃手才记录 turn use，支付后候选 stale 不回滚费用，也不改选本批以外的 WAITING 成员。

`workflows/shared/own-card-effect-place-energy-gain-source-blade.ts` 由 `PL!SP-bp7-005` / `PL!SP-bp7-016` 证明，只消费 pending `eventIds` 绑定的 `ON_ENERGY_PLACED_BY_CARD_EFFECT`，要求 cause.playerId 和 targetPlayerId 均为控制者且来源仍在己方主舞台。`place-waiting-energy.ts` 另只新增 `skipNextActivePhase` 有限轴；该轴必须调用 `placeWaitingEnergyWithActivePhaseSkip`，使放置事件、WAITING 状态、精确能量卡 marker 与 continuation 保持同一原子语义。

`mill-top-gain-live-modifier.ts` 的新条件是有限 union `DISTINCT_MEMBER_BLADE_HEART_COLORS`；只读本次实际 milled IDs 中 MEMBER 的印刷 `BladeHeartEffect.HEART/heartColor`，不统计 LIVE 的 BLADE HEART、DRAW/SCORE 效果或普通 `hearts`。它仍共用 refresh-aware direct mill、grouped waiting-room event、Public Reveal Dwell 和来源 stale 后不回滚区域移动的原有边界，不接受任意 condition callback。

## When To Create A Workflow Module

新增或迁移卡效时，满足任一条件就应放入 workflow module：

- 有多步 activeEffect。
- 有 start / finish 成对流程。
- 有弃牌后分支、看顶后选择、回收后奖励、替代放置等组合逻辑。
- 需要被 runner 用 `abilityId` dispatch。
- 是特殊卡，但流程超过简单确认或单个 runtime action。

## Family Workflow

`relay-replacement-gain-blade.ts` 是 `PL!-PR-024`、`PL!HS-PR-040`、`PL!S-PR-046`
三个同文基础编号证明的窄离场 family。它只接受绑定当前 pending 的精确
`LeaveStageEvent`，并以该事件的 `replacingCardId` 重验换手登场成员仍为控制者主舞台顶层、
印刷费用至少9；不得从最近 action、当前槽位变化或卡名猜测关系。合法时写目标成员实例绑定的
BLADE +2，离场来源无需仍在舞台；事件或目标 stale 时消费 pending 并 no-op。手动确认使用
实时条件/结果文案，ordered batch 直接结算。

`look-top-ten-minus-hand-take-two.ts` 是 `PL!HS-PR-039` 与 `PL!SP-PR-028` 的窄动态检视
family。唯一动态轴是在结算开始按当前手牌锁定 `max(0, 10-handCount)`；检视、0～2张私密
入手、余牌成组进入休息室及 continuation 全部委托既有 `look-top-select-to-hand` core。
它不开放任意计数公式、selector 或目的地区域，0张请求直接结束。

`live-start-waiting-live-to-deck-top.ts` 是 `PL!S-PR-047` 与 `PL!SP-PR-027` 的窄
LIVE_START family。实时条件固定为自己休息室总数至多9，候选固定为其中 LIVE，选择固定为
0～3张 ordered 置顶。非空选择必须经过 waiting-room public-card-selection confirmation，
deadline 恢复后整体重验，并调用统一 waiting-room-to-main-deck 事件 wrapper；skip 不创建
空展示，手动无目标/条件失败用动态 confirm-only，ordered no-op 自动继续。该 family 不扩成
任意区域阈值、卡种或目的地 DSL。

`workflows/shared/discard-mill-top-recover-member.ts` 是由费用 5「高坂穂乃果」`PL!-bp5-010` 在费用 9「天王寺璃奈」`PL!N-bp1-009` 成为第二个真实样本后晋升的窄 family。稳定轴仅为 abilityId、mill 数量、成员 selector/目标说明、是否在结算开始校验来源仍在舞台，以及稳定 step/action 标签。两者共同保持“可选弃1手 → refresh-aware direct mill → 支付后重扫当前休息室 → 强制回收1张成员”的顺序、标准事件 wrapper、无目标保留费用与 mill、waiting-room-to-hand public confirmation 和统一 continuation；璃奈的 ON_ENTER pending 成立后不因来源离场取消，高坂穂乃果的 LIVE_START 仍要求来源在舞台并只回收『A-RISE』成员。该 family 不是任意“弃牌后做若干动作”的 DSL。

费用 9「ミア・テイラー」`PL!N-bp1-011` 保持 `workflows/cards/n-bp1-011-mia-taylor.ts` 单卡 ownership。它只与上述 family 共享可选弃手和底层区域动作；完整流程是逐张公开至服务端确定的首张 LIVE、通过 Public Reveal Dwell 展示完整公开结果、展示结束后一次移动，不存在玩家自由选择命中目标，因此不接 public-card-selection confirmation deadline。

`self-sacrifice-waiting-room-to-hand.ts` 承接“来源成员自送休息室后，从自己的休息室公开确认回收卡牌”的稳定 family。回收后的能量恢复只允许有限条件联合：成功 LIVE 区有效分数总计，或本次实际回收 LIVE 自身的结构化团体与印刷分数；不接受任意 callback。`PL!-PR-017` 与 `PL!S-bp3-008` 是两个真实条件样本。

`live-start-discard-gain-blade.ts` 承接 LIVE_START queued 的“可选弃手，来源成员获得 BLADE”稳定 family。当前配置轴仅为 abilityId、弃置 min/max、`PER_DISCARD / FIXED_TOTAL` 两种有限奖励，以及“弃置 LIVE 后抽1”的窄后处理；不接受任意 callback、奖励公式、任意弃牌后处理或步骤 DSL。`PL!S-bp3-003` 证明0至2张与每张+2，`PL!SP-PR-009/011/012` 保留 exactly 1、+1与弃 LIVE 抽1，`PL!SP-sd1-003` 证明恰好2张与支付成功后固定+5。弃手统一走 trigger-safe wrapper，modifier 绑定来源成员实例，并通过统一 pending continuation 返回检查时点；手牌不足配置下限时直接消费 pending，不建立非法选择窗口。

`live-start-discard-gain-heart.ts` 承接 LIVE_START queued 的“可选精确弃固定数量手牌后获得固定数量 Heart”稳定 family。`discardCount` / `heartCount` 是有限正整数轴；多张弃手必须一次精确选择并以单个 grouped 进入休息室事件支付。`PL!-bp4-013-N` 费用4「園田海未」的固定单色 + 任意其他主舞台成员样本使用 `HeartColor.PINK`，因此成功弃手后直接进入成员选择，不打开只有一个选项的颜色窗口。recipient 仍只有 `SOURCE_MEMBER` / `SELECT_OTHER_STAGE_MEMBER` 两种模式；后者的 `groupAlias` 是有限可选轴，缺省表示任意其他己方主舞台成员，既有 `PL!N-bp3-002` 虹咲样本继续显式配置 `groupAlias: '虹ヶ咲'`。

`PL!N-sd2-005` 费用13「宫下爱」是 `discardCount: 2` / `heartCount: 2` 样本，并继续证明来源成员在支付后从六种普通 HEART 中指定1色的有限模式；颜色窗口只使用前端已有稳定 token，不接受 ALL 或任意字符串。

该 family 只扫描控制者 LEFT/CENTER/RIGHT 顶层成员，排除来源与 memberBelow；目标确认时重扫来源与候选，支付后无目标或来源/目标 stale 均保留费用并通过统一 continuation 继续。成员 Heart 统一写 `SOURCE_MEMBER` / `TARGET_MEMBER` modifier。family 不接受 selector callback，不表达任意费用、任意目标、任意 modifier 或步骤 DSL。

同型效果放 family 文件。例如：

```text
src/application/card-effects/workflows/shared/self-sacrifice-waiting-room-to-hand.ts
src/application/card-effects/workflows/shared/look-top-select-to-hand.ts
src/application/card-effects/workflows/shared/pay-energy-gain-blade.ts
```

Family workflow 应包含：

- config map：按 ability id 记录差异轴。
- starter：创建第一步 activeEffect 或直接结算。
- step handler：处理选择输入。
- local validation：只验证本 family 的卡文差异。

Before promoting more complex cards into a family workflow, run a small family audit. The audit should check whether at least three remaining effects share the same game operation and have stable parameter axes. Report:

- ability ids and step ids;
- real differences in cost, optionality, preconditions, target groups, counts, no-target behavior, and action payload;
- whether an existing shared workflow can absorb them;
- pending order, payment timing, event enqueue, cancel path, and no-target risks;
- minimum tests needed before extraction.

Do not keep moving only single-card wrappers when a stable family has emerged. Also do not merge grouped recovery into ordinary waiting-room-to-hand recovery before the group rules are documented and tested.

Grouped recovery is a dedicated shared family. Keep workflows that recover one card per named group in `workflows/shared/grouped-recovery.ts` or a similarly explicit module; represent the differences as discard count, preconditions, group selectors, per-group required/optional counts, no-target action step, and payload field names. Use a small validation helper for per-group selection bounds, but do not turn these rules into a general steps DSL or route them through ordinary `waiting-room-to-hand.ts`.

On-enter waiting-room card to deck-top is a narrow shared family for the proven identical-text bases `PL!N-bp4-021` and `PL!SP-bp2-013/014/018`. It owns only the optional 0～1 waiting-room selection, public-card-selection confirmation metadata, authoritative deadline restoration, final target revalidation, deck-top move, and pending continuation. Keep the existing shared ability definition and `moveWaitingRoomCardsToDeckTopAndEnqueueTriggers`; do not widen this family into a general zone-movement DSL.

Waiting-room selections that move chosen cards to hand or a known main-deck position must use the shared public-selection confirmation lifecycle before movement. Ordinary waiting-room-to-hand workflows receive it from `createWaitingRoomToHandEffectState`; grouped/custom recovery and deck top/bottom/position workflows opt in with narrow destination metadata. The first submission only publishes the chosen IDs through `revealedCardIds`; the original workflow remains responsible for final stale validation, movement, rewards, and continuation after the second confirmation. Fixed targets, whole-zone shuffles, and choices that select only a destination rather than a card do not opt in.

All production `WAITING_ROOM -> MAIN_DECK` moves use the trigger-safe wrappers in `runtime/waiting-room-main-deck-triggers.ts`. The raw top, ordered-bottom, specific-position, and shuffled-bottom helpers create exactly one authoritative grouped event only after a real non-empty move; wrappers dispatch that exact event and write an independent dispatch ledger even when no listener exists. Listener ownership follows the waiting-room/main-deck owner (`event.playerId`), while `controllerId` and `cause.playerId` retain the effect actor. Rule refresh emits the same event with `SHUFFLED_BOTTOM` and `RULE_ACTION/REFRESH`; check timing passes its exact events, and the runner also drains undispatched events so refreshes performed inside draw/look-top effects before a later scheduler log cursor are not lost.

Revealed-cheer selections use the same lifecycle with `source: 'REVEALED_CHEER'`, including destinations that are already public such as waiting room. The shared runtime validates only current-cheer movable membership and owns pause/display/deadline restoration; `revealed-cheer-selection.ts` or the card workflow still owns printed selectors, costs, turn-use recording, additional cheer, reroll, action payloads, and continuation. Do not treat event-inclusive `CheerEvent.revealedCardIds` condition facts as movable targets. Server-determined all-card actions such as `PL!S-bp2-004` may call the low-level card-id window entry and resume through a narrow synthetic step, but must reject the whole move when the displayed set is no longer exactly movable rather than silently moving a stale subset.

Fixed pay-energy gain-BLADE is a shared live-start family when the only stable axes are active energy cost and fixed BLADE amount. The `PL!N-sd2-004` / `008` pair proves the fixed +2 axis alongside the earlier +1 samples. Keep the payment prompt, `PAY_COST` action log, source-member BLADE modifier, skip path, and pending continuation inside the workflow; do not fold payment execution into the action-log helper.

On-enter other-identity activate-energy is a narrow shared family proven by `PL!HS-bp6-012` and `PL!N-bp1-004`. Keep its configuration axes to ability id, identity kind (`GROUP` / `UNIT`), alias, activation count, and the internal `RESOLVE_ABILITY` step labels `actionStep` / `noOtherMemberStep`. Those labels are audit payload values, not player-facing action copy or a new UI configuration axis. The workflow must exclude the source card, combine `typeIs(MEMBER)` with `groupAliasIs` or `unitAliasIs`, and delegate WAITING-energy selection and activation to the common energy-operation runtime. Do not fold this into unconditional/count-based on-enter energy activation or widen it into a general condition DSL.

Activated pay-energy draw is a shared family proven by `PL!SP-bp5-020` and `PL!HS-bp1-007`. Keep its axes narrow to ability id, active energy cost, draw count, and action copy. The definition owns the once-per-turn limit; the workflow validates current-player main phase, source membership/definition match, pays through `TAP_ACTIVE_ENERGY`, records `PAY_COST`, then records ability use and draws. Do not add target selection, pending behavior, or a generic activated DSL. `PL!SP-bp1-009` does not join this family because it must continue into a discard step; its thin card wrapper owns legality and the fixed one-ACTIVE-energy payment, then delegates draw/discard state and HAND -> WAITING_ROOM trigger handling to the existing `draw-then-discard` core.

`workflows/shared/pay-energy-waiting-room-to-hand.ts` contains two explicitly separate lifecycles rather than one flag-heavy configuration object. The original `ACTIVATED / STAGE_MEMBER` family validates main phase, active player, current source stage membership and immediate payment before recording `ABILITY_USE`; its definitions own any per-turn limit. Most entries require a legal initial target, while the narrow `allowPaymentWithoutInitialTarget` axis is reserved for text such as `PL!N-sd2-001` where paying `[E][E]` is itself legal and the recovery target is rescanned only after payment; a zero-target result then keeps energy payment and turn use. `PL!SP-sd1-007` proves the distinct `queued ON_ENTER / PLAYED_MEMBER / optional payment` lifecycle: once the enter event is queued, later source departure does not cancel it; no legal target consumes only that pending, insufficient ACTIVE energy still opens a decline-only player window, and choosing payment uses `payImmediateEffectCosts` plus actual `PAY_COST.energyCardIds` without recording activated use. After payment it rescans the controller's waiting room, keeps paid cost if no target remains, and otherwise forces one configured selection through `createWaitingRoomToHandEffectState`, shared public-card-selection confirmation, restore-time current-candidate validation, and unified pending continuation. The two lifecycles share target scanning, payment primitives, recovery state, movement and confirmation helpers only; this is not a generic trigger/cost/selector DSL.

`PL!SP-bp1-010` 也不加入上述 family：它的固定复合费用是两张 ACTIVE 能量加恰好一张弃手，且后续必须完成顶5检视、可选0至1张『Liella!』卡公开入手、余牌成组入休息室。窄单卡 workflow 只编排 `payImmediateEffectCosts`、标准弃手事件 wrapper 与 `look-top-select-to-hand` core；在任何资源移动前预验证两种资源，全部成功后才记录回合次数。这不是任意复合费用或 steps DSL。

`PL!SP-bp1-003` 保持窄单卡 workflow：它在起动后公开 0 至全部己方手牌成员，并以提交时同一个完整手牌快照计算每张卡的当前有效登场费用。多张公开复用 `revealHandCardsForActiveEffect`，满足指定合计时只写入一次 target-member-bound SCORE modifier；普通登场与本 workflow 共用 `buildPlayMemberCostResources` / `getHandMemberEffectivePlayCost` 的只读资源查询。不要由此建立任意 reveal、费用或 steps DSL。

The pure `memberHasMoreEffectiveHeartsThanPrinted` query compares the sum of each `HeartIcon.count` in `getMemberEffectiveHeartIcons` with the printed member Hearts using one collected modifier snapshot. It includes SOURCE_MEMBER and TARGET_MEMBER additions, rejects wrong-player/off-stage/non-member cards, and treats original-color replacement without a count increase as false. Card-specific unit filters remain in workflows such as `hs-pb1-029-zenhoui-kyun.ts`.

On-enter discard-then-recover-unit-card is a shared family when the stable operation is "optionally discard exactly one hand card, then recover exactly one waiting-room card from a named unit". Keep the axes to ability id, unit alias, step ids, action step labels, and UI text. The discard must use `discardOneHandCardToWaitingRoomAndEnqueueTriggers`, and the recovery target is a unit card of any card type, so the just-discarded card can be selected if it matches. If no hand exists, consume the pending ability without opening a window; if no target exists after payment, keep the paid cost and consume the pending ability. Do not merge this family into activated discard-cost recovery or a general steps DSL.

On-enter workflows may read `pending.metadata.fromZone` when the printed condition depends on where the member entered from. The runner may propagate `EnterStageEvent.fromZone` into ordinary ON_ENTER pending metadata, and normal hand-play fallback sources should mark `ZoneType.HAND`; card-specific source checks still belong in workflow modules, not in runner gates or trigger matcher experiments.

Member-on-enter draw is a shared family when the whole operation is "this played member draws N cards" with no discard, target selection, optional payment, or follow-up movement. Keep the axes narrow to ability id, base card codes, draw count, action step label, and proven finite condition fields. `PL!SP-bp1-008` adds only a named own-main-stage-member condition plus a fixed bonus draw count: resolve-time scanning is restricted to LEFT/CENTER/RIGHT top members and uses shared card identity matching. `PL!SP-sd1-001` adds the finite `energyPerDraw=6` axis: resolve-time `energyZone.cardIds.length` counts ACTIVE, WAITING, and marker-bearing energy uniformly, the requested draw count is `floor(energyCount / 6)`, and a zero request still consumes the pending ability and returns through unified continuation. This is not an arbitrary predicate/callback or formula-expression axis. Draw-only effects should not be folded into draw-then-discard unless they genuinely share the discard step semantics.

`workflows/shared/on-enter-gain-live-total-score.ts` is the behavior-named family promoted when `PL!SP-sd1-004` became the second real sample after `PL!-bp4-007`. Its stable axes are only `abilityId`, expected base card codes, fixed `countDelta`, condition kind (`SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE` or `ALWAYS`), and action/no-op step names. Both entries revalidate that the concrete source is the controller's correct member in a LEFT/CENTER/RIGHT main-stage slot, then write a target-member-bound player SCORE modifier whose source and target are that same member instance. Different instances stack, the same source/ability is idempotent, slot movement preserves the modifier, standard leave-stage/memberBelow cleanup removes only that instance, and LIVE end clears the family through the common modifier lifecycle.

The 007 configuration still checks at resolution that the successful LIVE zone has at least one card and current effective score at most one; once granted, later successful-zone changes do not revoke it. The 004 `ALWAYS` configuration does not read successful-LIVE facts. This family does not absorb activated grants such as `PL!SP-bp1-003`, target-other-member grants such as `PL!S-bp3-001`, LIVE_START/continuous score families, arbitrary predicates, modifier DSL, or source-stale semantics that allow resolution after the source leaves stage.

`PL!SP-bp1-002` 保持单卡 workflow，因为当前没有第二个真实样本证明「按本次登场事件区域 + 可选固定费用 + 固定抽牌」是稳定 family。LEFT 条件只读 `PendingAbilityState.sourceSlot` 的 ON_ENTER 事件快照，不从结算时卡牌位置反推；实际支付与抽牌分别复用 `payImmediateEffectCosts` 和 `drawCardsForPlayer`。不因此引入任意区域、费用或抽牌 DSL。

Ordinary `waiting-room-to-hand.ts` recovery may carry a finite start threshold and target selector when the surrounding lifecycle remains identical. `PL!SP-bp1-007` adds the concrete `energyZone.cardIds.length >= 11` threshold and mandatory LIVE-only single selection. Eligible recovery continues to use `createWaitingRoomToHandEffectState` and public-card-selection confirmation: first submission reveals without movement, deadline resume performs final owner/zone/type/original-candidate validation, then the workflow moves once and continues pending resolution. This does not create a general condition DSL or replace specialized grouped/cost-bearing recovery families.

Discard-then-draw is a separate shared family when the stable order is private hand multi-selection, optional decline, one grouped hand-to-waiting move, draw count derived from the actual discarded cards or the post-discard hand size, resolve action, then pending continuation. Keep the axes narrow to ability/step ids, selector, min/max selection, Chinese prompt/skip copy, and a small draw-policy union (`discarded count + offset` or `until hand size`). Use `discardHandCardsToWaitingRoomAndEnqueueTriggers`; do not merge this family with draw-then-discard or a general steps DSL. Current real samples are `PL!HS-pb1-003`, `PL!HS-bp1-005`, `PL!HS-PR-031`, and same-text `PL!N-PR-028`; the latter two share one ability identity and workflow configuration.

Arrange-top workflows may share a core when they inspect the deck top, let the player choose an ordered subset for deck top, and move unselected inspected cards to waiting room. The shared summary label can describe 登场, LIVE开始, or LIVE成功 sources, but the workflow must still own only the inspection / ordered deck-top / inspected-to-waiting-room flow. Keep card-specific opt-in costs, such as waiting the source member before inspection, in a thin card wrapper that calls the shared core after the cost has fully resolved.

The DRAFT `PL!S-bp7-008` ON_ENTER ability proves one narrow additional destination axis: after choosing an ordered 0–3-card top subset, every remaining inspected card must be ordered for the deck bottom. `arrange-inspected-deck-edge.ts` owns that second exact-all ordered step and delegates only the final atomic placement to `moveInspectedCardsToDeckTopAndBottom`; a remainder of zero or one resolves without an unnecessary second prompt. This axis does not permit mixed waiting-room placement, arbitrary destinations, partial bottom subsets, or a generic multi-step DSL.

The DRAFT `PL!S-bp7-010-N` 费用4「高海千歌」remains card-owned in `workflows/cards/s-bp7-010-chika.ts`: it privately inspects exactly one bottom card, then offers the two destination results of placing that same card fourth from the top or retaining it at the bottom. The destination choice uses the existing public-effect-choice lifecycle so both players see the selected result before any movement, while the inspected card itself remains private to its owner. The workflow owns the queued ON_ENTER window, private projection, stale revalidation and continuation; `moveInspectedCardToDeckPositionFromTop` owns only the atomic inspection-to-position move, while the bottom result reuses `moveInspectedCardsToDeckTopAndBottom`. This first arbitrary-position inspection sample does not extend `arrange-inspected-deck-edge.ts` or establish a configurable deck-position workflow family.

When such a thin wrapper pays a discard cost before delegating, it may pass the narrow optional `discardedCostCardIds` summary context so STARTED and COMPLETED public summaries report the real cost. The shared arrange core does not select or pay that cost; callers without a discard cost continue to report an empty list.

`CardAbilitySourceZone.WAITING_ROOM` is a narrow source-zone marker for real activated abilities whose source card is in its owner's waiting room. Keep support source-zone-aware in definitions, command validation, and UI entry points; do not broaden it into a generic DSL or trigger matcher surface.

`CardAbilitySourceZone.HAND` is the matching narrow marker for real activated abilities printed as usable only while the source card is in hand. Definitions, command validation, and hand-zone UI entry points should carry the source zone explicitly; the workflow still owns card-specific cost payment, post-cost target checks, and no-target no-op semantics.

Relay-enter draw/discard is a shared on-enter family when the operation is "if this member entered by relay from a named member, draw N then discard M". Keep the relay condition bound to the current pending ability's `relayReplacements` metadata, use `cardNameAliasIs` for the named replacement check, consume the pending ability as a no-op when the condition fails, and delegate the actual draw/discard step to the existing draw-then-discard workflow so hand discards continue to enqueue enter-waiting-room triggers.

`workflows/shared/relay-enter-lower-cost-unit.ts` is only a pure condition helper. It reads the current pending ability's `relayReplacements` event-snapshot costs, the source member's effective cost at resolution, and the replaced cards' structured unit aliases. Payment, modifiers, skip behavior, and pending continuation remain in each card workflow; this helper is not a relay DSL and must not become a runner gate.

`workflows/shared/low-cost-relay-play-hand-member.ts` owns the stable full-flow family proven by `PL!SP-PR-020` and `PL!-PR-015`. Keep the cards' ability identities and Excel effectText separate while sharing the relay snapshot comparison, optional hand selection, empty-slot selection, stale refresh, `playMemberFromZoneToEmptySlot`, ON_ENTER enqueue, and continuation order. The replaced member uses its effective-cost snapshot captured by the production relay action; the entered source uses effective cost at resolution. The hand threshold uses the card's printed cost through `costLte`, not the separate play-cost payment modifier pipeline. Player copy is fixed to “选择要登场的成员 / 登场 / 不登场” and “选择登场区域 / 登场”. Do not add card-number branches or relay gates to the runner.

`workflows/cards/sp-sd1-002-keke.ts` remains a narrow single-card workflow rather than joining that family. It shares only the lower-level `playMemberFromZoneToStageSlotWithReplacement` action because its stable rules are different: any printed-cost-4-or-less Liella! MEMBER in the controller's current hand may be played for no additional cost, occupied slots are allowed, and legal slots are recalculated from the current occupant's `movedToStageThisTurn` identity. Card-effect placement into an occupied slot is not relay, so neither this workflow nor the runtime action calls `canMemberBeRelayedAway` or emits relay/replacement metadata. The runtime action atomically applies duplicate-member cleanup while preserving the rules-facing event order: incoming `ON_ENTER_STAGE`, then the previous member's `ON_LEAVE_STAGE` / `ON_ENTER_WAITING_ROOM`, plus `RULE_ACTION/DUPLICATE_MEMBER`. The workflow owns private hand selection, two-step stale refresh, optional decline, parent-action-before-trigger ordering, and continuation. Do not add persistent slot locks, effective play-cost thresholds, card-code gates, Liella! checks, windows, or pending progression to the runtime helper.

Draw-then-discard may also carry a narrow `requiredSourceSlot` axis for real side-locked on-enter cards. Check the current authoritative source slot before drawing; when the side condition fails, consume the pending ability as a no-op and do not open the discard window.

`workflows/shared/on-enter-choose-draw-discard-or-wait-opponent-low-cost.ts` owns the stable same-text family proven by `PL!-PR-005`, `PL!-PR-006`, and `PL!-PR-008`: a mandatory two-option ON_ENTER window followed by either draw-one-discard-one or an immediate batch change of every matching opponent main-stage member to WAITING. The draw branch delegates `startDrawThenDiscardCardsWorkflow` / `finishDrawThenDiscardCardsWorkflow`; that core exposes only narrow optional `selectionLabel` / `confirmSelectionLabel` copy overrides, leaving all existing registered configs unchanged. The wait branch uses printed-cost selectors, `setMembersOrientation`, and the member-state trigger wrapper, records the resolve action before enqueue, and emits no event for already-WAITING matches. Do not merge this family into `opponent-wait-target.ts`, whose stable contract is a second single-target player-selection window, or into a general branch DSL. Runner ownership remains one import and one register call.

Discard-look-top-select-to-hand may combine an alias selector with `memberOnly` when the real text says "named group/unit member card". Keep the discard cost on `discardOneHandCardToWaitingRoomAndEnqueueTriggers`, then build the reveal selector as `typeIs(CardType.MEMBER)` plus the alias predicate so LIVE cards from the same group remain in the inspected remainder.

`look-top-select-to-hand.ts` may use the finite `minSuccessfulLiveScore` axis when the printed effect gates the existing inspection flow on the controller's successful-LIVE effective score. The starter must call `sumSuccessfulLiveScore` before `inspectTopCards`; a failed threshold consumes only the current pending, records a player-readable condition result, creates no inspection or active effect, and returns through unified continuation. `PL!-bp4-006` is the proving sample with threshold 3, top 5, and `typeIs(MEMBER) + groupAliasIs("μ's")`. This axis is not an arbitrary condition callback, predicate DSL, or generic zone-movement condition.

Opponent wait target is a shared family when the operation is "choose one opponent stage member and change it to WAITING". Keep selector differences, action step, step text, selection/confirmation copy, and proven finite source-side preconditions in config. `PL!N-sd2-013` adds only the resolve-time condition that every occupied own top-level stage slot is a member of one configured group; `PL!N-sd2-019/021` add the printed-cost-at-most selector while retaining the same single-target operation. The workflow may reuse stage-member orientation selection helpers and event-log delta helpers, but it must enqueue `ON_MEMBER_STATE_CHANGED` only after the orientation change and resolve action have been recorded. A queued LIVE_START no-target branch may opt into a narrow `confirmNoTargetWithRealtimeText` axis when the real card has no interaction after target absence; the appended text must describe the current target count and actual no-op result, and real target selection windows must not receive an extra confirm-only wrapper. Do not merge this family into activation-energy or other orientation-changing workflows unless their event timing, target side, and payload fields are identical.

On-enter source-member LIVE modifier is the behavior-named shared family for a mandatory queued ON_ENTER ability whose whole resolution is a fixed SOURCE_MEMBER modifier until LIVE end. `workflows/shared/on-enter-source-member-gain-live-modifier.ts` was promoted from the earlier BLADE-only module when `PL!N-sd2-019` supplied the second modifier kind. Stable axes are ability id, `BLADE` versus `HEART`, fixed amount, HEART color when applicable, action step, and the narrow manual-confirm bridge required by the card's UI timing. It must revalidate the source instance on the controller's top-level stage, use the standard BLADE/HEART modifier helpers, consume stale pending abilities as no-op, and keep target-other-member, conditional, paid, or player-chosen modifiers outside this family.

Stage formation change is a shared family when the operation is "let the player move/swap current own main stage members, then commit the final stage atomically". Keep trigger timing, source zone, pre-draw, condition predicate, unit/group predicates such as "only 5yncri5e! stage members", and action step names in config. The workflow should expose `stageFormation` activeEffect state instead of enumerating `selectableOptions`, consume decline/skip without moving, and apply confirmed `moveHistory` through `rearrangeStageMembersByMoveHistoryAndEnqueueTriggers` so `RESOLVE_ABILITY` is recorded before all `ON_MEMBER_SLOT_MOVED` triggers are enqueued. Do not trust frontend `movedCardIds`: replay history from the current authoritative stage state, ignore same-slot moves, treat swaps as moving both members, and emit at most one moved event per member while preserving the full `moveHistory` in action payloads.

Conditional live modifier is a shared Live-start family when the operation is "open a confirm-only effect window, recompute a condition on confirm, then add/replace/clear Live modifiers". Keep the stable axes in config or local finish functions: counted zone, count threshold, requirement color, modifier target, add/replace/null behavior, start payload fields, and finish payload fields. Reuse activeEffect start glue for the window itself, but do not move card-specific condition checks or modifier strategy into the runtime helper.

Opponent wait target is a shared member-target family for "select one opponent stage member matching a printed selector and change it to WAITING". Stable axes are ability id, target selector, UI labels, start action label, and narrow own-stage gates proven by card text: minimum effective Heart total, minimum different named BiBi members, or minimum printed member cost. Do not add arbitrary predicates, a DSL, or effective-cost semantics. The target must use the stage orientation selection and member-state trigger wrapper; already WAITING or stale targets must not create a state-change event. For no-input LIVE_START no-op branches, the single pending confirmation must show real-time rule counts and result, while ordered resolution continues automatically.

On-move self Heart is a shared AUTO family when the operation is "this moved source member gains one fixed Heart color until Live end". Keep the stable axes to ability id, base card code, Heart color, and action payload labels. The workflow should consume the current `ON_MEMBER_SLOT_MOVED` pending, rely on definition-level `perTurnLimit`, write `SOURCE_MEMBER` Heart through `addHeartLiveModifierForSourceMember`, and avoid filtering out movement caused by an opponent card effect. Do not merge BLADE or conditional movement rewards into this family.

On-move self BLADE is a shared AUTO family when the operation is "this moved source member gains fixed BLADE until Live end". Keep the stable axes to ability id, base card code, BLADE amount, and action step label. The workflow should consume the current `ON_MEMBER_SLOT_MOVED` pending, rely on definition-level `perTurnLimit`, write source-member BLADE through `addBladeLiveModifierForSourceMember`, and leave conditional movement observers or target selection in card-specific workflows.

Member-slot-moved observer glue is allowed only for exact card text that observes movement beyond the ordinary "the moved card's ON_MEMBER_SLOT_MOVED definition always queues" shape, such as requiring a specific `CARD_EFFECT` cause or observing another member entering a particular slot. Register those handlers through `runtime/member-slot-moved-observers.ts`; runner should only call the generic observer hook after the ordinary member-slot-moved path. `PL!SP-pb2-022` proves the narrow multi-event rule: when one controller's swap batch contains an own 5yncri5e! member actually entering CENTER, bind only that matching event and do not create a paired non-matching pending. If the whole swap batch is non-matching, at most one no-op pending may be reserved for the same source; use `runtime/ability-turn-limit.ts` so pending/activeEffect occupy the definition's per-turn capacity consistently with runner queues. Card-specific abilityId, unit, slot and pending construction stay in the workflow handler, not runner. If a definition is only a classification/documentation surface for an observer-owned route, mark it `observerOnly` so the ordinary runner path cannot create unfiltered pending abilities.

Ordinary moved-card AUTO abilities that depend on the source member's orientation at the instant of movement should use `requiredSourceOrientationAtTrigger` on the definition. Every production `MemberSlotMovedEvent`, including both sides of a swap, carries its own `orientationAtMove` snapshot; `runtime/member-slot-moved-triggers.ts` performs the generic match before the runner queues a pending ability. Do not re-read the post-move orientation to decide whether the trigger happened, and do not add card-number branches to the runner.

Activated abilities whose source member must currently have a particular orientation should use definition-level `requiredSourceOrientation`. `runtime/activated-ability-availability.ts` is the shared semantic check for authoritative command validation and the projected/local UI configuration. `runtime/activated-ability-ui.ts` derives the same requirement into `ActivatedAbilityUiConfig`; unconfigured activated abilities retain their existing availability.

For abilities whose printed once-per-turn limit is shared across multiple trigger routes, use the narrow definition queue guard `skipQueueWhenTurnLimitReached` instead of adding ability-id-specific checks in runner. The runner may skip queueing a definition with this flag when `canUseAbilityThisTurn` is already false, but the workflow must still recheck validity and consume stale pending abilities safely.

Resolved-ability observer glue is allowed only for exact card text that triggers after another ability has already recorded `RESOLVE_ABILITY`, such as `PL!-bp6-020`. Register those handlers through `runtime/resolved-ability-observers.ts`; runner should only call the generic observer hook before opening the next pending window. Keep each observer narrow: inspect the latest resolved action, validate the resolved definition category/source zone, source slot, source group, current LIVE card, and per-turn limit, then enqueue a card-specific pending ability. For exact energy-placement observers such as `PL!SP-bp5-004`, only trust an explicit non-empty `placedEnergyCardIds` payload and recheck that those cards are now in the controller's `energyZone`; do not treat paid/tapped energy payloads, energy-below moves, or empty placement arrays as placement triggers. Do not turn this into a broad trigger matcher or steps DSL.

Self position-change is a shared family when the operation is "optionally move this source member to a different member slot, swapping with an occupied target slot if needed". It covers proven on-enter examples through `GENERIC_ON_ENTER_SELF_POSITION_CHANGE_ABILITY_ID` and the `PL!SP-pb2-011` LIVE_START self-move ability id; keep the axes narrow to ability id / trigger timing / source zone. Finish must re-read the source slot, record `RESOLVE_ABILITY`, and use `moveMemberBetweenSlotsAndEnqueueTriggers` so downstream `ON_MEMBER_SLOT_MOVED` abilities can observe both normal moves and swaps.

Activated pay-energy self position-change is a shared family only for the proven pair `PL!SP-bp2-008` and `PL!SP-sd2-002`. Keep the stable axes to ability id, base card code, active energy cost count, and action payload labels. The workflow must pay `TAP_ACTIVE_ENERGY` and record `PAY_COST` before opening the mandatory movement activeEffect; finish must re-read the source stage slot, record the position-change `RESOLVE_ABILITY`, and only then enqueue `ON_MEMBER_SLOT_MOVED` through `moveMemberBetweenSlotsAndEnqueueTriggers`. Do not broaden this into a generic position-change DSL.

Activated wait-self discard-draw is a shared family when the stable operation is "source member ACTIVE -> WAITING, discard exactly one hand card to waiting room, then draw N cards". Keep the axes narrow to ability id, base card codes, and draw count. The source orientation cost must use member-state event enqueue, the hand discard must use the enter-waiting-room trigger wrapper, and no-hand / non-active source failures must happen before paying costs or consuming the turn-once limit.

Wait-self opponent-wait is a shared ON_ENTER / LIVE_START family proven by `PL!N-bp5-004` and the identical-text pair `PL!N-bp3-017` / `PL!N-bp3-023`. The source must still be the controller's ACTIVE main-stage member before it may become WAITING as an optional cost; after payment, the workflow rescans the opponent's main-stage targets and uses the configured selector (`memberPrintedBladeEquals(4)` or `typeIs(MEMBER) + costLte(4)`). Source and target changes both enqueue `ON_MEMBER_STATE_CHANGED`, and a no-target result after payment keeps the paid cost. Keep the family axes to ability ids, target selector, and player-facing target copy; do not expand it into an arbitrary cost/target DSL or merge it into the direct-target `opponent-wait-target` family.

Energy-below effects should first reuse the atomic helpers in `src/application/effects/energy-below.ts`: `stackEnergyFromEnergyZoneBelowMember` for automatic "put N energy from energy zone below this member" costs/effects, and `returnEnergyBelowMemberToEnergyDeck` / `returnEnergyBelowMemberToEnergyDeckForPlayer` for the leave-stage invariant. Do not promote a full shared workflow family until real cards prove stable axes for timing, optional payment, follow-up reward, and no-target behavior.

Original Heart color replacement uses `MEMBER_ORIGINAL_HEART_REPLACEMENT` as a Live modifier for "this member's printed original Heart becomes the chosen color". `getMemberEffectiveHeartIcons` applies that replacement to the printed Heart total before appending normal member Heart bonuses; it is not a PLAYER Heart write or a member "gain Heart" bonus.

Live-start target-member original Heart fixed-color replacement is a shared family proven by `PL!HS-bp5-021` and `PL!S-bp7-024`. Keep the stable axes finite: `abilityId`, source base card code, structured group alias plus player-facing group name, fixed `HeartColor` plus mapped Heart token, and action payload labels. The workflow must query only the controller's three top-level main-stage members with `typeIs(MEMBER) + groupAliasIs`, consume a zero-target pending safely, and open a mandatory public single-card selection whenever at least one legal target exists—even when there is exactly one. Confirmation revalidates the source LIVE and current legal target before writing `MEMBER_ORIGINAL_HEART_REPLACEMENT`; normal member Heart bonuses remain appended and the standard LeaveStage cleanup owns target-instance lifetime. Do not expand this family to player-chosen colors, source-self replacement after a cost, copying another card's full printed Heart pattern, ordinary Heart gain, arbitrary target predicates, or a general modifier DSL.

Original Blade count replacement uses `MEMBER_ORIGINAL_BLADE_REPLACEMENT` as a Live modifier for "this member's printed original Blade count becomes N". `getMemberEffectiveBladeCount` applies the latest replacement as the original Blade count first, then appends normal member Blade bonuses; it is not equivalent to adding or subtracting a BLADE modifier, because printed Blade counts above the replacement value must also be overwritten.

Revealed-cheer selection is a shared family when the operation is "choose cards revealed by the current cheer and still in the processing zone, then move them or perform additional cheer". Keep selector differences, destination, min/max count, optional/skip behavior, additional-cheer count calculation, whether a successful move records a turn-once ability use, and payload field names in config. Reuse `effects/cheer-selection.ts` for current-cheer eligibility and `effects/cheer.ts` for additional cheer; do not reimplement resolution-zone movement, cheer context checks, or the non-recursive additional-cheer guard inside a workflow.

On-cheer no-BLADE-HEART gain-Heart is a narrow shared AUTO family proven by `PL!SP-bp2-015/020/021`. Keep the stable axes to ability id, Heart color, and action step. Resolve only the pending-linked own normal `CheerEvent`, require at least one actually revealed own card, and use `hasBladeHeart()` across every blade-heart entry, including ALL, SCORE, and DRAW. The condition reads `revealedCardIds` event facts even after cards leave `resolutionZone`; a valid normal cheer consumes turn1 even when a BLADE HEART makes the condition fail, while no event/zero own reveals/additional cheer/source departure does not. Write only a source-bound `SOURCE_MEMBER` Heart modifier and do not add activeEffect or confirm-only UI.

On-cheer same-group member triple gain-Hearts is a narrow shared AUTO family proven by `PL!N-PR-023` and `PL!S-PR-040`. Keep separate ability identities and definition text while sharing only the no-input resolver. Read the pending-linked own normal `CheerEvent.revealedCardIds` history, de-duplicate card ids, accept only own member cards with structured `getCardGroupIdentityKeys`, and require one canonical group bucket to contain at least three different members; do not group by unitName or replace event facts with the current movable revealed set. A valid source/event consumes turn1 even when the threshold fails; additional/opponent/missing events and stale sources do not. Write one `SOURCE_MEMBER` modifier containing pink and green Heart and continue through the unified scheduler without activeEffect.

Cheer reroll is a narrow shared family proven by `PL!S-bp2-004` and `PL!S-bp3-020`, and remains separate from revealed-cheer selection. Its finite configuration axes are ability id, source requirement (`STAGE_MEMBER` or own `LIVE_CARD`), condition kind (`NO_LIVE` or at-most-N Blade-Heart cards), the threshold, whether every historical revealed card must still be the exact movable set, and stable player-facing step text. The family reads the pending-linked normal `CheerEvent` fact, uses shared public display with `REVEALED_CHEER -> WAITING_ROOM`, records source-instance turn1 only after the complete move, rerolls with the original `totalBlade`, and explicitly enqueues the replacement `additional=false` event through the normal `ON_CHEER` path. Do not add arbitrary callbacks, a condition DSL, generic steps, different costs, selectable subsets, or continuation scripts. `replaceCurrentCheerCards=true` replaces only the acting player's current cheer IDs; default/false remains additive registration and opponent IDs remain unchanged.

Cheer-card Heart color replacement is a shared no-input LIVE_START family for effects that say cards revealed by your own cheer have specific Heart colors treated as another Heart color until LIVE end. Real samples are `PL!SP-bp4-023`, `PL!N-bp4-025`, and stage-member source `PL!-bp8-005`. Keep the stable axes to `abilityId`, definition-owned card coverage, `fromColors`, `toColor`, confirm/preview text, action step label, and a narrow source-availability query. The default source gate remains the controller's `liveZone`; the member sample explicitly supplies its top-level stage check. The workflow owns manual confirm-only versus ordered-resolution behavior, writing `CHEER_CARD_HEART_COLOR_REPLACEMENT`, `RESOLVE_ABILITY` payload, and `continuePendingCardEffects`. Do not fold in VIVID WORLD's LIVE_SUCCESS score check, Dazzling Game's member BLADE selection, or other LIVE_START modifier families.

LIVE-start cheer-count adjustment is a narrow shared no-input family in `workflows/shared/live-start-cheer-count.ts`. `PL!-pb2-039` proves the confirmable path: its card workflow owns the concrete “successful LIVE zone has at least two structured μ’s cards and the source remains in liveZone” query. Existing `PL!SP-bp2-010` proves the legacy immediate path and explicitly opts out of the confirmation bridge. The shared layer owns `CHEER_COUNT` modifier creation, action payload, and unified continuation. Configuration is limited to ability id, integer delta, action label, condition context, player-visible preview copy, and the finite `CONFIRMABLE / NONE` confirmation mode; do not add arbitrary rewards, target selection, additional-cheer execution, or a generic condition DSL.

Success-zone placement prohibitions are not workflow families by themselves. Keep pure "can this LIVE enter SUCCESS_ZONE" rules in `domain/rules/success-live-placement.ts`, and call them from the natural success Live selection, replacement candidates, exchange candidates, and manual move validation. If the same card also has a LIVE_SUCCESS reward, implement that reward as a normal workflow wrapper, as `PL!S-bp2-024` does with draw-then-discard.

Choose-player / bottom-one-waiting-LIVE / draw-one is a narrow shared family proven by `PL!S-bp3-007` and `PL!S-PR-041`. Its stable core is: the effect controller chooses self or opponent, selects exactly one LIVE from that player's waiting room, publishes that choice through the shared deadline confirmation, revalidates owner/zone/type/original-candidate membership after resume, moves the card to that player's main-deck bottom, then draws one for the effect controller only after a successful move. Keep the activated entry's main-phase/current-player/stage-source gates, `[E]` and special-energy payment, turn1 use, activatedUi, action/payload contract, and legacy persisted step IDs separate from the queued ON_ENTER entry's no-cost/no-limit pending consumption, orderedResolution, and unified continuation. Do not add arbitrary zone, destination, reward, or step DSL axes. `PL!N-bp3-010` is excluded because it selects up to two ordered members with no draw; `PL!S-bp2-008` is excluded because it only targets its controller's waiting room, allows zero or one LIVE, and has no draw.

Example shape:

```ts
export function startSelfSacrificeRecoverWorkflow(game, params): GameState {
  const config = getSelfSacrificeRecoverConfig(params.abilityId);
  // send source member to waiting room
  // create recover selection step
}

export function finishSelfSacrificeRecoverWorkflow(game, input): GameState {
  // validate activeEffect and selected card
  // move waiting-room card to hand
  // clear activeEffect and continue pending
}
```

## Card-Specific Workflow

Loveca 很多卡是复杂复合效果，不需要强行塞进 family。对于无稳定同型的特殊卡，可以一张卡一个 workflow 文件。

Example:

```text
src/application/card-effects/workflows/cards/hs-bp5-003-rurino.ts
```

This file may export:

```ts
export function startHsBp5003RurinoLiveStart(...)
export function finishHsBp5003RurinoDiscard(...)
export function finishHsBp5003RurinoTarget(...)
```

Rules:

- 特殊卡 workflow 可以包含卡文分支逻辑。
- 仍必须复用 runtime action 和 query helper。
- 不重复实现候选可见性、手牌移动、pending 继续等基础设施。
- 不为了 family 化把参数塞爆；特殊卡独立文件是可接受目标态。

## Runner Dispatch

### LIVE_SUCCESS availability gate

`runtime/live-success-ability-availability-gates.ts` 是只作用于入队前的窄 registry：按
`abilityId` 注册 predicate，未注册的能力默认允许。runner 只在 LIVE_SUCCESS 循环中调用通用
查询；gate 为 false 时不构造 pending，也不记录 `TRIGGER_ABILITY`。它不结算效果、不构造
pending、不推进队列，也不承载卡牌专属条件。当前真实样本是 `PL!S-bp2-008`：其单卡 workflow
用该 gate 判断自己 LEFT/CENTER/RIGHT 顶层成员是否均为不同名 Aqours，再决定授予的 pseudo
LIVE_SUCCESS ability 是否入队。

Target start dispatch:

```ts
const PENDING_EFFECT_STARTERS = {
  [HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID]: startHsBp5003RurinoLiveStart,
};
```

Target step dispatch:

```ts
registerActiveEffectStepHandler(
  HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID,
  HS_BP5_003_SELECT_DISCARD_STEP_ID,
  finishHsBp5003RurinoDiscard
);
```

Runner should not need to know the internal step sequence of the workflow.

## Workflow File Checklist

Each workflow module should make these facts easy to see:

- handled ability ids
- trigger or activated entry point
- step ids it owns
- runtime helpers it uses
- metadata it writes
- no-target behavior
- whether selection is optional or mandatory
- tests that cover it

## Tests

Preferred tests:

- Keep behavior tests in `tests/integration/sample-card-effect-runner.test.ts` when the workflow spans pending / activeEffect.
- Add focused unit tests for runtime helper behavior.
- Keep ability registration tests in `tests/unit/card-effect-classification.test.ts`.

Workflow extraction should preserve existing tests. If behavior changes are intended, they must be a separate, explicitly reviewed change.

# conditional LIVE draw-one family

`workflows/shared/conditional-live-draw-one.ts` is the behavior-named family proven across `PL!N-bp4-003`, `PL!S-bp3-005`, `PL!-bp4-001`, and `PL!-bp4-023`. It owns the shared LIVE_START/LIVE_SUCCESS and STAGE_MEMBER/LIVE_CARD pending lifecycle, source-safe resolution, confirm-only/manual bridge, ordered continuation, real-time condition reread, and one-card draw through `drawCardsForPlayer`.

Its finite discriminated-union configuration has only the ability id, expected base card codes, source kind, condition type, exact action/no-op step labels, and condition-specific structured values needed for confirmation text. The proven conditions are LIVE score, event-inclusive cheer counts, stage effective-cost totals, and a specified remaining-HEART color with existing rebalance semantics; it is not a general condition callback or DSL.

# conditional-live-modifier 的成员登场次数配置

- `PL!N-bp3-005` 是该 family 的 player-level SCORE 样本：manual confirm-only 预览与最终 finish 均实时调用成员登场事件 query；modifier key 由 `kind + playerId + sourceCardId + abilityId` 区分，不绑定 `liveCardId`。
- replacement 后以旧值和新值的 delta 刷新 `liveResolution.playerScores`，保证 resolver 重入不重复累计、不同来源实例可以叠加。

# conditional-live-modifier 的跨区不同名团体成员必要 Heart 配置

`PL!HS-pb1-026` 与 `PL!SP-bp1-026` 共用同一有限配置 family：稳定轴仅为 `abilityId`、`groupAlias`、玩家显示团体名、不同名阈值、固定泛用必要 Heart 减少量与 action step。两者都只扫描控制者 LEFT/CENTER/RIGHT 顶层成员和休息室成员，先用结构化团体 matcher 过滤，再用共享 card identity matcher 为多名称成员分配不同名；不统计 memberBelow、对方区域或其他区域。

manual confirm-only 预览与最终结算都实时重算数量和来源 LIVE 状态；条件成立时只替换同一 `liveCardId + sourceCardId + abilityId` 的 `REQUIREMENT RAINBOW` modifier，不清除其他来源。本 family 不接受 callback，不表达任意区域、selector、modifier 类型或条件 DSL。

# live-start-score-bonuses 的能量阈值配置

`PL!SP-bp1-027` 和 `PL!SP-sd1-026` 是该 shared workflow 的有限 `minEnergyCount` 样本，分别配置 12 和 9；稳定轴仅为 `abilityId`、能量张数阈值、固定 SCORE 增量与 action step。确认窗口和最终 resolver 都读取控制者当前 `energyZone.cardIds.length`，因此 ACTIVE、WAITING 和特殊能量都按张数计入；条件成立时 replacement 写入绑定来源 LIVE 实例与 ability 的 SCORE modifier，并只按新旧差值刷新 `playerScores`，所以 resolver 重入不重复累计，而结算后的能量变化不会撤销既得分数。两个阈值按 abilityId 隔离，不扩展成任意 predicate 或分数条件 DSL。

# LIVE_START 自身待机后中央 μ's 获得 BLADE family

`workflows/shared/live-start-wait-self-center-muse-gain-blade.ts` 由第二个真实样本 `PL!-bp4-011` 触发晋升；原 `PL!-bp4-017` 单卡 workflow 与 focused test 已迁入行为命名 shared ownership。稳定参数轴仅为 `abilityId`、`bladeAmount` 与兼容 action step：两张卡都固定由来源自身从 ACTIVE 变 WAITING 作为可选费用，固定查询自己中央结构化 μ's 成员，并写目标成员 BLADE modifier。当前不泛化团体、区域、费用状态或 modifier 类型。

该 family 使用“发动 / 不发动”且不生成固定来源的 `selectableCardIds`；打开窗口与确认发动时都重查来源，支付走成员状态事件 wrapper，支付后才重读中央目标。来源自身位于中央时，变为 WAITING 后仍可成为目标；中央无合法目标时保留费用并正常继续 pending。

# conditional-live-modifier 的中央 μ's 有效 BLADE 分数配置

`PL!-bp4-022` 在 confirm-only 与最终结算时都读取当前中央结构化 μ's 成员，并通过 `collectLiveModifiers` + `getMemberEffectiveBladeCount` 使用印刷 BLADE、临时 modifier 与 replacement 后的有效值。满足 9 个阈值且来源 LIVE 仍合法时，用绑定来源 `liveCardId` 的 SCORE replacement 写 +2；`playerScores` 只按旧/新 modifier 差值刷新，重复结算不累计，条件失效会清理旧状态。玩家动态文案只展示中央身份、有效 BLADE、条件与实际 +2/+0，不展示来源区域门禁。

# ON_ENTER_STAGE AUTO 的换手事实过滤

`OnEnterStageTriggerFilter.enteredViaRelay` 只比较已发生的 `EnterStageEvent` 事实：`relayReplacements` 非空，或 legacy `replacedMemberCardId` 存在时视为换手。ON_ENTER_STAGE AUTO source 同时传递 `enteredFromZone`，并在入队前通用应用 definition `triggerFromZones`。未配置这两个轴的既有 AUTO 保持原行为；workflow 不应回查最近事件或根据槽位替换情况猜测换手。`PL!N-PR-025` 是首个组合 `triggerFromZones: [HAND]` 与 `enteredViaRelay: true` 的生产样本。

# Waiting-room ON_ENTER delegation

`activate-waiting-room-member-on-enter-ability.ts` 是窄 shared family，不是 ability DSL。它只委托显式审计并 opt-in 的已实现、queued、`ON_ENTER`/`PLAYED_MEMBER` definition；目标留在休息室，来源槽位为空，不创建真实登场事件，费用仍由原 workflow 支付。

该范围默认拒绝且并不覆盖所有历史/未来合法成员。后续新增费用4以下的虹ヶ咲或 Liella! 成员及新的已实现 ON_ENTER workflow 形状时，维护者应单独审计来源费用、槽位和 continuation，再决定是否 opt-in；普通 ON_ENTER workflow 无需感知本特殊机制。

# Activate-own-stage-member family

`workflows/shared/activate-own-stage-member.ts` 承担“从控制者三个主舞台槽中至多选择1名当前非 ACTIVE 成员并变为 ACTIVE”的稳定可选流程。配置只保留 abilityId、stepId，以及来源在结算时是否仍须位于己方舞台：`PL!-bp3-001` 的 LIVE_START 保留来源 gate，`PL!S-bp3-010/011` 的 ON_ENTER 入队后不要求来源仍在场。状态变化统一走成员状态事件 wrapper，并通过统一 continuation 返回检查时点。这里没有 callback、任意条件组合或 steps-lite，因此是行为命名的 shared workflow，不是通用状态变化 DSL。

# Optional pay-energy look-top-select-to-hand family

`workflows/shared/optional-pay-energy-look-top-select-to-hand.ts` 当前服务顶3同文组 `PL!SP-bp1-012`、`PL!SP-sd1-008`、`PL!SP-sd1-017`，以及第二种真实配置 `PL!SP-sd1-009`。稳定边界固定为：ON_ENTER queued、可选支付 1 张 ACTIVE 能量、`topCount` 只接受 3 或 5、可选支付成功后的能量区总张数门槛、实际有卡时强制私密选择恰好 1 张加入手牌、余牌成组进入休息室。支付只调用 `payImmediateEffectCosts(TAP_ACTIVE_ENERGY, 1)` 并记录实际 `energyCardIds`；支付后门槛按当前 `energyZone.cardIds.length` 重读；检视、refresh、选择入手、`MAIN_DECK -> WAITING_ROOM` 事件和 continuation 委托 `look-top-select-to-hand.ts`。

配置只保留 abilityId、支付/选择 stepId、`topCount`、可选的支付后 `minEnergyCount` 与 action/玩家步骤文案。本 family 不接受任意费用数、费用 callback、条件 callback、selector callback、公开确认模式、通用步骤解释器或 steps DSL。所选卡不公开，不接 public-card-selection confirmation；支付成功后门槛不足、卡组不足、无检视卡或 stale 选卡都不会回滚费用。ON_ENTER 来源在入队后离场沿用现有 queued 触发语义，不额外增加来源存活 gate。

# Higher-score place-waiting-energy family

`workflows/shared/higher-score-place-waiting-energy.ts` 由 `PL!HS-bp1-023` 的旧单卡 workflow 在新增 `PL!SP-bp1-023` 第二个真实样本时晋升。稳定核心是 queued LIVE_SUCCESS 在最终结算时重读 `liveResolution.playerScores`，只接受自己严格高于对方，重验来源 LIVE 的 owner、类型和当前 LIVE 区，然后通过 `placeEnergyFromDeckToZoneByCardEffect` 放置 1 张 WAITING 能量并统一 continuation。

配置轴只保留 abilityId、预期基础编号、action step，以及可选的结构化 `requiredStageGroupAlias`。HS 样本配置 `groupAliasIs('蓮ノ空')` 并只扫描己方 LEFT/CENTER/RIGHT 顶层成员；SP 样本不配置团体条件。manual confirm-only 文案实时展示双方分数、适用时的团体状态、能量卡组是否有牌与实际结果；最终 resolver 不信任开窗快照。旧 HS abilityId、definition 文本和 action/payload 兼容字段保持不变。

# LIVE_START 选择目标成员获得 BLADE family

`workflows/shared/live-start-target-member-gain-blade.ts` 由 `PL!S-bp2-025-L` 分数1「青空Jumping Heart」的旧单卡 workflow 在加入第二、第三个真实基础编号时晋升。当前样本为：025 从己方 LIVE 区来源、成功 LIVE 卡区至少2张、任选己方主舞台成员 BLADE +2；`PL!-bp4-014-N` 费用9「星空 凛」从己方主舞台来源、己方 LIVE 区存在印刷文本不持有 LIVE_START/LIVE_SUCCESS 的 LIVE、排除来源自身后 BLADE +2；`PL!-bp4-024-L` 分数2「小夜啼鳥恋詩」从己方 LIVE 区来源、无额外条件、只选结构化 μ's 主舞台成员 BLADE +1；`PL!N-bp7-025-SECL` 分数1「Colorful Dreams! Colorful Smiles!」选择结构化虹咲成员 BLADE +1；`PL!SP-bp7-025-L` 分数3「Memories」选择拥有「嵐千砂都」姓名身份的成员 BLADE +1。

稳定配置轴仅为 `abilityId`、来源区域（`STAGE_MEMBER` / `LIVE_CARD`）、可选 exact 来源卡号、BLADE 数量、有限目标身份（`ANY / GROUP_ALIAS / CARD_NAME_ALIAS`）、是否排除来源、三种有限条件判别与已映射 BLADE 玩家文案。团体使用 `groupAliasIs`，姓名使用 `cardNameAliasIs` 读取卡牌全部结构化姓名组件；family 不接受任意 selector callback、条件 AST、modifier 类型或通用步骤 DSL。所有目标都通过 `getStageMemberCardIdsMatching` 只扫描 LEFT/CENTER/RIGHT 顶层成员。BLADE 写入使用显式 `addBladeLiveModifierForTargetMember`：`sourceCardId` 保留真实发动的 LIVE/成员实例，受益者始终写入 `targetMemberCardId`，即使二者是同一实例也不折叠为 SOURCE；已结算 modifier 不随来源离区清除，但随目标离场、替换或实例重登清除。

0目标消费 pending no-op，单目标自动结算，多目标打开不可跳过的单选窗口且不叠 confirm-only。确认时重新扫描来源区域、条件和目标，不信任旧 selectable 快照；原合法目标、来源或条件 stale 时清窗且不写 BLADE，再通过统一 continuation 返回检查时点。

# LIVE 区印刷时点能力 query

`domain/rules/live-zone-ability.ts#hasLiveWithoutLiveStartOrSuccessAbility` 是只读 `GameState` 的游戏级 query：仅扫描指定玩家当前 LIVE 区中 owner 正确的合法 LIVE 实例，并按 `cardText` 印刷文本识别中日 LIVE_START / LIVE_SUCCESS 标记，不查询 ability definition 的实现状态。`PL!-bp4-002` 的 continuous modifier 与 `PL!-bp4-014` 的 shared workflow 是当前两个真实消费者；query 不创建 pending、activeEffect 或 modifier。

# 卡组底全匹配后获得来源成员 Heart family

`workflows/shared/mill-bottom-all-match-gain-source-member-hearts.ts` 由 `PL!S-bp7-006-P` 费用2「津岛善子」、`PL!S-bp7-015-N` 费用5「津岛善子」与 DRAFT `PL!S-bp7-017-N` 费用4「小原鞠莉」三个真实样本建立。稳定轴仅为 base card code / abilityId、卡组底移动数量、窄条件（`GROUP_MEMBER + Aqours`、`CARD_TYPE + LIVE` 或 `MEMBER + printed cost >= 10`）与 Heart 集合；Heart 固定写给 `SOURCE_MEMBER`。family 允许已证明的 `LIVE_START / ON_ENTER` 入口差异，不把 timing 写进 workflow 名称。

family 复用 direct top-mill 的公开结果形状：实际卡组底移动与分组等待室事件完成后，以 Public Reveal Dwell 向双方展示真实 `movedCardIds`；展示窗口打开时尚未写 Heart，展示结束后才按实际移动数与卡牌身份写 modifier 并统一 continuation。该定时公开展示取代纯 confirm-only，手动点选也不会双弹窗；移动前仍不预读或展示隐藏底牌。`PL!S-bp7-011` 的 WAIT 费用、再活跃与 BLADE 奖励不进入该 family；本 family 也不包含抽牌、加分、LIVE 必要 Heart 修改、声援方向或任意奖励 DSL。

# bp7 bottom-mill 后 requirement / draw / score 单卡样本

`PL!S-bp7-020-SECL` 分数3「快乐派对火车」与 `PL!S-bp7-021-L` 分数5「我们的旅程永不落幕」只共享第一批 refresh-aware bottom helper，不形成新的 shared reward family。020 的底1 Aqours MEMBER 后必要[無ハート]-1 留在 `cards/s-bp7-020-happy-party-train.ts`；同卡公开的“己方主舞台成员全部 ACTIVE”段扩展 `conditional-live-modifier.ts`，以至少1名顶层成员避免空集合误判。021 留在 `cards/s-bp7-021-bokura-no-tabi-wa-owaranai.ts`，结算时重查三名顶层成员门槛，完整移动5张后按实际 MEMBER 数抽牌并以 replacement 写来源 LIVE SCORE。

`PL!S-bp7-022-SECL` 分数8「想在水族馆恋爱」保持单卡 LIVE_SUCCESS workflow `cards/s-bp7-022-koi-ni-naritai-aquarium.ts`。声援方向是 domain 纯 query 与统一公开入口的规则责任，不在 workflow/runner 传 `useBottom` 布尔值。LIVE_SUCCESS 复用 `selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts` 的逐卡 event-inclusive 有效判心事实，再由 `evaluateDistinctCheerCardsCoverHeartColors` 对三色不同 cardId 做确定性小型回溯；成员卡的印刷 `hearts`、DRAW/SCORE 等非 HEART 判定不计入，它只表达“不同卡覆盖所需判心颜色”，不是图算法框架或 Heart DSL。结果以来源 LIVE SCORE replacement 和 `playerScores` 差值刷新结算，动态 confirm-only 只显示三色判心候选数、三张不同卡匹配结果与实际分数。

声援判心条件统一分为四层：`selectCurrentLiveRevealedCheerCardIds` 只提供本次 event-inclusive 公开卡事实；`selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts` 为每张卡应用当前 LIVE modifier 后返回有效判心；`collectCurrentLiveRevealedCheerBladeHeartColors` 处理步梦、Colorful 一类颜色并集；`evaluateDistinctCheerCardsCoverHeartColors` 处理水族馆一类不同实例分配。Love U my friends 一类“存在有效 ALL”的条件直接从逐卡有效判心做窄聚合，不套用颜色并集或不同卡分配。除非卡文明确参照原本/印刷信息，禁止在这类 workflow 中直接读取 `card.data.bladeHearts` 或使用 `hasAllBladeHeart()` 等印刷 selector；印刷 selector 仍可用于成功 LIVE 卡区等不受声援颜色替换影响的区域。新增或修改这类卡效时至少补一组颜色替换 modifier 回归，证明能力仍正常诱发并消费 pending/turn1，但结算条件按有效颜色成立或失败；固定颜色集合还必须覆盖 GRAY/ORANGE 不会意外抬升旧卡阈值。

020 与 021 都在移动及标准分组事件入队后打开 Public Reveal Dwell，窗口期间不写必要 Heart、抽牌或 SCORE modifier。020 展示结束后才按公开的实际移动卡是否为结构化 Aqours MEMBER 写来源 LIVE requirement replacement；021 展示结束后才按公开的5张中 MEMBER 数量执行0奖励、抽1或抽1且来源 LIVE SCORE +1。两者都不在移动前预读或展示隐藏底牌，舞台不足3名时 021 仍以动态 confirm-only 说明不移动。两个 workflow 本身不承担从卡组底声援；该机制已由 `PL!S-bp7-022-SECL` 分数8「想在水族馆恋爱」的独立 direction query 与统一 cheer helper 覆盖。本边界仍不实现其他 bp7、不建立任意 bottom reward DSL，也不改变第一批 gain-heart family 的 ownership。

# arrange-inspected-deck-edge 的卡组边缘轴（2026-07-23）

- 原顶牌 family 已迁为 `workflows/shared/arrange-inspected-deck-edge.ts`。现有配置缺省 `TOP`，旧 abilityId、stepId、选择顺序、公开摘要与回归语义不变。
- 当前公开版本 `PL!S-bp7-004-P` 费用13「黑泽黛雅」是首个 `BOTTOM` 样本，效果按基础编号覆盖：`inspectBottomCards` 以“最下方在前”建立私密 inspection；玩家 ordered selection 的数字1为最终最下方，未选牌经 bottom inspection wrapper 作为单组 `MAIN_DECK -> WAITING_ROOM` 事件进入休息室。
- `inspectDeckEdge`、selected/unselected destination 是有限枚举轴；不要加入任意 zone callback。卡组顶公开摘要仍限 `TOP`，底部流程不得复用带“卡组顶”含义的 summary。
- 同卡登场段仍是窄单卡 `workflows/cards/s-bp7-004-dia.ts`：definition 的 `playedMemberOnEnterTriggerFilter` 只用换手事件快照和被替换成员的结构化 Aqours 身份决定是否入队；双方手牌选择、洗切置底和各抽3不进入 edge arrange family。

# ON_ENTER 舞台有效费用门槛抽牌 family

`workflows/shared/member-on-enter-draw.ts` 现由 `PL!-bp3-009` 费用2「矢澤にこ」与当前公开版本 `PL!S-bp7-002-P` 费用4「樱内梨子」证明“主舞台有效费用门槛后登场抽牌”配置；后者按基础编号覆盖。稳定轴仅为 `abilityId`、`drawCount`、最低有效费用、可选团体条件与 action step；三个主舞台顶层通过 `getMemberEffectiveCost` 实时查询，团体通过 `cardBelongsToGroup` 结构化判定。

两张卡都在 manual confirm-only 和最终 resolver 时实时重扫，动态文案只显示符合成员数、满足状态与实际抽牌数。已合法入队后不要求来源仍在场，不计 memberBelow、对方或其他区域。无条件旧配置继续只展示原卡文，不追加资源统计。这不是任意 ON_ENTER 条件 DSL。

# ON_MEMBER_SLOT_MOVED 来源成员 BLADE family

`workflows/shared/on-move-gain-blade.ts` 的实际配置轴为 `abilityId`、BLADE `amount` 与 action step。`PL!SP-sd2-011` 费用4「鬼冢冬毬」、`PL!HS-bp5-014-N` 费用4「安養寺 姫芽」保持 +1，当前公开版本 `PL!SP-bp7-014-N` 费用4「岚千砂都」配置 +2且按基础编号覆盖。family 只在来源自身移动事件入队后结算，不按 `triggerPlayerId` 过滤，次数保持来源实例语义。

来源在事件后、结算前失效，或 `addBladeLiveModifierForSourceMember` 返回 null 时，family 删除当前 pending、记录不含成功 `bladeBonus` 的 no-op `RESOLVE_ABILITY`，再回到统一 continuation；不改变其他 pending 顺序。玩家卡文/确认文案不暴露该引擎安全原因。本 family 不扩展为通用移动奖励 DSL。

# BP7 memberBelow 与委托序列边界（2026-07-18）

- 卡效将成员放到舞台主成员下方时，workflow 先用结构化 selector 产生候选并处理公开/交互，最后才调用 `stackMemberCardBelowStageMember`。helper 仅做 `HAND / WAITING_ROOM -> memberBelow` 原子移动和 stale 防线。
- 普通 continuous collector 仍只扫描舞台顶层成员；memberBelow 来源必须 exact 登记。所有 BLADE / HEART modifier 必须显式声明 `PLAYER / SOURCE_MEMBER / TARGET_MEMBER`，不允许通过缺失 target、来源卡类型或 source/target ID 相等性推断作用域。`SOURCE_MEMBER` 表示来源成员本身就是受益者；选择或指定成员即使选中来源自身也仍为 `TARGET_MEMBER`，并分别保存真实 `sourceCardId` 与 `targetMemberCardId`。能力指定受益成员时使用对应 `...ForTargetMember` 具名入口；source 离场不清除已授予的 TARGET，target 离场才清除，PLAYER 不绑定成员。
- 舞台成员的窄 ON_ENTER 查询只兼容已实现 queued definition 的历史 `PLAYED_MEMBER / STAGE_MEMBER` 两种 sourceZone，并按真实 source slot 检查 `requiredSourceSlots`。`PL!S-pb1-001`、`PL!S-pb1-002`、`PL!S-bp5-004` 有 focused 合法样本；这不是等待室虚拟登场 policy。
- `delegated-ability-sequence` 只接受已选定的 queued ON_ENTER pending 列表，每个子项重验真实舞台实例、槽位和当前 definition。进展只认真实 `activeEffect`、游戏终局、sequence 清空，或 remaining/resolved/skipped 实际继续推进；仅新增 actionHistory 或替换 pending 数组不算进展。子项 stale、starter 缺失或委托无进展均记录 no-op 并继续，审计分别保存 pending ID 与 abilityId。它不伪造登场事件、不支付普通登场费用、不接受任意 timing 或卡文解析。

# BP7 energyBelow 第三批边界（2026-07-19）

- 四张卡保留各自 card-owned workflow：004 为起动费用后选对方成员，005 为有条件强制二选一，007 为 continuous + LIVE_SUCCESS manual-confirmable，019 为 LeaveStage replacement 事件事实；触发、交互和 continuation 不同，不晋升成批次 shared workflow。
- 004 继续复用 `stackEnergyFromEnergyZoneBelowMember` 的 ENERGY_ZONE→energyBelow 与 WAITING-first/特殊 marker 选择；日文权威卡文为“能量区”，不采用公开中文 API 的“能量卡组”。
- 005/007/019 只共享 `placeEnergyFromEnergyDeckBelowStageMember` 原子动作。target 必须是当前己方顶层成员，移槽跟随实例；离场、换手、替换的既有生命周期会让 energyBelow 返回能量卡组。
- 005 第一分支卡文是“将2张能量变为活跃状态”，不提供0～2张自由选择；WAITING 不足2张时通用动作才尽可能处理实际数量。已展示的分支或目标确认时 stale 会记录 no-op、消费精确 pending 并统一 continuation；从未展示的伪造输入继续保持原窗口。
- 007 第二段只读 `own energyZone.cardIds.length - 6`，不计 below/deck/对方。所有 BP7 definition、workflow gate 与 continuous registry 均使用基础编号匹配。
- energyBelow 放置不复用 `ON_ENERGY_PLACED_BY_CARD_EFFECT`，因为该事件当前专指放置入能量区。
  后续 `PL!N-bp7-001` 落地了独立的 `ON_ENERGY_PLACED_BELOW_MEMBER`：只覆盖卡牌效果实际完成的
  `ENERGY_ZONE -> MEMBER_SLOT`，由统一 wrapper 在事件发生时 exact dispatch 并写
  `DISPATCH_TRIGGER_EVENT` 台账；从能量卡组放到成员下方仍不触发。该窄事件边界不是完整能量
  事件体系或任意 below DSL。

# LIVE 开始返还1能量后比较数量加分 family（2026-07-23）

`workflows/shared/live-start-return-one-energy-compare-score.ts` 只覆盖两个已证明的 LIVE 基础编号样本（当前公开版本如下）：

- `PL!S-bp7-023-L` 分数4「夜空是否全然知晓？」：己方三个主舞台顶层至少2名结构化 Aqours 才可发动；返还后对方能量多1张时 SCORE +1，多至少2张时 SCORE +2。
- `PL!SP-bp7-027-L` 分数5「What a Wonderful Dream!!」：返还后自己的能量严格多于对方时 SCORE +1。

family 的有限配置轴仅为 `abilityId` / `baseCardCode`、可选的团体+最少人数舞台门槛，以及 `OPPONENT_AHEAD_TIERED` / `CONTROLLER_AHEAD` 两种比较模式；不接受条件或奖励 callback。返还完整复用 `createOptionalEnergyReturnWindow` / `resolveOptionalEnergyReturn`，因此普通能量按既有顺序自动选取，特殊 skip marker 候选需要精确选择，移动只产生一次带精确 IDs/cause 的 `ON_ENERGY_MOVED_TO_DECK` 事件。

来源在开窗和确认时都必须按基础编号匹配且仍位于控制者 LIVE 区；S023 的门槛只统计 LEFT/CENTER/RIGHT 顶层成员，不计 memberBelow、对方或其他区域。数量比较在返还能量成功后读取实时双方 `energyZone.cardIds.length`。SCORE 通过来源 LIVE + ability identity replacement 写入并按差值同步 `playerScores`，重复结算不会累加旧 modifier。门槛不满足或无能量时使用 confirm-only 玩家窗口并在确认后消费当前 pending；伪造/重复/stale 选择保持原窗口。

`PL!SP-bp7-027-L` 的 LIVE 成功段不进入该 family，而由窄单卡 workflow 调用 waiting-energy placement helper；runner 仍只负责 import/register 与注入统一 trigger enqueue。

# LIVE 成功时能量差加分 family（2026-07-25）

`workflows/shared/live-success-energy-difference-score.ts` 由第二个真实样本 `PL!SP-bp7-024` 分数2「WE WILL!!」触发晋升；旧 `PL!S-bp6-022-L` 分数7「近未来ハッピーエンド」的比较切片已从 Aqours 大 workflow 迁入。两个样本固定为无输入 queued LIVE_SUCCESS、比较双方当前能量张数、条件成立时仅给来源 LIVE `[スコア]+1`：

- `PL!S-bp6-022-L` 保持旧 exact `L` 来源覆盖，对方至少多1张时成立。
- `PL!SP-bp7-024` 按基础编号覆盖，自己至少多2张时成立。

有限配置轴仅为 `abilityId`、exact/base 来源覆盖、领先方 `SELF / OPPONENT`、最小差值与稳定 action step；分数奖励固定为1，不接受任意比较 callback、奖励公式、modifier 类型或条件 DSL。manual confirm-only 实时展示双方能量数量、满足状态与实际 `[スコア]+1/+0`，手动 pending 点选使用同一 bridge，ordered batch 自动结算。最终 resolver 重验来源 owner、LIVE 类型、配置卡号与当前 LIVE 区，再重算比较；SCORE 使用 `liveCardId + sourceCardId + abilityId` replacement，并仅按新旧 modifier 差值刷新 `playerScores`，因此重复进入不会累计。来源门禁只用于引擎安全，不进入玩家文案。runner 只负责 import/register。

# BP7 第三、第四批 workflow 边界（2026-07-23）

- `PL!N-bp7-026-SECL` 分数5「Just Believe!!!」保留单卡 workflow：弃牌数、等量目标选择与第二段 event-inclusive 无 BLADE HEART 声援计数是同卡专属编排；底层只复用标准弃牌事件、结构化 selector、目标型 BLADE 与 replacement SCORE，不扩成任意“按支付数选择目标”DSL。
- `PL!SP-bp7-028-L` 分数8「能够听见未来的声音」保留单卡 workflow。精确9张是公开区域集合选择；由于当前输入域没有 unordered multi 枚举，`ORDERED_MULTI` 仅承载一次多选提交，玩家标签与 public confirmation 不表达顺序，实际置底前必须洗切所选子集并忽略提交顺序。LIVE 成功的“全部为 Liella!”明确要求本次自己至少公开1张声援卡，避免空集合真值。
- 当前公开版本 `PL!N-bp7-030-L` 分数0「Cheer Mode」的检视段只向 `arrange-inspected-deck-edge.ts` 增加一个 TOP 配置与基础编号 LIVE 来源轴；有序回顶、余牌成组入休息室、短牌库和 stale 输入保持 family 既有语义。回手弃1段由单卡 workflow 持有，runtime 只提供窄 LIVE_ZONE→HAND 原子移动。
- `PL!S-bp7-025-L` 分数3「Guilty Night, Guilty Kiss!」使用 card-owned effectChoice 编排；低费用过滤读取印刷费用，目标只限对方顶层舞台，skip marker 只写给真实变为 WAITING 的成员及其控制者。没有把“二选一 + 目标动作/抽牌”推广为 callback family。
- 四张卡的 runner 接线均为 import/register；条件、交互、移动、modifier 与事件处理不进入 runner。

# PR 第1至第4批 workflow 边界（2026-07-23）

- `PL!HS-PR-036-PR` 费用5「大泽瑠璃乃」、`PL!N-PR-032-PR` 费用5「优木雪菜」、`PL!S-PR-044-PR` 费用5「高海千歌」建立 `fill-waiting-room-to-eight-optional-milled-live-to-deck-top.ts`。稳定形状仅为：结算开始时固定捕获 `8 - waitingRoom.length`、refresh-aware direct mill、后段只从本次 movedCardIds 中选择0或1张仍在休息室的 LIVE、公开确认后置顶。它不接受任意目标张数、任意 selector、目的地 callback 或奖励 DSL。
- `PL!S-PR-045-PR` 费用11「津岛善子」作为 `relay-enter-draw-discard.ts` 的第二类真实条件轴，只增加 `REPLACED_MEMBER_EFFECTIVE_COST` 与既有 `REPLACED_MEMBER_NAME` 的有限 union；费用只读 ON_ENTER 事件快照，不在结算时重算。抽牌、弃牌、刷新与进入休息室事件继续由 `draw-then-discard` family 承担。
- `PL!-PR-020-PR` 费用13「高坂穗乃果」与 `PL!SP-PR-026-PR` 费用13「鬼冢夏美」扩入 `conditional-live-modifier.ts`。动态 confirm-only 与最终 resolver 都读取 `live-zone-score.ts`，结算再次重验来源仍为己方中央；满足时只写来源实例绑定的玩家 LIVE 合计 SCORE +1。本配置不是任意区域分数表达式或 modifier DSL。

# 2026-07-27 BP7 API-only 单卡边界

- `PL!N-bp7-008-P` 费用15「艾玛·维尔德」保留单卡 ON_ENTER 编排：有序休息室选择走既有 WAITING_ROOM→MAIN_DECK_BOTTOM wrapper，能量处理走既有普通/特殊能量选择；不建立“移动任意牌后按张数做任意动作”的 family。
- `PL!N-bp7-029-L` 分数7「Burn!!」保留单卡 LIVE_SUCCESS 选择、来源校验和 SCORE 奖励。仅把“当前顶层成员下方完整能量堆原子放入能量区，并发出一个标准 placement event”沉到 `effects/energy-below.ts`；helper 不承担卡号、窗口、门槛、分数或 continuation。
- 两张卡均按基础编号覆盖，公开 API 为卡文权威来源；本地 `cards.json` 与当前 Excel 没有记录。runner 只增加 import/register。

# 2026-08-06 DRAFT 第三批 shared 边界

- `stage-formation-change.ts` 只增加已证明的团体条件与“本次真实移动指定团体成员后给来源 BLADE”有限奖励轴。`PL!S-bp7-012` 的判定读取 atomic rearrange 返回的 `rearrangedMembers`，同槽输入、skip 或来源 stale 不伪造奖励；未增加任意奖励 callback。
- `activated-self-position-change.ts` 仅持有强制自身站位变换窗口、来源／恋授予资格复核、标准 slot-moved wrapper 与 stale-after-cost continuation。它不知道能量费用种类；旧 `activated-pay-energy-self-position-change.ts` 与新 `PL!SP-bp7-022` 分别在开窗前支付活跃能量 `[E]` 费用或返回能量费用。
- `runtime/public-card-selection-confirmation.ts` 的 `distinctGroupAssignment` 是显式 opt-in：开启时，一张实体卡即使具有多小队身份也只能贡献一个 selection group，通过小型回溯查找可行一对一分配。缺省关闭，不改变旧 grouped-recovery 语义；当前只有 `PL!SP-bp7-012` 使用。
- `PL!S-bp7-011` 的“来源 WAIT 费用 + 底2 + 再活跃 + BLADE”与 `PL!SP-bp7-012` 的“三小队各1张置底后抽1”保持卡牌专属 workflow；只复用事件 wrapper、公开停留、选择确认和统一 continuation，不为本批构造任意步骤 DSL。
