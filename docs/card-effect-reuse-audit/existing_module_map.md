# Loveca card effect implementation registry

审查日期：2026-06-14

本文件是卡效完成状态登记册，按“基础编号”记录。Loveca 中同基础编号不同罕度视为同一张卡，例如 `PL!HS-bp1-004-P` / `PL!HS-bp1-004-R+` / `PL!HS-bp1-004-SEC` 均归为 `PL!HS-bp1-004`。

相关文档：

- 模块覆盖与 helper 边界：`docs/card-effect-reuse-audit/effect_module_coverage.md`
- 同构批量扩样本：`docs/card-effect-reuse-audit/card_effect_batch_expansions.md`
- 缺口与下一步：`docs/card-effect-reuse-audit/module_gap_list.md`

## Status Legend

| status | meaning |
|---|---|
| 完整已实现 | 当前已知中文效果文本均已实现，并已同步同基础编号罕度。 |
| 部分已实现 | 至少一段效果已实现，但仍有明确未实现段。 |
| 同型已实现 | 作为低风险同构扩样本，当前同型文本段已实现；详情见 `card_effect_batch_expansions.md`。 |
| 测试样例 partial | 用于验证框架的样例卡，未承诺完整实卡文本。 |

## Same-Base Rarity Sync

当前卡效登记支持 `baseCardCodes`。后续新增卡效时，若 `llocg_db/json/cards_cn.json` 中同基础编号不同罕度效果文本一致，应优先登记基础编号，而不是只登记单一罕度。

自动保护：

- `tests/unit/card-effect-rarity-sync.test.ts` 会扫描 `CARD_ABILITY_DEFINITIONS` 与 `llocg_db/json/cards_cn.json`。
- 如果某个 ability 用 exact `cardCodes` 只覆盖了同基础编号的一部分罕度，测试会失败。
- 费用修正中涉及同基础编号的逻辑也已改用基础编号判断。

## Main Registry

