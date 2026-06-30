# llocg_db 与 loveca Excel 数据源格式差异调查

> 文档类型：历史/调查文档
> 适用范围：`llocg_db` 与 Loveca Excel 两类上游数据源的字段格式、数据质量和接入背景
> 当前状态：历史调查；当前同步职责边界以 [卡牌数据同步管线设计](./design.md) 为准
> 调查日期：2026-06-26
> 调查对象：`llocg_db/json/cards.json`、`llocg_db/json/cards_cn.json`、`docs/card-data-sync/sources/loveca_20260626015115.xlsx`
> 现有同步入口：`src/scripts/sync-cards-llocg.ts`
> 现有落库目标：PostgreSQL `public.cards`

本文记录两个数据源的实际格式、字段值域、现有入库映射，以及将 Excel 数据接入当前同步管线前需要处理的差异。

> 2026-06-26 落地决策：本轮直接调整 schema，数据库不保留重复展示字段。`cards` 表使用 `name_jp` / `name_cn`、`card_text_jp` / `card_text_cn`、`work_names` / `group_names` 表达中日文本和归属结构；旧 `name` / `card_text` / `group_name` 不再作为 DB 列存在。运行时展示用的 `card.data.name` / `card.data.cardText` 由 registry 与前端 mapper 派生。2026-06-30 起运行时不再派生 `card.data.groupName`，真实团体只通过结构化 `card.data.groupNames` 暴露。Loveca Excel 同步入口为 `src/scripts/sync-cards-loveca-excel.ts`，只更新文本/展示/来源字段，不覆盖规则字段；Excel 官方 `作品名` / `参加ユニット` 存在已知修正问题，本轮不读取这两列。

## 1. 总览

当前有两类数据源：

| 来源         | 文件                                                                | 根结构                      | 当前用途                        | 规则结构化程度                                                                  |
| ------------ | ------------------------------------------------------------------- | --------------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| llocg JP     | `llocg_db/json/cards.json`                                          | 以卡号为 key 的 JSON object | 当前主数据源                    | 高，包含费用、基础 Heart、BLADE、LIVE 分数、必要 Heart、BLADE Heart、特殊 Heart |
| llocg CN     | `llocg_db/json/cards_cn.json`                                       | 以卡号为 key 的 JSON object | 当前中文补充源和少量 CN-only 卡 | 中低，中文文本完整，但结构化 Heart 字段主要是字符串展示字段                     |
| Loveca Excel | `docs/card-data-sync/sources/loveca_20260626015115.xlsx` / `sheet1` | 单 sheet 扁平表，24 列      | 新数据源候选                    | 高，已把日文/中文文本、团体/小队、Heart、商品编号、云端图链整理为列             |

关键差异：

- `llocg_db` 是双 JSON 合并：JP 负责结构化规则字段，CN 负责中文名和中文效果文本。
- Excel 是单表扁平源：同一行同时有日文文本、中文文本、真实团体、真实小队、结构化 Heart 和商品编号。
- 旧数据库 `cards` 表只有单语言展示字段；本轮 schema 已补齐中日名称/效果、作品数组、真实团体数组、商品编号、数据标识和云端图链来源字段。
- Excel 的 Heart 颜色 key 与 `llocg_db` 完全不同，需要新的颜色映射。
- Excel 包含当前数据库没有的 19 个标准化卡号，也缺少当前数据库已有的 33 个标准化卡号。
- Excel 有几类导入前必须处理的数据质量问题：重复卡号、空卡名能量、异常稀有度、能量卡 `コスト=-1`、小队名格式差异。

## 2. 当前落库模型

当前 `public.cards` 实际列：

| 列                                         | 类型     | nullable | 当前同步来源                                 |
| ------------------------------------------ | -------- | -------- | -------------------------------------------- |
| `id`                                       | uuid     | no       | 数据库生成                                   |
| `card_code`                                | text     | no       | 标准化卡号                                   |
| `card_type`                                | text     | no       | `MEMBER` / `LIVE` / `ENERGY`                 |
| `name_jp`                                  | text     | yes      | Loveca Excel / JP 原始日文卡名               |
| `name_cn`                                  | text     | yes      | Loveca Excel / CN 中文卡名                   |
| `work_names`                               | jsonb    | yes      | llocg_db `series` / 旧库迁移 / 人工维护      |
| `group_names`                              | jsonb    | yes      | Loveca Excel `真实团体` JSON array           |
| `unit_name`                                | text     | yes      | 当前来自 JP `unit`，入库时包成 `「...」`     |
| `unit_name_raw`                            | text     | yes      | Loveca Excel `真实小队` 原始清洗值           |
| `cost`                                     | integer  | yes      | MEMBER 费用                                  |
| `blade`                                    | integer  | yes      | MEMBER BLADE 数                              |
| `hearts`                                   | jsonb    | yes      | `[{ "color": "...", "count": n }]`           |
| `blade_hearts`                             | jsonb    | yes      | `[{ "effect": "...", "heartColor": "..." }]` |
| `score`                                    | integer  | yes      | LIVE 分数                                    |
| `requirements`                             | jsonb    | yes      | LIVE 必要 Heart                              |
| `card_text_jp`                             | text     | yes      | Loveca Excel / JP 日文效果文本               |
| `card_text_cn`                             | text     | yes      | Loveca Excel / CN 中文效果文本               |
| `image_filename`                           | text     | yes      | 当前是图片 basename                          |
| `image_source_uri`                         | text     | yes      | Loveca Excel `卡图链接` 原始来源 URI         |
| `rare`                                     | text     | yes      | 稀有度                                       |
| `product`                                  | text     | yes      | 收录商品名                                   |
| `product_code`                             | text     | yes      | Loveca Excel `商品编号`                      |
| `source_external_id`                       | text     | yes      | Loveca Excel `数据标识`                      |
| `source_flags`                             | jsonb    | yes      | 同步来源与冲突标记                           |
| `status`                                   | text     | no       | 当前同步统一写 `PUBLISHED`                   |
| `created_at` / `updated_at` / `updated_by` | metadata | mixed    | 数据库 / API 维护                            |

当前数据库状态：

| 项                | 值                                                           |
| ----------------- | ------------------------------------------------------------ |
| 总卡数            | 2285                                                         |
| 状态              | 2285 张均为 `PUBLISHED`                                      |
| 类型分布          | MEMBER 1355, LIVE 254, ENERGY 676                            |
| MEMBER 结构化字段 | `cost` 1355, `blade` 1264, `hearts` 1338, `blade_hearts` 749 |
| LIVE 结构化字段   | `score` 254, `requirements` 254, `blade_hearts` 234          |

## 3. llocg_db JP 格式：`cards.json`

### 3.1 根结构

`cards.json` 是一个 object，key 为原始卡号，value 为卡牌对象。

统计：

| 项               | 值                                |
| ---------------- | --------------------------------- |
| 原始 key 数      | 2280                              |
| 标准化后唯一卡号 | 2278                              |
| 原始类型分布     | MEMBER 1356, LIVE 254, ENERGY 670 |
| 标准化重复组     | 2 组                              |

标准化重复组：

| 标准化卡号        | 原始 key                                       |
| ----------------- | ---------------------------------------------- |
| `PL!N-bp1-019-PR` | `PL!N-bp1-019-PR`, `PL!N-bp1-019-PRproteinbar` |
| `LL-PR-007-PR`    | `LL-PR-007-PR`, `LL-PR-007-PRLoveLive!Days`    |

当前 `normalizeCardCode()` 会处理：

- 全角 `＋` -> 半角 `+`
- `PR2` -> `PR+`
- `PRproteinbar` -> `PR`
- `PRLoveLive!Days` -> `PR`

因此 JP 原始数据里部分不同图片/版本会在入库时撞到同一个 `card_code`，当前脚本以遍历顺序后出现的记录覆盖前一个记录。

### 3.2 顶层字段

| 字段            | 类型   | 出现数 | 空值数 | 说明                                   |
| --------------- | ------ | -----: | -----: | -------------------------------------- | ----------- |
| `card_no`       | string |   2280 |      0 | 卡号，通常等于 root key                |
| `img`           | string |   2280 |      0 | 官方 HTTPS 图片 URL                    |
| `name`          | string |   2280 |     30 | 日文卡名；部分能量卡为空字符串         |
| `product`       | string |   2280 |      0 | 日文收录商品名，格式紧凑，很多值无空格 |
| `type`          | string |   2280 |      0 | 日文卡牌类型                           |
| `series`        | string |   2210 |      0 | 作品/系列；部分 PR/联动卡缺失          |
| `rare`          | string |   2280 |      0 | 稀有度，原始值可含全角 `＋`            |
| `faq`           | array  |   2280 |   1893 | FAQ 列表                               |
| `rare_list`     | array  |   2280 |      0 | 同编号/相关罕度列表                    |
| `_img`          | string |   2280 |      0 | 本地相对图片路径                       |
| `unit`          | string |   1924 |      0 | 小队名                                 |
| `cost`          | number |   1356 |      0 | 成员费用                               |
| `base_heart`    | object |   1356 |     17 | 成员基础 Heart                         |
| `blade`         | number |   1265 |      0 | 成员 BLADE 数                          |
| `ability`       | string |   1373 |      0 | 日文效果文本，含 `{{icon.png           | ...}}` 标记 |
| `blade_heart`   | object |    960 |      5 | BLADE Heart 结构                       |
| `score`         | number |    254 |      0 | LIVE 分数                              |
| `need_heart`    | object |    254 |      0 | LIVE 必要 Heart                        |
| `special_heart` | object |    111 |     68 | BLADE 触发的抽卡/加分等特殊效果        |

