# Loveca card effect batch expansions

> 文档类型：专题说明
> 适用范围：同构效果批量扩样本、复用来源和低风险扩展记录
> 当前状态：同构批量扩样本登记；单卡完成状态以 `existing_module_map.md` 为准
> 最后更新：2026-06-16

本文件记录“同构效果批量扩样本”。这些卡通常不是新的规则边界，而是验证同一套 helper 可以覆盖更多真实卡。卡牌完成状态请看 `existing_module_map.md`。

## Discard 1, Look Top 3, Take 1

同型来源：`PL!-sd1-011` 费用 4「绚濑绘里」。

复用模块：`GENERIC_DISCARD_LOOK_TOP_ABILITY_ID` + `effect-costs.ts` + `look-top.ts`。

| 基础编号 | 费用/卡名 | 当前状态 |
|---|---|---|
| `PL!-sd1-011` | 费用 4「绚濑绘里」 | 已实现并作为同型来源 |
| `PL!-sd1-012` | 费用 4「矢泽妮可」 | 已实现 |
| `PL!-sd1-016` | 费用 4「小泉花阳」 | 已实现 |
| `PL!HS-PR-001` | 费用 10「日野下花帆」 | 登场段已实现；LIVE 开始支付 `[E][E]` 获得 BLADE 段也已实现 |
| `PL!HS-cl1-007` | 费用 7「セラス 柳田 リリエンフェルト」 | 已实现 |
| `PL!HS-pb1-011` | 费用 7「大沢瑠璃乃」 | 已实现；同编号 `R / P+` 由基础编号匹配同步 |
| `PL!N-PR-004` | 费用 4「中须霞」 | 已实现 |
| `PL!N-PR-006` | 费用 4「朝香果林」 | 已实现 |
| `PL!N-PR-013` | 费用 4「ミア・テイラー」 | 已实现 |
| `PL!N-bp1-007` | 费用 4「优木雪菜」 | 已实现；同编号 `R / P` 由基础编号匹配同步 |
| `PL!N-bp1-010` | 费用 4「三船栞子」 | 已实现；同编号 `R / P` 由基础编号匹配同步 |
| `PL!N-sd1-002` | 费用 9「中须霞」 | 已实现 |
| `PL!N-sd1-003` | 费用 9「樱坂雫」 | 已实现 |

## Self-Sacrifice Recover LIVE

同型来源：`PL!-sd1-005` 费用 2「星空凛」。

复用模块：`RIN_ACTIVATED_ABILITY_ID` / `BP4_003_ACTIVATED_ABILITY_ID` + `startSacrificeSelfActivatedEffect` + `effect-costs.ts` + `card-selectors.ts` + `zone-selection.ts`。

| 基础编号 | 费用/卡名 | 当前状态 |
|---|---|---|
| `PL!-sd1-005` | 费用 2「星空凛」 | 已实现；同编号 `SD / RM` 由基础编号匹配同步 |
| `PL!-bp4-003` | 费用 2「南琴梨」 | 已实现；`P / R` 已统一为同一基础编号能力 |
| `PL!-pb1-024` | 费用 2「西木野真姬」 | 已实现 |
| `PL!HS-PR-026` | 费用 2「村野沙耶香」 | 已实现 |
| `PL!HS-bp2-004` | 费用 2「夕雾缀理」 | 已实现；同编号 `R / P` 由基础编号匹配同步 |
| `PL!HS-sd1-009` | 费用 2「日野下花帆」 | 已实现 |
| `PL!N-PR-009` | 费用 2「优木雪菜」 | 已实现；同编号 `PR / RM` 由基础编号匹配同步 |
| `PL!N-PR-012` | 费用 2「三船栞子」 | 已实现；同编号 `PR / RM` 由基础编号匹配同步 |
| `PL!N-PR-014` | 费用 2「钟岚珠」 | 已实现；同编号 `PR / RM` 由基础编号匹配同步 |
| `PL!N-PR-019` | 费用 2「中须霞」 | 已实现 |
| `PL!N-sd1-011` | 费用 2「米娅·泰勒」 | 已实现 |
| `PL!S-PR-026` | 费用 2「樱内梨子」 | 已实现 |
| `PL!S-bp2-009` | 费用 2「黑泽露比」 | 已实现；同编号 `R / P` 由基础编号匹配同步 |
| `PL!S-pb1-004` | 费用 2「黑泽黛雅」 | 已实现；同编号 `R / P+` 由基础编号匹配同步 |
| `PL!S-sd1-015` | 费用 2「津岛善子」 | 已实现 |
| `PL!SP-bp1-011` | 费用 2「鬼冢冬毬」 | 已实现；同编号 `R / P` 由基础编号匹配同步 |
| `PL!SP-pb1-018` | 费用 2「米女芽衣」 | 已实现 |
| `PL!SP-sd1-006` | 费用 2「樱小路 希奈子」 | 已实现 |
| `PL!SP-sd2-010` | 费用 2「ウィーン・マルガレーテ」 | 已实现 |

