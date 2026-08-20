# 赛季管理员角色迁移说明

> 文档类型：专题说明
>
> 适用范围：`0028_add_season_admin_role.sql` 的停机迁移、角色切换与上线前验证
>
> 当前状态：开发基线；赛季写操作审计完整覆盖前不得为真实运营账号分配 `season_admin`

对应迁移：`0028_add_season_admin_role.sql`。

本迁移将 `profiles.role` 的数据库约束从 `user | admin` 扩展为 `user | season_admin | admin`，并创建追加式 `management_audit_logs`，作为后续赛季管理持久审计的统一边界。角色变更不写入该表。迁移不自动授予任何用户新角色，现有 `user` / `admin` 值保持不变。

本能力不支持滚动兼容。旧应用不能识别 `season_admin`，因此必须在停机窗口完成迁移和应用切换；在新应用及前端全部就绪、赛季写操作审计覆盖完成前，不得向真实运营账号分配 `season_admin`。

执行前检查：

- 已停止旧应用、后台任务和其他 `profiles` 写入者；
- 已完成数据库备份，并按顺序应用 `0001` 至 `0027`；
- `profiles.role` 仅包含 `user` / `admin`，不存在异常字符串；
- 至少存在一个能够登录的 `admin`，并确认其账号与邮箱可用于恢复管理权限；
- 已确认本次应用版本包含数据库当前角色复核、最后一个平台管理员保护和独立角色管理接口。

执行后检查：

- `profiles_role_check` 接受三种正式角色并拒绝其他字符串；
- 现有各角色数量与迁移前一致，`season_admin` 初始数量为 0；
- `management_audit_logs` 及 actor、scope/target、时间索引存在；
- 平台管理员可以分页读取用户摘要，并能完成一次测试账号 `user → season_admin → user` 往返；
- 每次实际角色变化均撤销目标用户全部 refresh token，且不写入管理审计；
- 过期 `expectedRole` 返回 409，最后一个平台管理员降级返回 409；
- 被降权账号的旧 access token 在下一次特权请求返回 `AUTHORIZATION_STALE`。

回滚不能只恢复旧约束。如果已经分配 `season_admin`，必须先在停机窗口明确逐账号恢复策略，将全部 `season_admin` 显式改回 `user` 或 `admin`，确认无旧会话后才能恢复旧应用和旧约束。删除审计表会丢失赛季管理审计，不作为常规回滚步骤。
