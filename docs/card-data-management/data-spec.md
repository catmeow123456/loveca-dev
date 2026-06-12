# 卡牌数据规范

> 版本: 1.0.0
> 创建日期: 2026-03-13
> 最后更新: 2026-06-12
> 文档类型: 专题说明
> 适用范围: `cards` 表字段格式、卡牌同步脚本和管理界面输入约束
> 当前状态: 以 `src/server/db/schema.ts`、`src/domain/card-data/schema.ts` 和 `src/scripts/sync-cards-llocg.ts` 为准

本文档定义 `cards` 表中各字段的格式、约束和有效值，供管理员编辑卡牌和开发者编写同步脚本时参考。

## 1. card_code（卡牌编号）

唯一标识一张卡牌，格式为 **4 段连字符分隔**：`{系列前缀}-{商品代号}-{序号}-{稀有度}`。

**示例：** `PL!SP-bp2-009-R+`、`LL-E-001-SD`、`PL!-bp5-E01-PE`（能量卡变体）

### 1.1 系列前缀

| 前缀     | 系列                  | 卡数 |
| -------- | --------------------- | ---- |
| `PL!`    | LoveLive!             | ~317 |
| `PL!S`   | LoveLive! Sunshine!!  | ~338 |
| `PL!N`   | LoveLive! 虹咲        | ~490 |
| `PL!SP`  | LoveLive! Superstar!! | ~403 |
| `PL!HS`  | 蓮ノ空                | ~227 |
| `PL!SIM` | SIF2（联动）          | ~1   |
| `LL`     | 跨系列/通用           | ~26  |
| `PYHN`   | 幻日                  | 1    |

### 1.2 商品代号

| 代号        | 含义                  |
| ----------- | --------------------- |
| `sd1`       | 起始卡组 1            |
| `sd2`       | 起始卡组 2            |
| `bp1`~`bp6` | 补充包 vol.1~6        |
| `cl1`       | Collection/联动商品   |
| `pb1`       | 购入特典包            |
| `PR`        | PR 卡                 |
| `E`         | 能量卡（仅 `LL-E-*`） |

### 1.3 序号格式

序号通常为 3 位纯数字（如 `001`、`032`）。能量卡变体使用 `E` 前缀加数字（如 `E01`、`E15`）。

### 1.4 标准化规则

数据库中 card_code **统一使用半角 `+`**。

llocg_db 日文数据使用全角 `＋`（如 `LL-bp1-001-R＋`），中文数据使用半角 `+`（如 `LL-bp1-001-R+`）。同步脚本入库前自动标准化：`＋` → `+`。

此外，llocg_db 中存在非标准稀有度编号，同步脚本自动修复：

- `PR2` → `PR+`
- `PRproteinbar` → `PR`
- `PRLoveLive!Days` → `PR`

标准化逻辑统一在 `src/shared/utils/card-code.ts` 的 `normalizeCardCode()` 函数中实现。

## 2. card_type（卡牌类型）

| 值       | 含义    | 适用字段                                     |
| -------- | ------- | -------------------------------------------- |
| `MEMBER` | 成员卡  | cost, blade, hearts, blade_hearts, unit_name |
| `LIVE`   | Live 卡 | score, requirements, blade_hearts            |
| `ENERGY` | 能量卡  | 无额外字段                                   |

数据库有 CHECK 约束，仅接受以上三个值。

## 3. name（卡名）

- 类型: TEXT, NOT NULL
- **中文优先**：有中文数据时使用中文名，无中文时使用日文名
- 同一名称可以对应多张不同编号的卡（不同稀有度变体）
- 示例: `高坂穗乃果`、`START:DASH!!`、`能量`

## 4. card_text（效果文本）

- 类型: TEXT, nullable
- **中文优先**：同 name
- 能量卡通常为 null
- 来自 llocg_db 的日文文本包含图标标记语法：`{{icon.png|显示名}}`
- 中文文本使用 `【】` 标注关键词：`【登场】`、`【常时】`、`【LIVE成功时】`

## 5. 数值字段

### 5.1 cost（成员卡费用）

