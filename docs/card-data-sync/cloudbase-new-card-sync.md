# CloudBase 新卡同步与管理员任务

> 更新时间: 2026-08-22
> 文档类型: 专题说明
> 适用范围: `src/scripts/sync-cards-cloudbase-new.ts` 与运营管理中心“上游新卡同步”的输入、写入和图片处理边界
> 当前状态: 当前实现说明；同步管线整体职责以 [卡牌数据同步管线](./design.md) 为准

本文档说明 CloudBase-only 新卡导入脚本的关键规则，不维护完整命令清单、终端输出或外部服务账号配置。

## 1. 定位

`src/scripts/sync-cards-cloudbase-new.ts` 只处理 CloudBase 卡牌集合中当前 PostgreSQL `cards` 表不存在的新卡。

该脚本不替代 `sync-cards-llocg.ts` 或 `sync-cards-loveca-excel.ts`：

- 不更新已有卡牌字段。
- 不删除 DB-only 卡牌。
- 不登记或推断卡牌效果自动化。
- 不改变前端图片访问协议。

新卡默认写入 `DRAFT`，用于先完成字段、卡图和规则风险审核。只有显式传入 `--status=PUBLISHED` 时才会直接发布。

运营管理中心的“上游新卡同步”复用该脚本抽出的读取、字段转换、候选规划与图片处理函数，不通过 shell 启动 TypeScript 脚本。管理入口的策略固定为：集合 `loveca`、只新增、状态 `DRAFT`、必须上传卡图、图片缺失或处理失败时阻断该卡、不覆盖既有图片。该入口不能切换为发布、跳过图片、覆盖图片、更新或删除已有卡牌。

## 2. 输入和去重

脚本从 CloudBase 集合读取文档，默认集合名为 `loveca`。当前已确认 `loveca` 是可读取的卡牌集合，`real_card` 不存在。

输入至少需要提供：

- 可标准化的卡牌编号。
- CloudBase 文档的 `type`（语义为卡牌类型 / `カードタイプ`）。
- `name_jp` / `name_cn` 中至少一个名称字段。

### 卡牌类型判定

CloudBase `loveca` 集合的实际字段名是 `type`，而非 `カードタイプ`。`sync-cards-cloudbase-new.ts`
只读取该字段，不再从 `カード種別`、`card_type`、费用、分数或 Heart 字段推断类型。当前已确认值按以下映射写入
PostgreSQL `cards.card_type`：

| CloudBase `type` | `cards.card_type` |
| ---------------- | ----------------- |
| `メンバー`       | `MEMBER`          |
| `ライブ`         | `LIVE`            |
| `エネルギー`     | `ENERGY`          |

缺失或无法映射的 `type` 会作为该候选的阻断错误报告，且不会插入新卡。

去重规则：

- CloudBase 输入内部标准化卡号重复时，整组跳过并报告。
- DB 已存在卡号跳过，不做 update。
- 候选内部图片 basename 冲突时跳过。
- 候选图片 basename 与 DB 已有 `image_filename` 冲突时跳过。

## 3. 字段转换

脚本按当前 `cards` schema 写入新记录，覆盖中日名称、中日效果、归属字段、规则结构化字段、来源追踪字段和发布状态。

规则字段缺失不会阻止插入，但会写入 `source_flags.missingRuleFields`。这类卡默认保持 `DRAFT`，由维护者在管理端或后续同步流程中补齐。

CloudBase 新卡可以从 `作品名` / `work_names` / `series` 写入 `work_names`。这与 Loveca Excel 同步不同，因为本脚本只插入 DB 不存在的新记录，不会覆盖已有主记录的作品归属。

## 4. 图片策略

正式运行必须显式选择图片策略：

- `--upload-images`：从 CloudBase fileID 或 HTTPS URL 下载原图，使用 `sharp` 生成 `thumb` / `medium` / `large` WebP，并上传 MinIO / S3。
- `--skip-images`：不处理图片，不写入 `image_filename`，只保留 `image_source_uri` 并写入 `source_flags.imageSkipped`。

`--upload-images` 默认不覆盖已有对象。下载、压缩或上传失败时，该卡默认不插入；只有显式传入 `--allow-missing-images` 时才允许插入，并清空 `image_filename`，同时写入对应失败 flag。

## 5. 审核边界

dry-run 和 report 用于正式导入前审核：

- CloudBase 候选数量是否合理。
- DB 已存在跳过数量是否符合预期。
- 字段解析 warning 和缺规则字段是否可接受。
- 图片 basename 冲突是否需要人工处理。
- 可插入候选是否应保持 `DRAFT`。

正式导入后，新卡仍需要通过卡牌管理、规则字段检查、卡图显示检查和必要的卡效登记流程确认，才能发布给普通玩家。

### 管理员任务边界

- 接口使用独立权限 `cards.sync`，当前只授予平台 `admin`，不授予 `season_admin`。
- “检查新卡”只读取 CloudBase 与 PostgreSQL 现有卡号并生成 15 分钟有效的持久化预览；正式同步需要再次确认。
- 执行前会重新读取上游并核对来源 SHA-256 与候选卡号；预览后发生变化时任务失败，管理员需重新检查。
- 同一时刻只允许一个正式同步任务。任务和逐卡结果写入 `card_sync_runs` / `card_sync_run_items`，但不保存 CloudBase 原始文档、临时签名 URL 或凭据。
- Worker 执行中会更新心跳；超过两分钟没有心跳的 `RUNNING` 任务会被标记为中断失败，解除后续任务互斥。中断前已插入的草稿不会自动回滚，重新预览时会按已有卡跳过。
- CloudBase 代码路径只调用集合查询和临时文件 URL 获取，不调用集合新增、更新、删除或云函数写入能力。数据库侧只对不存在的卡号执行 `INSERT ... ON CONFLICT DO NOTHING`，并记录 `updated_by`；不会更新或删除已有卡。
- 浏览器只收到配置是否就绪、候选摘要与脱敏结果。CloudBase 环境 ID、Secret ID、Secret Key 仅由 API 进程环境读取。

## 6. 相关代码路径

| 路径                                      | 说明                                  |
| ----------------------------------------- | ------------------------------------- |
| `src/scripts/sync-cards-cloudbase-new.ts` | CloudBase-only 新卡导入与卡图上传入口 |
| `src/server/routes/card-sync.ts` | 管理员预览、执行和任务状态 API |
| `src/server/services/card-sync-service.ts` | 预览、幂等、互斥与持久化任务记录 |
| `src/server/services/cloudbase-card-sync-engine.ts` | 固定策略的新卡计划与逐卡应用 |
| `client/src/components/admin/CardSyncAdminPage.tsx` | 运营管理中心预览与二次确认页面 |
| `src/shared/utils/card-code.ts`           | 卡牌编号标准化                        |
| `src/server/db/schema.ts`                 | `cards` 表 schema                     |
| `client/src/lib/imageService.ts`          | 前端卡图路径解析                      |

## 7. 相关文档

- [卡牌数据同步文档索引](./README.md)
- [卡牌数据同步需求](./requirements.md)
- [卡牌数据同步管线](./design.md)
- [卡牌数据管理设计](../card-data-management/design.md)
- [MinIO 需求与设计](../minio-requirements.md)
