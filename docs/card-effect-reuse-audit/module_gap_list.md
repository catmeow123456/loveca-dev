# Loveca card effect module gap list

审查日期：2026-06-13  
本文件基于 `loveca_effect_fragments_catalog.json` 回扫当前已实现卡牌。它只列 Stage 1A-1F 之后仍值得追踪的缺口；已经有主模块的片段不再作为 P0-now 抽象任务重复列出。

## Closed or substantially reduced by staged refactors

| fragments | current module | status |
|---|---|---|
| `F07,F08,F09` | `src/application/effects/zone-selection.ts` + `card-selectors.ts` | 当前 `WAITING_ROOM -> HAND` 单选路径已成为主路径，覆盖 001/002/003/005，并已用 `PL!-pb1-019-N` 费用 2「高坂穗乃果」与 `PL!-bp4-003-P` 费用 2「南琴梨」验证非预组起动扩样本。后续扩多选、其他来源/目标区域即可。 |
| `T01,F07,F09` | `src/application/effects/zone-selection.ts` + `card-selectors.ts` | `LL-bp1-001-R+` 费用 20「上原步梦&涩谷香音&日野下 花帆」登场段已落地；暂未实现：`T02/C08/B05/X05`（同卡其他段）。 |
| `C01,C02,C03,C04,E01` | `src/application/effects/effect-costs.ts` | 弃手、横置能量、自送休息室已外移。未来补标准 GameEvent，而不是回到单卡手写。 |
| `F03,F04,F05,F06,F13` | `src/application/effects/look-top.ts` | 看顶/公开/清理/顶牌入休息室原语已外移。`PL!HS-PR-001-PR` 费用 10「日野下花帆」登场段已落地；`PL!-bp3-010-N` 费用 9「高坂穗乃果」登场段和 live-only 公开筛选已落地；`F04` 仍在其他卡的 runner orchestration。 |
| `F01,F02` | `src/application/effects/draw.ts` + runner 抽弃壳 | 当前卡效抽牌到底座已覆盖 007 的额外抽 1；F02 已由 `PL!SP-bp4-008-P` 费用 13「若菜四季」左侧登场与 `PL!HS-bp1-006-P` 费用 11「藤岛 慈」登场验证抽 2 弃 1。`F12` 与更复杂抽弃语义等待真实样例。 |
| `B03,B05,B07,B08,T05` | `src/domain/rules/live-modifiers.ts` | Live modifier 主写入路径已建立，legacy fields 是兼容投影。 |
| `S01,S02,S05,S07` | `src/application/effects/member-state.ts` | 成员状态/站位变换/卡效登场原语已建立；Karin position change 与 `PL!SP-bp4-008-P` 费用 13「若菜四季」LIVE 开始可选站位变换均已复用，`PL!SP-bp5-003-AR` 费用 17「岚 千砂都」验证批量成员活跃，`PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」验证选择 1 名待机舞台成员变活跃，`PL!S-bp2-006-P` 费用 11「津岛善子」验证从休息室登场到空槽。 |
| `E02,E03` | `src/application/effects/energy.ts` | 能量卡组顶 -> 能量区放置原语已建立，支持指定活跃/待机状态；能量区方向变更原语也已建立。当前覆盖 `PL!SP-PR-004-PR` 费用 4「唐 可可」的待机能量放置、`PL!SP-bp4-008-P` 费用 13「若菜四季」右侧登场的待机能量变活跃、`PL!SP-bp5-003-AR` 费用 17「岚 千砂都」LIVE 开始全部能量变活跃，以及 `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」登场选择能量分支后自动处理至多 2 张待机能量。能量没有个体差异，不要求玩家逐张选择具体能量卡。 |
| `X11` | `src/domain/rules/cost-calculator.ts` | Stage 1L 已起步：登场费用修正会在规则层生成基础费用、修正后费用、修正明细、换手减免与最终支付方案；`LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」已验证按其他手牌数量减费且自身不计入，`PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」已验证舞台存在待机状态『虹咲』成员时自身 -2 费，`PL!SP-bp5-003-AR` 费用 17「岚 千砂都」已验证舞台来源使手牌中 10 费 Liella! 成员登场费用 -2 且先减费再换手。 |
| `T06,S08` | `src/application/card-effect-runner.ts` trigger enqueue + look-top primitives | Stage 1O 已起步：`PL!HS-bp2-012-N` 费用 5「乙宗 梢」验证舞台成员进休息室触发 AUTO，复用 pending ability 队列与 look-top 检视/公开/入手原语；被换手替换时与新登场成员能力共享顺序选择窗口。 |

## Remaining gaps

