# llocg_db 卡牌数据同步管线 - 需求文档

> 版本: 1.1.0
> 创建日期: 2026-03-13
> 状态: 已实现

## 1. 背景

项目已有一条基于 Python 爬虫的卡牌数据同步管线（详见 [requirements.md](./requirements.md)），能够从 Bushiroad Deck Log API 和官网获取卡牌元数据并同步到数据库。但该管线仅填充基础字段（card_code, name, card_type, card_text, blade, rare, product），游戏核心数据（cost, hearts, requirements, score 等）需管理员在后台手动补充，工作量大且易出错。

现引入第三方非官方数据库 [llocg_db](https://github.com/wlt233/llocg_db) 作为**独立的第二数据源**，以 git submodule 方式集成。该数据源包含结构化的完整游戏数据、中文翻译和卡牌图片，可大幅减少管理员手动填充的工作量。

### 1.1 两条管线定位

| | 爬虫管线 | llocg_db 管线 |
|---|---|---|
| 数据源 | Bushiroad Deck Log API + 官网 | llocg_db git submodule |
| 脚本 | `sync-cards.ts` | `sync-cards-llocg.ts` |
| 数据完整度 | 基础字段（card_code, name, rare, product 等） | **完整游戏数据**（含 cost, hearts, requirements, score, unit 等） |
| 中文支持 | 无 | 有（中文优先填充 name、card_text） |
| 图片 | 独立流程 | 纳入管线 |
| 适用场景 | 快速获取最新日文卡牌列表 | 获取完整游戏数据（含中文） |

两条管线独立运行、独立脚本，开发者按需选择执行。

## 2. 数据源概览

### 2.1 Submodule 路径

`llocg_db/`（项目根目录下的 git submodule）

### 2.2 文件结构

```
llocg_db/
├── json/
│   ├── cards.json          # 日文卡牌（1803 张，dict，key=card_no）
│   ├── cards_cn.json       # 中文卡牌（1662 张，dict，key=card_no）
│   ├── products.json       # 日文商品信息
│   └── products_cn.json    # 中文商品信息
├── img/
│   ├── cards/              # 日文卡图（按商品子目录: BP01/, BP02/, ...）
│   └── cards_cn/           # 中文卡图（扁平结构）
└── ...
```

### 2.3 card_no 标准化

日文数据使用全角 `＋`（如 `LL-bp1-001-R＋`），中文数据使用半角 `+`（如 `LL-bp1-001-R+`）。同步脚本在匹配和入库时统一标准化为**半角 `+`**。

### 2.4 数据覆盖情况（标准化后）

| | 日文 (cards.json) | 中文 (cards_cn.json) | 重叠 |
|---|---|---|---|
| 总卡数 | 1803 | 1662 | 1654 |
| 仅该版本 | 149 | 8 | — |

合并后总计 **1811 张**卡牌。

**日文数据完整度（成员卡 1069 张）：**
- cost: 100% | base_heart: 99% | blade: 94% | blade_heart: 53% | unit: 99% | ability: 86%

**日文数据完整度（Live 卡 175 张）：**
- score: 100% | need_heart: 100% | special_heart: 16% | ability: 77%

## 3. 数据读取与合并

### 3.1 日文卡牌（主数据源）

读取 `llocg_db/json/cards.json`。格式为 `Record<card_no, CardObject>`。

每张卡的结构示例（成员卡）：

```json
{
  "card_no": "PL!-sd1-001-SD",
  "name": "高坂 穂乃果",
  "type": "メンバー",
  "series": "ラブライブ！",
  "unit": "Printemps",
  "cost": 11,
  "blade": 3,
  "base_heart": { "heart01": 1, "heart03": 2, "heart06": 1 },
  "blade_heart": { "b_heart06": 1 },
  "rare": "SD",
  "product": "スタートデッキラブライブ！",
  "ability": "{{toujyou.png|登場}}...",
  "_img": "img/cards/PLSD01/PL!-sd1-001-SD.png"
}
```

Live 卡额外字段：

```json
{
  "score": 2,
  "need_heart": { "heart01": 1, "heart03": 1, "heart0": 3 },
  "special_heart": { "score": 1 }
}
```

### 3.2 中文卡牌（优先数据源）

读取 `llocg_db/json/cards_cn.json`。标准化 card_no 后按 key 匹配日文卡牌。

**中文优先策略：** 有中文数据时，`name` 和 `card_text` 使用中文值；无中文时 fallback 到日文。不区分语言字段，不新增独立的中文列。

- `name` ← `detail.card_name_cn`（有 CN 时）或 `jp.name`（无 CN 时）
- `card_text` ← `detail.ability`（有 CN 时）或 `jp.ability`（无 CN 时）

### 3.3 CN-only 卡牌

标准化后仍有 8 张仅存在于中文数据的卡牌，从 CN detail 字段构建记录：

| CN 字段 | 数据库字段 | 转换规则 |
|---|---|---|
| `detail.card_name_cn` | `name` | 直接映射 |
| `detail.ability` | `card_text` | 直接映射 |
| `card_type` (13/14/15) | `card_type` | 13→MEMBER, 14→LIVE, 15→ENERGY |
| `detail.cost` | `cost` | 直接映射 |
| `detail.trigger_count` | `blade` | 直接映射 |
| `detail.rarity` | `rare` | 直接映射 |
| `_img` | `image_filename` | 提取文件名 |

CN-only 卡牌不包含结构化的 hearts/requirements 数据，这些字段置为 null。

### 3.4 不使用的数据

以下字段不纳入同步：
- `faq` / `detail.faq_lists`：FAQ 数据
- `rare_list`：稀有度变体列表
- `img`：在线图片 URL（使用本地 `_img` 代替）
- `detail.illustrator`, `detail.copyright`, `detail.animation`：元数据

## 4. 数据转换规则

### 4.1 基础字段映射

| llocg_db 字段 | 数据库字段 | 转换规则 |
|---|---|---|
| `card_no` | `card_code` | 标准化（全角＋→半角+）后映射 |
| `type` | `card_type` | 枚举映射（见 4.2） |
| CN `card_name_cn` / JP `name` | `name` | 中文优先 |
| CN `ability` / JP `ability` | `card_text` | 中文优先 |
| `rare` | `rare` | 直接映射 |
| `product` | `product` | 直接映射 |
| `_img` | `image_filename` | 提取路径末尾文件名 |
| — | `status` | 固定为 `'DRAFT'` |

### 4.2 卡牌类型映射

| llocg_db 值（JP） | CN card_type | 数据库值 |
|---|---|---|
| `メンバー` | 13 | `MEMBER` |
| `ライブ` | 14 | `LIVE` |
| `エネルギー` | 15 | `ENERGY` |

### 4.3 成员卡专用字段

| llocg_db 字段 | 数据库字段 | 转换规则 |
|---|---|---|
| `cost` | `cost` | 直接映射（整数） |
| `blade` | `blade` | 直接映射（整数，null 保留） |
| `base_heart` | `hearts` | 颜色编号映射为 JSONB 数组（见 4.5） |
| `blade_heart` | `blade_hearts` | 映射为 BladeHeartItem 数组（见 4.6） |
| `unit` | `unit_name` | 直接映射 |
| `series` | `group_name` | 直接存储（多系列以换行分隔） |

### 4.4 Live 卡专用字段

| llocg_db 字段 | 数据库字段 | 转换规则 |
|---|---|---|
| `score` | `score` | 直接映射（整数） |
| `need_heart` | `requirements` | 颜色编号映射为 JSONB 数组（见 4.5） |
| `special_heart` | `blade_hearts` | 映射为 BladeHeartItem 数组（见 4.7） |

### 4.5 颜色编号映射

| 编号 | HeartColor | 含义 |
|---|---|---|
| `heart01` | `PINK` | 桃色 |
| `heart02` | `RED` | 红色 |
| `heart03` | `YELLOW` | 黄色 |
| `heart04` | `GREEN` | 绿色 |
| `heart05` | `BLUE` | 蓝色 |
| `heart06` | `PURPLE` | 紫色 |
| `heart0` | `RAINBOW` | 任意色（仅 Live 卡 requirements 中出现） |

**base_heart → hearts 转换示例：**

```
输入: { "heart01": 1, "heart03": 2, "heart06": 1 }
输出: [{"color": "PINK", "count": 1}, {"color": "YELLOW", "count": 2}, {"color": "PURPLE", "count": 1}]
```

**need_heart → requirements 转换示例：**

```
输入: { "heart01": 1, "heart03": 1, "heart0": 3 }
输出: [{"color": "PINK", "count": 1}, {"color": "YELLOW", "count": 1}, {"color": "RAINBOW", "count": 3}]
```

### 4.6 blade_heart 映射（成员卡）

| llocg_db 键 | BladeHeartItem | 说明 |
|---|---|---|
| `b_heart01` | `{ effect: "HEART", heartColor: "PINK" }` | 桃色心 |
| `b_heart02` | `{ effect: "HEART", heartColor: "RED" }` | 红色心 |
| `b_heart03` | `{ effect: "HEART", heartColor: "YELLOW" }` | 黄色心 |
| `b_heart04` | `{ effect: "HEART", heartColor: "GREEN" }` | 绿色心 |
| `b_heart05` | `{ effect: "HEART", heartColor: "BLUE" }` | 蓝色心 |
| `b_heart06` | `{ effect: "HEART", heartColor: "PURPLE" }` | 紫色心 |
| `b_all` | `{ effect: "HEART", heartColor: "RAINBOW" }` | 全色心 |

值为该效果的数量。若值 > 1，生成对应数量的 BladeHeartItem。

### 4.7 special_heart 映射（Live 卡）

| llocg_db 键 | BladeHeartItem | 说明 |
|---|---|---|
| `draw` | `{ effect: "DRAW" }` | 抽卡效果 |
| `score` | `{ effect: "SCORE" }` | 加分效果 |

值为该效果的数量。

## 5. 同步策略

| 卡牌状态 | 操作 | 说明 |
|---|---|---|
| 不存在 | **INSERT**（status=DRAFT） | 新卡入库，默认草稿状态 |
| DRAFT | **UPSERT（覆盖）** | 用最新数据覆盖全部字段 |
| PUBLISHED | **SKIP** | 保护已上线的管理员审核数据 |

DRAFT 卡牌被覆盖时，以下字段全部使用 llocg_db 最新数据：
- 基础字段：card_type, name, card_text, image_filename, rare, product
- 游戏数据：cost, blade, hearts, blade_hearts, score, requirements
- 分类数据：unit_name, group_name

支持批量 upsert，每批 100 条。

## 6. 数据库变更

**无需数据库变更。** 中文数据直接写入现有 `name` 和 `card_text` 字段（中文优先策略），不新增独立的中文列。

## 7. 图片同步

### 7.1 图片来源

| 来源 | 路径 | 结构 | 用途 |
|---|---|---|---|
| 日文卡图 | `llocg_db/img/cards/` | 按商品子目录（BP01/, BP02/, ...） | 主要卡图 |
| 中文卡图 | `llocg_db/img/cards_cn/` | 扁平结构 | 中文版卡图（如需） |

### 7.2 流程

1. 从 llocg_db submodule 读取原始图片
2. 复用现有 `compress-images.ts` 压缩为 thumb(100px) / medium(300px) / large(600px)
3. 复用现有 `upload-to-minio.ts` 上传到 MinIO
4. DRAFT 卡牌的图片可直接覆盖已有文件

### 7.3 图片文件名

使用卡牌的 `_img` 字段提取文件名（如 `PL!-sd1-001-SD.png`），与 `image_filename` 字段对应。

## 8. CLI 接口

### 8.1 数据同步

```bash
# 正式同步（需 Service Role Key）
SUPABASE_SERVICE_ROLE_KEY=xxx npx tsx src/scripts/sync-cards-llocg.ts

# 预览模式（不写入数据库）
npx tsx src/scripts/sync-cards-llocg.ts --dry-run
```

### 8.2 图片同步

图片压缩和上传为独立步骤，复用现有脚本：

```bash
# 压缩图片（指定 llocg_db 来源）
npx tsx src/scripts/compress-images.ts --source=llocg-db

# 上传到 MinIO
npx tsx src/scripts/upload-to-minio.ts
```

## 9. 执行摘要

同步完成后输出统计信息：

```
llocg_db Card Data Sync

Step 1: Reading llocg_db sources...
  cards.json: 1803 cards (MEMBER: 1069, LIVE: 175, ENERGY: 559)
  cards_cn.json: 1662 cards

Step 2: Transforming cards...
  Total: 1811 cards (CN matched: 1654, CN-only: 8)

Step 3: Checking existing cards in DB...
  Found 500 published + 200 draft cards

Step 4: Categorizing cards...
  New cards to insert: 1111
  Draft cards to update: 200
  Skipped (published): 500

Step 5: Syncing...
  ...

Summary:
  Read: 1811 (JP: 1803, CN matched: 1654, CN-only: 8)
  Inserted: 1111
  Updated (draft): 200
  Skipped (published): 500
  Failed: 0
```

## 10. 使用流程

```
1. 开发者更新 llocg_db submodule: git submodule update --remote
2. 运行数据同步: npx tsx src/scripts/sync-cards-llocg.ts
   - 新卡入库为 DRAFT
   - 已有 DRAFT 卡牌数据被覆盖更新
   - PUBLISHED 卡牌不受影响
3. 运行图片同步: npx tsx src/scripts/compress-images.ts --source=llocg-db
4. 上传图片: npx tsx src/scripts/upload-to-minio.ts
5. 管理员在后台查看 DRAFT 卡牌，确认数据无误后上线
```

## 11. 相关文档

- [爬虫管线需求文档](./requirements.md)
- [爬虫管线设计文档](./design.md)
- [自托管迁移文档](../self-hosted-migration.md)
- [卡牌数据管理需求](../card-data-management/requirements.md)