### 3.3 JP 枚举和值域

`type`：

| 原始值       | 入库值   | 数量 |
| ------------ | -------- | ---: |
| `メンバー`   | `MEMBER` | 1356 |
| `ライブ`     | `LIVE`   |  254 |
| `エネルギー` | `ENERGY` |  670 |

`rare` 观察到 29 种：

`N`, `P`, `R`, `PR`, `L`, `PE`, `P+`, `SD`, `PE+`, `SRE`, `SECE`, `LLE`, `R+`, `SEC`, `AR`, `SD2`, `SRL`, `PR+`, `RE`, `CL`, `RM`, `PP`, `P＋`, `L+`, `SECL`, `SEC+`, `SECS`, `PR＋`, `DUO`。

注意：`P＋`、`PR＋` 是全角加号形式；`PP`、`SRL`、`DUO` 不在当前 `src/shared/utils/card-code.ts` 的 `VALID_RARITIES` 中，但数据库没有 rare CHECK。

`series` 观察到的主要值：

- `ラブライブ！`
- `ラブライブ！サンシャイン!!`
- `ラブライブ！虹ヶ咲学園スクールアイドル同好会`
- `ラブライブ！スーパースター!!`
- `蓮ノ空女学院スクールアイドルクラブ`
- 以及少量多系列字符串，使用换行符 `\n` 拼接。

`unit` 观察到 23 种，包括：

`5yncri5e!`, `QU4RTZ`, `CatChu!`, `KALEIDOSCORE`, `A・ZU・NA`, `Printemps`, `CYaRon！`, `GuiltyKiss`, `AZALEA`, `R3BIRTH`, `lilywhite`, `スリーズブーケ`, `BiBi`, `DOLLCHESTRA`, `DiverDiva`, `みらくらぱーく！`, `EdelNote`, `みらくらぱーく!`, `SaintSnow`, `SunnyPassion`, `A-RISE`, `AiScReam`, `Aqours/SaintSnow`。

数值字段：

| 字段    | 语义       | 观察情况                                                    |
| ------- | ---------- | ----------------------------------------------------------- |
| `cost`  | 成员费用   | number，主要为 2, 4, 5, 7, 8, 9, 10, 11, 13, 15, 17, 20, 22 |
| `blade` | 成员 BLADE | number，当前入库后 MEMBER 中有 0 到 7，缺失会入库为 null    |
| `score` | LIVE 分数  | number，当前观察到 0 到 9                                   |

### 3.4 JP Heart 字段

`base_heart` / `need_heart` 使用官方 key：

| JP key    | 内部颜色                                 |
| --------- | ---------------------------------------- |
| `heart01` | `PINK`                                   |
| `heart02` | `RED`                                    |
| `heart03` | `YELLOW`                                 |
| `heart04` | `GREEN`                                  |
| `heart05` | `BLUE`                                   |
| `heart06` | `PURPLE`                                 |
| `heart0`  | `RAINBOW`，主要用于 LIVE 任意 Heart 需求 |

`blade_heart` 使用另一套 key：

| JP key      | 内部效果                                     |
| ----------- | -------------------------------------------- |
| `b_heart01` | `{ effect: "HEART", heartColor: "PINK" }`    |
| `b_heart02` | `{ effect: "HEART", heartColor: "RED" }`     |
| `b_heart03` | `{ effect: "HEART", heartColor: "YELLOW" }`  |
| `b_heart04` | `{ effect: "HEART", heartColor: "GREEN" }`   |
| `b_heart05` | `{ effect: "HEART", heartColor: "BLUE" }`    |
| `b_heart06` | `{ effect: "HEART", heartColor: "PURPLE" }`  |
| `b_all`     | `{ effect: "HEART", heartColor: "RAINBOW" }` |

`special_heart`：

| JP key  | 内部效果              |
| ------- | --------------------- |
| `draw`  | `{ effect: "DRAW" }`  |
| `score` | `{ effect: "SCORE" }` |

当前同步脚本把 `blade_heart` 与 `special_heart` 合并写入 `blade_hearts`。

### 3.5 JP 嵌套数组

`faq[]` 结构：

| 字段                 | 类型   | 说明                         |
| -------------------- | ------ | ---------------------------- |
| `title`              | string | 如 `Q79（2025.09.15）`       |
| `question`           | string | 日文问题文本，可能含图标标记 |
| `answer`             | string | 日文回答文本                 |
| `relation[]`         | array  | 相关卡列表                   |
| `relation[].card_no` | string | 相关卡号                     |
| `relation[].name`    | string | 相关卡名                     |

`rare_list[]` 结构：

| 字段      | 类型   |
| --------- | ------ |
| `card_no` | string |
| `name`    | string |

当前 `cards` 表没有 FAQ 或 rare_list 的落库字段。

## 4. llocg_db CN 格式：`cards_cn.json`

### 4.1 根结构

`cards_cn.json` 同样是以卡号为 key 的 JSON object。

统计：

| 项               | 值                            |
| ---------------- | ----------------------------- |
| 原始 key 数      | 2032                          |
| 标准化后唯一卡号 | 2032                          |
| 类型分布         | `13` 1221, `14` 216, `15` 595 |
| 标准化重复组     | 0                             |

CN 与 JP 合并时，当前脚本先标准化卡号。dry-run 结果：

| 项           |   值 |
| ------------ | ---: |
| JP 原始卡    | 2280 |
| CN 匹配 JP   | 2025 |
| CN-only      |    7 |
| 最终同步记录 | 2285 |

CN-only 的 7 张是 `PL!N-bp3-032-PE`, `PL!N-bp3-032-PE+`, `PL!N-bp3-033-PE`, `PL!N-bp3-033-PE+`, `PL!N-bp3-034-PE`, `PL!N-bp3-034-PE+`, `PL!N-bp3-035-PE+`。

### 4.2 顶层字段

| 字段                   | 类型        | 出现数 | 空值数 | 说明                                    |
| ---------------------- | ----------- | -----: | -----: | --------------------------------------- |
| `version_id`           | number      |   2032 |      0 | CN 版本 ID                              |
| `card_name_org`        | string      |   2032 |      0 | 原文卡名                                |
| `card_name_alias`      | string      |   2032 |    595 | 别名，常含中文名 + 基础编号             |
| `card_id`              | number      |   2032 |      0 | CN 卡 ID                                |
| `image`                | string      |   2032 |      0 | OSS HTTPS 图片 URL                      |
| `card_prefix`          | string      |   2032 |   2032 | 当前均为空                              |
| `status`               | number      |   2032 |      0 | 当前均为 `0`                            |
| `card_type`            | number      |   2032 |      0 | 数字类型                                |
| `level`                | number/null |   2032 |   1816 | LIVE 等级/点数类字段，只有 216 张非空   |
| `is_common_card`       | number      |   2032 |      0 | 当前均为 `0`                            |
| `can_join_main_deck`   | number      |   2032 |      0 | 主卡组可用标记                          |
| `can_join_engery_deck` | number      |   2032 |      0 | 能量卡组可用标记，字段名拼写为 `engery` |
| `card_name_cn`         | string      |   2032 |      0 | 中文卡名                                |
| `detail`               | object      |   2032 |      0 | 详细字段                                |
| `_img`                 | string      |   2032 |      0 | 本地相对图片路径                        |

`card_type` 数字映射：

| CN 值 | 入库值   | 数量 |
| ----: | -------- | ---: |
|    13 | `MEMBER` | 1221 |
|    14 | `LIVE`   |  216 |
|    15 | `ENERGY` |  595 |

`can_join_main_deck` / `can_join_engery_deck`：

| 字段                   | 值域              |
| ---------------------- | ----------------- |
| `can_join_main_deck`   | `1` 1437, `0` 595 |
| `can_join_engery_deck` | `0` 1437, `1` 595 |

### 4.3 `detail` 字段

