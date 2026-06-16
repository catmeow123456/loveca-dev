# Condition/query remaining inventory

审查日期：2026-06-16

本文档只追踪卡效底层重构中的 condition/query 复用摊子。它的目标是把“还剩什么”摊开，而不是推动一次性 AST / DSL / steps 迁移。

当前边界：

- `src/application/effects/conditions.ts` 是第一版纯 query helper，只读 `GameState`。
- 本阶段允许继续补纯 query、selector、少量 query 单测。
- 本阶段不做 condition AST、不做 typed formula builder、不做 declarative steps。
- 本阶段不改变 pending 顺序、不改变费用期间事件消费时机、不改变事件层入队/消费语义。
- domain 层文件不能 import `src/application/effects/conditions.ts`。

## Current covered base

`conditions.ts` 当前已覆盖：

- 区域卡牌数量：`countCardsInZone`
- 任意 cardIds + selector 过滤/计数/阈值：`getCardIdsMatchingSelector`、`countCardsMatchingSelector`、`hasAtLeastCardsMatchingSelector`、`hasCardIdsMatchingSelector`、`allCardIdsMatchingSelector`
- 区域 + selector 组合：`getCardIdsInZoneMatching`、`countCardsInZoneMatching`、`hasCardInZoneMatching`
- 成功 LIVE 数：`countSuccessfulLiveCards`
- 舞台成员数/存在性：`countStageMembers`、`hasStageMemberMatching`、`hasOtherStageMember`
- LIVE 区排除来源卡计数：`countOtherLiveZoneCardsMatching`
- 来源成员有效 BLADE：`getSourceEffectiveBladeCount`、`sourceHasBladeAtLeast`
- 区域 id/cards 读取：`getCardIdsInZone`、`getCardsInZone`

相关 selector / application-local query 已覆盖：

- `card-selectors.ts`：团体身份 `groupAliasIs`（含 μ's / 莲之空 / Liella! / 虹咲 / Aqours alias 与卡号 fallback）、绿色 Heart 成员、BLADE HEART、印刷 BLADE 阈值、`cardNameAliasAny`。
- `stage-targets.ts` / `energy.ts`：application-local 的舞台成员 / 能量按朝向查询；缺失 cardState 不命中。

已开始复用该层的当前卡效点：

| card/effect | covered query |
|---|---|
| `PL!-sd1-001` 费用 7「高坂穗乃果」 | 成功 LIVE 数查询已在 continuous modifier 收集路径使用 domain-local 计数；application query 已有对应 helper。 |
| `PL!-sd1-009` 费用 11「矢泽妮可」 | 等待室 `μ's` 数量。 |
| `PL!-sd1-022` 分数 4「僕らは今のなかで」 | 成功 LIVE 数。 |
| `PL!HS-bp5-019` 分数 6「花结」 | LIVE 区此卡以外「莲之空」卡数量。 |
| `PL!HS-bp2-022` 分数 2「アオクハルカ」 | 等待室 Cerise Bouquet LIVE 数量。 |
| `PL!HS-pb1-009` 费用 15「日野下花帆」 | 来源成员有效 BLADE 阈值。 |
| `PL!HS-pb1-020` 费用 9「百生吟子」 | 等待室 LIVE 数量。 |
| `PL!HS-sd1-006` 费用 15「安养寺姬芽」 | 舞台相关成员存在性。 |
| `PL!HS-bp6-001` 费用 4「日野下花帆」 | 舞台成员数。 |
| `PL!HS-bp6-031` 分数 8「ファンファーレ！！！」 | 等待室成员与 `みらくらぱーく！` 成员数。 |
| `PL!HS-bp1-006` 费用 11「藤岛 慈」同型组 | 其他舞台成员存在性。 |
| `LL-bp1-001` / `LL-bp2-001` 指定姓名 LIVE 开始段 | 手牌候选使用 `cardNameAliasAny` 收束多姓名 alias 判断；弃手流程与奖励公式仍留在 runner。 |

## Status labels