- 类型: INT, nullable
- 仅 MEMBER 卡使用
- 数据库未设置数值 CHECK；`src/domain/card-data/schema.ts` 要求非负整数
- 当前构筑筛选 UI 范围为 0 ~ 22
- llocg_db 已同步数据通常落在 2 ~ 22
- 表示出场所需的能量费用

### 5.2 blade（应援棒数）

- 类型: INT, nullable
- 仅 MEMBER 卡使用
- 数据库未设置数值 CHECK；`src/domain/card-data/schema.ts` 要求非负整数
- llocg_db 已同步数据通常落在 1 ~ 7
- null 表示该成员无应援棒

### 5.3 score（Live 卡分数）

- 类型: INT, nullable
- 仅 LIVE 卡使用
- 数据库未设置数值 CHECK；`src/domain/card-data/schema.ts` 要求正整数
- 当前构筑筛选 UI 范围为 0 ~ 10
- 表示 Live 成功时获得的基础胜利分数

## 6. hearts（成员卡心图标）

- 类型: JSONB, DEFAULT `'[]'`
- 仅 MEMBER 卡使用
- 格式: `HeartIcon[]`
- 每个元素包含颜色和数量，颜色必须来自有效颜色值，数量必须为正整数。

### 有效颜色值

| 值        | 含义   | 色标    |
| --------- | ------ | ------- |
| `PINK`    | 桃色   | heart01 |
| `RED`     | 红色   | heart02 |
| `YELLOW`  | 黄色   | heart03 |
| `GREEN`   | 绿色   | heart04 |
| `BLUE`    | 蓝色   | heart05 |
| `PURPLE`  | 紫色   | heart06 |
| `RAINBOW` | 万能色 | heart0  |

`count` 必须为正整数。

当前 `HeartIconSchema` 允许 `RAINBOW` 出现在任意 `HeartIcon[]` 中；实际同步数据通常只在 Live 的 `requirements` 或 `blade_hearts` 的 `heartColor` 中使用。

## 7. requirements（Live 卡心需求）

- 类型: JSONB, DEFAULT `'[]'`
- 仅 LIVE 卡使用
- 格式: 同 `HeartIcon[]`
- 每个元素表示一种颜色需求及所需数量。

使用与 hearts 相同的颜色枚举：

| 值        | 含义                               |
| --------- | ---------------------------------- |
| `RAINBOW` | 任意色（heart0），表示任意颜色需求 |

## 8. blade_hearts（应援棒心效果）

- 类型: JSONB, nullable
- MEMBER 卡和 LIVE 卡均可使用
- 格式: `BladeHeartItem[]`
- `HEART` 效果需要指定颜色；`DRAW` 与 `SCORE` 不需要颜色。

### 有效效果值

| effect  | heartColor                     | 含义               |
| ------- | ------------------------------ | ------------------ |
| `HEART` | 必填，颜色枚举值（含 RAINBOW） | 声援时公开的心颜色 |
| `DRAW`  | 不填                           | 声援时抽一张卡     |
| `SCORE` | 不填                           | Live 成功时分数 +1 |

- 成员卡: 通常只有 `HEART` 效果
- Live 卡: 通常只有 `DRAW` 或 `SCORE` 效果（来自 llocg_db 的 `special_heart`）

## 9. rare（稀有度）

- 类型: TEXT, nullable
- 有效值（24 种）：

| 稀有度 | 说明       |
| ------ | ---------- |
| `SD`   | 起始卡组   |
| `SD2`  | 起始卡组 2 |
| `N`    | 普通       |
| `R`    | 稀有       |
| `R+`   | 稀有+      |
| `P`    | 异画       |
| `P+`   | 异画+      |
| `AR`   | 动画稀有   |
| `CL`   | Collection |
| `L`    | 传说       |
| `L+`   | 传说+      |
| `SEC`  | 秘密       |
| `SEC+` | 秘密+      |
| `SECL` | 秘密传说   |
| `SECE` | 秘密能量   |
| `SECS` | 秘密起始   |
| `PR`   | 赠品       |
| `PR+`  | 赠品+      |
| `PE`   | 异画能量   |
| `PE+`  | 异画能量+  |
| `RE`   | 稀有能量   |
| `SRE`  | 超稀有能量 |
| `RM`   | 稀有成员   |
| `LLE`  | 传说能量   |

## 10. product（收录商品）

