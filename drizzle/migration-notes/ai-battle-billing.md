# AI 对战计费字段迁移

> 适用范围：首次部署包含 `0040_add_ai_battle_billing.sql` 的版本。
> 本地隔离验证与生产迁移分别执行；本文不表示生产已更新。

## 变更

`match_records` 新增可空 `ai_billing` JSONB，保存本局模型、北京人民币单价快照、五项累计用量、调用/已确认次数和写入 revision。金额从保存事实精确计算；没有新增账单表。`match_records_ai_billing_origin_check` 要求非空值只能属于 `AI_DEBUG`。

旧记录保持 NULL，历史显示“未记录”。不根据旧回放、裁剪日志或平均消耗补齐费用。新局在首次模型调用前必须初始化计费；运行路径不接受旧格式或按需迁移。

## 执行

平台 URL/Key 共用既有 `ai_effect_extraction_config`，无需新增上游配置迁移。卡效提取模型与开关仍只控制提取；对战开局读取 URL/Key 并独立选择模型。保存后的上游供新局使用，无需重启；已有局保持开局配置。

1. 停止旧 API 及写入任务，备份目标数据库；先在备份副本执行 `pnpm db:migrate` 并检查结果。
2. 确认目标库无进行中的旧 AI 对局后，使用发布环境的 `DATABASE_URL` 执行 `pnpm db:migrate`。
3. 部署新服务及前端，在平台“AI 上游配置”中保存 Base URL 与 API Key；复用已有加密主密钥和主机白名单。旧 `AI_BATTLE_BASE_URL` / `AI_BATTLE_API_KEY` 不再读取，也不自动迁入平台表。网页创建模型必须为 `qwen3.8-max` / `qwen3.8-flash`；不接受旧的缺少 model 的创建请求。
4. 新建一场 AI 调试局并完成一次调用，核对原始 usage、单步提示、本局累计与历史接口；失败/结束不可重复计入同一次请求。

校验：

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'match_records' AND column_name = 'ai_billing';

SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'match_records_ai_billing_origin_check';

SELECT match_id, origin_kind, status,
       ai_billing->>'model' AS model,
       ai_billing->>'attempts' AS attempts,
       ai_billing->>'reportedAttempts' AS reported_attempts
FROM match_records
WHERE ai_billing IS NOT NULL
ORDER BY updated_at DESC LIMIT 10;
```

历史费用由当前 `rules.manage` 权限及原局真人归属约束。会话过期、进程重启和回放清成 METADATA_ONLY 后仍读取根记录。无法收到的 usage 只能保持未确认，不能以现金账单精度承诺估价。

若需回滚，先停止写入并保留备份；旧程序不会采集新费用，不能让它继续创建需要完整计费的 AI 对局。不要删除已采集的计费字段来消除未确认状态。