| 字段                               | 类型        | 出现数 | 空值数 | 说明                        |
| ---------------------------------- | ----------- | -----: | -----: | --------------------------- |
| `detail.version_id`                | number      |   2032 |      0 | 与顶层重复                  |
| `detail.card_id`                   | number      |   2032 |      0 | 与顶层重复                  |
| `detail.card_name_org`             | string      |   2032 |      0 | 与顶层重复                  |
| `detail.card_name_cn`              | string      |   2032 |      0 | 与顶层重复                  |
| `detail.image`                     | string      |   2032 |      0 | 与顶层重复                  |
| `detail.card_type`                 | number      |   2032 |      0 | 与顶层重复                  |
| `detail.ability`                   | string      |   2032 |    651 | 中文效果文本                |
| `detail.flavor`                    | string      |   2032 |   2032 | 当前均为空                  |
| `detail.card_number`               | string      |   2032 |      0 | 卡号                        |
| `detail.rarity`                    | string      |   2032 |      0 | 稀有度                      |
| `detail.illustrator`               | string      |   2032 |   2032 | 当前均为空                  |
| `detail.cost`                      | number/null |   2032 |    811 | 成员费用                    |
| `detail.trigger_count`             | number/null |   2032 |    811 | 成员 BLADE 数               |
| `detail.trigger`                   | string      |   2032 |    647 | 应援心展示字符串            |
| `detail.participation_unit`        | string/null |   2032 |    810 | 小队/参加单位数字 ID 字符串 |
| `detail.animation`                 | string/null |   2032 |    734 | 动画/作品数字 ID 字符串     |
| `detail.level`                     | number/null |   2032 |   1816 | 与顶层重复                  |
| `detail.copyright`                 | string      |   2032 |    328 | 版权标记                    |
| `detail.display_attacks`           | string      |   2032 |    595 | Heart 展示字符串            |
| `detail.pack_lists`                | array       |   2032 |     83 | 收录包列表                  |
| `detail.faq_lists`                 | array       |   2032 |   1990 | 中文 FAQ 列表               |
| `detail.top_deck_collection_lists` | array       |   2032 |   2032 | 当前均为空                  |

`detail.trigger` 不是稳定结构化字段。观察到 37 种字符串，常见形式包括：

`-`, `紫1`, `黄1`, `蓝1`, `ALL1-`, `粉1`, `绿1`, `红1`, `-得分`, `ALL`, `红`, `黄`, `蓝`, `紫`, `绿`, `[全ブレード]-`, `粉`, `紫1抽卡`, `粉1抽卡`, `蓝1抽卡`, `得分`, `红1抽卡`, `黄1抽卡`, `-[得分]`, `绿1抽卡`, `红抽卡`, `粉抽卡`, `粉1[抽卡]`, `绿抽卡` 等。

`detail.display_attacks` 有 396 种字符串组合，例如 `粉3绿3紫3`、`红2绿2蓝2`、`粉1黄1紫1`。它可用于展示或校验，但不如 JP/Excel 的 JSON Heart 字段适合直接入库。

`detail.pack_lists[]`：

| 字段          | 类型   | 说明                          |
| ------------- | ------ | ----------------------------- |
| `id`          | number | 包 ID                         |
| `pack_name`   | string | 中文包名                      |
| `card_prefix` | string | 观察到 `Loveca` / `Lovaca` 等 |
| `released_at` | string | `YYYY-MM-DD HH:mm:ss`         |

`detail.faq_lists[]`：

| 字段             | 类型   | 说明                    |
| ---------------- | ------ | ----------------------- |
| `version_number` | string | FAQ 所属卡号            |
| `times`          | string | 日期，如 `2025-02-07`   |
| `question`       | string | 中文问题，可能含 `<br>` |
| `answer`         | string | 中文回答，可能含 `<br>` |
| `bushiroad_id`   | string | 如 `Q62`                |

当前 `sync-cards-llocg.ts` 对 CN 数据只使用中文名称、中文效果、CN-only 的基本字段和图片 basename，不解析 `trigger`、`display_attacks`、`pack_lists` 或 FAQ。

## 5. Excel 格式：`docs/card-data-sync/sources/loveca_20260626015115.xlsx`

### 5.1 工作簿结构

| 项       | 值       |
| -------- | -------- |
| sheet 数 | 1        |
| sheet 名 | `sheet1` |
| 总行数   | 2275     |
| 表头行   | 第 1 行  |
| 数据行   | 2274     |
| 列数     | 24       |

Excel 列顺序：

1. `多行日文效果`
2. `多行中文效果`
3. `真实团体`
4. `真实小队`
5. `カード名`
6. `卡牌中文名`
7. `カード番号`
8. `卡图链接`
9. `カードタイプ`
10. `レアリティ`
11. `コスト`
12. `匹配应援心`
13. `ブレードハート`
14. `特殊ハート`
15. `ブレード`
16. `基本ハート`
17. `必要ハート`
18. `スコア`
19. `収録商品`
20. `商品编号`
21. `点数`
22. `作品名`
23. `参加ユニット`
24. `数据标识`

注意：直接读取 XML 时大多数值表现为字符串。接入时应按列语义显式转换，不要依赖 XLSX 库的自动类型推断。

### 5.2 Excel 字段统计

| 列               | 非空 |   空 | unique | 语义/格式                                        |
| ---------------- | ---: | ---: | -----: | ------------------------------------------------ |
| `多行日文效果`   | 1374 |  900 |    697 | 日文效果文本，可多段，保留换行                   |
| `多行中文效果`   | 1373 |  901 |    707 | 中文效果文本，可多段，保留换行                   |
| `真实团体`       | 2254 |   20 |     19 | JSON array string，如 `["Liella!"]`              |
| `真实小队`       | 1920 |  354 |     19 | 小队名字符串，部分有前导 tab                     |
| `カード名`       | 2268 |    6 |    322 | 日文卡名，6 张能量卡为空                         |
| `卡牌中文名`     | 2268 |    6 |    320 | 中文卡名，6 张能量卡为空                         |
| `カード番号`     | 2274 |    0 |   2271 | 卡号，存在 3 个重复卡号                          |
| `卡图链接`       | 2274 |    0 |   2273 | `cloud://.../cardlist/...`                       |
| `カードタイプ`   | 2274 |    0 |      3 | 日文类型                                         |
| `レアリティ`     | 2274 |    0 |     29 | 稀有度，存在 1 行异常值                          |
| `コスト`         | 1354 |  920 |     14 | 整数语义，含 1 行 `-1` 异常                      |
| `匹配应援心`     | 1004 | 1270 |     14 | JSON array string，颜色/特殊效果汇总             |
| `ブレードハート` |  960 | 1314 |      8 | 单值字符串，颜色或 `all` / `bonus`               |
| `特殊ハート`     |  106 | 2168 |      2 | JSON object string，如 `{"draw":1}`              |
| `ブレード`       | 1333 |  941 |      8 | 整数语义，0 到 7                                 |
| `基本ハート`     | 1338 |  936 |    231 | JSON object string，颜色 -> 数量                 |
| `必要ハート`     |  257 | 2017 |    187 | JSON object string，颜色 -> 数量                 |
| `スコア`         |  254 | 2020 |     10 | LIVE 分数，0 到 9                                |
| `収録商品`       | 2274 |    0 |     22 | 日文收录商品名，格式带空格                       |
| `商品编号`       | 2274 |    0 |     22 | 商品短代码，如 `BP05`                            |
| `点数`           | 1475 |  799 |      5 | 非当前 LIVE score；多数为 0，语义需确认          |
| `作品名`         | 2180 |   94 |     14 | JSON array string，作品全名                      |
| `参加ユニット`   | 1915 |  359 |     22 | 小队名，部分有前导 tab，与 `真实小队` 不完全一致 |
| `数据标识`       | 2274 |    0 |   2274 | 唯一外部标识，很多值有前导 tab                   |

### 5.3 Excel 枚举和值域

`カードタイプ`：

| 原始值       | 入库值   | 数量 |
| ------------ | -------- | ---: |
| `メンバー`   | `MEMBER` | 1355 |
| `ライブ`     | `LIVE`   |  257 |
| `エネルギー` | `ENERGY` |  662 |

`レアリティ` 观察到 29 种：

`N`, `P`, `R`, `PR`, `L`, `PE`, `P+`, `SD`, `PE+`, `SRE`, `SECE`, `LLE`, `R+`, `SEC`, `AR`, `SD2`, `SRL`, `CL`, `RE`, `PR+`, `RM`, `PP`, `P＋`, `L+`, `SECL`, `SEC+`, `SECS`, `DUO`, `PL!SP-bp7-014-N`。

异常：`PL!SP-bp7-014-N` 出现在 `レアリティ` 列，应该不是合法稀有度。

`コスト` 观察到：

`4`, `9`, `2`, `11`, `13`, `15`, `7`, `5`, `10`, `17`, `20`, `22`, `8`, `-1`。

异常：`PL!-PR-016-PR+` 是能量卡，但 `コスト=-1`。当前 `cards.cost` 只对 MEMBER 有意义，导入时应忽略 ENERGY 的 `コスト` 或先修正源数据。

`ブレード` 观察到：

`0`, `1`, `2`, `3`, `4`, `5`, `6`, `7`。

`スコア` 观察到：

`0`, `1`, `2`, `3`, `4`, `5`, `6`, `7`, `8`, `9`。

`商品编号` 观察到 22 种：

`BP05`, `PR`, `BP01`, `BP04`, `BP02`, `BP03`, `BP06`, `PBN`, `PBSP02`, `PBLL`, `PBLS`, `PBHS`, `PBSP`, `SPSD02`, `NSD01`, `SPSD01`, `PLSD01`, `SSD01`, `HSSD01`, `CLHS01`, `BP07`, `NSD02`。

`収録商品` 观察到 22 种，和 `商品编号` 对应。相比 JP `product`，Excel 商品名更可读，通常带空格，如：

- `ブースターパック Anniversary 2026`
- `ブースターパック Royal Holiday`
- `プレミアムブースター ラブライブ！スーパースター!! DUO`
- `ブースターパック MELLOW MOMENT`
- `スタートデッキ ラブライブ！虹ヶ咲学園スクールアイドル同好会 cheer`