## Self-Sacrifice Recover Member

同型来源：`PL!-sd1-002` 费用 2「绚濑绘里」。

复用模块：`ELI_ACTIVATED_ABILITY_ID` / `PB1_019_ACTIVATED_ABILITY_ID` + `startSacrificeSelfActivatedEffect` + `effect-costs.ts` + `card-selectors.ts` + `zone-selection.ts`。

| 基础编号 | 费用/卡名 | 当前状态 |
|---|---|---|
| `PL!-sd1-002` | 费用 2「绚濑绘里」 | 已实现并作为同型来源 |
| `PL!-pb1-019` | 费用 2「高坂穗乃果」 | 已实现 |
| `PL!-pb1-025` | 费用 2「东条希」 | 已实现 |
| `PL!HS-PR-014` | 费用 2「日野下花帆」 | 已实现 |
| `PL!HS-pb1-019` | 费用 2「大沢瑠璃乃」 | 已实现 |
| `PL!HS-sd1-015` | 费用 2「セラス 柳田 リリエンフェルト」 | 已实现 |
| `PL!N-bp4-017` | 费用 2「宫下爱」 | 已实现 |
| `PL!N-bp4-020` | 费用 2「艾玛·维尔德」 | 已实现 |
| `PL!N-sd1-006` | 费用 2「近江彼方」 | 已实现 |
| `PL!S-PR-025` | 费用 2「高海千歌」 | 已实现；同编号 `PR / RM` 由基础编号匹配同步 |
| `PL!S-PR-027` | 费用 2「松浦果南」 | 已实现；同编号 `PR / RM` 由基础编号匹配同步 |
| `PL!S-bp2-016` | 费用 2「国木田花丸」 | 已实现 |
| `PL!S-bp6-014` | 费用 2「渡边曜」 | 已实现 |
| `PL!S-sd1-008` | 费用 2「小原鞠莉」 | 已实现 |
| `PL!SP-bp4-015` | 费用 2「平安名堇」 | 已实现 |
| `PL!SP-bp4-019` | 费用 2「若菜四季」 | 已实现 |
| `PL!SP-pb1-021` | 费用 2「ウィーン・マルガレーテ」 | 已实现 |
| `PL!SP-sd2-014` | 费用 2「岚千砂都」 | 已实现 |

## Live Modifier Samples

同型来源：既有 `PL!-sd1-009` 费用 11「矢泽妮可」分数修正与 `PL!-sd1-022` 分数 4「僕らは今のなかで」必要 Heart 修正。

复用模块：LIVE 开始队列 + continuous modifier registry + `live-modifiers.ts` 的 `addLiveModifier` / `replaceLiveModifier` / `collectLiveModifiers`。

| 基础编号 | 分数/卡名 | 当前状态 |
|---|---|---|
| `PL!HS-bp5-019` | 分数 6「花结」 | 已实现；LIVE 卡区此卡以外「莲之空」卡每张减少绿色必要 Heart 2 个 |
| `PL!HS-bp2-022` | 分数 2「アオクハルカ」 | 已实现；休息室大于等于 3 张 `Cerise Bouquet` LIVE 时此 Live 卡分数 +1，`L / L+` 由基础编号匹配同步 |
| `PL!HS-bp1-003` | 费用 13「乙宗梢」 | 已实现；三面均有不同名「莲之空」成员时，常时获得 LIVE 合计分数 +1 |
| `PL!HS-bp5-001` | 费用 11「日野下花帆」 | 已实现；登场公开检视顶 4 后若存在 LIVE，LIVE 结束时为止获得 BLADE +2 |

## Green Hasunosora Deck Samples

来源：`/Users/meiyikai/Desktop/文件/个人/codex/loveca/deck/绿莲-6弹ver.yaml` 的小批量真实卡效推进。

复用模块：`baseCardCodes`、`card-selectors.ts`、`effect-costs.ts`、`energy.ts`、`zone-selection.ts`、`look-top.ts`、`cheer-selection.ts`、`member-state.ts`、`live-modifiers.ts`。

