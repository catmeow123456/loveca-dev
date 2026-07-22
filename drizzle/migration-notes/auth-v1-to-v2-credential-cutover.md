# 认证凭据 v1 -> v2 切换说明

> 文档类型：版本迁移说明
> 适用范围：部署只接受 v2 认证凭据格式的 API 前，迁移既有用户认证数据
> 当前状态：强制维护窗口清单；权威通用部署流程仍以 `docs/production-release-runbook.md` 为准

本次切换不新增数据库字段，但不在运行时代码中保留 v1 密码、刷新 Cookie 或一次性 token 的兼容读取。必须在停止旧 API 写入后执行 `drizzle/data-migrations/auth-v1-to-v2-credential-cutover.ts`，再部署新版 API 和前端。

## 1. 数据影响

- v2 密码使用 SHA-256 预哈希后再执行 bcrypt 12；旧 `bcrypt(password)` 无法在不知道明文密码的情况下无损转换。
- 迁移会把所有旧 bcrypt 或未知密码凭据标记为“必须重置”。这些用户部署后不能继续使用旧密码登录，需要通过邮件找回或由运营执行独立的账号恢复流程。
- 迁移会删除全部刷新令牌、邮箱验证 token 和密码重置 token。所有设备需要重新登录，未完成的验证或重置链接需要重新申请。
- 使用 `@placeholder.loveca.local` 邮箱的受影响账号无法自助找回。脚本默认阻断正式执行，必须先处理这些账号；只有明确接受人工恢复影响时才传入 `--allow-unrecoverable-accounts`。

## 2. 执行前检查

1. 进入维护窗口，停止旧 API 和所有会写入认证表的任务。
2. 完成 Postgres 备份并验证恢复命令。
3. 确认启用邮件找回的部署已配置 `EMAIL_ENABLED=true` 和完整 SMTP 环境变量。
4. 对占位邮箱账号准备真实邮箱绑定、人工密码恢复或账号淘汰方案。
5. 确认新版 API、前端和本迁移脚本来自同一提交。

## 3. Dry-run

默认只读。报告会列出当前密码、旧 bcrypt、未知格式、已标记重置、占位邮箱影响和三类 token 数量：

```bash
DATABASE_URL='postgres://...' pnpm exec tsx \
  drizzle/data-migrations/auth-v1-to-v2-credential-cutover.ts \
  --dry-run \
  --report=tmp/auth-v2-dry-run.json
```

若报告中的 `placeholderResetRequiredCount` 不为 0，应先处理账号恢复路径，不要直接正式执行。

## 4. 正式执行

确认 dry-run、备份和恢复安排后执行：

```bash
DATABASE_URL='postgres://...' pnpm exec tsx \
  drizzle/data-migrations/auth-v1-to-v2-credential-cutover.ts \
  --apply \
  --yes \
  --invalidate-legacy-passwords \
  --report=tmp/auth-v2-apply.json
```

只有明确接受占位邮箱账号无法自助找回时，才额外增加：

```text
--allow-unrecoverable-accounts
```

脚本在单个事务中标记旧密码并清空三类 token，提交前校验不再存在旧/未知密码凭据或遗留 token。受影响行数与 dry-run 不一致时会回滚。

## 5. 部署与验证

迁移成功后立即部署新版 API 和前端，不要重新启动旧 API。验证：

- v2 账号可以登录并获得 `v2:<tokenId>:<secret>` 刷新 Cookie。
- 旧密码账号返回通用凭据错误，并可以通过新申请的邮件链接重置密码。
- 旧刷新 Cookie、旧邮箱验证链接和旧密码重置链接均不可继续使用。
- 重置密码后用户可以登录，数据库密码字段不再是重置标记。

## 6. 回滚边界

- 迁移会覆盖旧密码哈希；仅回滚 API 代码不能恢复旧密码。
- 如需完整回滚，必须停止写入并恢复迁移前 Postgres 备份，同时回滚 API 和前端。
- 若只需恢复个别账号，应走独立账号恢复流程，不要把旧格式兼容重新加入运行时代码。
