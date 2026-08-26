# 活动徽章迁移说明

> 文档类型：迁移运行说明
> 适用范围：`0035_add_activity_badges.sql`，以及已经存在首届排位徽章数据的环境
> 当前状态：开发基线；尚未在生产执行

## 变更与边界

- 排位赛季与娱乐模式活动各自最多配置一枚当前徽章，资格门槛固定为 3 场有效对局。
- 管理员首次上传会创建活动规则并补发已经达标的玩家；替换只更新当前图片 revision，不重复授予，也不撤回既有徽章。
- 新运行时只读取 `player_badge_rules.image_object_key` 指向的公开对象，不再读取 `/badges/first-ranked-season.png` 静态路径。
- `assets/badges/first-ranked-season.png` 仅保留为旧生产数据的一次性迁移输入，不属于新运行时 fallback。

## 停机迁移

1. 停止 API、排位结算和娱乐模式对局封存写入，完成并验证 PostgreSQL 与公开对象存储备份。
2. 执行 `pnpm db:migrate`。迁移会把已知的 `ranked-first-season-qualified` 规则指向冻结对象键；若发现其他未审计旧规则会直接失败，必须先逐条制定迁移方案。
3. 若环境曾执行首届徽章补发，先预览旧图片对象上传：

```bash
DATABASE_URL=... pnpm badges:activity-assets:seed
```

4. 核对 `objectKey`、`sha256`、`bytes`；保持停机并执行：

```bash
DATABASE_URL=... pnpm badges:activity-assets:seed -- --apply --yes
```

5. 再次执行预览，确认 `alreadyExists=true`；从对象存储读取该键并核对为静态 WebP。
6. 部署同一版本 API 与前端，使用赛季管理员账号分别验证排位、娱乐模式徽章读取与一次替换，再恢复写入。

全新环境如果没有历史规则，脚本会返回 `notApplicable=true`，不上传旧素材；后续直接由管理员在对应活动设置中首次上传。