### 5.4 Excel Heart 字段

Excel 的 Heart key 使用英文颜色，不使用 JP 的 `heart01` 形式。

`基本ハート` / `必要ハート` JSON key：

| Excel key | 内部颜色                             |
| --------- | ------------------------------------ |
| `pink`    | `PINK`                               |
| `red`     | `RED`                                |
| `yellow`  | `YELLOW`                             |
| `green`   | `GREEN`                              |
| `blue`    | `BLUE`                               |
| `purple`  | `PURPLE`                             |
| `any`     | `RAINBOW`，用于 LIVE 任意 Heart 需求 |

`基本ハート` 观察到的 key 频次：

| key      | 出现卡数 |
| -------- | -------: |
| `purple` |      621 |
| `yellow` |      525 |
| `red`    |      522 |
| `blue`   |      459 |
| `pink`   |      449 |
| `green`  |      414 |

`必要ハート` 观察到的 key 频次：

| key      | 出现卡数 |
| -------- | -------: |
| `any`    |      241 |
| `purple` |      123 |
| `red`    |      103 |
| `yellow` |       97 |
| `blue`   |       89 |
| `pink`   |       81 |
| `green`  |       79 |

`ブレードハート` 是单值字符串：

| 原始值   | 数量 | 建议映射               |
| -------- | ---: | ---------------------- |
| `purple` |  172 | `HEART` / `PURPLE`     |
| `red`    |  147 | `HEART` / `RED`        |
| `all`    |  143 | `HEART` / `RAINBOW`    |
| `yellow` |  143 | `HEART` / `YELLOW`     |
| `blue`   |  129 | `HEART` / `BLUE`       |
| `pink`   |  116 | `HEART` / `PINK`       |
| `green`  |  109 | `HEART` / `GREEN`      |
| `bonus`  |    1 | 需要确认，疑似 `SCORE` |

`特殊ハート` 是 JSON object string：

| 原始值        | 数量 | 建议映射                               |
| ------------- | ---: | -------------------------------------- |
| `{"draw":1}`  |   61 | `{ effect: "DRAW" }`                   |
| `{"bonus":1}` |   45 | 疑似 `{ effect: "SCORE" }`，需确认命名 |

`匹配应援心` 是 JSON array string，像是把 `ブレードハート` 和 `特殊ハート` 合成后的展示/匹配字段：

| 原始值类型  | 示例                                  |
| ----------- | ------------------------------------- |
| 单颜色      | `["purple"]`, `["red"]`, `["all"]`    |
| 特殊效果    | `["bonus"]`                           |
| 颜色 + 抽卡 | `["red","draw"]`, `["purple","draw"]` |

建议：入库 `blade_hearts` 时优先解析 `ブレードハート` + `特殊ハート`，把 `匹配应援心` 作为校验字段，不作为唯一来源。原因是当前内部模型需要保留 `{ effect, heartColor }` 结构，而 `匹配应援心` 把颜色和特殊效果压成了同一个 token 数组。

### 5.5 Excel 团体/小队字段

Excel 有四个和归属相关的列：

| 列             | 格式                        | 示例                                         | 当前 `cards` 表是否可直接表达 |
| -------------- | --------------------------- | -------------------------------------------- | ----------------------------- |
| `真实团体`     | JSON array string，短团体名 | `["Liella!"]`, `["μ’s","Aqours"]`            | 写入 `group_names`            |
| `作品名`       | JSON array string，作品全名 | `["ラブライブ！スーパースター!!"]`           | 不读取；官方列存在修正问题    |
| `真实小队`     | string                      | `KALEIDOSCORE`, `\t5yncri5e!`                | 可清洗后映射到 `unit_name`    |
| `参加ユニット` | string                      | `lily white`, `Edel Note`, `みらくらぱーく!` | 不读取；官方列存在修正问题    |

`真实团体` JSON array 观察到的成员：

`Liella!`, `虹ヶ咲`, `蓮ノ空`, `Aqours`, `μ’s`, `Saint Snow`, `A-RISE`, `Sunny Passion`。

`作品名` JSON array 观察到的成员：

`ラブライブ！スーパースター!!`, `ラブライブ！虹ヶ咲学園スクールアイドル同好会`, `蓮ノ空女学院スクールアイドルクラブ`, `ラブライブ！サンシャイン!!`, `ラブライブ！`。

旧 `cards.group_name` 语义来自 JP `series`，更接近 Excel 的 `作品名`，不是 `真实团体`。本轮已移除该单文本列，迁移时将旧值拆入 `work_names`；Excel 同步只读取修正后的 `真实团体` 写入 `group_names`，不使用官方 `作品名`。

Excel 小队名需要标准化：

| Excel 原始形式             | 当前建议标准化                           |
| -------------------------- | ---------------------------------------- |
| 前导 tab，如 `\t5yncri5e!` | trim                                     |
| `lily white`               | `lilywhite` 或继续使用项目现有别名层匹配 |
| `Guilty Kiss`              | `GuiltyKiss` 或继续使用别名层匹配        |
| `Edel Note`                | `EdelNote`                               |
| `Saint Snow`               | `SaintSnow`                              |
| `Sunny Passion`            | `SunnyPassion`                           |
| `みらくらぱーく!`          | `みらくらぱーく！`                       |

当前入库 `unit_name` 还会包成 `「...」`。

### 5.6 Excel 图片字段

Excel `卡图链接` 是 `cloud://.../cardlist/...`，不是 JP `img` 的 HTTPS，也不是当前 `_img` 本地路径。

当前 `cards.image_filename` 只保存 basename，例如 `PL!-sd1-001-SD.png`。如果接入 Excel，有两种选择：

| 策略                                    | 影响                                                           |
| --------------------------------------- | -------------------------------------------------------------- |
| 继续只取 basename 写入 `image_filename` | 和当前 schema 兼容，但需要现有图片服务器能根据 basename 找到图 |
| 新增字段保存完整 cloud URI              | 能保留来源图链，但需要 schema/API/前端图片解析一起改           |

注意：Excel 里同一卡号重复行可能卡图链接不同，例如 `PL!N-bp1-019-PR` 同时有 `...PRprotein.png` 和 `...PR.png`。

### 5.7 Excel 数据质量问题

重复卡号：

| 卡号              | 行号       | 备注                                                             |
| ----------------- | ---------- | ---------------------------------------------------------------- |
| `PL!N-bp1-019-PR` | 549, 550   | 同卡不同图片 URL，分别为 `PRprotein.png` 与 `PR.png`             |
| `LL-PR-007-PR`    | 634, 862   | 两行卡名/图不同，第二行是 `LoveLive!Days4月号表紙`               |
| `PL!-bp6-001-SEC` | 1820, 1842 | 同卡重复，字段不完全一致：一行有 `ブレード=0`，另一行 BLADE 为空 |

异常字段：

|                         行号 | 卡号                 | 问题                                                          |
| ---------------------------: | -------------------- | ------------------------------------------------------------- |
|                          646 | `PL!SP-bp7-014-N`    | `レアリティ` 列值为完整卡号 `PL!SP-bp7-014-N`，应修正为稀有度 |
|                         1415 | `PL!-PR-016-PR+`     | ENERGY 卡 `コスト=-1`，当前模型不应写 ENERGY cost             |
| 276, 277, 327, 328, 392, 393 | `PL!-bp3-100-LLE` 等 | 6 张 ENERGY 卡 `カード名` 与 `卡牌中文名` 为空                |

新商品/卡号规则：

- Excel `商品编号` 出现 `BP07`、`NSD02` 等新商品短代码；这些是商品维度字段，不等同于 `card_code` 的商品段。
- Excel `カード番号` 标准化后出现 `bp7`、`pb2` 等当前 `VALID_PRODUCTS` 未覆盖的卡号商品段；`sd2` 当前已在 `src/shared/utils/card-code.ts` 的 `VALID_PRODUCTS` 中。
- Excel 出现 `PP`、`DUO`、`SRL` 等当前 `VALID_RARITIES` 未覆盖的稀有度。
- 当前同步脚本不会调用 `validateCardCode()`，但后续若新增严格校验，需要先更新 `card-code.ts` 和 `data-spec.md`。

## 6. 覆盖差异

以下比较均使用当前 `normalizeCardCode()` 标准化后的卡号。

### 6.1 旧数据源与当前数据库

当前 `sync-cards-llocg.ts --dry-run` 会生成 2285 张卡，和当前数据库 2285 张 `PUBLISHED` 卡一致。

### 6.2 Excel 与当前数据库

| 项                       | 数量 |
| ------------------------ | ---: |
| Excel 数据行             | 2274 |
| Excel 标准化唯一卡号     | 2271 |
| 当前数据库标准化唯一卡号 | 2285 |
| Excel 有、数据库没有     |   19 |
| 数据库有、Excel 没有     |   33 |

Excel 有、当前数据库/旧数据源没有的 19 个标准化卡号：

