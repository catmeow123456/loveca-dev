# 候场 BGM 曲库迁移说明

> 适用范围：`0038_add_matchmaking_bgm_library.sql`
> 当前状态：迁移已生成，尚未在生产执行
> 最后更新：2026-09-01

## 变更

迁移新增 `matchmaking_bgm_tracks`，并登记当前版本随前端发布的三首候场 MP3。`is_default` 表示平台管理员维护的默认播放子集，初始三首均默认选中，新上传曲目默认不加入该子集。新上传曲目使用公共对象存储中的内容寻址键；匹配成功提示音不属于本表。

`profiles.matchmaking_bgm_track_ids` 保存用户自定义子集。`NULL` 表示实时跟随平台默认值；非空数组表示用户明确选择的曲目，其中空数组表示候场静音。播放时只取该数组与当前曲库的交集，因此曲目删除后无需在用户档案中保留兼容读取或同步清理路径。

## 执行与验证

1. 按发布流程停止旧版应用和数据库写入，完成备份。
2. 确认当前前端版本仍包含 `assets/music/event-2-theme.mp3`、`event-menu-theme.mp3` 与 `intro-theme.mp3`。
3. 执行 `pnpm db:migrate`，再部署同一 SHA 的 API 与前端。
4. 使用平台管理员账号读取曲库、上传一首受控 MP3，确认新曲默认未选中；调整并保存平台默认子集，试听后删除；另以普通账号验证管理接口返回 403。
5. 以普通账号分别验证跟随平台默认、自定义非空子集和自定义空子集，并确认重新登录后偏好仍存在。
6. 分别进入公共牌桌、排位和娱乐模式候场，确认只从有效子集随机播放、空子集保持静音、等待音乐会在匹配形成时停止，且匹配提示音仍正常播放。

```sql
SELECT title, storage_key, byte_size, is_default
FROM matchmaking_bgm_tracks
ORDER BY created_at, id;

SELECT id, matchmaking_bgm_track_ids
FROM profiles
WHERE matchmaking_bgm_track_ids IS NOT NULL;

SELECT COUNT(*) AS invalid_keys
FROM matchmaking_bgm_tracks
WHERE storage_key !~ '^music/[a-z0-9][a-z0-9._-]*[.]mp3$'
  AND storage_key !~ '^matchmaking-bgm/[0-9a-f]{64}[.]mp3$';
```

迁移刚完成且尚未运营上传时，第一条查询应返回三条 `is_default = true` 的内置曲目，用户自定义查询应为空，非法对象键查询应返回 `0`。

## 回滚边界

新版本运行时不保留硬编码曲库 fallback。回滚必须在停机窗口先回退 API 与前端，再删除 `profiles.matchmaking_bgm_track_ids` 和本表；若已有管理员上传曲目，应先导出表记录并按对象键保留或清理对应对象。删除内置曲目的管理操作只删除登记，不删除随版本发布的静态 MP3。
