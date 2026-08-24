# 小能苗新卡同步：生产环境配置说明

> 文档类型：v3.10.0 生产发布专题说明
> 总迁移说明：[`3.9.9-to-3.10.0.md`](3.9.9-to-3.10.0.md)
> 结构迁移专题：[`card-sync-jobs.md`](card-sync-jobs.md)、[`card-sync-hardening.md`](card-sync-hardening.md)

这项功能由运营管理中心的前端按钮请求 Loveca 后端，再由后端使用腾讯 CloudBase 凭据读取固定的 `loveca` 集合。凭据只配置在生产服务器上 Loveca 仓库根目录的 `.env` 文件中，不存入 Git、前端代码、数据库或运营管理页面。同步链路不会修改 CloudBase；正式同步会向 Loveca PostgreSQL 写入新卡和任务记录，并向既有 MinIO 卡图存储上传版本化图片。

## 1. 配置仓库根目录 `.env`

在生产服务器的 Loveca 仓库根目录（即 `docker-compose.yml` 所在目录）找到现有 `.env`，在文件中追加以下三项并填入真实值。不要覆盖其中已有的数据库、JWT、MinIO 等生产配置，也不要将真实值写入 `.env.example`、发到聊天、提交到 Git 或记录在部署日志中。

```dotenv
CLOUDBASE_ENV_ID=
CLOUDBASE_SECRET_ID=
CLOUDBASE_SECRET_KEY=
```

`.env` 已被项目的 `.gitignore` 忽略。建议确认文件所有者是部署账号（或运行 Loveca API 的专用账号），并限制为仅所有者可读写：

```bash
chmod 600 .env
```

`CLOUDBASE_ENV_ID` 是环境标识；`CLOUDBASE_SECRET_ID` 和 `CLOUDBASE_SECRET_KEY` 是敏感凭据。这三项都必须只注入 API/后台任务进程，不应注入前端构建环境。服务端只读取以上带下划线的正式变量名，不接受 `CLOUDBASE_SECRETID`、`CLOUDBASE_SECRETKEY` 等旧名称。

正式同步会复用 API 现有的 `MINIO_ENDPOINT`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`、`MINIO_BUCKET` 等对象存储配置，不需要新增另一套 MinIO 凭据；发布时必须保留服务器已有配置和写入权限。

## 2. 重新部署后端

当前功能在 API 进程内执行后台任务。新版 `docker-compose.yml` 的 `api.environment` 已包含这三项映射；从仓库根目录执行现有 Docker Compose 发布流程时，Compose 会读取根目录 `.env`，并将三项配置传入 API 容器。不要把真实密钥直接写入 `docker-compose.yml`。

请继续使用服务器现有的完整发布流程，使新环境变量在重新创建后的 API 容器中生效。例如，若现有流程是在仓库根目录使用 Compose，可执行原有的部署命令；不要只凭本说明跳过数据库迁移、镜像更新或其他既有步骤。

当前交付版本同时包含 `drizzle/0033_harden_card_sync.sql`。它以前序 `0031_add_card_sync_jobs` 创建的同步任务表为基础，为任务增加租约代际、租约令牌和到期时间，并为卡号格式及费用／应援棒／分数的非负值增加数据库约束。本次 journal 顺序应为 `0031_add_card_sync_jobs` → `0032_add_deck_classifier` → `0033_harden_card_sync`；必须按生产发布 Runbook 使用 `pnpm db:migrate` 随全部待执行迁移一起应用，禁止手工粘贴任一 SQL、伪造迁移记录或使用 `db:push`。当前 0033 文件的 SHA-256 应为 `36c3467b0a96ba81d9318f8d15a436230dd7749326ad5f95aa405f19c52ec18e`；部署时仍须以 v3.10.0 release commit 中重新计算并审查的结果为准。

迁移后可使用以下只读 SQL 核对 0033。三个租约字段和五项约束都应存在；`card_sync_runs_lease_generation_check` 的 `convalidated` 应为 `true`，四个 `cards_*` 约束按设计应为 `false`（`NOT VALID`），不会因历史卡牌数据阻断本次迁移，但会约束后续新增或更新的数据：

```sql
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'card_sync_runs'
  AND column_name IN ('lease_generation', 'lease_token', 'lease_expires_at')