`LL-bp7-001-R+`, `PL!-PR-020-PR`, `PL!-PR-021-PR`, `PL!HS-PR-036-PR`, `PL!HS-PR-037-PR+`, `PL!N-PR-032-PR`, `PL!N-bp7-005-P`, `PL!N-bp7-019-N`, `PL!N-sd2-007-P`, `PL!N-sd2-025-P`, `PL!N-sd2-026-P`, `PL!N-sd2-027-P`, `PL!S-PR-044-PR`, `PL!S-PR-045-PR`, `PL!S-bp7-016-N`, `PL!SP-PR-024-PR`, `PL!SP-PR-025-PR`, `PL!SP-PR-026-PR`, `PL!SP-bp7-014-N`。

当前数据库/旧数据源有、Excel 没有的 33 个标准化卡号：

`PL!-PR-019-PR`, `PL!-PR-019-PR+`, `PL!-pb1-019-PR`, `PL!-pb1-021-PR`, `PL!-pb1-022-PR`, `PL!HS-PR-034-PR`, `PL!HS-PR-034-PR+`, `PL!HS-bp2-010-PR`, `PL!N-PR-030-PR`, `PL!N-PR-030-PR+`, `PL!N-bp1-013-PR`, `PL!N-bp1-017-PR`, `PL!N-bp1-024-PR`, `PL!N-bp3-007-PR`, `PL!N-bp3-032-PE`, `PL!N-bp3-032-PE+`, `PL!N-bp3-033-PE`, `PL!N-bp3-033-PE+`, `PL!N-bp3-034-PE`, `PL!N-bp3-034-PE+`, `PL!N-bp3-035-PE+`, `PL!S-PR-043-PR`, `PL!S-PR-043-PR+`, `PL!S-pb1-005-PR`, `PL!S-pb1-010-PR`, `PL!S-pb1-011-PR`, `PL!SP-PR-023-PR`, `PL!SP-PR-023-PR+`, `PL!SP-bp1-004-PR`, `PL!SP-bp1-016-PR`, `PL!SP-pb1-012-PR`, `PL!SP-pb1-013-PR`, `PL!SP-pb1-014-PR`。

## 7. 现有同步映射

`sync-cards-llocg.ts` 当前行为：

| 目标字段         | JP + CN 匹配时来源                                                      | CN-only 来源                |
| ---------------- | ----------------------------------------------------------------------- | --------------------------- |
| `card_code`      | `normalizeCardCode(jp.card_no)`                                         | `normalizeCardCode(cnCode)` |
| `card_type`      | JP `type` 映射                                                          | CN `card_type` 映射         |
| `name_jp`        | JP `name`，空值回退卡号                                                 | CN 原名（如有）             |
| `name_cn`        | CN `detail.card_name_cn` / `card_name_cn`，但能量通用名不覆盖 JP 具体名 | CN 中文名 / 原名 / 卡号     |
| `card_text_jp`   | JP `ability`                                                            | null                        |
| `card_text_cn`   | CN `detail.ability`                                                     | CN `detail.ability`         |
| `image_filename` | JP `_img` basename                                                      | CN `_img` basename          |
| `cost`           | JP `cost`                                                               | CN `detail.cost`            |
| `blade`          | JP `blade`                                                              | CN `detail.trigger_count`   |
| `hearts`         | JP `base_heart`                                                         | null                        |
| `blade_hearts`   | JP `blade_heart` + JP `special_heart`                                   | null                        |
| `score`          | JP `score`                                                              | null                        |
| `requirements`   | JP `need_heart`                                                         | null                        |
| `unit_name`      | JP `unit` 标准化后包 `「」`                                             | null                        |
| `work_names`     | JP `series` 按换行拆为数组                                              | null                        |
| `rare`           | JP `rare`                                                               | CN `detail.rarity`          |
| `product`        | JP `product`                                                            | null                        |
| `status`         | 固定 `PUBLISHED`                                                        | 固定 `PUBLISHED`            |

附加行为：

- 同基础编号、同类型的 `blade_hearts` 缺失会经 `inheritMissingBladeHeartsByBase()` 补全。
- 已存在卡牌如果同步字段有变化，需要 TTY 人工逐张审核，否则非交互环境报错。
- dry-run 不连接数据库，只展示转换样例和统计。

## 8. Excel 到当前模型的建议映射

如果新增 Excel 同步入口，建议先做成独立 transform，再复用现有 diff/review/persist 流程。

| 目标字段         | Excel 建议来源                  | 转换说明                                                                   |
| ---------------- | ------------------------------- | -------------------------------------------------------------------------- |
| `card_code`      | `カード番号`                    | 必须先 `normalizeCardCode()`；重复卡号需先合并/选择保留行                  |
| `card_type`      | `カードタイプ`                  | 使用 JP 同款映射：`メンバー` / `ライブ` / `エネルギー`                     |
| `name_jp`        | `カード名`                      | 空值 fallback 现有 DB 日文名或卡号                                         |
| `name_cn`        | `卡牌中文名`                    | 能量通用名不覆盖更具体的日文名；运行时展示名中文优先派生                   |
| `card_text_jp`   | `多行日文效果`                  | 保留换行，不压平                                                           |
| `card_text_cn`   | `多行中文效果`                  | 保留换行，不压平                                                           |
| `image_filename` | `卡图链接` basename             | 若要保留 `cloud://` 完整 URI，需要新增字段                                 |
| `cost`           | `コスト`                        | 只对 MEMBER 写入；ENERGY/LIVE 忽略                                         |
| `blade`          | `ブレード`                      | 只对 MEMBER 写入；空值保持 null                                            |
| `hearts`         | `基本ハート`                    | JSON parse 后颜色 key 映射到内部枚举                                       |
| `blade_hearts`   | `ブレードハート` + `特殊ハート` | `all` -> `RAINBOW`；`draw` -> `DRAW`；`bonus` -> `SCORE`（当前落地映射，仍可由 `匹配应援心` 校验）         |
| `score`          | `スコア`                        | 只对 LIVE 写入；不要使用 `点数`                                            |
| `requirements`   | `必要ハート`                    | JSON parse；`any` -> `RAINBOW`                                             |
| `unit_name`      | `真实小队`                      | trim、别名标准化、包 `「」`                                                |
| `work_names`     | 不由 Loveca Excel 更新          | 保留 llocg_db `series`、旧库迁移或人工维护值                               |
| `group_names`    | `真实团体`                      | JSON array parse 后写入短团体名数组                                        |
| `rare`           | `レアリティ`                    | 需先排除异常行和全角 `＋`                                                  |
| `product`        | `収録商品`                      | 注意格式会与 JP 当前 product 大量不同，可能触发全量 diff                   |
| `status`         | 固定或配置                      | 如果沿用当前同步，写 `PUBLISHED`；若作为新老师数据源审核，建议考虑先 DRAFT |

Excel 中暂不作为规则写入、只做校验或来源保留的字段：

| Excel 字段      | 当前处理                                         |
| --------------- | ------------------------------------------------ |
| `匹配应援心`    | 更适合作为 `blade_hearts` 校验字段               |
| `商品编号`      | 写入 `product_code`                              |
| `点数`          | 语义未确认，不能当作 LIVE `score`                |
| `数据标识`      | 写入 `source_external_id`                        |
| 完整 `卡图链接` | 写入 `image_source_uri`；不替换 `image_filename` |

### 8.0.1 本轮 Loveca Excel 同步落地映射

`src/scripts/sync-cards-loveca-excel.ts` 采用保守同步策略：

| DB 字段              | Excel 来源     | 说明                                    |
| -------------------- | -------------- | --------------------------------------- |
| `name_jp`            | `カード名`     | 保留日文卡名                            |
| `name_cn`            | `卡牌中文名`   | 保留中文卡名                            |
| `card_text_jp`       | `多行日文效果` | 保留日文效果，换行不压平                |
| `card_text_cn`       | `多行中文效果` | 保留中文效果，换行不压平                |
| `group_names`        | `真实团体`     | JSON array parse 后写入                 |
| `unit_name_raw`      | `真实小队`     | trim 后保留                             |
| `unit_name`          | `真实小队`     | trim、别名标准化后包 `「」`             |
| `hearts`             | `基本ハート`   | 只对 MEMBER 写入；JSON object 颜色 key 映射内部枚举；未知 key 或非正整数数量阻断，回退 DB 现值 |
| `blade_hearts`       | `ブレードハート` + `特殊ハート` | `all` -> `RAINBOW`；`bonus` -> `SCORE`；`draw` -> `DRAW` |
| `requirements`       | `必要ハート`   | 只对 LIVE 写入；`any` -> `RAINBOW`；未知 key 或非正整数数量阻断，回退 DB 现值 |
| `product`            | `収録商品`     | Excel 商品展示名优先                    |
| `product_code`       | `商品编号`     | 商品短代码                              |
| `image_source_uri`   | `卡图链接`     | 仅保留来源 URI，不改变现有图片 basename |
| `source_external_id` | `数据标识`     | Excel 外部行标识                        |
| `source_flags`       | 同步过程       | 当前记录字段冲突等来源标记              |

该脚本不会更新 `cost`、`blade`、`score`、`rare`、`image_filename` 或 `status`，也不会插入 Excel-only 新卡或删除 DB-only 卡。`hearts`、`blade_hearts`、`requirements` 在 Excel 有可解析值时才覆盖（分别仅对 MEMBER / 全卡种 / LIVE 生效），解析失败或为空时保留 DB 现值。Excel 内部标准化卡号重复时，该卡号跳过并输出 warning。

