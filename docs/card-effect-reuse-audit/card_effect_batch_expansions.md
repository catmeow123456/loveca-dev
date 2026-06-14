# Loveca card effect batch expansions

审查日期：2026-06-14

本文件记录“同构效果批量扩样本”。这些卡通常不是新的规则边界，而是验证同一套 helper 可以覆盖更多真实卡。卡牌完成状态请看 `existing_module_map.md`。

## Discard 1, Look Top 3, Take 1

同型来源：`PL!-sd1-011` 费用 4「绚濑绘里」。

复用模块：`GENERIC_DISCARD_LOOK_TOP_ABILITY_ID` + `effect-costs.ts` + `look-top.ts`。

| 基础编号 | 费用/卡名 | 当前状态 |
|---|---|---|
| `PL!-sd1-011` | 费用 4「绚濑绘里」 | 已实现并作为同型来源 |
| `PL!-sd1-012` | 费用 4「矢泽妮可」 | 已实现 |
| `PL!-sd1-016` | 费用 4「小泉花阳」 | 已实现 |
| `PL!HS-PR-001` | 费用 10「日野下花帆」 | 登场段已实现；LIVE 开始支付 `[E][E]` 获得 BLADE 段未实现 |
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

## Batch Verification

核心覆盖：

- `tests/unit/card-effect-classification.test.ts`
- `tests/unit/card-effect-rarity-sync.test.ts`
- `tests/integration/sample-card-effect-runner.test.ts`

`card-effect-rarity-sync.test.ts` 会阻止后续新增 exact `cardCodes` 时漏掉同基础编号的其他罕度。
