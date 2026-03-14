# 卡牌数据同步管线 - 需求文档

> 版本: 1.1.0
> 创建日期: 2026-03-09
> 状态: 部分实现

## 1. 背景

项目已有一套 Python 爬虫程序（位于 `test/` 目录），能够从 Bushiroad Deck Log API 和官网获取 LoveLive! Official Card Game 的全量卡牌元数据及图片，输出为本地 JSON 文件。同时，项目已有自托管 PostgreSQL 数据库 `cards` 表，存储游戏所需的领域模型格式卡牌数据。

目前，每次官方发布新卡后，从爬虫输出到数据库入库的过程需要人工编写转换脚本、逐一校验字段格式、手动上传，流程繁琐且易出错。

## 2. 目标

搭建一条端到端的卡牌数据管线，覆盖从数据源到用户可见的完整链路：

```
官方数据源 → 爬虫(已有) → 本地 JSON → 同步脚本(新建) → 数据库(DRAFT)
  → 管理员审核/编辑/上线 → 数据库(PUBLISHED) → 普通用户可见
```

## 3. 功能需求

### 3.1 数据读取

- 读取爬虫输出的两个 JSON 文件：
  - `test/data/cards_full.json`：普通卡牌（成员卡 + Live 卡），含效果文本
  - `test/data/cards_energy.json`：能量卡

### 3.2 数据转换

将爬虫的原始字段格式转换为数据库所需的格式：

| 爬虫字段 | 数据库字段 | 转换规则 |
|---------|-----------|---------|
| `card_number` | `card_code` | 直接映射 |
| `card_kind` (M/L/E) | `card_type` (MEMBER/LIVE/ENERGY) | 枚举映射 |
| `name` | `name` | 直接映射 |
| `effect_text` | `card_text` | 直接映射（能量卡为 null） |
| `img` | `image_filename` | 直接映射 |
| `blade` (字符串) | `blade` (整数) | 解析："-"/""→null, "1"~"4"→对应数字, "ALL1"→1 |
| `rare` | `rare` | 直接映射 |
| `product` | `product` | 直接映射（能量卡为 null） |
| — | `status` | 固定为 `'DRAFT'`（新卡默认不可见） |

以下数据库字段**不由同步管线填充**，留空由管理员在后台手动补充：
- `cost`（成员卡费用）
- `hearts`（成员卡心图标）
- `blade_hearts`（应援棒心效果）
- `score`（Live 卡基础分数）
- `requirements`（Live 卡心需求）
- `group_name`（组合名）
- `unit_name`（小组名）

### 3.3 同步策略

- **INSERT-only**：仅插入数据库中不存在的卡牌（按 `card_code` 判断）
- 已存在的卡牌**不做任何更新**，保护管理员手动编辑的数据
- 新插入的卡牌 `status` 默认为 `DRAFT`，不对普通用户可见
- 支持批量插入，提高效率

### 3.4 去重

- 同一 `card_code` 在两个 JSON 文件中同时出现时，优先使用 `cards_full.json` 的数据（因其包含 effect_text 和 product）

### 3.5 预览模式

- 支持 `--dry-run` 参数，仅展示将要插入的卡牌列表和统计信息，不实际写入数据库
- 便于管理员在正式同步前确认数据正确性

### 3.6 执行摘要

同步完成后输出统计信息：
- 读取总数
- 跳过数（数据库已存在）
- 插入数
- 失败数（如有）

### 3.7 卡牌上线流程

同步脚本入库后，新卡处于 DRAFT 状态，需要管理员完成以下步骤后才对普通用户可见：

1. 管理员登录网站，进入卡牌数据管理页面
2. 查看 DRAFT 状态的卡牌列表
3. 补充缺失的游戏数据字段（cost、hearts、requirements 等）
4. 确认数据无误后，点击"上线"将卡牌状态改为 PUBLISHED
5. PUBLISHED 状态的卡牌对所有用户可见，可用于游戏和组卡

## 4. 数据库变更需求

### 4.1 新增字段

在 `cards` 表中新增以下字段：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|-------|------|
| `rare` | TEXT | null | 稀有度（R, R+, P, AR, SEC, SECL, L, RM, RE 等） |
| `product` | TEXT | null | 收录商品名（如 "ブースターパック Anniversary 2026"） |
| `status` | TEXT | `'DRAFT'` | 卡牌状态：`DRAFT`（草稿）或 `PUBLISHED`（已上线） |

### 4.2 RLS 策略变更

- 普通用户（anon + authenticated）仅能查询 `status = 'PUBLISHED'` 的卡牌
- 管理员可查询所有卡牌（DRAFT + PUBLISHED）
- 写操作权限不变（仍为仅管理员）

### 4.3 兼容性

- 新字段为可空或有默认值，不影响现有数据
- 现有卡牌的 `status` 应设为 `PUBLISHED`（已在线上使用的数据）
- 需同步更新 `import_cards()` 和 `export_cards()` 存储函数

## 5. 非功能需求

- **手动触发**：管理员通过 CLI 命令运行，不设定时任务
- **技术栈**：TypeScript，使用 `pg` 库直接连接 PostgreSQL
- **权限**：使用管理员数据库连接执行，绕过 RLS
- **图片管线独立**：图片下载、压缩、上传为独立流程，不纳入本管线

## 6. 使用流程

```
1. 管理员运行爬虫（Python）拉取最新官方数据到 test/data/
2. 管理员运行同步脚本（TypeScript）将新卡入库（status=DRAFT）
3. 管理员在后台管理界面查看 DRAFT 卡牌，补充 cost/hearts/requirements 等字段
4. 管理员确认数据无误后点击"上线"，卡牌变为 PUBLISHED 状态
5. 普通用户可见并可使用该卡牌
6.（可选）运行图片管线处理新卡图片
```