| 基础编号 | 同编号罕度覆盖 | 费用/分数与卡名 | 状态 | 已实现效果段 | 未实现/备注 | 主要 ability / 测试 |
|---|---|---|---|---|---|---|
| `PL!-sd1-001` | 当前登记基础编号 | 费用 7「高坂穗乃果」 | 完整已实现 | 登场回收 LIVE；常时按成功 LIVE 数增加 BLADE 判定张数。 | 成功 LIVE 条件仍在 resolver 中，不影响当前行为。 | `HONOKA_ON_ENTER_ABILITY_ID`；continuous modifier registry；`tests/unit/live-modifiers.test.ts` |
| `PL!-sd1-002` | 当前登记基础编号 | 费用 2「绚濑绘里」 | 同型已实现 | 起动：自送休息室，从休息室回收 1 张成员。 | 同构批量见 batch 文档。 | `ELI_ACTIVATED_ABILITY_ID`；`tests/integration/sample-card-effect-runner.test.ts` |
| `PL!-sd1-003` | 当前登记 exact | 费用 7「南琴梨」 | 完整已实现 | 登场回收低费 μ's 成员；LIVE 开始弃 1 手牌选择 Heart 颜色。 | Heart option 流程仍在 runner 串联。 | `KOTORI_ON_ENTER_ABILITY_ID`、`KOTORI_LIVE_START_HEART_ABILITY_ID` |
| `PL!-sd1-004` | 当前登记 exact | 费用 11「园田海未」 | 完整已实现 | 登场检视顶 5，可公开 1 张 LIVE 加入手牌，其余入休息室。 | workflow 配置化未抽。 | `UMI_ON_ENTER_ABILITY_ID` |
| `PL!-sd1-005` | `SD / RM` 已同步 | 费用 2「星空凛」 | 同型已实现 | 起动：自送休息室，从休息室回收 1 张 LIVE。 | 同构批量见 batch 文档。 | `RIN_ACTIVATED_ABILITY_ID`；`tests/unit/card-effect-rarity-sync.test.ts` |
| `PL!-sd1-006` | 当前登记 exact | 费用 8「西木野真姬」 | 完整已实现 | 登场公开手牌 LIVE、成功区 LIVE 入手、如此做后交换区域。 | C07/交换流程仍是 bespoke。 | `MAKI_ON_ENTER_ABILITY_ID` |
| `PL!-sd1-007` | 当前登记 exact | 费用 7「东条希」 | 完整已实现 | 登场公开顶 5 入休息室，其中有 LIVE 则抽 1。 | 是否翻到 LIVE 的条件仍在 resolver 中。 | `NOZOMI_ON_ENTER_ABILITY_ID` |
| `PL!-sd1-008` | 当前登记基础编号 | 费用/分数未登记「小泉花阳」 | 完整已实现 | 起动每回合 1 次支付 2 能量，将卡组顶 10 张入休息室。 | 每回合限制为来源卡实例级。 | `HANAYO_ACTIVATED_ABILITY_ID` |
| `PL!-sd1-009` | 当前登记 exact | 费用 11「矢泽妮可」 | 完整已实现 | LIVE 开始按休息室 μ's 条件获得分数 +1。 | 条件仍手写，未抽 condition AST。 | `NICO_LIVE_START_SCORE_ABILITY_ID` |
| `PL!-sd1-011 / 012 / 016` | 当前登记基础编号 | 费用 4「绚濑绘里」等 | 同型已实现 | 登场弃 1 手牌，检视顶 3，必选 1 张加入手牌，其余入休息室。 | 同构批量见 batch 文档。 | `GENERIC_DISCARD_LOOK_TOP_ABILITY_ID` |
| `PL!-sd1-015` | 当前登记基础编号 | 费用 4「星空凛」 | 完整已实现 | 登场弃 1 手牌，检视顶 5，可公开 1 张成员加入手牌，其余入休息室。 | workflow 配置化未抽。 | `GENERIC_DISCARD_LOOK_TOP_ABILITY_ID` |
| `PL!-sd1-019` | 当前登记 exact | 分数 4「START:DASH!!」 | 完整已实现 | LIVE 成功时检视顶 3，任意张按顺序回卡组顶，其余入休息室。 | ordered workflow 仍在 runner。 | `START_DASH_LIVE_SUCCESS_ABILITY_ID` |
| `PL!-sd1-022` | 当前登记 exact | 分数 4「僕らは今のなかで」 | 完整已实现 | LIVE 开始按成功 LIVE 数减少必要 Heart。 | 倍率表达仍在 resolver。 | `BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID` |
| `PL!-bp3-010` | 当前登记 exact | 费用 9「高坂穗乃果」 | 完整已实现 | 登场弃 1 手牌，检视顶 5，可公开 1 张 LIVE 加入手牌，其余入休息室。 | workflow 配置化未抽。 | `BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID` |
| `PL!-bp4-003` | `P / R` 已同步 | 费用 2「南琴梨」 | 同型已实现 | 起动：自送休息室，从休息室回收 1 张 LIVE。 | 原先 `P/R` 分散在两个 ability；现按基础编号统一。 | `BP4_003_ACTIVATED_ABILITY_ID`；`tests/unit/card-effect-classification.test.ts` |
| `PL!-pb1-019` 等成员回收同型 | 已同步同基础编号罕度 | 费用 2「高坂穗乃果」等 | 同型已实现 | 起动：自送休息室，从休息室回收 1 张成员。 | 详细卡表见 batch 文档。 | `PB1_019_ACTIVATED_ABILITY_ID` |
| `LL-bp1-001` | 当前登记 exact `R+` | 费用 20「上原步梦&涩谷香音&日野下花帆」 | 部分已实现 | 登场从休息室回收 1 张成员。 | LIVE 开始弃合计 3 张指定姓名并得分 +3 未实现。 | `LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID` |
| `LL-bp2-001` | 当前登记 exact `R+` | 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」 | 部分已实现 | 手牌中的自身按此卡以外的手牌数量每张费用 -1。 | 无法因换手放置入休息室、LIVE 开始弃指定姓名手牌获得 BLADE 未实现。 | `cost-calculator.ts`；`tests/unit/cost-calculator.test.ts` |
| `PL!N-pb1-004` | `P+ / R` 已同步 | 费用 11「朝香果林」 | 测试样例 partial | LIVE 开始公开顶 1，费用 9 以下成员加入手牌并进行站位变换，否则入休息室。 | catalog 常时“未移动时 +2 BLADE”未实现。 | `KARIN_LIVE_START_ABILITY_ID` |
| `PL!N-pb1-008` | `P+ / R` 已同步 | 费用 17「艾玛·维尔德」 | 完整已实现 | 手牌中自身费用减少；登场选择 1 名成员或至多 2 张能量变为活跃。 | 能量分支按能量区顺序自动处理。 | `EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID`；`cost-calculator.ts` |
| `PL!SP-PR-004` | 当前登记 exact | 费用 4「唐 可可」 | 完整已实现 | 登场可弃 1 手牌；如此做时从能量卡组顶放置 1 张待机能量。 | 流程串联仍在 runner。 | `KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID` |
| `PL!SP-bp4-008` | `P / P+ / R+ / SEC` 已同步 | 费用 13「若菜四季」 | 完整已实现 | 左侧登场抽 2 弃 1；右侧登场将 2 张能量变活跃；LIVE 开始可站位变换。 | 来源槽位条件走 `requiredSourceSlots`。 | `SHIKI_*` abilities |
| `PL!SP-bp5-003` | `AR / P / R+ / SEC` 已同步 | 费用 17「岚 千砂都」 | 完整已实现 | 舞台来源使手牌中费用 10 的 Liella! 成员登场费用 -2；中心位 LIVE 开始将 Liella! 成员与能量全部变活跃。 | 本地 `系统边界混合` 缺少合适 10 费 Liella! 目标，费用段用构造数据验证。 | `CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID`；`cost-calculator.ts` |
| `PL!S-bp2-006` | `P / R` 已同步 | 费用 11「津岛善子」 | 完整已实现 | 登场可支付 4 能量，从休息室选择至多 2 张费用合计小于等于 4 的成员登场到空槽。 | 不走普通登场费用/换手；非手牌方式登场会继续触发被登场成员登场能力。 | `YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID` |
| `PL!HS-PR-001` | 当前登记基础编号 | 费用 10「日野下花帆」 | 部分已实现 | 登场弃 1 手牌，检视顶 3，选 1 入手，其余入休息室。 | LIVE 开始支付 `[E][E]` 获得 BLADE 未实现。 | `GENERIC_DISCARD_LOOK_TOP_ABILITY_ID` |
| `PL!HS-bp1-004` | `P / P+ / R+ / SEC` 已同步 | 费用 15「夕雾缀理」 | 完整已实现 | 起动每回合 1 次支付 3 能量回收「莲之空」LIVE；LIVE 开始支付 1 能量按 LIVE 区数量获得 BLADE。 | 无合法目标时起动不支付、不占次数。 | `HS_BP1_004_*` abilities |
| `PL!HS-bp1-006` | `P / P+ / R+ / SEC` 已同步 | 费用 11「藤岛 慈」 | 完整已实现 | 登场抽 2 弃 1；LIVE 开始弃 1 手牌，若有其他成员则选择任意普通 Heart 颜色获得 Heart。 | Heart option 流程仍在 runner。 | `HS_BP1_006_*` abilities |
| `PL!HS-bp2-002` | `P / P+ / R+ / SEC` 已同步 | 费用 13「村野沙耶香」 | 完整已实现 | 登场从休息室回收至多 2 张费用小于等于 2 的成员。 | 多选上限已由 zone selection 支持。 | `HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID` |
| `PL!HS-bp2-012` | 当前登记 exact `N` | 费用 5「乙宗 梢」 | 完整已实现 | 此成员从舞台放置入休息室时，检视顶 5，可公开 1 张成员加入手牌，其余入休息室。 | 完整事件层仍后续再抽。 | `HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID` |
| `PL!HS-bp6-017` | 当前登记 exact `N` | 费用 11「日野下花帆」 | 完整已实现 | 此成员从舞台放置入休息室时，可弃 1 手牌；如此做时从休息室将 LIVE/成员至多各 1 张加入手牌。 | 分组上限仍在 runner 校验。 | `HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID` |
| `PL!HS-pb1-009` | `R / P+` 已同步 | 费用 15「日野下花帆」 | 完整已实现 | 中心位监听己方「莲之空」成员登场，实例级每回合 2 次获得 BLADE +2；LIVE 开始 BLADE >= 8 时抽 2 弃 1。 | confirm-only 无输入确认壳已接通。 | `HS_PB1_009_*` abilities |
| `PL!HS-bp6-004` | `R / P` 已同步 | 费用 13「百生 吟子」 | 完整已实现 | 登场 / LIVE 开始选择对方费用 <= 9 成员变待机；LIVE 开始可弃 1 手牌获得 BLADE，弃「百生吟子」成员时共 +2。 | 同源双 LIVE 开始能力用 option 区分。 | `HS_BP6_004_*` abilities |

