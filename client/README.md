# Loveca Web 客户端

> 文档类型：总览文档
> 适用范围：`client/` 客户端目录、常用命令、主要模块和后端依赖
> 当前状态：现行客户端入口

React + Vite + TypeScript 客户端，负责牌桌、卡组管理、卡牌管理后台、账号流程和正式联机房间界面。

## 常用命令

```bash
pnpm --dir client dev
pnpm --dir client build
pnpm --dir client lint
pnpm --dir client test:e2e:mobile
pnpm --dir client test:e2e:visual
pnpm --dir client preview
```

视觉基线仅在明确接受页面变化时通过 `pnpm --dir client test:e2e:visual:update` 更新；不同运行平台使用各自的截图目录。

## 主要目录

- `src/components/game`：牌桌、玩家区域、阶段面板、判定与结算 UI
- `src/components/pages`：首页、对局入口、正式联机、调试联机、分享卡组页面
- `src/components/deck`、`src/components/deck-editor`：卡组列表、导入导出、构筑编辑器
- `src/components/admin`：运营管理中心，以及卡牌、同步、AI 配置、用户、赛季、分类、平台数据、快捷表情与候场曲库等管理页面
- `src/store`：Zustand 状态管理
- `src/lib`：REST API、图片、卡牌、联机、管理员 AI 提取客户端与应用更新协调器

## 后端依赖

生产与完整开发流程依赖根项目的 Express API。客户端默认同源访问 API；本地调试可通过 `VITE_API_BASE_URL` 指向后端服务。

## 启动恢复与公开卡池缓存

启动卡池使用独立的 `GET /api/cards/published`，返回 API envelope 中的
`{ schemaVersion: 1, cards }`。只包含已发布卡牌的公开展示和规则字段，保留权威图片文件名；
不输出数据库身份、审计字段或外部来源元数据。与管理列表、导出接口的权限和表示分开。

成功响应使用 `Cache-Control: public, no-cache` 和 Express 内容 ETag。客户端不发送
Cookie/Authorization，每次加载先重新验证；未变化时由浏览器合并 304 与完整缓存正文。
每次服务端验证读取当前数据库，不使用额外的服务端卡池快照缓存。只有完整、结构有效且
非空的卡池才能装载；失败不回退到旧卡池。人工重试使用 `cache: reload` 以绕过损坏缓存。
这只保证本次读取的新鲜度，不包含跨页面实时同步、开局版本握手或服务端 registry 缓存改造。

公开卡池请求每次最多等待 15 秒；网络、正文读取或超时失败最多额外重试一次，退避
300–599 ms，整个请求任务预算 31 秒。主动取消、HTTP 错误、JSON 或卡池结构错误不自动
重试。普通 API、写请求和对局命令保持原策略。并发初始化和重复点击共用正在进行的任务。

生产页面卡池失败后支持原地重试及复制简短诊断；配置或维护快照失败也可原地重新检查。
恢复时先确认配置和维护状态，保留原页面、登录、本地卡组、设置与对局恢复标识。
诊断仅包含构建标识、时间、请求阶段、耗时、结果与收到的请求 ID，不导出完整导航记录。
`appPerformance` 的 `loveca:startup:catalog-attempt` 记录这次加载最多两次尝试；下载/解析
时间只在相应阶段完成时提供，收到响应头后发生的失败仍保留请求 ID。

此阶段未接入 CDN/ESA、不可变卡池快照或 PWA 调度调整，也不代表香港、台湾网络已验收。
已移除旧的 `GET /api/cards` 全量列表入口、前端全量缓存和无调用者的查询方法；
启动与测试夹具只读取新卡池格式。前后端需同步部署，旧页面需刷新到新版。
开发模式仍保留本地调试的空卡池降级，因此失败恢复必须用显式生产构建验收：

```bash
NODE_ENV=production pnpm --dir client build
pnpm --dir client preview --host 127.0.0.1 --port 4175
# 在另一终端，指向上面的隔离测试 preview；测试使用模拟 API，不操作账号数据。
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4175 pnpm --dir client exec playwright test tests/e2e/startup-recovery.spec.ts --project=tablet-1024x768 --project=mobile-390x844
```
