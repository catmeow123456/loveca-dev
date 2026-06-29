# 卡牌数据同步文档索引

> 文档类型: 专题索引
> 适用范围: `docs/card-data-sync/` 下卡牌同步文档的入口、职责和维护边界
> 当前状态: 现行专题索引

本文档说明卡牌数据同步专题从哪里读起，以及每份文档维护什么事实。

## 阅读入口

维护同步脚本或判断两个上游数据源职责时，优先阅读：

1. [卡牌数据同步管线设计](./design.md)：主文档，维护 `sync-cards-llocg.ts` 与 `sync-cards-loveca-excel.ts` 的职责边界、数据流、字段覆盖范围、运行顺序和写入策略。
2. [卡牌数据同步需求](./requirements.md)：维护同步需求、风险、验收边界和正式运行前后的检查项。
3. [llocg_db 卡牌同步](./llocg-db-requirements.md)：维护 `llocg_db` JP/CN JSON 的合并规则和结构化规则字段边界。
4. [llocg_db 与 Loveca Excel 格式差异调查](./llocg-vs-xlsx-format-audit-20260626.md)：历史调查和字段差异背景；当前职责边界以设计文档为准。

## 当前职责边界

`src/scripts/sync-cards-llocg.ts` 是主数据/规则字段同步脚本。它从 `llocg_db/json/cards.json` 与 `llocg_db/json/cards_cn.json` 建立或刷新卡牌主记录，尤其负责卡牌类型、费用、Heart、BLADE、LIVE 分数、必要 Heart、图片文件名、稀有度、收录商品、作品数组和基础中日文本。

`src/scripts/sync-cards-loveca-excel.ts` 是 Loveca 文本/来源字段补强脚本，默认从本地 Excel 读取，也可通过 `--source=cloudbase` 从腾讯云 CloudBase 集合读取同等字段。它只更新已有卡牌的中日名称、中日效果、真实团体、真实小队、成员持有 Heart、BLADE Heart、LIVE 必要 Heart、商品编号、图片来源 URI 和外部来源标识，不插入 source-only 新卡，不删除 DB-only 卡，也不覆盖费用、BLADE 或 LIVE 分数等其他规则字段。

`src/scripts/audit-loveca-effect-placeholders.ts` 是 Loveca Excel 卡效占位符只读调查脚本。它复用同类 XLSX XML 读取方式扫描 `多行日文效果` / `多行中文效果`，汇总 `【...】` 与 `[...]` token，并按时点、次数限制、站位、Heart、BLADE、费用、分数等类别标记已知 token；未知 token 会作为疑似数据问题输出。

推荐顺序是先运行 `sync-cards-llocg.ts` 建立规则字段和基础卡池，再运行 `sync-cards-loveca-excel.ts` 补齐更可靠的双语文本、真实团体、小队原文、商品和来源信息。

## 占位符调查

本地 Excel 原始文件存在时，可运行：

```bash
pnpm exec tsx src/scripts/audit-loveca-effect-placeholders.ts
```

如需机器可读输出：

```bash
pnpm exec tsx src/scripts/audit-loveca-effect-placeholders.ts --json
```

未传 `--xlsx=...` 时，Loveca Excel 同步脚本和占位符调查脚本会自动选择 `docs/card-data-sync/sources/` 下文件名时间戳最新的 `loveca_YYYYMMDDHHMMSS.xlsx`，例如当前本地默认会选中 `loveca_20260629130944.xlsx`；需要复查旧输入时可显式传入 `--xlsx=docs/card-data-sync/sources/loveca_20260626015115.xlsx`。

CloudBase 来源验证可运行：

```bash
pnpm exec tsx src/scripts/sync-cards-loveca-excel.ts --source=cloudbase --cloudbase-collection=real_unit --cloudbase-limit=3 --dry-run
```

当前 `real_unit` 只是小队字典集合，缺少卡牌编号，会被脚本跳过；正式同步需要将 `--cloudbase-collection` 指向包含卡牌行的集合。CloudBase 凭据从环境变量或 `.env` 读取：`CLOUDBASE_ENV_ID`、`CLOUDBASE_SECRET_ID`、`CLOUDBASE_SECRET_KEY`。

截至 `docs/card-data-sync/sources/loveca_20260629130944.xlsx`，调查结果为：2303 行中 1382 行含卡效占位符，共 44 种原始 token；41 种已归类，3 种未知或疑似数据问题。高频 token 包括 `[ブレード]` 1053 次、`[E]` 714 次、`【登场】` 564 次、`【登場】` 561 次、`【LIVE开始时】` 459 次、`【ライブ開始時】` 457 次、`[赤ハート]` 199 次、`[紫ハート]` 170 次。未知项为 `[Aqours]`、一条缺失右括号导致的长 token、以及 `[ターン1回]`。

## 维护规则

- 两个脚本的职责边界只在 [设计文档](./design.md) 维护权威说明；其他文档需要引用或摘要时，不重复展开字段全集。
- 新增或调整上游数据源时，先更新设计文档，再判断是否需要更新需求文档和专题调查文档。
- 调查文档记录背景和数据差异，不作为当前运行策略的唯一权威来源。
- `sources/` 下的 Excel 原始文件属于私有上游资料，不进入仓库；脚本和文档可以引用约定路径，但提交时不得包含实际 `.xlsx` 文件。