### 8.1 生产库字段来源决策矩阵

下面按当前 `cards` 表字段逐项列出可选来源、推荐策略和需要的转换。这里的“推荐”不是最终产品决策，而是为了避免后续接入 Excel 时按行覆盖导致语义漂移。

| 目标字段                                   | 可选来源                                                                                                            | 来源特点                                                                                                      | 推荐策略                                                                                               | 必须转换 / 审核                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `card_code`                                | JP `card_no`、CN root key / `detail.card_number`、Excel `カード番号`                                                | 三者基本同语义；Excel 覆盖新 `bp7` / `sd2` / 新 PR；旧 JP 有非标准后缀 `PRproteinbar` / `PRLoveLive!Days`     | 统一以标准化后的 `card_code` 为主键；Excel-only 新卡可新增；旧源-only 不因 Excel 缺失删除              | 先 `trim`，再 `normalizeCardCode()`；重复标准化卡号必须进冲突报告；若启用严格校验，先补 `bp7` / `pb2` / `PP` / `DUO` / `SRL` 等枚举 |
| `card_type`                                | JP `type`、CN `card_type`、Excel `カードタイプ`                                                                     | JP 和 Excel 都是日文类型；CN 是数字枚举                                                                       | 既有卡继续用 JP/DB 作为权威，Excel 作为交叉校验；Excel-only 用 Excel                                   | `メンバー` -> `MEMBER`，`ライブ` -> `LIVE`，`エネルギー` -> `ENERGY`；同卡多源类型不一致时阻断                                      |
| `name_jp`                                  | JP `name`、Excel `カード名`                                                                                         | Excel/JP 都是原文名；部分 ENERGY 名为空                                                                       | 保存日文原文；为空时保留现有 DB 值或 fallback 卡号                                                     | `trim`；不能写空字符串；同卡已有非空值且 Excel 不一致时 warning                                                                     |
| `name_cn`                                  | CN `detail.card_name_cn` / `card_name_cn`、Excel `卡牌中文名`                                                       | 中文名可能是罗马字或原文；部分 ENERGY 中文名只是通用类型名                                                    | 保存中文名；运行时展示名中文优先派生，不回写重复列                                                     | `trim`；通用 `能量` 不覆盖更具体的日文/现有名；同卡已有非空值且 Excel 不一致时 warning                                              |
| `card_text_jp`                             | JP `ability`、Excel `多行日文效果`                                                                                  | JP 文本可能含 `{{icon.png                                                                                     | ...}}` 标记；Excel 日文效果换行完整                                                                    | 保存日文效果原文，便于官方文本核对                                                                                                  | 保留换行；空字符串转 null；同卡已有非空值且 Excel 不一致时 warning |
| `card_text_cn`                             | CN `detail.ability`、Excel `多行中文效果`                                                                           | CN/Excel 中文文本更适合玩家展示                                                                               | 保存中文效果；运行时展示文本中文优先派生，不回写重复列                                                 | 保留换行；空字符串转 null；同卡已有非空值且 Excel 不一致时 warning                                                                  |
| `image_filename`                           | JP `_img` basename、CN `_img` basename、Excel `卡图链接` basename、当前 DB 值                                       | 当前生产图片链路依赖对象存储 / 图片服务器；Excel 是 `cloud://`，不是前端可直接访问 URL；重复卡号可能不同图    | 短期只保存可被现有图片链路解析的 basename；完整 Excel `cloud://` 另存新字段而不是塞进 `image_filename` | 从路径/URI 取 basename；重复卡号多图需要确定保留主图还是保留变体；basename 改动应单独审核，避免破坏卡图加载                         |
| `cost`                                     | JP `cost`、CN `detail.cost`、Excel `コスト`、当前 DB 值                                                             | 对 MEMBER 是规则字段；当前运行时缺失会被映射为 0；Excel 有 2 张 MEMBER 缺 cost，1 张 ENERGY 有 `-1`           | MEMBER 必须有非负整数；LIVE / ENERGY 不写入；缺失时优先用同卡旧源/当前 DB 补全，否则阻断               | 字符串转整数；非 MEMBER cost 忽略并报告；负数阻断；同卡多源 cost 冲突进入审核                                                       |
| `blade`                                    | JP `blade`、CN `detail.trigger_count`、Excel `ブレード`、当前 DB 值                                                 | 对 MEMBER 是规则字段；当前运行时缺失会被映射为 0；Excel 有部分 MEMBER `ブレード` 空，可能代表 0，也可能是漏填 | MEMBER 可允许 0，但空值不能直接等同 0；空值优先用同卡旧源/同基础编号/当前 DB 补全，无法确认时报告      | 字符串转整数；0 和空值区分；同基础编号不同罕度若文本/规则一致，可用非空罕度补全，但要记录派生来源                                   |
| `hearts`                                   | JP `base_heart`、Excel `基本ハート`、当前 DB 值；CN `display_attacks` 仅展示校验                                    | 对 MEMBER 是 LIVE 判定规则字段；当前运行时缺失会变空数组，严重影响判定                                        | MEMBER 的 `基本ハート` 应视为阻断级字段；Excel 缺失时优先回旧源或当前 DB 补全，不直接写空              | JSON parse；`pink/red/yellow/green/blue/purple` 映射内部枚举；数量必须正整数；未知 key 阻断                                         |
| `blade_hearts`                             | JP `blade_heart` + `special_heart`、Excel `ブレードハート` + `特殊ハート`、CN `trigger` / Excel `匹配应援心` 作校验 | 对声援 / LIVE 奖励有规则影响；当前已有同基础编号同类型补全逻辑；Excel `bonus` 当前落地映射为 `SCORE`            | 结构化落库优先用 JP 或 Excel 的拆分字段；`匹配应援心` 只做一致性校验；缺失可继续用同基础编号补全       | `all` -> `RAINBOW`；`draw` -> `DRAW`；`bonus` -> `SCORE`；重复效果按数量展开                                         |
| `score`                                    | JP `score`、CN `level`、Excel `スコア`、当前 DB 值                                                                  | 对 LIVE 是规则字段；当前运行时缺失会被映射为 1；Excel 有 3 张 LIVE `スコア` 空，但旧源有分数                  | LIVE 必须有整数分数；Excel 空值优先回旧源 / 当前 DB 补全；不能让 mapper 默认成 1                       | 字符串转整数；允许 0 分 LIVE；缺失阻断或补全后记录来源；不要使用 Excel `点数` 替代                                                  |
| `requirements`                             | JP `need_heart`、Excel `必要ハート`、当前 DB 值；CN `display_attacks` 仅展示校验                                    | 对 LIVE 判定有直接影响；Excel 当前 257 条非空，覆盖 LIVE/部分变体需求                                         | LIVE 必须有可解析需求；旧源和 Excel 同卡不一致时人工审核；不直接写空需求                               | JSON parse；`any` -> `RAINBOW`；数量必须正整数；兼容当前 `createHeartRequirement()` 的 `RAINBOW` / total 语义                       |
| `unit_name`                                | JP `unit`、Excel `真实小队`、CN `participation_unit` 数字 ID                                                        | 对卡效 selector 有影响；Excel 修正后的真实小队格式有前导 tab 和空格差异                                       | 保留标准化单值，卡效 selector 继续读该字段                                                             | `trim`；别名标准化；入库包 `「」`；`lily white` / `Guilty Kiss` / `Edel Note` 等要映射到项目既有写法                                |
| `unit_name_raw`                            | Excel `真实小队`                                                                                                    | 用于审计清洗前文本                                                                                            | Excel 同步写入原始清洗值                                                                               | `trim`；空字符串转 null                                                                                                             |
| `work_names`                               | JP `series`、旧库迁移、人工维护                                                                                     | 作品全名数组；旧 `group_name` 迁移时拆入此列                                                                  | 保存作品数组，不与真实团体混用；Loveca Excel 不更新该列                                                | 旧换行文本拆数组；多作品去空项                                                                                                      |
| `group_names`                              | Excel `真实团体`                                                                                                    | 短团体名数组，如 `["μ’s","Aqours"]`                                                                           | 保存真实团体数组，不再塞进作品字段                                                                     | JSON array parse；同卡已有非空值且 Excel 不一致时 warning                                                                           |
| `rare`                                     | JP `rare`、CN `detail.rarity`、Excel `レアリティ`、card_code 末尾稀有度                                             | 当前 DB 无 CHECK；Excel 有一行把完整卡号写入稀有度；全角加号仍存在                                            | 优先从标准化 `card_code` 末尾推导/校验，再与源字段比对；异常阻断                                       | 全角 `＋` -> 半角 `+`；`PL!SP-bp7-014-N` 行应修正为 `N`；枚举需扩 `PP` / `DUO` / `SRL` 或明确允许非标准                             |
| `product`                                  | JP `product`、CN `pack_lists[].pack_name`、Excel `収録商品`、当前 DB 值                                             | JP 多为紧凑名，Excel 更可读且有空格；直接切换会产生大量 diff                                                  | 若只求最小风险，保留现有 `product`；若要提升展示，分批切到 Excel `収録商品` 并单独审核                 | 统一空格与全角符号策略；建议新增 `product_code` 保存 Excel `商品编号`，避免把短代码塞进 `product`                                   |
| `status`                                   | 当前同步固定 `PUBLISHED`、人工配置、导入策略                                                                        | 新源接入存在质量风险；直接 PUBLISHED 会影响构筑与对局                                                         | Excel-only 或字段冲突卡建议先 `DRAFT`；确认后再发布；纯补全且验证通过可保持原状态                      | 不应让同步默认把已有 DRAFT 改成 PUBLISHED，除非显式确认                                                                             |
| `created_at` / `updated_at` / `updated_by` | DB 自动值、同步任务账号                                                                                             | 非卡牌源字段                                                                                                  | 由数据库 / 导入任务维护                                                                                | 正式导入建议使用固定 `updated_by` 或导入批次记录，便于追踪                                                                          |