- 类型: TEXT, nullable
- 日文商品名，如 `スタートデッキラブライブ！`、`ブースターパック Anniversary 2026`
- 自动同步，一般无需手动编辑

## 11. unit_name（小组名）

- 类型: TEXT, nullable
- 仅 MEMBER 卡使用
- 入库标准格式为带 `「」` 的小组名。
- 有效值（22 个）：

| 系列        | 小组                                                   |
| ----------- | ------------------------------------------------------ |
| LoveLive!   | `「Printemps」`, `「BiBi」`, `「lilywhite」`, `「A-RISE」`, `「AiScReam」` |
| Sunshine!!  | `「CYaRon！」`, `「AZALEA」`, `「GuiltyKiss」`, `「SaintSnow」` |
| 虹咲        | `「A・ZU・NA」`, `「DiverDiva」`, `「QU4RTZ」`, `「R3BIRTH」` |
| Superstar!! | `「CatChu!」`, `「KALEIDOSCORE」`, `「5yncri5e!」`, `「SunnyPassion」` |
| 蓮ノ空      | `「スリーズブーケ」`, `「みらくらぱーく！」`, `「DOLLCHESTRA」`, `「EdelNote」` |

> 注意: `みらくらぱーく!`（半角 `!`）和 `みらくらぱーく！`（全角 `！`）在数据源中均有出现，入库统一为 `「みらくらぱーく！」`。

## 12. group_name（系列名）

- 类型: TEXT, nullable
- 来自 llocg_db 的 `series` 字段
- 可能为单一系列或多系列（换行分隔，联动卡牌）

| 值                                             | 含义                  |
| ---------------------------------------------- | --------------------- |
| `ラブライブ！`                                 | LoveLive!             |
| `ラブライブ！サンシャイン!!`                   | LoveLive! Sunshine!!  |
| `ラブライブ！虹ヶ咲学園スクールアイドル同好会` | LoveLive! 虹咲        |
| `ラブライブ！スーパースター!!`                 | LoveLive! Superstar!! |
| `蓮ノ空女学院スクールアイドルクラブ`           | 蓮ノ空                |
| 多系列（`\n` 分隔）                            | 联动卡牌              |

## 13. status（卡牌状态）

- 类型: TEXT, NOT NULL, DEFAULT `'DRAFT'`
- 有效值：

| 值          | 含义   | 可见性       |
| ----------- | ------ | ------------ |
| `DRAFT`     | 草稿   | 仅管理员可见 |
| `PUBLISHED` | 已上线 | 所有用户可见 |

当前状态来源需要区分：

- 管理界面新建卡默认进入 `DRAFT`。
- 当前维护的同步脚本会把同步记录写入 `PUBLISHED`，具体风险和审核策略见 [卡牌数据同步需求](../card-data-sync/requirements.md)。
- 同步脚本不属于“草稿导入后再逐张上线”的流程；若需要草稿导入，应作为独立需求设计。

## 14. image_filename（图片文件名）

- 类型: TEXT, nullable
- 格式: 文件名（不含路径），如 `PL!-sd1-001-SD.png`
- 对应 Minio 中的图片文件
- 图片管线会生成三种尺寸：thumb(100px) / medium(300px) / large(600px)

## 15. 各类型卡牌必填字段

| 字段           | MEMBER | LIVE   | ENERGY |
| -------------- | ------ | ------ | ------ |
| card_code      | 必填   | 必填   | 必填   |
| card_type      | 必填   | 必填   | 必填   |
| name           | 必填   | 必填   | 必填   |
| cost           | 建议填 | -      | -      |
| blade          | 建议填 | -      | -      |
| hearts         | 建议填 | -      | -      |
| blade_hearts   | 可选   | 可选   | -      |
| score          | -      | 建议填 | -      |
| requirements   | -      | 建议填 | -      |
| card_text      | 可选   | 可选   | -      |
| unit_name      | 可选   | -      | -      |
| group_name     | 可选   | 可选   | -      |
| rare           | 建议填 | 建议填 | 建议填 |
| product        | 可选   | 可选   | 可选   |
| image_filename | 建议填 | 建议填 | 建议填 |

"建议填"表示 PUBLISHED 前应补充完整，"可选"表示可为 null。
