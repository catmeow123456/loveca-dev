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

- 可标准化且通过 `validateCardCode()` 的卡牌编号；非规范前缀、商品段、序号或稀有度会阻断该条记录。
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
- 候选图片 basename 与 DB 已有 `image_filename` 冲突时跳过；本流程生成版本化文件名时会同时在 `source_flags.imageObjectVersioned` 和 `source_flags.imageOriginalBaseName` 保存明确标记。两个键必须同时存在，且当前文件名必须严格匹配 `${imageOriginalBaseName}-<24 hex>.webp`；空图片名、部分标记或对应不一致会作为现有卡牌数据异常阻断全部候选。后续只按通过校验的元数据读取原始 basename，未标记文件名保持完整比较，不通过正则推断后缀。

## 3. 字段转换

脚本按当前 `cards` schema 写入新记录，覆盖中日名称、中日效果、归属字段、规则结构化字段、来源追踪字段和发布状态。

规则字段缺失不会阻止插入，但会写入 `source_flags.missingRuleFields`。这类卡默认保持 `DRAFT`，由维护者在管理端或后续同步流程中补齐。

`cost`、`blade` 和 `score` 只接受安全的非负整数。负数不再作为 warning 降级为 `null`，而是直接阻断候选；PostgreSQL `cards` 表也使用 CHECK 作为最后写入边界。

卡号仍校验四段结构、系列前缀、序号和稀有度，但商品代号不使用逐个白名单：`sd` / `bp` / `cl` / `pb` 后接数字即可，所以未来 `bp9`、`bp10` 等无需提前登记。非法结构仍会在预览中列为阻断项，不会直接写入。

CloudBase 新卡可以从 `作品名` / `work_names` / `series` 写入 `work_names`。这与 Loveca Excel 同步不同，因为本脚本只插入 DB 不存在的新记录，不会覆盖已有主记录的作品归属。

## 4. 图片策略

正式运行必须显式选择图片策略：

- `--upload-images`：从 CloudBase fileID 或 HTTPS URL 下载原图，使用 `sharp` 生成 `thumb` / `medium` / `large` WebP，并上传 MinIO / S3。
- `--skip-images`：不处理图片，不写入 `image_filename`，只保留 `image_source_uri` 并写入 `source_flags.imageSkipped`，同时清除任何版本化图片标记。

`--upload-images` 默认不覆盖已有对象。下载、压缩或上传失败时，该卡默认不插入；只有显式传入 `--allow-missing-images` 时才允许插入，并清空 `image_filename`、清除版本化图片标记，同时写入对应失败 flag。CloudBase 文档中的同名版本化标记属于不可信外部输入，转换时会剔除并产生 warning；只有本次图片上传成功后才会重新派生。

下载链路会先解析主机的全部 A/AAAA 结果，任一结果属于回环、链路本地、内网或保留地址时都拒绝；HTTPS 连接使用已校验地址的 pinned lookup，不再在请求时二次自由解析，也不跟随重定向。

每次正式执行都从任务身份派生独立的版本后缀，三个 WebP 尺寸写入 `${size}/${sourceBase}-${version}.webp`，并在元数据中保留各自的 SHA-256。同一执行只会复用同键且哈希与当前内容完全相同的对象；不同任务不共享可变键。只有仍持有有效 token/generation 的数据库事务会把本任务的版本化文件名写入 `cards.image_filename`，并把原始 basename 与版本化标记写入 `source_flags`；失租旧 worker 即使延迟上传最后完成，也只会写入它自己的旧任务键，不会覆盖后续任务已绑定的卡图。数据库 `COMMIT` 返回异常时会尝试结束原事务，再通过另一连接核对该卡是否已经引用本任务文件名：已引用则保留；只有回滚已确认且未引用才清理；回滚失败或无法完成对账时保守保留、销毁原连接并报告结果不确定。上传或插卡回滚时的对象清理失败仍会记录卡号和对象键。

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
- Worker 认领任务时生成随机 lease token 并递增 generation，心跳只能续租当前代。超过两分钟没有成功续租的 `RUNNING` 任务会被标记为中断失败、递增 generation 并解除后续任务互斥。旧 worker 后续的图片步骤、卡牌事务、逐卡结果和最终任务状态都必须校验 token/generation；失去租约后不再有权写入。中断前在有效租约内已插入的草稿不会自动回滚，重新预览时会按已有卡跳过。
- CloudBase 代码路径只调用集合查询和临时文件 URL 获取，不调用集合新增、更新、删除或云函数写入能力。数据库侧只对不存在的卡号执行 `INSERT ... ON CONFLICT DO NOTHING`，并记录 `updated_by`；不会更新或删除已有卡。
- 浏览器只收到配置是否就绪、候选摘要与脱敏结果。CloudBase 环境 ID、Secret ID、Secret Key 仅由 API 进程环境读取。

## 6. 相关代码路径

| 路径                                                | 说明                                  |
| --------------------------------------------------- | ------------------------------------- |
| `src/scripts/sync-cards-cloudbase-new.ts`           | CloudBase-only 新卡导入与卡图上传入口 |
| `src/server/routes/card-sync.ts`                    | 管理员预览、执行和任务状态 API        |
| `src/server/services/card-sync-service.ts`          | 预览、幂等、互斥与持久化任务记录      |
| `src/server/services/card-sync-lease.ts`            | 执行租约的校验、续租与 fencing        |
| `src/server/services/cloudbase-card-sync-engine.ts` | 固定策略的新卡计划与逐卡应用          |
| `client/src/components/admin/CardSyncAdminPage.tsx` | 运营管理中心预览与二次确认页面        |
| `src/shared/utils/card-code.ts`                     | 卡牌编号标准化                        |
| `src/server/db/schema.ts`                           | `cards` 表 schema                     |
| `client/src/lib/imageService.ts`                    | 前端卡图路径解析                      |

## 7. 相关文档

- [卡牌数据同步文档索引](./README.md)
- [卡牌数据同步需求](./requirements.md)
- [卡牌数据同步管线](./design.md)
- [卡牌数据管理设计](../card-data-management/design.md)
- [MinIO 需求与设计](../minio-requirements.md)
