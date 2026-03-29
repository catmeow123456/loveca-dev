# 卡牌数据同步管线

> 更新时间: 2026-03-30
> 状态: 以当前代码实现为准

本文档只描述仓库里已经存在的两条卡牌数据同步脚本，以及它们现在实际会做什么。

## 1. 总览

当前有两条独立脚本：

| 脚本 | 数据源 | 写入字段范围 | 已存在卡牌的处理 |
| --- | --- | --- | --- |
| `src/scripts/sync-cards.ts` | `test/data/cards_full.json` + `test/data/cards_energy.json` | 基础字段 | `PUBLISHED` 跳过，`DRAFT` 覆盖更新 |
| `src/scripts/sync-cards-llocg.ts` | `llocg_db/json/cards.json` + `llocg_db/json/cards_cn.json` | 基础字段 + 大部分游戏字段 | 所有已存在卡牌都会更新 |

两条脚本都通过 `DATABASE_URL` 直连 PostgreSQL 的 `cards` 表。两者都支持 `--dry-run`。

## 2. 共同规则

### 2.1 卡牌编号标准化

两条脚本在入库前都会调用 `normalizeCardCode()`：

- 统一卡号格式
- 统一全角 `＋` / 半角 `+`
- 用标准化后的 `card_code` 做去重和数据库匹配

### 2.2 数据库匹配方式

两条脚本都会先执行：

```sql
SELECT card_code, status FROM cards
```

然后按 `card_code` 判断是新增还是更新。

### 2.3 dry-run

两条脚本在 `--dry-run` 下都不会连接数据库，也不会写入数据。

## 3. 爬虫 JSON 管线

脚本：`src/scripts/sync-cards.ts`

### 3.1 输入

- `test/data/cards_full.json`
- `test/data/cards_energy.json`

### 3.2 转换字段

写入以下字段：

- `card_code`
- `card_type`
- `name`
- `card_text`
- `image_filename`
- `blade`
- `rare`
- `product`

不会写入以下游戏字段：

- `cost`
- `hearts`
- `blade_hearts`
- `score`
- `requirements`
- `group_name`
- `unit_name`

### 3.3 类型映射

| 源值 | 入库值 |
| --- | --- |
| `M` | `MEMBER` |
| `L` | `LIVE` |
| `E` | `ENERGY` |

### 3.4 blade 解析

`parseBlade()` 的当前行为：

- 空字符串或 `-` -> `null`
- 纯数字 -> 对应整数
- 以 `ALL` 开头或包含 `全ブレード` -> 提取数字；没数字时返回 `1`
- 末尾带数字的颜色前缀字符串，例如 `桃1` -> 提取末尾数字
- 其他格式 -> 打 warning，并写 `null`

### 3.5 去重

脚本先写入 `cards_energy.json`，再写入 `cards_full.json` 到同一个 `Map`。

这意味着：

- 去重键是标准化后的 `card_code`
- 冲突时 `cards_full.json` 覆盖 `cards_energy.json`

### 3.6 写库策略

当前代码的真实行为：

- 数据库中不存在 -> `INSERT`
- 数据库中存在且 `status = 'DRAFT'` -> `ON CONFLICT DO UPDATE`
- 数据库中存在且 `status = 'PUBLISHED'` -> 跳过

`INSERT` 和 `UPDATE` 都只覆盖这几个基础字段：

- `card_type`
- `name`
- `card_text`
- `image_filename`
- `blade`
- `rare`
- `product`

脚本没有显式写入 `status`，所以：

- 新卡会使用数据库默认状态
- 已有 `DRAFT` 卡更新后保留原状态
- 已有 `PUBLISHED` 卡不会被修改

## 4. llocg_db 管线

脚本：`src/scripts/sync-cards-llocg.ts`

### 4.1 输入

- `llocg_db/json/cards.json`
- `llocg_db/json/cards_cn.json`

如果缺少文件，脚本会提示先执行：

```bash
git submodule update --init
```

### 4.2 数据合并方式

- `cards.json` 是主数据源
- `cards_cn.json` 用于补充中文名称和中文效果文本
- 会先把 CN key 标准化后建立索引
- JP 卡按标准化后的 card code 去匹配 CN 卡
- JP 没有、但 CN 有的卡，会按 CN-only 逻辑补一条记录

### 4.3 中文优先规则

`transformJpCard()` 的当前行为：

- `name` 优先使用 CN 名称
- 但如果 CN 名称是 `能量` 或 `エネルギー`，会回退到 JP 名称
- `card_text` 优先使用 CN `detail.ability`，否则回退到 JP `ability`

### 4.4 类型映射

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

### 4.5 写入字段

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

### 4.6 hearts / blade_hearts / requirements 转换

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

### 4.7 group / unit 的当前处理

- `group_name` 直接写 `jp.series`
- `unit_name` 直接写 `jp.unit`
- 如果 `unit_name` 不以 `「` 开头，会自动包成 `「...」`
- 非 `LIVE` 卡如果缺少 `unit`，会输出 warning
- 任意卡如果缺少 `series`，会输出 warning

### 4.8 CN-only 卡

CN-only 卡的当前行为：

- 可以写 `card_type` / `name` / `card_text` / `cost` / `blade` / `rare`
- `hearts` / `blade_hearts` / `score` / `requirements` / `unit_name` / `group_name` / `product` 都会写 `null`

### 4.9 写库策略

当前代码的真实行为：

- 数据库中不存在 -> `INSERT`
- 数据库中已存在，不区分 `DRAFT` / `PUBLISHED` -> `UPDATE`

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

## 5. 运行方式

```bash
# 爬虫 JSON 管线
DATABASE_URL=postgres://... npx tsx src/scripts/sync-cards.ts
DATABASE_URL=postgres://... npx tsx src/scripts/sync-cards.ts --dry-run

# llocg_db 管线
DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-llocg.ts
DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-llocg.ts --dry-run
```

## 6. 代码入口

- `src/scripts/sync-cards.ts`
- `src/scripts/sync-cards-llocg.ts`
- `src/shared/utils/card-code.ts`
