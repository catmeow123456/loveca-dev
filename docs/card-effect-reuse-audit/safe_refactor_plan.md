# Loveca safe card effect refactor plan

审查日期：2026-06-13  
状态：Stage 1A-1F 已完成当前 μ's 验证集的主要底座抽取；Step 12 / Stage 1G AUTO 事件层暂缓，等待真实自动能力 proving card。

本计划假设当前行为是 golden。除非明确接受 behavior mismatch，否则每一批都应先补 focused tests，再迁移。

## 0. Frozen baseline after Stage 1F

当前可视为已稳定的模块：

- `card-selectors.ts`
- `zone-selection.ts`
- `effect-costs.ts`
- `look-top.ts`
- `draw.ts`
- `member-state.ts`
- `live-modifiers.ts`

当前验证基线：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/live-modifiers.test.ts tests/unit/member-state.test.ts tests/unit/draw.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

最近结果：11 files passed，99 tests passed，server/client TypeScript passed。

## 1. Do not start Stage 1G without an AUTO proving card

Stage 1G 应包含：

1. standard `GameEvent`
2. effect/cost/move steps emitting events
3. trigger matcher
4. once-per-turn / when-if / source timing rules
5. UI pending trigger selection

当前不做，因为 μ's 预组没有足够合适的 AUTO 样例。后续遇到真实自动能力卡牌时，先写一页最小设计，再用该卡实现 proving case。

## 2. Recommended next implementation batch

优先选一个非 `PL!-sd1`、低风险、已由现有模块覆盖的 proving card，证明当前底座不是 starter-deck-only。

首选：

1. `LL-bp1-001-R＋` 登场回收成员：`T01,F07,F09`
   - 复用 `zone-selection.ts` 与 `card-selectors.ts`。
   - 风险低，能验证跨系列卡号和非 μ's 预组数据。
   - focused test：登场后只允许从休息室选择成员卡加入手牌。

备选：

2. `PL!HS-PR-001-PR` 或 `PL!HS-PR-002-PR` 登场看顶 3 选 1：`T01,C01,F03`
   - 复用 `effect-costs.ts` 与 `look-top.ts`。
   - 可推动 look-top workflow config 化，但仍需注意弃手/可选语义。

3. `PL!-pb1-019-N` 自送休息室回收成员：`T03,C04,F07,F09`
   - 与 002 同型，适合验证 effect-costs + zone-selection 可跨卡复用。

4. `PL!-bp3-010-N` 看顶 5 公开 Live 入手：`T01,C01,F04`
   - 与 004 同型但非预组，适合验证 F04 workflow 参数化。

## 3. Safe parameterization after one non-precon card

如果下一张非预组样例通过，可以开始减少 runner inline 分支：

1. 将 simple recovery ability 配置化：
   - trigger: `ON_ENTER_STAGE` / `ACTIVATED`
   - condition: optional
   - step: `WAITING_ROOM -> HAND`
   - selector: `typeIs(MEMBER|LIVE)` plus optional group/cost predicates

2. 将 look-top workflow 配置化：
   - `lookN`
   - `take min/max`
   - selector
   - reveal selected before hand
   - rest destination
   - ordered selection for `F05`

3. 将 Live modifier builders 配置化：
   - score delta
   - Heart grant
   - requirement delta
   - condition and scaling source

不要先做大型 resolver DSL。等至少两类非预组卡走通后，再判断 step pipeline 的稳定形状。

## 4. Known inline items to leave alone for now

| item | reason to defer |
|---|---|
| `PL!-sd1-006-SD` hand reveal + success-zone exchange | C07/X02/L01/L02 only has one current proving card; low frequency compared with already-migrated modules. |
| 003 Heart color option step | UI shape exists, but generic option API needs第二个样例来确定参数。 |
| 009/022/001 condition builders | Condition AST should be driven by repeated non-precon examples, not invented from one card. |
| Karin continuous `T05,B08` | Current Karin is a test sample. Decide whether to implement full real card text before adding moved-this-turn condition tracking. |
| `F02/F12` draw-discard / draw-then-deck-placement | Need actual samples to settle hand selection, deck position, and refresh semantics. |

## 5. Verification after each future batch

For card-effect module changes:

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/zone-selection.test.ts tests/unit/effect-costs.test.ts tests/unit/look-top.test.ts tests/unit/draw.test.ts tests/unit/member-state.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
```

For Live modifier changes:

```bash
pnpm test:run tests/unit/live-modifiers.test.ts tests/unit/heart-live.test.ts tests/unit/live-judgment-settlement.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
pnpm --dir client exec tsc -b
```

For frontend-visible flows, start `5173` and ask the user to test one named card and one expected outcome.

## 6. Documentation updates required per batch

Update these together:

- `AGENTS.md`
- `PROJECT_PROGRESS_TODO_20260612.md`
- `docs/card-effect-framework/card_effect_framework_design.md`
- `docs/card-effect-framework/card_effect_fragment_coverage_matrix.md`
- `docs/card-effect-reuse-audit/existing_module_map.md`
- `docs/card-effect-reuse-audit/module_gap_list.md`
- `docs/card-effect-reuse-audit/safe_refactor_plan.md`
