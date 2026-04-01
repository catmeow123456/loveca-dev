# 卡牌数据同步管线

> 更新时间: 2026-04-02
> 状态: 以当前代码实现为准

本文档只描述仓库里当前仍在维护的卡牌数据同步脚本，以及它现在实际会做什么。

## 1. 总览

当前仅保留一条同步脚本：

| 脚本 | 数据源 | 写入字段范围 | 已存在卡牌的处理 |
| --- | --- | --- | --- |
| `src/scripts/sync-cards-llocg.ts` | `llocg_db/json/cards.json` + `llocg_db/json/cards_cn.json` | 基础字段 + 大部分游戏字段 | 仅有差异的卡牌进入人工审核，审核通过后更新 |

脚本通过 `DATABASE_URL` 直连 PostgreSQL 的 `cards` 表，并支持 `--dry-run`。

## 2. 共同规则

### 2.1 卡牌编号标准化

脚本在入库前会调用 `normalizeCardCode()`：

- 统一卡号格式
- 统一全角 `＋` / 半角 `+`
- 用标准化后的 `card_code` 做去重和数据库匹配

### 2.2 数据库匹配方式

脚本会先执行：

```sql
SELECT card_code, status FROM cards
```

然后按 `card_code` 判断是新增还是更新。

### 2.3 dry-run

脚本在 `--dry-run` 下不会连接数据库，也不会写入数据。

历史说明：

- `src/scripts/sync-cards.ts` 这条旧的爬虫 JSON 管线已从仓库移除，不再作为当前实现描述对象。

## 3. llocg_db 管线

脚本：`src/scripts/sync-cards-llocg.ts`

### 3.1 输入

- `llocg_db/json/cards.json`
- `llocg_db/json/cards_cn.json`

如果缺少文件，脚本会提示先执行：

```bash
git submodule update --init
```

### 3.2 数据合并方式

- `cards.json` 是主数据源
- `cards_cn.json` 用于补充中文名称和中文效果文本
- 会先把 CN key 标准化后建立索引
- JP 卡按标准化后的 card code 去匹配 CN 卡
- JP 没有、但 CN 有的卡，会按 CN-only 逻辑补一条记录

### 3.3 中文优先规则

`transformJpCard()` 的当前行为：

- `name` 优先使用 CN 名称
- 但如果 CN 名称是 `能量` 或 `エネルギー`，会回退到 JP 名称
- `card_text` 优先使用 CN `detail.ability`，否则回退到 JP `ability`

### 3.4 类型映射

JP：

| 源值 | 入库值 |
| --- | --- |
| `メンバー` | `MEMBER` |
| `ライブ` | `LIVE` |
| `エネルギー` | `ENERGY` |

CN-only：

| 源值 | 入库值 |
| --- | --- |
| `13` | `MEMBER` |
| `14` | `LIVE` |
| `15` | `ENERGY` |

### 3.5 写入字段

此脚本会写入：

- `card_code`
- `card_type`
- `name`
- `card_text`
- `image_filename`
- `cost`
- `blade`
- `hearts`
- `blade_hearts`
- `score`
- `requirements`
- `unit_name`
- `group_name`
- `rare`
- `product`
- `status`

### 3.6 hearts / blade_hearts / requirements 转换

`convertHearts()`：

- `heart01` -> `PINK`
- `heart02` -> `RED`
- `heart03` -> `YELLOW`
- `heart04` -> `GREEN`
- `heart05` -> `BLUE`
- `heart06` -> `PURPLE`
- `heart0` -> `RAINBOW`

输出格式：

```json
[{ "color": "PINK", "count": 1 }]
```

`convertBladeHearts()`：

- `b_heart01` 到 `b_heart06` -> `effect: "HEART"` + 对应颜色
- `b_all` -> `effect: "HEART", heartColor: "RAINBOW"`
- 数量大于 1 时会展开成多项数组

`convertSpecialHearts()`：

- `draw` -> `{ "effect": "DRAW" }`
- `score` -> `{ "effect": "SCORE" }`

### 3.7 group / unit 的当前处理

- `group_name` 直接写 `jp.series`
- `unit_name` 直接写 `jp.unit`
- 如果 `unit_name` 不以 `「` 开头，会自动包成 `「...」`
- 非 `LIVE` 卡如果缺少 `unit`，会输出 warning
- 任意卡如果缺少 `series`，会输出 warning

### 3.8 CN-only 卡

CN-only 卡的当前行为：

- 可以写 `card_type` / `name` / `card_text` / `cost` / `blade` / `rare`
- `hearts` / `blade_hearts` / `score` / `requirements` / `unit_name` / `group_name` / `product` 都会写 `null`

### 3.9 写库策略

当前代码的真实行为：

- 数据库中不存在 -> `INSERT`
- 数据库中已存在，不区分 `DRAFT` / `PUBLISHED` -> 先比较字段差异
- 有差异的卡牌会先在终端列出卡牌编号，再逐张显示修改前/修改后
- 管理员输入 `y` -> 执行该卡的 `UPDATE`
- 管理员输入 `n` -> 跳过该卡，不写库

更新时覆盖：

- `card_type`
- `name`
- `card_text`
- `image_filename`
- `cost`
- `blade`
- `hearts`
- `blade_hearts`
- `score`
- `requirements`
- `unit_name`
- `group_name`
- `rare`
- `product`
- `status`
- `updated_at = now()`

注意：脚本构建的记录里 `status` 固定为 `PUBLISHED`，所以无论是新插入还是更新已有卡牌，最终都会写成 `PUBLISHED`。
被管理员跳过的待更新卡牌不会发生任何数据库变更。

## 5. 运行方式

```bash
DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-llocg.ts
DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-llocg.ts --dry-run
```

## 6. 代码入口

- `src/scripts/sync-cards-llocg.ts`
- `src/shared/utils/card-code.ts`
