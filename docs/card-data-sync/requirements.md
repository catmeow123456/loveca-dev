# 爬虫 JSON 卡牌同步

> 更新时间: 2026-03-30
> 状态: 以 `src/scripts/sync-cards.ts` 为准

本文档只描述当前这条基于爬虫 JSON 的同步脚本实际行为，不再保留早期的规划性内容。

## 1. 脚本定位

脚本路径：`src/scripts/sync-cards.ts`

这条管线用于把爬虫产出的基础卡牌信息同步到 `cards` 表。它只处理基础字段，不负责补全完整游戏数据。

## 2. 输入文件

- `test/data/cards_full.json`
- `test/data/cards_energy.json`

缺少文件时，脚本会退出，并提示先运行：

```bash
cd test && python main.py all
```

## 3. 转换规则

### 3.1 字段映射

| 输入字段 | 数据库字段 | 当前行为 |
| --- | --- | --- |
| `card_number` | `card_code` | 先做 `normalizeCardCode()` |
| `card_kind` | `card_type` | `M/L/E -> MEMBER/LIVE/ENERGY` |
| `name` | `name` | 直接映射 |
| `effect_text` | `card_text` | 空值写 `null` |
| `img` | `image_filename` | 只保留文件名 |
| `blade` | `blade` | 通过 `parseBlade()` 解析 |
| `rare` | `rare` | 空值写 `null` |
| `product` | `product` | 空值写 `null` |

### 3.2 blade 解析

- `""` / `"-"` -> `null`
- `"1"` 之类纯数字 -> 对应数字
- `"ALL1"` 或包含 `"全ブレード"` -> 提取数字；没有数字时返回 `1`
- `"桃1"` 这类末尾带数字的字符串 -> 提取末尾数字
- 未知格式 -> warning + `null`

## 4. 去重与优先级

脚本按这个顺序写入内存 `Map`：

1. `cards_energy.json`
2. `cards_full.json`

所以同一张卡如果同时出现在两个文件里：

- 去重键是标准化后的 `card_code`
- `cards_full.json` 的记录会覆盖 `cards_energy.json`

## 5. 数据库写入策略

脚本会先读取数据库现有卡牌的 `card_code` 和 `status`，然后分三类处理：

- 不存在：插入
- 已存在且 `status = 'DRAFT'`：更新
- 已存在且 `status = 'PUBLISHED'`：跳过

更新方式是：

```sql
INSERT ... ON CONFLICT (card_code) DO UPDATE
```

会被覆盖的只有基础字段：

- `card_type`
- `name`
- `card_text`
- `image_filename`
- `blade`
- `rare`
- `product`

不会覆盖：

- `cost`
- `hearts`
- `blade_hearts`
- `score`
- `requirements`
- `group_name`
- `unit_name`
- `status`

## 6. dry-run

`--dry-run` 下：

- 不连接数据库
- 不判断哪些卡已存在
- 只展示转换后的全部卡牌和总数

运行方式：

```bash
DATABASE_URL=postgres://... npx tsx src/scripts/sync-cards.ts --dry-run
```

## 7. 正式运行

```bash
DATABASE_URL=postgres://... npx tsx src/scripts/sync-cards.ts
```

正式运行输出的核心统计包括：

- 读取卡牌数
- 去重后总数
- 已发布卡跳过数
- 新插入数
- 已有草稿卡更新数
- 失败批次数量对应的卡数
