# 卡牌数据同步需求

> 更新时间: 2026-04-02
> 状态: 以 `src/scripts/sync-cards-llocg.ts` 为准

本文档只描述当前仍在维护的卡牌同步脚本实际行为，不再保留已移除旧脚本的需求说明。

## 1. 脚本定位

脚本路径：`src/scripts/sync-cards-llocg.ts`

这条管线用于把 `llocg_db` 子模块中的 JP/CN 卡牌数据同步到 `cards` 表。它会写入基础字段以及大部分游戏字段。

## 2. 输入文件

- `llocg_db/json/cards.json`
- `llocg_db/json/cards_cn.json`

缺少文件时，脚本会退出，并提示先运行：

```bash
git submodule update --init
```

## 3. 转换规则

### 3.1 字段映射

| 输入字段 | 数据库字段 | 当前行为 |
| --- | --- | --- |
| `card_no` / CN 卡号 | `card_code` | 先做 `normalizeCardCode()` |
| `type` / `card_type` | `card_type` | `JP_TYPE_MAP` / `CN_TYPE_MAP` 转换 |
| `name` / `card_name_cn` | `name` | 中文优先，缺失时回退日文 |
| `ability` | `card_text` | 空值写 `null` |
| `_img` | `image_filename` | 只保留文件名 |
| `cost` | `cost` | 空值写 `null` |
| `blade` / `trigger_count` | `blade` | 空值写 `null` |
| `base_heart` | `hearts` | 转成颜色数组 |
| `blade_heart` + `special_heart` | `blade_hearts` | 转成效果数组 |
| `score` | `score` | 空值写 `null` |
| `need_heart` | `requirements` | 转成颜色数组 |
| `unit` / `series` | `unit_name` / `group_name` | `unit_name` 会规范成 `「...」` |
| `rare` / `rarity` | `rare` | 空值写 `null` |
| `product` | `product` | 空值写 `null` |
| 常量 | `status` | 固定写 `PUBLISHED` |

### 3.2 hearts / blade_hearts 转换

- `heart01` 到 `heart06`、`heart0` 会转换为标准颜色枚举
- `b_heart01` 到 `b_heart06`、`b_all` 会转换为 `HEART` 效果数组
- `special_heart.draw` / `special_heart.score` 会分别转换为 `DRAW` / `SCORE`
- 未知 key 会输出 warning

## 4. 去重与优先级

脚本以标准化后的 `card_code` 为键合并 JP 与 CN 数据：

- JP 数据是主数据源
- 命中同卡号的 CN 数据只用于中文名称/文本等补充
- JP 中不存在但 CN 中存在的卡，会按 CN-only 规则构建记录

## 5. 数据库写入策略

脚本会先读取数据库现有卡牌完整字段并比较差异，然后分三类处理：

- 不存在：插入
- 已存在且无差异：跳过
- 已存在且有差异：进入逐张人工审核

人工审核行为：

- 终端先列出待更新卡号
- 逐张打印字段 `before` / `after`
- 输入 `y` 执行更新
- 输入 `n` 跳过该卡

更新会覆盖这些字段：

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

注意：

- 更新后的 `status` 固定为 `PUBLISHED`
- 交互审核要求 TTY；如果存在待更新卡且终端非 TTY，脚本会抛错退出

## 6. dry-run

`--dry-run` 下：

- 不连接数据库
- 不判断哪些卡已存在
- 只展示转换后的样本、能量卡统计和总数

运行方式：

```bash
DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-llocg.ts --dry-run
```

## 7. 正式运行

```bash
DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-llocg.ts
```

正式运行输出的核心统计包括：

- 读取卡牌数
- CN 命中数 / CN-only 数
- 新插入数
- 已更新数
- 无差异数
- 人工审核后跳过数
- 失败批次数量对应的卡数
