# 卡牌效果 AI 私密配置停机迁移说明

> 适用范围：`0023_add_ai_effect_extraction_config.sql`、服务端 AI 提取链路、旧浏览器 DashScope 代理移除

## 迁移边界

- 迁移新增 AI 配置单例与追加式审计表，并只建立 `enabled=false` 的空配置。
- 旧 `DASHSCOPE_BASE_URL` / `DASHSCOPE_API_KEY`、示例值和空值不会自动写入数据库。新业务路径不读取旧变量，也不保留 dual-read。
- 配置 API Key 使用部署环境主密钥进行 AES-256-GCM 认证加密。数据库备份必须与主密钥分开保护；缺失原主密钥时密文不能恢复。
- 本说明不授权写入生产 Key、启用真实上游或发起真实模型调用。

## 发布前准备

1. 为目标环境生成唯一的 32 字节随机主密钥，编码为 64 位 hex 或 base64，写入部署 Secret：`AI_EFFECT_EXTRACTION_ENCRYPTION_KEY`。
2. 将实际 OpenAI-compatible 上游的精确主机名写入 `AI_EFFECT_EXTRACTION_ALLOWED_HOSTS`。仅在已评审的自建环境中使用 `AI_EFFECT_EXTRACTION_PRIVATE_HOSTS` 或 `AI_EFFECT_EXTRACTION_HTTP_HOSTS`；例外主机也必须在主允许列表中。
3. 备份 PostgreSQL，记录当前部署 SHA 和旧 AI 环境变量是否存在。若要迁移旧值，先人工验证 Base URL、模型、Key 所属环境和调用权限；不要复制示例或无法验证的值。

## 停机发布顺序

1. 停止旧 API 与前端发布，阻止管理员继续编辑卡牌。
2. 执行数据库迁移：

   ```bash
   pnpm db:migrate
   ```

3. 只读确认单例处于禁用状态且审计表为空：

   ```sql
   SELECT id, revision, enabled, base_url, model_id,
          encrypted_api_key IS NOT NULL AS api_key_configured
   FROM ai_effect_extraction_config;

   SELECT count(*) AS audit_count FROM ai_effect_extraction_audit_logs;
   ```

   首次迁移预期为 `default / 1 / false / 空 / 空 / false`，审计数为 0。

4. 部署同一提交的 API 与前端；确认构建产物和 Vite 配置中不存在 `/api/dashscope` 代理。
5. 以管理员身份打开运营管理中心。确认页面显示主密钥和主机白名单就绪后，输入经审核的候选值并先执行“测试候选配置”。
6. 测试通过后保存。再次读取管理配置，只应看到 `apiKeyConfigured=true`，不应看到 Key 或密文；数据库密文字段应以 `v1.` 开头且不包含明文。
7. 在一张已保存卡图的草稿卡上执行提取，确认结果只回填编辑框，取消编辑不会修改卡牌数据。

## 失败与回滚

- 迁移失败：保持停机，修复迁移后重试；不要手工创建半套表。
- 部署安全配置未就绪：保持 AI 配置禁用，其他管理模块可继续使用；修复 Secret/允许列表后重启 API。
- 新链路部署失败：优先修复同一版本。若必须整体回退，应恢复迁移前数据库备份并部署旧前后端；不要在新表已接受写入后单独启动旧浏览器代理。
- Key 误填或泄露：在提供方撤销旧 Key，使用“替换 Key”保存新值；运行时不保留旧 Key fallback。
