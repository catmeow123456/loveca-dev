# 快捷表情运营目录停机迁移说明

> 适用范围：`0021_add_match_emote_catalog.sql`、`0022_add_match_emote_catalog_previous_version.sql`、首批六项内容寻址 WebP、客户端与服务端聊天协议切换

> 本文保留首发六项目录的历史切换步骤。当前仓库清单已由 `0025_add_match_emote_sticker_pack.sql` 扩充到九项、十个对象；后续环境还必须继续执行 [`match-emote-sticker-pack.md`](match-emote-sticker-pack.md)。

## 迁移边界

- 本次新增表情资源表、不可变目录版本表和单行 active pointer。迁移会直接建立首个六项目录，但不会向对象存储写文件。
- 新协议要求表情发送携带 `catalogVersion`，服务端消息保存资源快照；旧客户端没有该字段。按项目原则不提供旧 payload fallback 或 dual-read，因此必须停机切换。
- 种子清单位于 `assets/emotes/seed/manifest.json`。对象键按内容 SHA-256 固定，`pnpm emotes:seed-assets` 只上传缺失对象，遇到同键但尺寸不一致时拒绝继续。
- 目录与资源元数据持久化；单局聊天仍在进程内存中。停机部署会清空运行中的聊天，这与现有服务重启边界一致。

## 发布顺序

1. 停止旧 API、前端发布和所有联机对局写入，确认当前运行中对局已按发布计划收口。
2. 备份 PostgreSQL，并记录目标对象存储 bucket、endpoint 与当前部署 SHA。确认 `.env` 中 `MINIO_*` 指向目标环境。
3. 在尚未执行数据库迁移时先上传并校验种子资源：

   ```bash
   pnpm emotes:seed-assets
   ```

   首发提交中的命令报告七个种子对象；当前仓库清单会报告十个对象均已存在或已成功上传。任何 hash/尺寸冲突都应中止发布。

4. 执行数据库迁移：

   ```bash
   pnpm db:migrate
   ```

5. 用以下只读检查确认目录完整：

   ```sql
   SELECT count(*) AS asset_count FROM match_emote_assets;

   SELECT c.active_version_id,
          jsonb_array_length(v.entries) AS item_count,
          count(*) FILTER (WHERE (entry.value->>'enabled')::boolean) AS enabled_count
   FROM match_emote_catalog_config c
   JOIN match_emote_catalog_versions v ON v.id = c.active_version_id
   CROSS JOIN LATERAL jsonb_array_elements(v.entries) entry
   WHERE c.id = 'default'
   GROUP BY c.active_version_id, v.entries;
   ```

   首次迁移预期 `asset_count=6`、`item_count=6`、`enabled_count=6`。其中“深度思考中…”的资源应同时具有静态与动画对象键。

6. 部署同一提交的服务端和前端。先检查 `/api/config` 返回非空 `matchEmotes.version` 及六项启用目录，再以管理员身份检查 `/api/match-emotes/admin/catalog`。
7. 完成一次真实双方发送：发送前记录目录版本，确认消息响应包含名称、静态地址、动画地址和 `assetRevision` 快照；随后再恢复新对局入口。

## 失败与回滚边界

- 对象上传失败：数据库尚未变化；修复对象存储配置后重复执行上传脚本。
- 对象上传成功、数据库迁移失败：内容寻址对象可安全保留，修复迁移后重试；它们尚未被生效目录引用。
- 数据库迁移成功、应用部署失败：继续保持停机。优先修复并部署同一协议版本，不启动旧服务接受新写入。
- 若必须整体回退到旧版本，应恢复迁移前 PostgreSQL 备份并部署旧前后端；新上传的内容寻址对象可以暂时保留，确认没有任何目录引用后再独立清理。
- 不手工改写既有目录版本 JSON，也不复用已发布 `emoteId`。运营修正必须通过管理 API 创建新版本并原子切换 active pointer。