### 8.2 当前 schema 已覆盖的来源追踪字段

本轮 schema 已把长期保留价值高、但不属于规则判定的字段纳入 `cards` 表：

| 字段                            | 来源                             | 用途                         |
| ------------------------------- | -------------------------------- | ---------------------------- |
| `name_jp` / `name_cn`           | JP/CN/Excel 名称                 | 支持中日展示与官方文本核对   |
| `card_text_jp` / `card_text_cn` | JP/CN/Excel 效果                 | 支持中日卡效核对和玩家展示   |
| `work_names` / `group_names`    | 旧源/人工维护 / Excel `真实团体` | 区分作品全名数组与短团体数组 |
| `unit_name_raw`                 | Excel `真实小队`                 | 追踪清洗前小队来源           |
| `product_code`                  | Excel `商品编号`                 | 稳定按商品批次筛选           |
| `source_external_id`            | Excel `数据标识`                 | 追踪外部源行                 |
| `image_source_uri`              | Excel `卡图链接`                 | 保留原始云端图链             |
| `source_flags`                  | 多源比较结果                     | 记录字段冲突、派生等同步状态 |

### 8.3 字段清洗与转换细则

卡号：

- 所有来源先做 `trim`，再做全角 `＋` -> 半角 `+`。
- 继续保留现有特殊后缀修正：`PR2` -> `PR+`、`PRproteinbar` -> `PR`、`PRLoveLive!Days` -> `PR`。
- Excel `カード番号` 里 `bp7`、`pb2` 是卡号商品段；Excel `商品编号` 里的 `BP07`、`NSD02` 是商品短代码。两者应分开校验和落库。
- 标准化后重复的卡号不能按遍历顺序覆盖，应输出冲突报告并要求选择保留行或合并规则。

字符串字段：

- Excel 中存在前导 tab，尤其是 `真实小队`、`参加ユニット`、`数据标识`，接入前必须 `trim`。
- 空字符串统一转为 `null`，不能写入 `name` 这类 NOT NULL 字段。
- 名称字段需要区分“空值”“通用类型名”和“真实卡名”：CN 能量通用名 `能量` / `エネルギー` 不应覆盖 JP/Excel 更具体的能量名。
- 商品名如果从 JP 切到 Excel，会因为空格导致大量展示字段 diff；应作为独立迁移批处理。

JSON 字段：

- Excel `真实团体`、`作品名`、`基本ハート`、`必要ハート`、`特殊ハート` 是 JSON string，不是已解析对象；当前同步解析 `真实团体`、`基本ハート`、`必要ハート`、`特殊ハート`，不读取 `作品名`。
- 空字符串按字段语义转为 `null` 或空数组；JSON parse 失败应阻断该行。
- Heart 数量必须为正整数；0 值不应写入 `hearts` / `requirements` 数组。
- 未知 Heart key 不能忽略，否则会让 LIVE 判定字段静默缺失。

数值字段：

- Excel 直接读 XML 时大多是字符串，`コスト`、`ブレード`、`スコア` 必须显式转整数。
- MEMBER `コスト` 缺失不能让运行时默认成 0；LIVE `スコア` 缺失不能让运行时默认成 1。
- LIVE 分数允许 0。当前 `src/domain/card-data/schema.ts` 写的是 positive，但现有数据和 Excel 都存在 0 分 LIVE，后续如启用 schema 校验需同步修正。
- `点数` 不是当前内部 LIVE `score`，不能拿来补 `スコア` 空值。

BLADE Heart：

- Excel `ブレードハート=all` 映射为 `{ effect: "HEART", heartColor: "RAINBOW" }`。
- Excel `特殊ハート={"draw":1}` 映射为 `{ effect: "DRAW" }`，数量大于 1 时按数量展开。
- Excel `特殊ハート={"bonus":1}` 和 `ブレードハート=bonus` 当前落地映射为 `{ effect: "SCORE" }`，与 `score` 同义；写入前可用 `匹配应援心` 校验该 token 是否作为特殊效果出现。
- `匹配应援心` 可用于检查 `ブレードハート` + `特殊ハート` 的合成结果，但不建议作为唯一来源，因为它丢失了内部 `{ effect, heartColor }` 的结构边界。

### 8.4 Excel 异常清单与建议处理

这些异常不是全部“坏数据”，但都需要明确处理，否则会被当前 mapper 的默认值掩盖。

重复标准化卡号：

| 卡号              | 行号       | 具体差异                                                                                      | 建议处理                                                                                                    |
| ----------------- | ---------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `PL!N-bp1-019-PR` | 549, 550   | 两行均为费用 4「優木せつ菜 / 优木雪菜」，规则字段一致；图片分别为 `PRprotein.png` 与 `PR.png` | 如果当前生产库只能保存一个 `image_filename`，选择主展示图；若要保留变体，需新增图片变体字段或拆分 source id |
| `LL-PR-007-PR`    | 634, 862   | ENERGY 卡，两行卡名和图片不同；第二行是 `LoveLive!Days4月号表紙`                              | 不应无条件合并；需要决定同一卡号多图是否保留当前旧源后出现记录，或新增 source variant                       |
| `PL!-bp6-001-SEC` | 1820, 1842 | 费用 2「高坂穂乃果 / 高坂穗乃果」，两行图片一致；一行 `ブレード=0`，另一行 `ブレード` 为空    | 合并时应保留非空 `ブレード=0`，不能让后出现空值覆盖 0                                                       |

缺失或异常规则字段：

| 类型                     | 数量 | 明细                                                                                                                                                                                                                                     | 建议处理                                                                                 |
| ------------------------ | ---: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| LIVE `スコア` 为空       |    3 | `PL!HS-bp2-022-L+` 分数 2「アオクハルカ」、`PL!HS-bp2-024-L+` 分数 4「レディバグ」、`PL!HS-bp2-026-L+` 分数 5「みらくりえーしょん」                                                                                                      | 旧 JP/CN 源均可补分数；补全时记录来源，不能写 null 后让运行时默认 1                      |
| MEMBER `コスト` 为空     |    2 | `PL!N-sd1-019-PR` 费用 4「優木せつ菜 / 优木雪菜」、`PL!SP-bp1-018-PR` 费用 9「米女メイ / 米女芽衣」                                                                                                                                      | 旧 JP 源可补费用；无法补时阻断导入                                                       |
| MEMBER `基本ハート` 为空 |   17 | 包括 `PL!-bp3-012-N / PR / RM` 费用 2「南ことり」、`PL!HS-pb1-002-R / P+` 费用 2「村野さやか」、`PL!-bp5-011-N` 费用 2「絢瀬絵里」、`PL!N-bp5-001-R+ / P / SEC / AR` 费用 5「上原歩夢」、`PL!SP-bp5-011-R / P / AR` 费用 9「鬼塚冬毬」等 | 作为规则字段缺失处理；优先旧源/当前 DB 补全；若确认为无 Heart 才允许写空数组，并记录确认 |
| MEMBER `ブレード` 为空   |   22 | 包括 `PL!HS-cl1-005-CL` 费用 4「徒町 小鈴」、`PL!HS-bp6-001-R+ / P / P+ / SEC` 费用 4「日野下花帆」、`PL!-bp6-001-P / P+ / R+ / SEC` 费用 2「高坂穂乃果」等                                                                              | 空值和 0 必须区分；可按旧源/当前 DB/同基础编号补全；不能直接让 mapper 默认成 0           |
| ENERGY `コスト=-1`       |    1 | `PL!-PR-016-PR+` ENERGY「園田海未 / 园田海未」                                                                                                                                                                                           | 非 MEMBER cost 直接忽略并报告；不要写入 `cards.cost`                                     |
| `レアリティ` 为完整卡号  |    1 | `PL!SP-bp7-014-N` 费用 4「嵐千砂都 / 岚千砂都」的 `レアリティ` 值为完整卡号                                                                                                                                                              | 应修正为 `N`；导入前阻断该行或由 transform 从 `card_code` 推导 rare                      |
| ENERGY 空卡名            |    6 | `PL!-bp3-100-LLE` 等 6 张 ENERGY 卡 `カード名` 与 `卡牌中文名` 为空                                                                                                                                                                      | `name` 是 NOT NULL，需 fallback 当前 DB / JP 名 / 固定能量名；不能写空                   |

覆盖差异处理：