| label | meaning | allowed next action |
|---|---|---|
| `ready-query` | 纯读查询，当前可继续收束。 | 补小 helper + 单测，再做等价替换。 |
| `needs-selector` | 查询形状清楚，但 selector 语义还散落或有别名/fallback 风险。 | 先扩 `card-selectors.ts` 并补 selector 测试，再迁 query。 |
| `domain-blocked` | 位于 domain 层，不能 import application query。 | 暂不迁；未来决定是否下沉到 domain/shared query。 |
| `formula-builder` | 查询已经能做，但“数量 -> 奖励/修正”的表达仍在 runner。 | 后续真实重复足够后再抽 typed builder；不要塞进 `conditions.ts`。 |
| `workflow-step` | 本质是流程/选择/移动/支付串联。 | 等 look-top/reveal-hand/grouped-selection/steps 配置化专题处理。 |

## Completed small batches

- Batch A selector cleanup：已完成 application 层团体身份 selector、绿色 Heart 成员、BLADE HEART、印刷 BLADE 阈值，并替换 runner 中最直接的本地 selector。
- Batch B zone/cardIds helper：已补 zone/cardIds convenience helper，并替换顶牌检视 any/all、等待室 LIVE count 等低风险读查询。
- Batch C-1 application-local state query：已把 Liella! 舞台成员扫描、舞台成员/能量按朝向查询收束到 selector / `stage-targets.ts` / `energy.ts`。
- Batch D-1 named discard selector：已补 `cardNameAliasAny` 并替换 `LL-bp1-001` / `LL-bp2-001` 指定姓名弃手候选。奖励公式、弃手流程、pending 顺序仍未迁移。

## Remaining inventory

### ready-query

| id | current location | current behavior | next action |
|---|---|---|---|
| RQ-01 | `card-effect-runner.ts` 中多处 `getCardIdsInZone(...)+getCardIdsMatchingSelector(...)` / `countCardsMatchingSelector(...)` | 区域 + selector 的 id 列表、数量、阈值查询。 | `getCardIdsInZoneMatching` / `countCardsInZoneMatching` / `hasCardInZoneMatching` 已补；已替换 `PL!HS-pb1-020` 等低风险点，剩余重复可随真实卡效小步继续迁。 |
| RQ-02 | `PL!HS-bp5-001` 费用 11「日野下花帆」登场段 | 检视顶 4 后判断其中是否有 LIVE，决定是否给 BLADE +2。 | 已用 `hasCardIdsMatchingSelector(..., typeIs(CardType.LIVE))`；奖励写入仍留在 runner。 |
| RQ-03 | `PL!-sd1-007` 费用 7「东条希」 | 公开顶 5 后判断其中是否有 LIVE，决定是否抽 1。 | 已用 `hasCardIdsMatchingSelector(..., typeIs(CardType.LIVE))`；抽牌流程不迁。 |
| RQ-04 | `PL!HS-PR-019` 费用 2「百生吟子」 | 公开顶 3 后判断 3 张是否全部为绿色 Heart 成员。 | 已用 `allCardIdsMatchingSelector(..., memberHasHeartColor(HeartColor.GREEN))`；奖励写入仍留在 runner。 |
| RQ-05 | `PL!-sd1-006` 费用 8「西木野真姬」 | 扫手牌 LIVE 与成功区 LIVE 作为交换候选。 | 可用区域 + selector helper替换手写 filter；完整公开手牌 + 成功区交换仍是 workflow-step。 |
| RQ-06 | `PL!HS-pb1-012` 费用 15「百生吟子」 | 双方等待室成员数量合计、移动后成员数量合计，阈值 20。 | `getWaitingRoomMemberCardIds` 已改用 `getCardIdsInZoneMatching`；阈值后续仍是 formula/workflow。 |
| RQ-07 | `PL!HS-bp6-031` / `PL!HS-pb1-012` 共用的 `moveWaitingRoomMembersToDeckBottomShuffled` | 等待室成员洗回卡组底，并返回成员数量与 `みらくらぱーく！` 数量。 | 查询部分已有部分 zone helper 复用；移动仍属于专用步骤，不搬进 `conditions.ts`。 |
| RQ-08 | `PL!HS-bp6-017` 费用 11「日野下花帆」 | 弃手后从等待室选 LIVE / 成员各至多 1 张，并校验选中分组数量。 | 可抽“selected ids 按 selector 分组计数”纯 helper；真正的分组选取上限应属于 grouped selection config。 |
| RQ-09 | `PL!HS-pb1-020` 费用 9「百生吟子」 | 弃 2 后检查等待室是否有 Cerise Bouquet 成员、是否有「莲之空」LIVE，并据此强制选择 1+1 或可用分组。 | 可抽 `hasCardMatchingSelector` / 分组计数 helper；强制选择规则属于 grouped selection config。 |
| RQ-10 | `PL!HS-bp5-001` 起动段 | 手牌 LIVE 候选要求等待室存在同名 LIVE。 | 可抽“区域中存在与来源卡同名/包含名的 LIVE”查询；需要先定同名 selector 语义。 |
| RQ-11 | `LL-bp1-001` / `LL-bp2-001` 指定姓名弃手 LIVE 开始段 | 手牌中按多个姓名 alias 匹配候选。 | 已用 `cardNameAliasAny` 收束候选 selector；奖励仍是 formula-builder。 |
| RQ-12 | `PL!S-bp2-006` 费用 11「津岛善子」 | 等待室费用 <=4 成员候选、选择卡费用合计 <=4。 | 候选查询可迁 zone matching；费用合计是 grouped selection constraint，不放进 `conditions.ts`。 |
| RQ-13 | `PL!HS-bp1-004` / `PL!HS-bp1-003` / `PL!HS-bp1-002` 起动段 | 等待室「莲之空」LIVE、低费成员、费用 <=15 成员候选。 | 等 Hasunosora selector 稳定后，用 zone matching helper替换手写 selector 拼接。 |
| RQ-14 | `PL!SP-bp5-003` 费用 17「岚 千砂都」LIVE 开始段 | 扫自己舞台 Liella! 成员并扫能量区全部能量。 | Liella! 成员扫描已用 `getStageMemberCardIdsMatching(..., groupAliasIs('Liella!'))`；能量批量活跃流程仍留在 runner。 |
| RQ-15 | `PL!N-pb1-008` 费用 17「艾玛·维尔德」登场段 | 查询待机成员、待机能量，并据此生成二选一。 | 已将按朝向查询放入 `stage-targets.ts` / `energy.ts`；二选一流程仍是 workflow-step。 |

