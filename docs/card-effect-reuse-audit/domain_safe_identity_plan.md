# Domain-safe identity helper plan

审查日期：2026-06-16

本文档记录 Batch G 的边界设计与当前迁移状态。G-1 / G-2 / G-3 / G-4 已完成。

## Current Status

- Batch G-1 已完成：`src/shared/utils/card-identity.ts` 提供 shared/domain-safe `cardBelongsToGroup(card, groupName)`，并有 focused unit test 覆盖 alias、文本 normalize 与卡号 fallback。
- Batch G-2 已完成：application 层 `groupAliasIs(groupName)` 已委托 shared helper；`groupIs(groupName)` 仍保留直接 contains 语义后再走 shared identity fallback。
- Batch G-3 已完成：`src/domain/rules/cost-calculator.ts` 中 Nijigasaki / Liella! 身份判断已委托 shared helper；费用语义、modifier metadata 与费用计算顺序未改。
- Batch G-4 已完成：`src/domain/rules/live-modifiers.ts` 中 Hasunosora 身份判断已委托 shared helper；continuous modifier 收集时机、三面不同名语义与 SCORE modifier metadata 未改。

## Why

application 层已经有 `groupAliasIs(groupName)`，用于把团体 alias、文本字段和卡号 fallback 统一成 `CardSelector`。但 domain 层不能 import `src/application/effects/card-selectors.ts`，因此 `cost-calculator.ts` 与 `live-modifiers.ts` 里仍有手写身份判断。

已迁移项：

- `src/domain/rules/cost-calculator.ts`：`PL!N-pb1-008` 的虹咲成员身份判断已在 G-3 委托 shared `cardBelongsToGroup`。
- `src/domain/rules/cost-calculator.ts`：`PL!SP-bp5-003` 的 Liella! 成员身份判断已在 G-3 委托 shared `cardBelongsToGroup`。

剩余状态：

- Batch G 范围内的 application / cost-calculator / live-modifiers 团体身份判断已统一到底层 shared helper。
- application runner / selectors 已通过 `groupAliasIs` 覆盖同类语义。

设计目标是让 domain 与 application 共享底层身份事实，同时不让 domain 反向依赖 application。

## Proposed Boundary

未来 helper 应放在 shared/domain-safe 层，例如：

- `src/shared/utils/card-identity.ts`

helper 应只接收 domain 与 shared 层可见的数据，不读取 `GameState`，不依赖 runner，不依赖 application selector。

建议的最小输入形状：

```ts
interface CardIdentityLike {
  readonly cardCode?: string;
  readonly groupName?: string;
  readonly cardText?: string;
}
```

建议的最小 API：

```ts
type GroupIdentityName = "μ's" | '蓮ノ空' | 'Liella!' | '虹ヶ咲' | 'Aqours';

function cardBelongsToGroup(card: CardIdentityLike, groupName: string): boolean;
```

`GroupIdentityName` 仅用于 canonical group/table 定义；公开 helper 接受 `string`，未知 group 返回 `false`。

可以后续再补更具体的薄包装：

```ts
function isHasunosoraCardIdentity(card: CardIdentityLike): boolean;
function isLiellaCardIdentity(card: CardIdentityLike): boolean;
function isNijigasakiCardIdentity(card: CardIdentityLike): boolean;
```

这些包装只应委托 `cardBelongsToGroup`，避免重新散落 alias 表。

## Identity Semantics To Preserve

团体身份判断只处理 group identity，不处理角色姓名 alias，也不处理 unit identity。

| canonical group | aliases / text matches | card-code fallback |
|---|---|---|
| `μ's` | `μ's`、`μ` | `PL!-` |
| `蓮ノ空` | `蓮ノ空`、`莲之空`、`Hasunosora` | `PL!HS-` |
| `Liella!` | `Liella!`、`Liella`、`リエラ`、`スーパースター`、`superstar` | `PL!SP-` |
| `虹ヶ咲` | `虹咲`、`虹ヶ咲`、`Nijigasaki` | `PL!N-` |
| `Aqours` | `Aqours` | `PL!S-` |

归一化要求：

- 文本比较应兼容大小写差异。
- `！` 应视作 `!`。
- 引号类字符如 `『』「」'’` 不应影响匹配。
- 卡号 fallback 应使用当前卡号前缀语义，不能误改成 base-card 精确匹配。

## Adapter Direction

shared helper 落地后，application selector 应成为 adapter：

```ts
function groupAliasIs(groupName: string): CardSelector {
  return (card) => cardBelongsToGroup(card.data, groupName);
}
```

如果仍需要历史 `groupIs(groupName)` 的“传入原文 includes”语义，应单独保留，并明确它比 `groupAliasIs` 更宽。不要把 `groupIs` 的宽匹配偷塞进 domain helper。

## Future Migration Slices

### Batch G-1: shared helper only

- 已完成：新增 `src/shared/utils/card-identity.ts`。
- 已完成：增加 shared helper 单测。
- 已保持：未迁任何调用点。
- 已保持：未改 `cost-calculator.ts`、`live-modifiers.ts`、`card-selectors.ts`、runner。

### Batch G-2: application adapter

- 已完成：让 `groupAliasIs` 复用 shared helper。
- 已完成：保留并扩充 selector 测试，确认 alias 与 card-code fallback 不漂移。
- 已保持：未改 domain rules。

### Batch G-3: cost-calculator identity

- 已完成：迁移 `isNijigasakiMember` / `isLiellaMember` 的身份判断到 shared helper。
- 已保持：费用条件本身不变，包括待机状态、10 费限制、来源卡限制、费用减少量。
- 已覆盖：`tests/unit/cost-calculator.test.ts` 补充 Liella / Nijigasaki alias、cardText 与 fallback 单测。

### Batch G-4: live-modifiers identity

- 已完成：迁移 `isHasunosoraMemberCard` 的身份判断到 shared helper。
- 已保持：三面均为「莲之空」成员、三名不同名、continuous modifier 收集时机不变。
- 已覆盖：`tests/unit/live-modifiers.test.ts` 补充 Hasunosora alias、cardText、fallback、非 MEMBER、重复姓名与缺槽单测。

## Explicit Non-goals

- 不改变登场费用语义。
- 不改变 continuous modifier 收集时机。
- 不改变 pending 顺序、事件消费或费用支付时机。
- 不抽 condition AST、formula builder、trigger matcher、steps DSL。
- 不把 zone 查询、stage 查询或 activeEffect workflow 放入 identity helper。
- 不把 unit alias、角色姓名 alias 合并进 group identity helper。

## Validation Guidance

每个实作批都至少跑：

```bash
pnpm test:run tests/unit/card-selectors.test.ts tests/unit/conditions.test.ts tests/unit/card-effect-classification.test.ts tests/integration/sample-card-effect-runner.test.ts
pnpm exec tsc --noEmit
git diff --check
```

若迁移 domain 调用点，再加：

```bash
pnpm test:run tests/unit/cost-calculator.test.ts tests/unit/live-modifiers.test.ts
```
