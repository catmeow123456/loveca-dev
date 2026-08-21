# 平台维护三态迁移说明

`0029_maintenance_mode_three_state.sql` 将平台状态收敛为 `NORMAL`、`RESTRICTING_NEW_GAMES`、`MAINTENANCE`。状态配置继续使用单例行上的最后修改人和修改时间；当前不增加专用状态审计表。

本迁移必须在停机窗口执行。执行前先备份数据库，并用新版本离线工具在独立持久目录创建 `MAINTENANCE` 快照；确认反向代理的 `/site-status.json` 已指向该文件且禁止缓存后，再停止旧 API。

迁移会把旧 `SCHEDULED`、`COMPLETED`、`POSTPONED`、`CANCELLED` 行转换为 `NORMAL` 并清空维护字段。这些旧值的计划与历史语义应在迁移前人工核对为公告内容；运行时不提供旧值兼容读取。

迁移后应验证：

```sql
SELECT lifecycle, count(*)
FROM site_status_config
GROUP BY lifecycle;

SELECT updated_by, updated_at
FROM site_status_config
WHERE id = 'default';
```

启动新 API 后先检查 `/api/health` 与 `/api/ready`。保持公开快照为 `MAINTENANCE`，由平台管理员通过恢复入口保存 `NORMAL`；只有数据库状态和公开快照均恢复开放后，才能继续普通页面 smoke。
