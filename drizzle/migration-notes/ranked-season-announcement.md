# 排位赛季公告字段迁移说明

> 文档类型：迁移运行说明
> 适用范围：`0018_add_ranked_season_announcement.sql` 的执行、校验与回滚边界
> 当前状态：迁移已生成，尚未在生产执行
> 最后更新：2026-08-09

## 变更

迁移为 `ranked_seasons` 增加非空纯文本字段 `announcement`，默认值为空字符串，并用数据库约束限制最多 2000 个字符。现有赛季只会得到空公告，不改变评分配置、积分流水、生命周期或匹配状态。

## 执行与验证

1. 按正常发布流程备份数据库并停止旧版应用写入。
2. 执行 `pnpm db:migrate`，确认 `0018` 成功登记。
3. 验证所有赛季的公告字段非空、长度不超过 2000，且既有赛季的积分和生命周期没有变化。
4. 部署新代码后，分别验证草稿赛季和活动赛季的公告编辑，以及玩家赛季页、候场状态和排位房间中的公告展示。

```sql
SELECT COUNT(*) FROM ranked_seasons WHERE announcement IS NULL;
SELECT COUNT(*) FROM ranked_seasons WHERE char_length(announcement) > 2000;
SELECT id, season_key, lifecycle, char_length(announcement) AS announcement_length
FROM ranked_seasons
ORDER BY created_at;
```

## 回滚边界

旧版代码不会读取该字段。若尚未依赖公告内容，可在停机窗口删除长度约束和字段后回退；一旦运营已写入公告，删除字段会丢失数据，应先导出内容并取得单独授权。
