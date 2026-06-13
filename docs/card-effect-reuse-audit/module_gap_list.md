# Loveca card effect module gap list

审查日期：2026-06-13  
本文件基于 `loveca_effect_fragments_catalog.json` 回扫当前已实现卡牌。它只列 Stage 1A-1F 之后仍值得追踪的缺口；已经有主模块的片段不再作为 P0-now 抽象任务重复列出。

## Closed or substantially reduced by Stage 1A-1F

| fragments | current module | status |
|---|---|---|
| `F07,F08,F09` | `src/application/effects/zone-selection.ts` + `card-selectors.ts` | 当前 `WAITING_ROOM -> HAND` 单选路径已成为主路径，覆盖 001/002/003/005。后续扩多选、其他来源/目标区域即可。 |
| `C01,C02,C03,C04,E01` | `src/application/effects/effect-costs.ts` | 弃手、横置能量、自送休息室已外移。未来补标准 GameEvent，而不是回到单卡手写。 |
| `F03,F04,F05,F06,F13` | `src/application/effects/look-top.ts` | 看顶/公开/清理/顶牌入休息室原语已外移。完整 workflow 仍在 runner，但底层移动不再是纯单卡逻辑。 |
| `F01` | `src/application/effects/draw.ts` | 当前卡效抽牌到底座已覆盖 007 的额外抽 1。`F02/F12` 等待真实样例。 |
| `B03,B05,B07,B08,T05` | `src/domain/rules/live-modifiers.ts` | Live modifier 主写入路径已建立，legacy fields 是兼容投影。 |
| `S01,S02,S05` | `src/application/effects/member-state.ts` | 成员状态/站位变换卡效原语已建立；Karin position change 已迁移。 |

## Remaining gaps

| priority | fragment_ids | proposed module / next action | current locations | notes |
|---|---|---|---|---|
| P0-deferred | `T06,S08,S09` | Stage 1G `GameEvent` + trigger matcher | cost/effect/move helpers currently mutate and record actions without standard event emission | 已按用户决策暂缓：μ's 预组缺少合适 AUTO proving case。后续遇到真实自动能力卡牌时再设计并验证。 |
| P1-soon | `C07,X02,L01,L02` | Reveal-from-hand + conditional exchange step | `PL!-sd1-006-SD` resolver | 仍然 inline。低频但清晰，适合在需要 C07/交换效果时做；当前不影响 Stage 1A-1F 主路径。 |
| P1-soon | `X01,X04,X05,X06,X13` | Condition/query AST | 001 success Live condition, 009 waiting room μ's count, 022 success Live scaling, 004/015 selectors, Karin cost selector | Selector 已有基础；condition 还没有统一表达。建议等下一批非 `PL!-sd1` 样例出现重复条件时再抽。 |
| P1-soon | `X03,B03` | Generic option-choice effect step | 003 Live-start Heart choice | UI shape 已支持 `selectableOptions`，但 resolver 仍是专用步骤。可在第二张选择颜色/模式的卡出现时抽。 |
| P1-soon | `F03,F04,F05,F13` workflow orchestration | Declarative look-top workflow config | 004/015/019/Karin runner orchestration | 原语已外移；下一步不是再移动底层函数，而是把 `lookN`、selector、reveal、rest destination、ordered selection 等变成 ability config。 |
| P1-soon | `B05,B07,B08,T05` condition-bound builders | Typed Live modifier builders and continuous registry config | 001/009/022 effect-specific condition + builder code | `addLiveModifier` / `replaceLiveModifier` 已是主写入路径；下一步是减少每张卡的手写 condition/build payload。 |
| P1-soon | `F02,F12` | Draw-discard and draw-then-deck-placement composed steps | none in current μ's precon proving set | 不提前实现。等实际卡牌样例验证 hand selection、deck placement、refresh semantics。 |
| P1-review | `T05,B08` for Karin | Decide sample partial vs real-card full implementation | `PL!N-pb1-004-P+` only has Live-start ability in code | Catalog 有“本回合未移动时 +2 BLADE”。若果林继续只是测试用样例，可以保留 partial 标注；若按实卡实现，则补 continuous modifier + moved-this-turn condition。 |
| P2-later | unmatched/P2 special fragments | Custom resolver hook with explicit boundaries | none urgent | 继续允许低频特例留在 runner，但内部必须复用 cost/selector/look-top/move/modifier APIs。 |

## Still-inline implemented effects

| card | inline part | why not migrated yet |
|---|---|---|
| `PL!-sd1-006-SD` | 公开手牌 Live，成功区 Live 入手，公开牌放成功区 | 涉及 C07、条件“如此做”、双区域交换；当前只有一个 proving card。 |
| `PL!-sd1-003-SD` | Heart color option step | UI 支持已存在，但还没有第二个选择型效果证明通用 API 形状。 |
| `PL!-sd1-004-SD` | 公开被选 Live 后确认入手的流程串联 | look-top 原语已复用；workflow config 尚未抽。 |
| `PL!-sd1-009-SD` | 休息室 μ's >=25 条件 | condition AST 尚未建立。 |
| `PL!-sd1-022-SD` | 成功 Live 数 * 2 的 reduction builder | live modifier 写入已统一；倍率/条件表达仍在 resolver。 |
| `PL!N-pb1-004-P+` | 顶 1 路由条件、费用 <=9 selector、catalog continuous 未实现 | Live-start 主行为已复用 look-top/member-state；完整实卡常时效果待决策。 |

## Next non-`PL!-sd1` proving candidates from catalog

这些候选来自 catalog 回扫，优先选择已有底座可覆盖、风险较低、能证明“不是只为 μ's 预组写死”的卡。

| candidate | fragments | why useful |
|---|---|---|
| `LL-bp1-001-R＋` 上原歩夢&澁谷かのん&日野下花帆 | `T01,F07,F09`; also `T02,C08,B05,X05` on another segment | 登场“从休息室回收成员”是 zone-selection 的最干净非 `PL!-sd1` proving case；Live-start 分数 +3 可作为后续 B05/费用约束样例。 |
| `PL!HS-PR-001-PR` 日野下花帆 | `T01,C01,F03` | 与 011/012/016 类似的看顶 3 选 1，适合验证 look-top workflow 不依赖 μ's 预组卡号。 |
| `PL!HS-PR-002-PR` 村野さやか | `T01,C01,F03` | 同上，可作为第二张同构样例，验证配置化而不是单卡分支。 |
| `PL!HS-bp2-002-P` 村野さやか | `T01,F07,F09,X06` | 从休息室回收至多 2 张低费用成员，可推动 zone-selection 从单选扩到多选。 |
| `PL!-bp3-010-N` 高坂穂乃果 | `T01,C01,F04` | 看顶 5 公开 Live 入手，接近 004 但非预组；适合验证 F04 workflow config。 |
| `PL!-pb1-019-N` 高坂穂乃果 | `T03,C04,F07,F09` | 自送休息室回收成员，与 002 同型；适合确认 effect-costs + zone-selection 不依赖 starter deck。 |

暂不建议马上选需要 `AUTO`、复杂 event、对手目标或 refresh 语义的卡，避免 Step 12 暂缓期间扩大行为面。