| 类别                          |             数量 | 风险                                                             | 建议处理                                                                               |
| ----------------------------- | ---------------: | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Excel 有、旧源/当前数据库没有 |               19 | 多为 `bp7`、新 PR、新预组卡；可能需要同步扩展卡号校验和图片链路  | 作为新增候选，默认 DRAFT 或进入新增审核；不要直接 PUBLISHED 除非规则字段完整且图片可用 |
| 旧源/当前数据库有、Excel 没有 |               33 | 多为旧 PR / PE / promo 卡；Excel 全量覆盖会误删                  | 不因 Excel 缺失删除；报告为 old-source-only，后续确认是否退环境或保留                  |
| 同卡多源字段不同              | 待实际 diff 生成 | 可能是翻译更新、商品名格式变化、图片 basename 变化、规则字段冲突 | 按字段分组审核：规则字段优先级高于展示字段，规则字段冲突应阻断，展示字段可批量选择来源 |

### 8.5 可选导入策略

根据目标不同，可以选择不同导入路径：

| 策略                  | 适用目标                                            | 数据源优先级                                                               | 优点                           | 风险 / 代价                                               |
| --------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------- |
| 最小补丁导入          | 只补 Excel 新卡和明显缺漏                           | 现有 DB / JP 为主，Excel 只补新卡或空字段                                  | 低风险，diff 小，最容易上线    | 不能充分利用 Excel 的中日文本、商品编号和真实团体         |
| Excel 规则字段优先    | 让 Excel 接管 Heart / score / cost 等结构化规则字段 | Excel 规则字段为主，JP/DB 做校验和补空                                     | 可逐步统一到新宽表源           | 需要先处理所有缺失字段和 `bonus` 映射，否则会影响对局判定 |
| Excel 展示字段优先    | 使用 Excel 中文名、商品名、图片 basename 改善展示   | Excel `卡牌中文名` / `収録商品` / `卡图链接` 为主                          | 展示更一致，商品名更可读       | 会产生大量 name/product/image diff；图片链路必须先验证    |
| Schema 扩展后无损导入 | 长期以 Excel 为业务源                               | Excel 保留中日文本、真实团体、商品编号、source id、cloud URI；JP/CN 作校验 | 信息最完整，后续增量同步可追溯 | 需要 DB migration、API、前端管理页和导出格式一起改        |

建议实际推进顺序：

1. 先做只读 Excel 解析和质量报告，不写库。
2. 用 `card_code` 对齐现有 DB / JP / CN，输出字段级 diff，而不是只输出卡号集合差异。
3. 先处理阻断异常：重复卡号、缺 `cost`、缺 `score`、缺 `hearts`、异常 `rare`、`bonus` 映射。
4. 决定是否扩 schema。如果不扩，明确哪些 Excel 字段会丢失。
5. 再选择“最小补丁”或“Excel 接管某类字段”的导入批次。

## 9. 主要差异和风险

### 9.1 字段命名与结构

- `llocg_db` 的 JP 结构是对象 + 嵌套字段，Excel 是扁平行。
- `llocg_db` 的 CN 有 `detail` 嵌套对象，Excel 没有嵌套对象但有 JSON 字符串列。
- Excel 的 JSON 列需要逐列 `JSON.parse()`；空字符串应视为 null/空数组，而不是 parse 失败。

### 9.2 Heart 颜色体系不同

| 语义 | JP key                  | Excel key     | 内部值    |
| ---- | ----------------------- | ------------- | --------- |
| 桃   | `heart01` / `b_heart01` | `pink`        | `PINK`    |
| 红   | `heart02` / `b_heart02` | `red`         | `RED`     |
| 黄   | `heart03` / `b_heart03` | `yellow`      | `YELLOW`  |
| 绿   | `heart04` / `b_heart04` | `green`       | `GREEN`   |
| 蓝   | `heart05` / `b_heart05` | `blue`        | `BLUE`    |
| 紫   | `heart06` / `b_heart06` | `purple`      | `PURPLE`  |
| 任意 | `heart0` / `b_all`      | `any` / `all` | `RAINBOW` |

Excel `bonus` 与 JP `score` 命名不一致。接入前需要确认 `bonus` 是否总是等价于当前内部 `SCORE`。

### 9.3 团体字段语义不同

旧同步把 JP `series` 写进 `group_name`，它实际是作品全名。Excel 的 `真实团体` 是修正后的短团体名数组，`作品名` 虽接近旧 `series`，但官方列存在已知修正问题，本轮不读取。

本轮 schema 已拆分为：

- `work_names jsonb`：作品全名数组，承接旧 `group_name` 的语义。
- `group_names jsonb`：真实团体短名数组。
- `unit_name` / `unit_name_raw`：标准化小队与原始小队文本。

后续同步不得再把 `真实团体` 混入作品字段，也不得重新引入单文本 `group_name`；Loveca Excel 同步不得使用官方 `作品名` / `参加ユニット` 覆盖修正后的归属字段。

### 9.4 商品字段会产生大量 diff

JP `product` 多为紧凑日文名，如 `ブースターパックRoyalHoliday`。Excel `収録商品` 多为带空格可读名，如 `ブースターパック Royal Holiday`。

如果 Excel 接管 `product`，会触发大量已有卡更新。建议：

- 先把 `product` 差异列为单独审核项。
- 或新增 `product_code` 保存 `商品编号`，保留旧 `product` 不批量覆盖。

### 9.5 图片字段需要策略选择

旧同步使用 `_img` basename，Excel 使用 `cloud://` 完整链接。当前生产图片链路已有独立对象存储，不能简单把 `cloud://` 当作前端 URL。

建议：

- 短期：只取 Excel `卡图链接` 的 basename 写入 `image_filename`。
- 长期：新增 `image_source_uri` / `image_provider` 之类字段，明确区分本地 fallback、官方 URL、云开发 URI、生产对象存储 key。

### 9.6 覆盖差异不是纯新增

Excel 比当前数据库多 19 张，但也少 33 张。不能用 Excel 全量覆盖数据库，否则会误删或遗漏旧源中的 PR/PE 卡。

建议同步策略：

- Excel 作为新增/更新源时，不自动删除 Excel 缺失的旧卡。
- Excel 有重复卡号时先生成冲突报告，不自动覆盖。
- Excel 与旧源同卡字段冲突时进入人工 diff 审核。

## 10. 接入建议

建议实现步骤：

1. 新增只读解析器：读取 `loveca_*.xlsx`，输出 `ExcelCardRaw[]`，保留原始行号。
2. 新增 Excel transform：转换为与 `CardUpsertRecord` 同形的内部记录。
3. 在 transform 阶段生成质量报告：重复卡号、异常稀有度、空卡名、非 MEMBER cost、未知颜色、未知类型、未知小队。
4. 质量报告有阻断级错误时不进入写库。
5. 复用现有 diff/review/persist 流程，不为 Excel 新写无审核覆盖逻辑。
6. 对 `product`、`image_filename`、`work_names` / `group_names` 这些容易造成大面积差异的字段提供开关或分阶段导入。

建议阻断级校验：

| 校验                             | 原因                                    |
| -------------------------------- | --------------------------------------- |
| 标准化卡号重复                   | 防止同一 `card_code` 被遍历顺序随机覆盖 |
| 未知 `カードタイプ`              | 会破坏 `card_type` CHECK                |
| MEMBER 缺 `コスト` 或缺基础字段  | 可能导致对局中默认 0 误判               |
| LIVE 缺 `スコア` 或 `必要ハート` | 会影响 LIVE 判定                        |
| 未知 Heart key                   | 可能导致判定字段静默缺失                |
| `bonus` 映射未确认               | 防止把加分/奖励语义写错                 |

建议非阻断但必须报告：

| 校验                           | 原因                       |
| ------------------------------ | -------------------------- |
| Excel 有、DB 没有              | 新卡导入列表               |
| DB 有、Excel 没有              | 不应自动删除               |
| `product` 与现有 DB 不同       | 大面积展示字段更新         |
| `image_filename` basename 不同 | 可能影响卡图加载           |
| 小队名需要别名标准化           | 影响卡效 selector          |
| `点数` 非空                    | 当前未落库，需确认业务含义 |

## 11. 结论

Excel 数据源不是 `llocg_db` 的同格式替代品。它更像已经人工整理过的一张业务宽表，优势是：

- 同时包含日文与中文效果文本。
- 已提供更可读的商品名和商品编号。
- 已提供 Excel 侧的结构化 Heart JSON。
- 覆盖了部分 `bp7` / 新 PR / 新预组卡。

主要接入成本是：

- 需要新的 Excel 解析与 transform。
- 需要处理重复卡号和异常行，不能按行无条件 upsert。
- 需要决定 `真实团体`、`作品名`、`商品编号`、`数据标识`、完整云端图链是否新增字段保存。
- 需要确认 `bonus` 与当前内部 `SCORE` 的等价关系。
- 需要避免用 Excel 缺失列表反向删除当前数据库已有卡。

在不改 schema 的前提下，Excel 可以转换出当前 `cards` 表所需的大部分对局字段；但会丢失日文效果、真实团体数组、商品编号、数据标识和完整 cloud 图链。若希望保留这些信息，应先扩展卡牌数据 schema，再接入正式同步。
