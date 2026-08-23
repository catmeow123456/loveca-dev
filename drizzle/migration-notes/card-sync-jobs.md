# 上游新卡同步任务迁移说明

> 适用范围：`0031_add_card_sync_jobs.sql`、运营管理中心“上游新卡同步”

> 后续 lease fencing、卡号/非负字段约束与 `0033_harden_card_sync.sql` 发布步骤见 [上游新卡同步加固迁移说明](card-sync-hardening.md)。

## 迁移内容

迁移新增 `card_sync_runs` 与 `card_sync_run_items`，只保存预览/执行的安全摘要、状态、操作者、request ID、幂等键和逐卡结果。迁移本身不会连接 CloudBase、不会执行同步、不会新增或修改 `cards` 数据，也不会保存 CloudBase 凭据、原始文档或临时签名图片 URL。

数据库约束保证同一时刻至多存在一个 `QUEUED` / `RUNNING` 的正式同步任务；同一管理员、任务类型与幂等键只能创建一条记录。应用与迁移必须作为同一版本发布，旧应用不读取新表。

## 发布顺序

1. 备份 PostgreSQL，确认当前没有人工运行 `sync-cards-cloudbase-new.ts`。
2. 在停机或禁止管理员同步的窗口执行 `pnpm db:migrate`。
3. 将 `CLOUDBASE_ENV_ID`、`CLOUDBASE_SECRET_ID`、`CLOUDBASE_SECRET_KEY` 填入生产仓库根目录中不提交 Git 的 `.env`，并确认它们已注入 API 进程；不要打印变量值。
4. 部署同一提交的 API 与前端并重启 API。页面应先显示配置状态，再允许平台管理员执行只读预览。
5. 首次正式同步前检查候选、阻断项和 warning；确认后导入的新卡必须为 `DRAFT`，已有卡不得改变。

## 回滚与失败处理

应用回滚不会自动删除已导入的卡牌，也不应通过迁移 down 操作删除任务历史。若任务部分成功，重新预览会把已成功插入的卡视为已有卡；管理员应人工复核新增草稿后再决定后续处理。

凭据缺失或 CloudBase 不可达只会使预览失败，不应影响其他 API。若怀疑凭据泄漏，必须由凭据所属方在腾讯云侧轮换或废止；删除本地配置或回滚应用不能使已泄漏凭据失效。