## Remaining Inline Behavior

- `PL!-sd1-006` 费用 8「西木野真姬」：公开手牌 + 成功区交换仍是 bespoke。
- `PL!-sd1-003` 费用 7「南琴梨」 / `PL!HS-bp1-006` 费用 11「藤岛 慈」：Heart color option step 尚未抽成 generic option resolver。
- `PL!-sd1-004` 费用 11「园田海未」 / `PL!-sd1-015` 费用 4「星空凛」 / `PL!-sd1-019` 分数 4「START:DASH!!」 / Karin：look-top workflow 使用共享 primitives，但 orchestration 仍在 runner。
- `PL!-sd1-009` 费用 11「矢泽妮可」 / `PL!-sd1-022` 分数 4「僕らは今のなかで」 / `PL!-sd1-001` 费用 7「高坂穗乃果」：条件/倍率仍未抽成 condition AST。
- `LL-bp2-001` 费用 20「渡边 曜&鬼冢夏美&大泽瑠璃乃」：换手禁止与 LIVE 开始段未实现。
- `LL-bp1-001` 费用 20「上原步梦&涩谷香音&日野下花帆」：LIVE 开始弃指定姓名并得分 +3 未实现。
- Standard movement/events for broader AUTO listeners are still incomplete；当前只覆盖 leave-stage 与 enter-stage proving paths。
