# 认证凭据 v1 -> v2 兼容切换说明

> 文档类型：版本迁移说明
> 适用范围：部署包含兼容认证切换的后续版本。`v3.7.2` tag 的原始脚本会强制重置旧密码，不能用于本说明。

本切换不从 `bcrypt(password)` 反推出明文或直接改成 `bcrypt(sha256(password))`。停机脚本只将可识别的原始 bcrypt 摘要包裹为 `$loveca-bcrypt-raw$<bcrypt-hash>`。新版运行时只接受这个显式兼容格式，不会接受未加前缀的原始摘要；用户用原密码成功登录后，系统会在同一账号会话更新事务中写入当前 `$loveca-bcrypt-sha256$<bcrypt-hash>` 格式。

## 数据影响

- 可识别的旧 bcrypt 密码保留原始摘要，用户可继续用原密码登录；首次成功登录会升级为当前 v2 格式。
- 当前 v2 密码不改动。`reset-required` 或未知格式密码无法证明与原密码的对应关系，正式 apply 会阻断，不允许用参数绕过。
- 全部刷新令牌、邮箱验证 token 和密码重置 token 会删除。用户需要重新输入原密码登录；旧 Cookie 和旧链接不能继续使用。
- 占位邮箱账号只要密码为可识别 bcrypt 就不需要重置；若该账号本身已是 reset-required 或未知格式，仍必须先走独立账号恢复。

## 执行前检查

1. 使用包含本迁移脚本、兼容验证和首次登录升级逻辑的同一提交构建 API 与前端，不得使用原 `v3.7.2` reset-only 镜像。
2. 进入维护窗口，停止旧 API、队列和所有可能写入用户或认证 token 的任务。
3. 完成 Postgres dump，并验证恢复命令；停机后再次运行 dry-run，作为 apply 的数量基线。
4. 在具备源码、devDependencies、Node、pnpm 与生产 `DATABASE_URL` 的发布环境执行脚本。API runtime 镜像不能执行 Drizzle CLI 或该 TypeScript 脚本。

## Dry-run

```bash
DATABASE_URL='postgres://...' pnpm exec tsx \
  drizzle/data-migrations/auth-v1-to-v2-credential-cutover.ts \
  --dry-run \
  --report=tmp/auth-v2-dry-run.json
```

仅当 `resetRequiredPasswordCount = 0` 且 `unsupportedPasswordCount = 0` 时才能继续。`legacyBcryptPasswordCount` 是会被保留并包裹的账号数，不是待重置人数。

## 正式执行

```bash
DATABASE_URL='postgres://...' pnpm exec tsx \
  drizzle/data-migrations/auth-v1-to-v2-credential-cutover.ts \
  --apply \
  --yes \
  --report=tmp/auth-v2-apply.json
```

脚本在单个事务中包裹旧 bcrypt 摘要、删除三类 token，并复核受影响行数与 postcondition。apply 报告中应满足：`legacyBcryptPasswordCount = 0`、`unsupportedPasswordCount = 0`、`resetRequiredPasswordCount = 0`，且三类 token 数量均为 0。

可使用以下 SQL 复核：

```sql
SELECT count(*) FILTER (WHERE password_hash LIKE '$loveca-bcrypt-sha256$%') AS current_v2,
       count(*) FILTER (WHERE password_hash LIKE '$loveca-bcrypt-raw$%') AS compatible_legacy,
       count(*) FILTER (WHERE password_hash ~ '^\\$2[aby]\\$') AS unwrapped_legacy,
       count(*) FILTER (WHERE password_hash = '$loveca-password-reset-required$v1') AS reset_required,
       count(*) FILTER (
         WHERE password_hash NOT LIKE '$loveca-bcrypt-sha256$%'
           AND password_hash NOT LIKE '$loveca-bcrypt-raw$%'
           AND password_hash <> '$loveca-password-reset-required$v1'
           AND password_hash !~ '^\\$2[aby]\\$'
       ) AS unsupported
FROM users;

SELECT (SELECT count(*) FROM refresh_tokens) AS refresh_tokens,
       (SELECT count(*) FROM email_verification_tokens) AS verification_tokens,
       (SELECT count(*) FROM password_reset_tokens) AS reset_tokens;
```

## 部署与验证

认证切换成功后立即部署同提交的 API 与前端，不要重新启动旧 API。至少验证：

- 一个迁移前的 bcrypt 测试账号可用原密码登录，并获得 v2 refresh Cookie。
- 该账号的 `password_hash` 从 `$loveca-bcrypt-raw$...` 升级到 `$loveca-bcrypt-sha256$...`；错误密码仍被拒绝。
- 当前 v2 测试账号仍可登录、刷新和登出。
- 旧 refresh Cookie、邮箱验证链接和密码重置链接均无效。

## 回滚边界

- 在 apply 前可直接停止并保留旧 API；未执行数据写入时无需恢复数据库。
- apply 后旧 API 无法读取带兼容前缀的密码；且一旦用户首次登录，密码会升级成旧 API 不可验证的格式。回滚必须停止写入、恢复发布前 Postgres dump，并同时回滚 API 与前端。