ORDER BY column_name;

SELECT conname, convalidated
FROM pg_constraint
WHERE conrelid IN ('public.card_sync_runs'::regclass, 'public.cards'::regclass)
  AND conname IN (
    'card_sync_runs_lease_generation_check',
    'cards_card_code_format_check',
    'cards_cost_non_negative_check',
    'cards_blade_non_negative_check',
    'cards_score_non_negative_check'
  )
ORDER BY conname;
```

如果发布命令不是从仓库根目录执行，或现有流程显式使用了 `--env-file`，请确保它指向这个生产根目录 `.env`。无论采用哪种现有发布命令，三项变量都只应进入后端 API 进程，不应进入前端构建环境。

## 3. 重启与无泄漏验证

发布包含该功能的新版后，按现有发布流程重建或重启 API 容器/进程，使新环境变量生效。验证时只检查变量是否存在，不要打印变量值；例如在 API 容器内执行三次 `test -n` 检查，而不是执行 `env` 或 `echo $CLOUDBASE_SECRET_KEY`。

Docker Compose 环境可使用下面的不回显检查；命令退出码为 0 表示三项都已注入，命令本身不会打印密钥：

```bash
docker compose exec -T api sh -lc '
  test -n "$CLOUDBASE_ENV_ID" &&
  test -n "$CLOUDBASE_SECRET_ID" &&
  test -n "$CLOUDBASE_SECRET_KEY"
'
```

发布后建议按以下顺序验收：

1. 确认 API 健康检查正常，且日志中没有出现凭据内容。
2. 使用平台 `admin` 账号进入“上游新卡同步”。接口要求独立的 `cards.sync` 权限，当前不授予 `season_admin`。
3. 第一次只执行“检查新卡”。该操作会只读 CloudBase，并读取生产卡牌的卡号及图片元数据；它不会修改 CloudBase、`cards` 表或 MinIO，但会在 Loveca PostgreSQL 中持久化预览任务及候选／阻断项，供二次确认和后续追溯。
4. 核对页面中的数量、卡号、卡名、类型、warning 和阻断原因。响应、浏览器网络面板及服务端日志都不应包含 Secret ID、Secret Key、CloudBase 原始文档或临时签名图片 URL。
5. 预览有效期为 15 分钟，只能由创建预览的同一管理员确认。预览过期，或上游内容、候选卡号发生变化时，应重新执行“检查新卡”。
6. 只有当预览结果正确且确实需要导入时，才二次确认正式同步。正式任务会上传 `thumb` / `medium` / `large` 三种尺寸的版本化卡图，并将生产中不存在的新卡以 `DRAFT` 写入；已有卡应跳过，不应被修改，也不会向 CloudBase 写入数据。
7. 等待任务进入 `SUCCEEDED`、`PARTIAL` 或 `FAILED` 后核对逐卡结果。部分成功时，已经写入的 `DRAFT` 卡和被引用卡图不会自动回滚，应按任务记录人工复核。

## 4. 故障与回滚

如果凭据缺失、无效或 CloudBase 不可达，同步功能应报错，但不应影响 API 其他功能。先停止使用同步入口，检查根目录 `.env` 是否填写正确以及变量是否被注入 API 容器；排查时仍不应打印完整凭据。

如需回滚应用版本，先确认没有 `QUEUED` 或 `RUNNING` 的正式同步任务，再按原有发布流程恢复上一个 API 镜像/版本。回滚代码不会回滚 `0031` / `0033` 数据库迁移，也不会自动删除已导入的卡牌或图片；不要手工删除同步表、租约列、约束或批量删除新增卡牌。如果旧版本与保留的数据库约束发生兼容问题，应停止使用卡牌同步和卡牌修改入口，单独评估，不要为恢复旧行为直接移除约束。

如怀疑密钥泄漏，仅删除环境文件或回滚应用并不足够；需要由密钥所属方在腾讯云侧轮换/废止该密钥，再更新服务器上的环境文件并重启后端。