| 基础编号 | 费用/分数/卡名 | 当前状态 |
|---|---|---|
| `PL!HS-bp5-019` | 分数 6「花结」 | 已实现；LIVE 开始按 LIVE 区其他「莲之空」卡减少绿色必要 Heart。 |
| `PL!HS-bp2-022` | 分数 2「アオクハルカ」 | 已实现；LIVE 开始按休息室 Cerise Bouquet LIVE 数量条件分数 +1。 |
| `PL!HS-sd1-006` | 费用 15「安养寺姬芽」 | 已实现；登场条件成立时活跃 1 张能量并回收「莲之空」LIVE，LIVE 开始支付 1 能量获得 BLADE +2。 |
| `PL!HS-bp5-008` | 费用 4「桂城泉」 | 已实现；登场可将自身待机并弃 1 手牌，看顶 5 公开费用大于等于 9 的「莲之空」成员。`R / P / AR` 由基础编号匹配同步。 |
| `PL!HS-pb1-004` | 费用 4「百生吟子」 | 已实现；登场可支付 1 能量并弃 1 手牌，顶 3 入休息室后回收 Cerise Bouquet LIVE。`R / P+` 由基础编号匹配同步。 |
| `PL!HS-PR-019` | 费用 2「百生吟子」 | 已实现；登场公开检视顶 3，继续处理后入休息室，若 3 张全为持有绿色 Heart 的成员则获得绿色 Heart。`PR / RM` 由基础编号匹配同步。 |
| `PL!HS-bp5-001` | 费用 11「日野下花帆」 | 已实现；登场公开检视顶 4 后入休息室并按是否存在 LIVE 获得 BLADE +2；起动支付 2 能量公开手牌 LIVE，并从休息室回收同名 LIVE。`AR / P / R+ / SEC` 由基础编号匹配同步。 |
| `PL!HS-bp1-003` | 费用 13「乙宗梢」 | 已实现；起动支付 1 能量回收费用小于等于 4 的「莲之空」成员；常时三面不同名「莲之空」成员时 LIVE 合计分数 +1。`P / P+ / R+ / SEC` 由基础编号匹配同步。 |
| `PL!HS-bp1-002` | 费用 11「村野沙耶香」 | 已实现；支付 2 能量并自送，从休息室登场费用小于等于 15 的「莲之空」成员到原区域。`P / R / RM` 由基础编号匹配同步。 |
| `PL!HS-sd1-001` | 费用 9「日野下花帆」 | 已实现；被费用大于等于 10 的「莲之空」成员换手放置入休息室时，活跃 2 张能量。 |
| `PL!HS-pb1-020` | 费用 9「百生吟子」 | 已实现；休息室 LIVE 大于等于 3 时可弃 2 手牌，回收 1 张 Cerise Bouquet 成员与 1 张「莲之空」LIVE。 |
| `PL!HS-bp6-001` | 费用 4「日野下花帆」 | 已实现；登场动态检视己方舞台成员数 + 2，选 1 放回卡组顶，其余入休息室；LIVE 成功时可选本次声援公开卡放回卡组顶。`P / P+ / R+ / SEC` 由基础编号匹配同步，本地全角 `R＋` 也可命中。 |
| `PL!HS-cl1-009` | 分数 1「水彩世界」 | 已实现；LIVE 成功时从本次声援公开卡中回收 1 张费用 4-9 成员。 |
| `PL!HS-bp6-027` | 分数 5「月夜見海月」 | 已实现；自己进行声援时，可将至多 3 张本次声援公开且无 BLADE HEART 的「莲之空」卡放置入休息室，并追加等量声援。 |

补充说明：

- 小组名条件统一使用 `unitAliasIs`，避免真实数据 `unitName=スリーズブーケ` 与效果文本 `Cerise Bouquet` 不一致。
- 成员名条件统一优先使用 `cardNameAliasIs`，覆盖中日名、空白/中点差异与早期中文误译。
- 翻牌/堆顶公开类效果优先进入 `inspectionZone`，需要双方看到时先公开，再通过“继续处理”进入最终结算。
- 隐藏区候选在确定公开前使用 `selectableCardVisibility: AWAITING_PLAYER_ONLY`，对手视角不显示候选区和候选数量；公开手牌后通过 `revealedCardIds` 确认窗口向双方展示。
- 声援公开卡选择统一走 `effects/cheer-selection.ts`，当前已覆盖加入手牌、放回卡组顶、放置入休息室与多选配置；追加声援走 `effects/cheer.ts`。

## Batch Verification

核心覆盖：

- `tests/unit/card-effect-classification.test.ts`
- `tests/unit/card-effect-rarity-sync.test.ts`
- `tests/integration/sample-card-effect-runner.test.ts`

`card-effect-rarity-sync.test.ts` 会阻止后续新增 exact `cardCodes` 时漏掉同基础编号的其他罕度。
