# 统一手绘快捷表情扩充迁移说明

> 适用范围：`0025_add_match_emote_sticker_pack.sql`、三项新增静态 WebP、默认快捷表情目录从六项扩充到九项

## 迁移边界

- 本次不修改表结构；迁移登记三项内容寻址资源，基于迁移执行时的 active 目录创建新不可变版本，并原子切换 active pointer。
- 当前目录原有条目、启用状态与排序都会保留，三项新表情追加在现有最大 `sortOrder` 之后。
- 迁移要求当前目录至多九项，保证追加后不超过系统的十二项上限；若稳定 ID `ALL_IN_LIVE`、`OH_NO` 或 `WHERE_IS_MY_LIVE` 已被占用，迁移会拒绝继续，不能静默覆盖。
- 数据库迁移只登记对象键，不向 MinIO 写文件。必须先使用同一提交中的种子清单上传资源。

## 测试环境

默认的 `pnpm test-env:start` 会依次完成 MinIO 种子上传和数据库迁移，无需额外命令。若复用既有数据库，仍会通过 `0025` 创建新目录版本；默认重建数据库则从完整迁移链得到九项目录。

## 发布顺序

1. 停止旧 API 和联机写入，备份 PostgreSQL，并确认目标 MinIO 配置。
2. 上传并校验当前十个内容寻址对象：

   ```bash
   pnpm emotes:seed-assets
   ```

3. 执行迁移：

   ```bash
   pnpm db:migrate
   ```

4. 只读核验：

   ```sql
   SELECT count(*) AS asset_count FROM match_emote_assets;

   SELECT c.active_version_id,
          v.previous_version_id,
          jsonb_array_length(v.entries) AS item_count,
          count(*) FILTER (WHERE (entry.value->>'enabled')::boolean) AS enabled_count
   FROM match_emote_catalog_config c
   JOIN match_emote_catalog_versions v ON v.id = c.active_version_id
   CROSS JOIN LATERAL jsonb_array_elements(v.entries) entry
   WHERE c.id = 'default'
   GROUP BY c.active_version_id, v.previous_version_id, v.entries;
   ```

   从未经过管理员扩充的默认环境预期 `asset_count=9`、`item_count=9`、`enabled_count=9`；active version 为 `00000000-0000-4000-8000-000000000202`，previous version 指向迁移前 active 目录。

5. 检查 `/api/config` 返回三项新 ID，并在真实对局中分别发送一次，确认菜单、身份旁浮层和聊天时间流都加载静态资源。

## 失败与回滚边界

- 对象上传失败时不执行数据库迁移；内容寻址上传可安全重试。
- 目录容量或稳定 ID 检查失败时，保持停机并先通过现有管理目录处理冲突，不修改迁移 SQL 绕过保护。
- 迁移成功后不手工改写 active version JSON。试用反馈需要停用或调整顺序时，使用管理 API 发布下一目录版本。
- 整体回滚依赖迁移前数据库备份；已经上传但不再被 active 目录引用的内容寻址对象可暂时保留，确认没有历史目录引用前不得删除。
