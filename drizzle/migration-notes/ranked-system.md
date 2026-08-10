# 赛季排位首版迁移说明

> 文档类型：迁移运行说明
> 适用范围：`drizzle/0010_add_ranked_system.sql` 的停机执行、校验与回滚边界
> 当前状态：已在生产落地；本文保留为历史执行、校验与回滚边界

## 变更内容

- 新增赛季、排位对局、当前积分、软重置种子与追加式积分流水；
- 公共牌桌票据和预留增加 `queue_kind / season_id`，预留增加房间创建尝试次数；既有
  数据保持 `CASUAL + NULL`，尝试次数从 `0` 开始；
- 玩家占用类型增加 `RANKED_QUEUE`；
- 对局来源增加 `RANKED`；
- 建立全平台单一有效赛季、排位生命周期、竞技环境、候场绑定、幂等结算、结果类型
  一致性和审计重建所需的外键、检查约束与唯一索引。

迁移不会创建赛季、回填旧对局积分或开放排位候场。

## 执行前提

这是停机迁移，不提供旧新结构 dual-read：

1. 停止 API、候场任务、排位运行时任务和对局记录写入；
2. 完成 PostgreSQL 备份；
3. 确认数据库已经登记到 `0009_magenta_nightcrawler`，且没有手工预建同名排位表；
4. 审查 `0010_add_ranked_system.sql` 后执行 `pnpm db:migrate`；
5. 部署理解完整排位结构的新版本；
6. 完成下列校验后再恢复服务。

不要使用 `db:push` 代替正式迁移记录。

## 验证

```sql
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'ranked_seasons',
    'ranked_matches',
    'ranked_player_ratings',
    'ranked_player_seeds',
    'ranked_rating_events',
    'ranked_rating_event_steps'
  )
ORDER BY tablename;
```

预期返回 6 张表。

```sql
SELECT queue_kind, season_id IS NULL AS season_is_null, count(*)
FROM public_table_tickets
GROUP BY queue_kind, season_id IS NULL
ORDER BY queue_kind, season_id IS NULL;

SELECT queue_kind, season_id IS NULL AS season_is_null, count(*)
FROM public_table_reservations
GROUP BY queue_kind, season_id IS NULL
ORDER BY queue_kind, season_id IS NULL;
```

迁移前已有票据和预留只能出现 `CASUAL / true`。

```sql
SELECT
  (SELECT count(*) FROM ranked_seasons) AS seasons,
  (SELECT count(*) FROM ranked_matches) AS matches,
  (SELECT count(*) FROM ranked_rating_events) AS rating_events;
```

三个值都应为 0。

## 运行与回滚边界

- `ranked_player_ratings` 是可重建投影；`ranked_rating_events` 和
  `ranked_rating_event_steps` 是不可覆写的审计流水；
- 休闲票据保持 `CASUAL + NULL`，排位票据和预留必须保持
  `RANKED + season_id`；
- 软重置只在赛季激活事务中生成一次；
- 如果尚无排位赛季、票据、对局、种子或积分流水，可停机后从备份整体回滚；
- 一旦产生正式排位数据，不得通过删表、删列或手改积分回滚，必须走备份恢复或追加式
  更正流程。