| priority | fragment_ids | proposed module / next action | current locations | notes |
|---|---|---|---|---|
| P0-next | `T06,S08,S09` broader AUTO event layer | Standard `GameEvent` + trigger matcher | current `ON_LEAVE_STAGE` proving path is action-history / explicit-source driven | `PL!HS-bp2-012-N` 费用 5「乙宗 梢」已完成第一条 S08 proving，但完整移动事件、状态变化事件、trigger matcher、when-if、每回合限制仍需后续真实 AUTO 样例推动。 |
| P1-soon | `C07,X02,L01,L02` | Reveal-from-hand + conditional exchange step | `PL!-sd1-006-SD` resolver | 仍然 inline。低频但清晰，适合在需要 C07/交换效果时做；当前不影响 Stage 1A-1F 主路径。 |
| P1-soon | `X01,X04,X05,X06,X13` | Condition/query AST | 001 success Live condition, 009 waiting room μ's count, 022 success Live scaling, 004/015 selectors, Karin cost selector | Selector 已有基础；condition 还没有统一表达。建议等下一批非 `PL!-sd1` 样例出现重复条件时再抽。 |
| P1-soon | `X03,B03` | Generic option-choice effect step | 003 Live-start Heart choice, `PL!N-pb1-008-P+` 费用 17「艾玛·维尔德」target branch | UI shape 已支持 `selectableOptions`，艾玛已验证选项分支后进入成员目标选择或直接结算能量分支；尚未抽成 declarative option resolver。可在第三张选择颜色/模式的卡出现时再抽。 |
| P1-soon | `F03,F04,F05,F13` workflow orchestration | Declarative look-top workflow config | 004/015/019/Karin runner orchestration | 原语已外移；下一步不是再移动底层函数，而是把 `lookN`、selector、reveal、rest destination、ordered selection 等变成 ability config。 |
| P1-soon | `B05,B07,B08,T05` condition-bound builders | Typed Live modifier builders and continuous registry config | 001/009/022 effect-specific condition + builder code | `addLiveModifier` / `replaceLiveModifier` 已是主写入路径；下一步是减少每张卡的手写 condition/build payload。 |
| P1-soon | `F12` | Draw-then-deck-placement composed steps | none yet | F02 抽 2 弃 1已有第一条 proving path；F12 继续等待实际样例验证 deck placement 与 refresh semantics。 |
| P1-review | `T05,B08` for Karin | Decide sample partial vs real-card full implementation | `PL!N-pb1-004-P+` only has Live-start ability in code | Catalog 有“本回合未移动时 +2 BLADE”。若果林继续只是测试用样例，可以保留 partial 标注；若按实卡实现，则补 continuous modifier + moved-this-turn condition。 |
| P2-later | unmatched/P2 special fragments | Custom resolver hook with explicit boundaries | none urgent | 继续允许低频特例留在 runner，但内部必须复用 cost/selector/look-top/move/modifier APIs。 |

## Still-inline implemented effects

| card | inline part | why not migrated yet |
|---|---|---|
| `PL!-sd1-006-SD` | 公开手牌 Live，成功区 Live 入手，公开牌放成功区 | 涉及 C07、条件“如此做”、双区域交换；当前只有一个 proving card。 |
| `PL!HS-PR-001-PR` 费用 10「日野下花帆」 | LIVE开始时支付 `[E][E]` 获得 `[BLADE]` 段 | 登场段已落地；LIVE开始时可支付 `[E][E]`，LIVE结束时为止获得 `[BLADE]` 的片段暂未实现。 |
| `PL!-sd1-003-SD` | Heart color option step | UI 支持已存在，但还没有第二个选择型效果证明通用 API 形状。 |
| `PL!-sd1-004-SD` | 公开被选 Live 后确认入手的流程串联 | look-top 原语已复用；workflow config 尚未抽。 |
| `PL!-sd1-009-SD` | 休息室 μ's >=25 条件 | condition AST 尚未建立。 |
| `PL!-sd1-022-SD` | 成功 Live 数 * 2 的 reduction builder | live modifier 写入已统一；倍率/条件表达仍在 resolver。 |
| `PL!N-pb1-004-P+` | 顶 1 路由条件、费用 <=9 selector、catalog continuous 未实现 | Live-start 主行为已复用 look-top/member-state；完整实卡常时效果待决策。 |
| `PL!SP-PR-004-PR` | 可选弃手后放置待机能量的流程串联 | C01 与 E03 原语已复用；完整 step pipeline 尚未配置化。 |
| `PL!SP-bp4-008-P` 费用 13「若菜四季」 | 左侧/右侧登场确认流程仍在 runner 串联 | 来源槽位条件、F02 抽弃组合步骤、E02 能量方向 helper 已复用；LIVE 开始 S05 已通过通用站位变换壳复用 `member-state.ts`。 |
| `LL-bp2-001-R+` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」 | 无法因换手放置入休息室；LIVE 开始弃指定姓名手牌获得 BLADE | 费用减少 X11 已落地；换手禁止属于 `X08` 边界，LIVE 开始段需要指定姓名手牌弃置与按支付数量缩放 BLADE，后续分批做。 |
| `S07` / 非手牌方式登场 | 更多来源区域与事件 ordering 边界 | `PL!S-bp2-006-P` 费用 11「津岛善子」已验证从休息室登场后继续触发被登场成员自己的登场能力；当前通过 `enqueueTriggeredCardEffects` 显式登场来源入队，触发逻辑不写进 S07 移动原语。后续扩卡组/成功区/能量下方等来源时，继续复用同一入口并补 ordering 样例。 |
| `PL!HS-bp2-012-N` 费用 5「乙宗 梢」 | AUTO look-top workflow orchestration 与完整事件层 | 已完成最小 `ON_LEAVE_STAGE` 能力；看顶5公开成员入手流程仍在 runner 串联，完整 declarative look-top workflow 与标准 `GameEvent` 后续再抽。 |

## Next non-`PL!-sd1` proving candidates from catalog

这些候选来自 catalog 回扫，优先选择已有底座可覆盖、风险较低、能证明“不是只为 μ's 预组写死”的卡。

| candidate | fragments | why useful |
|---|---|---|
| `PL!HS-PR-002-PR` 费用 10「村野さやか」 | `T01,C01,F03` | 同上，可作为第二张同构样例，验证配置化而不是单卡分支。 |

已可继续选择真实 AUTO 样例扩边界，但仍不建议一次性上完整事件系统、对手目标或 refresh 语义；保持一张卡一条事件边界的小步节奏。