### needs-selector

| id | current location | missing selector | next action |
|---|---|---|---|
| NS-01 | `isHasunosoraCard` / `isHasunosoraMemberCard` / `isHasunosoraLiveCard` in `card-effect-runner.ts` | 「莲之空」身份：groupName 中文/日文 + `PL!HS-` 卡号 fallback。 | 在 `card-selectors.ts` 增加 Hasunosora selector，保留现有 fallback；先补 selector tests，再迁 bp5-019、sd1-006、bp6-027、bp1-004/003/002 等使用点。 |
| NS-02 | `isMuseCard` / `isMuseLiveCardData` in `card-effect-runner.ts` | `μ's` LIVE selector。 | `groupIs("μ's")` 已覆盖 `PL!-` fallback；可替换剩余 Umi/Maki 相关用法并删除 runner-local helper。 |
| NS-03 | `isGreenHeartMemberCard` in `card-effect-runner.ts` | 绿色 Heart 成员 selector。 | 增加 `hasHeartColor` / `memberHasHeartColor` 之类 selector，覆盖 `heart.count > 0`。 |
| NS-04 | `hasBladeHeart` in `card-effect-runner.ts` | 持有 / 不持有 BLADE HEART selector。 | 增加 BLADE HEART selector，供 `PL!HS-bp6-027` 声援公开卡筛选复用。 |
| NS-05 | `SP_BP4_011` 目标筛选 | 印刷 BLADE <= 3 成员 selector。 | 增加 `printedBladeLte` 或 member blade selector；不要和有效 BLADE query 混淆。 |
| NS-06 | named hand discard | 多姓名 alias 任一命中 selector。 | 已增加 `cardNameAliasAny(names)` 并替换 named discard 候选。 |
| NS-07 | `PL!HS-bp5-001` 起动段同名 LIVE | 规范化卡名包含关系 selector。 | 明确是“等待室 LIVE 名称包含公开 LIVE 名称”，不是完全相等；补测试后再抽。 |
| NS-08 | `PL!SP-bp5-003` / cost-calculator 中 Liella! 判断 | Liella! 身份 selector，带 `PL!SP-` fallback 与文本别名。 | application 可先扩 selector；domain 侧仍不能直接 import，需要另行处理。 |
| NS-09 | cost-calculator 中 Nijigasaki 判断 | 虹咲身份 selector，带 `PL!N-` fallback 与文本别名。 | 属于 domain-blocked；若要统一，先把身份判定下沉到 shared/domain-safe 模块。 |
| NS-10 | 多处 `and(typeIs(CardType.MEMBER), costGte(...), costLte(...))` | 成员费用范围 selector 已能组合，但写法仍散。 | 不必立刻新增 helper；若重复继续增加，可补 `memberCostBetween(min,max)`。 |

