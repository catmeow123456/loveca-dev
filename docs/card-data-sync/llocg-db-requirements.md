# llocg_db 卡牌同步

> 更新时间: 2026-03-30
> 状态: 以 `src/scripts/sync-cards-llocg.ts` 为准

本文档只描述当前 `llocg_db` 同步脚本实际行为。

## 1. 脚本定位

脚本路径：`src/scripts/sync-cards-llocg.ts`

这条管线直接读取 `llocg_db` submodule 里的 JSON 数据，并同步更完整的卡牌字段到 `cards` 表。

## 2. 输入文件

- `llocg_db/json/cards.json`
- `llocg_db/json/cards_cn.json`

缺少文件时，脚本会退出，并提示：

```bash
git submodule update --init
```

## 3. 合并逻辑

### 3.1 主从数据源

- `cards.json` 是主数据源
- `cards_cn.json` 是补充数据源

脚本会先把 `cards_cn.json` 的 key 做 `normalizeCardCode()`，再用标准化后的 card code 去匹配 JP 卡。

### 3.2 中文优先

对于同时存在 JP/CN 的卡：

- `name` 优先使用中文名
- 但如果中文名是 `能量` 或 `エネルギー`，会退回日文名
- `card_text` 优先使用中文 `detail.ability`
- 没有中文时退回日文 `ability`

### 3.3 CN-only

如果标准化后某张卡只存在于 `cards_cn.json`：

- 脚本仍会生成一条记录
- 但结构化 hearts / requirements 等字段无法从 CN-only 数据补齐

## 4. 字段映射

### 4.1 基础字段

| 来源 | 数据库字段 | 当前行为 |
| --- | --- | --- |
| `card_no` / CN key | `card_code` | 标准化后写入 |
| `type` / `card_type` | `card_type` | JP 或 CN 枚举映射 |
| CN 名称 / JP `name` | `name` | 中文优先 |
| CN `detail.ability` / JP `ability` | `card_text` | 中文优先 |
| `_img` | `image_filename` | 只保留文件名 |
| `rare` / `detail.rarity` | `rare` | 直接映射 |
| `product` | `product` | 直接映射；CN-only 写 `null` |
| 固定值 | `status` | 始终写 `PUBLISHED` |

### 4.2 类型映射

JP：

| 值 | 结果 |
| --- | --- |
| `メンバー` | `MEMBER` |
| `ライブ` | `LIVE` |
| `エネルギー` | `ENERGY` |

CN-only：

| 值 | 结果 |
| --- | --- |
| `13` | `MEMBER` |
| `14` | `LIVE` |
| `15` | `ENERGY` |

### 4.3 MEMBER / LIVE 扩展字段

| 来源字段 | 数据库字段 | 当前行为 |
| --- | --- | --- |
| `cost` | `cost` | 直接映射 |
| `blade` / `trigger_count` | `blade` | 直接映射 |
| `base_heart` | `hearts` | 转成 `{color, count}[]` |
| `blade_heart` | `blade_hearts` | 转成 BladeHeartItem 数组 |
| `special_heart` | `blade_hearts` | 追加 `DRAW` / `SCORE` 项 |
| `score` | `score` | 直接映射 |
| `need_heart` | `requirements` | 转成 `{color, count}[]` |
| `unit` | `unit_name` | 缺少 `「」` 时自动补上 |
| `series` | `group_name` | 直接映射 |

## 5. JSON 结构转换

### 5.1 hearts / requirements

颜色映射如下：

| 键 | 结果 |
| --- | --- |
| `heart01` | `PINK` |
| `heart02` | `RED` |
| `heart03` | `YELLOW` |
| `heart04` | `GREEN` |
| `heart05` | `BLUE` |
| `heart06` | `PURPLE` |
| `heart0` | `RAINBOW` |

输出结构：

```json
[{ "color": "PINK", "count": 1 }]
```

### 5.2 blade_hearts

`blade_heart`：

- `b_heart01` 到 `b_heart06` -> `{ effect: "HEART", heartColor: ... }`
- `b_all` -> `{ effect: "HEART", heartColor: "RAINBOW" }`
- 数值大于 1 时展开成多项

`special_heart`：

- `draw` -> `{ effect: "DRAW" }`
- `score` -> `{ effect: "SCORE" }`

## 6. 数据库写入策略

脚本会先读取数据库所有 `card_code, status`，然后：

- 不存在 -> `INSERT`
- 已存在且至少一个同步字段有变化 -> `UPDATE`
- 已存在但同步字段完全一致 -> `SKIP`

这里不区分 `DRAFT` 和 `PUBLISHED`，两者都会参与差异比较；只要字段有变化就会更新。

更新时覆盖以下字段：

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

并且会写：

```sql
updated_at = now()
```

## 7. 当前实现里需要特别注意的行为

当前代码构建的每条记录 `status` 都固定为 `PUBLISHED`，因此：

- 新插入卡牌状态是 `PUBLISHED`
- 已存在卡牌在更新后，状态也会被改写成 `PUBLISHED`

这也意味着原本是 `DRAFT` 的卡牌在这条脚本更新后会直接变成 `PUBLISHED`。

## 8. dry-run

`--dry-run` 下：

- 不连接数据库
- 打印前 20 条转换结果样本
- 额外输出 ENERGY 卡的 `group_name` / `product` 覆盖情况

运行方式：

```bash
DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-llocg.ts --dry-run
```

## 9. 正式运行

```bash
DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-llocg.ts
```

正式运行输出的核心统计包括：

- JP 卡数
- CN 匹配数
- CN-only 数
- 新插入数
- 已存在卡更新数
- 已存在但无字段变化的卡数
- 失败批次数量对应的卡数
- 成功写入数据库的明细行：按 `INSERT` / `UPDATE` 打印 `card_code` 和 `name`
- 对 `UPDATE` 行额外打印发生变化的字段名