### domain-blocked

| id | current location | current behavior | why blocked / next action |
|---|---|---|---|
| DB-01 | `src/domain/rules/live-modifiers.ts` `collectContinuousLiveModifiers` | 为 continuous modifier 收集成功 LIVE 数和舞台成员来源。 | domain 不能 import application `conditions.ts`；短期保留。 |
| DB-02 | `src/domain/rules/live-modifiers.ts` `hasThreeDifferentHasunosoraMembersOnStage` | `PL!HS-bp1-003` 三面均为不同名「莲之空」成员时 LIVE 合计分数 +1。 | 这是最明确的 domain-blocked condition。后续若要迁，先设计 domain/shared query 与 Hasunosora selector。 |
| DB-03 | `src/domain/rules/live-modifiers.ts` `hasMemberPositionMovedThisTurn` | `PL!N-pb1-004` 未进行成员区位置移动时 BLADE +2。 | 读取 domain turn-state，保留 domain-local 或下沉 query，不走 application helper。 |
| DB-04 | `src/domain/rules/cost-calculator.ts` `LL-bp2-001` | 手牌中自身按“此卡以外手牌数量”减费。 | 登场费用规则在 domain；不属于 application condition/query 本批。 |
| DB-05 | `src/domain/rules/cost-calculator.ts` `PL!N-pb1-008` | 舞台存在待机虹咲成员时自身费用 -2。 | domain stage resource + orientation condition；未来可抽 domain-safe identity/orientation query。 |
| DB-06 | `src/domain/rules/cost-calculator.ts` `PL!SP-bp5-003` | 舞台来源使 10 费 Liella! 成员费用 -2。 | domain cost modifier 条件；需要 domain-safe Liella selector，不能复用 application selector。 |
| DB-07 | domain 中的 Liella/Nijigasaki/Hasunosora 身份判断 | 与 application selector 有语义重叠。 | 未来可做 shared identity helper；不要让 domain 反向依赖 application。 |

### formula-builder

这些不是 `conditions.ts` 的职责。它们要等重复样例更多后再抽 typed builder。

| id | current cards | current formula / condition-bound reward | next action |
|---|---|---|---|
| FB-01 | `PL!-sd1-009` / `PL!HS-bp2-022` | `count >= N` 时写入 SCORE +1。 | 后续可抽 threshold score builder。 |
| FB-02 | `PL!-sd1-022` / `PL!HS-bp5-019` | `count * 2` 转换为必要 Heart 减少。 | 后续可抽 scaling requirement builder。 |
| FB-03 | `PL!HS-bp1-004` | LIVE 区数量转换为 BLADE 数。 | 后续可抽 count-to-blade builder；当前支付流程仍在 runner。 |
| FB-04 | `PL!HS-pb1-009` | 来源有效 BLADE >= 8 时进入抽 2 弃 1。 | Query 已有；后续若抽 builder，要覆盖“满足条件才进入 workflow”。 |
| FB-05 | `PL!HS-bp5-001` / `PL!-sd1-007` / `PL!HS-PR-019` | 检视结果满足条件后给 BLADE / 抽牌 / 给 Heart。 | Query 可抽 any/all；奖励和后续步骤属于 builder/workflow。 |
| FB-06 | `LL-bp1-001` / `LL-bp2-001` | 指定姓名弃置后固定 SCORE 或按弃置数给 BLADE。 | named discard workflow 已有雏形；奖励 builder 可后续抽。 |
| FB-07 | `PL!HS-bp6-031` / `PL!HS-pb1-012` | 洗回成员数量达到阈值后进入目标选择或回收 + BLADE。 | 阈值 query 可读；后续是 recycle workflow + reward builder。 |
| FB-08 | `PL!N-pb1-004` | 翻开费用 <=9 成员时入手并站位变换，否则入休息室。 | 条件决定目的地与后续动作，优先归 workflow config。 |

### workflow-step

这些经常看起来像 condition/query，但本质是流程配置，不应作为 `conditions.ts` 扩张理由。

| id | current cards | pending workflow |
|---|---|---|
| WF-01 | `PL!-sd1-006` | 公开手牌 LIVE、选择成功区 LIVE、交换两个区域。 |
| WF-02 | `PL!HS-bp5-001` | 起动公开手牌 LIVE，再从等待室选同名 LIVE。 |
| WF-03 | `PL!HS-bp6-017` / `PL!HS-pb1-020` | 按分组上限或强制分组选择等待室卡。 |
| WF-04 | `PL!S-bp2-006` | 从等待室选择至多 2 名成员，费用合计 <=4，并登场到空槽。 |
| WF-05 | `PL!-sd1-004` / `PL!HS-bp2-012` / generic discard-look-top / `PL!HS-bp5-008` | look-top 检视、可选公开、入手、其余入休息室的 workflow config。 |
| WF-06 | `PL!-sd1-003` / `PL!HS-bp1-006` / `PL!HS-bp1-004` | Heart color / pay-or-decline option step。 |
| WF-07 | `PL!HS-bp6-001` / `PL!HS-cl1-009` / `PL!HS-bp6-027` | 声援公开卡选择已复用 cheer-selection；卡组底/重做声援仍待真实样例。 |
| WF-08 | `PL!SP-bp5-003` / `PL!N-pb1-008` | 批量成员/能量 orientation 目标查询与二选一流程。 |

## Suggested execution batches

### Batch A: selector cleanup

目标：先减少身份判断散落，避免 query helper 用错语义。

1. 补 Hasunosora selector，覆盖 `PL!HS-` fallback、`莲之空`、`蓮ノ空`。
2. 补绿色 Heart 成员 selector、BLADE HEART selector、印刷 BLADE 阈值 selector。
3. 替换 runner-local `isMuseCard` / `isMuseLiveCardData` 的剩余用法。
4. 只跑 selector 单测、conditions 单测、sample runner。

### Batch B: zone/cardIds convenience helper

目标：让区域 + selector 的组合调用少一点，但不改变流程。

1. 在 `conditions.ts` 补 `getCardIdsInZoneMatching`、`countCardsInZoneMatching`、`hasCardInZoneMatching`。
2. 补 `hasCardIdsMatchingSelector` / `allCardIdsMatchingSelector`。
3. 替换 RQ-01 到 RQ-05 中最直接的 2-4 个点。

### Batch C: state query placement

目标：把 orientation/energy/stage 状态查询放到合适模块，而不是硬塞 `conditions.ts`。

1. `getStageMemberCardIdsByOrientation` 候选：`member-state.ts` 或 `stage-targets.ts`。
2. `getEnergyCardIdsByOrientation` / active energy 查询候选：`energy.ts` 或 `effect-costs.ts`。
3. 先只迁 Emma / Chisato 这种明显复用点。

### Batch D: remaining condition inventory close-out

目标：更新本文件，把剩余项明确变成 formula-builder / workflow-step / domain-blocked。

1. Batch D-1 已完成 named discard selector 收束；这不代表弃手 workflow 或奖励 builder 已迁移。
2. 后续继续把 formula-builder 和 workflow-step 留在各自专题，不当作 `conditions.ts` 待办。
3. 等 trigger matcher 稳定后，再讨论 condition AST 或 steps 接入。

## Validation baseline

每批至少跑：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/conditions.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
git diff --check
```

若触及 LIVE_START timing 或 domain cost/continuous modifier，再加：

```bash
pnpm test:run tests/integration/live-start-timing.test.ts tests/unit/live-modifiers.test.ts tests/unit/cost-calculator.test.ts
```
