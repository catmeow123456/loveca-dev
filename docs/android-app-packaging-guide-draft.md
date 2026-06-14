# Loveca Android App 打包指南草稿

> 文档类型：计划文档 / 专题说明
> 适用范围：将当前 Loveca Web 客户端封装或发布为 Android App 的路线选择、前置条件和验收清单
> 当前状态：草稿；仓库已落地 PWA/TWA 前置项，并已生成 Bubblewrap TWA 工程和本地测试 APK/AAB；正式发布仍需部署更新后的线上 PWA manifest、Digital Asset Links、正式签名和 Google Play / 渠道发布流程

本文基于当前项目结构、部署方式和移动端适配文档整理。目标是回答“如果要把 Loveca 打包成 Android App，需要做什么”，并记录已开始实施的 PWA/TWA 仓库侧准备与本地 TWA 测试包状态。

## 1. 当前项目事实

Loveca 当前是 Web 优先架构：

- 根项目是 TypeScript / Express 后端，负责账号、卡组、卡牌数据、图片上传、正式联机房间和对局服务。
- `client/` 是 React + Vite + TypeScript 前端，负责牌桌、卡组管理、卡牌管理后台、账号流程和联机房间界面。
- 生产部署假设是同源入口：Nginx 代理 `/` 到前端预览服务，`/api/` 到 Express API，`/images/` 到 MinIO 或兼容 S3 对象存储。
- 客户端默认使用同源 API；`VITE_API_BASE_URL` 只用于需要浏览器访问不同 API / 图片代理源的场景。
- 前端已接入 `vite-plugin-pwa`，已有 Web App Manifest、Service Worker 运行时缓存和版本缓存清理逻辑，并已补齐 `192x192` / `512x512` / maskable PWA 图标声明。
- 登录续期依赖服务端写入的 `httpOnly` refresh cookie，当前 cookie 设置为 `secure: !config.isDev`、`sameSite: 'lax'`、`path: '/api/auth'`。
- 生产服务端默认不开 CORS，因为生产预期由同源 Nginx 代理解决跨域问题。
- 移动端已有基础适配和基线 E2E，但对战页、软键盘、安全区、覆盖层、触控热区和 hover / 拖拽替代路径仍是主要风险。

相关本地文档：

- [Web 客户端说明](../client/README.md)
- [当前实现限制](current-limitations.md)
- [移动端适配需求](UI_MOBILE_ADAPTATION_REQUIREMENTS.md)
- [移动端现状差距清单](UI_MOBILE_ADAPTATION_GAP_ANALYSIS.md)
- [MinIO 对象存储](minio-requirements.md)

## 2. 总体建议

如果目标是“尽快有一个 Android 图标，打开后就是线上 Loveca”，优先考虑 **PWA + Trusted Web Activity (TWA)**。

原因：

- 当前 Loveca 已按同源 Web 应用设计，TWA 直接打开生产站点，可以继续使用现有 `/api`、`/images`、cookie 和 Nginx 部署方式。
- 不需要立刻改服务端 CORS、refresh cookie、token 存储和图片 URL 策略。
- 前端已有 PWA 基础，补齐 manifest、图标和可安装性验收后更接近 TWA 要求。

如果目标是“真正把前端资源打进 APK / AAB，未来接入原生能力，或面向没有稳定 TWA 支持的 Android 环境分发”，再考虑 **Capacitor**。

但 Capacitor 本地资源包会让前端运行在 Android WebView 的本地 origin 下，访问远端 Loveca API 会变成跨源请求。以当前代码看，这条路线需要先处理 CORS、cookie、认证续期和 API base URL 策略，不能只加一个 Android 壳就完成。

## 3. 路线选择

| 路线             | 适合场景                                                  | 主要优点                                    | 主要代价                                                   |
| ---------------- | --------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| PWA 安装         | 不上架，只让用户从浏览器安装到桌面                        | 最少工作量，沿用现有部署                    | 不是应用商店里的原生包，系统能力有限                       |
| TWA              | 上架 Google Play 或产出一个打开线上站点的 Android 包      | 保持同源 Web 架构，后端改动少，更新跟随网站 | 依赖支持 TWA 的浏览器；需要 Digital Asset Links 与签名校验 |
| Capacitor 本地包 | 需要本地打包资源、原生插件、国内分发或更强 WebView 可控性 | APK / AAB 内含前端资源，可扩展原生能力      | 当前后端同源假设会被打破，需要认证、CORS 和发布流程改造    |
| 手写 WebView 壳  | 只想极简打开网页或本地 HTML                               | 初期代码少                                  | 维护成本和坑最多；建议除非有明确原生团队维护，否则不选     |

### 3.1 推荐阶段

1. 第一阶段：把 Web / PWA 在手机浏览器中验收到可用。
2. 第二阶段：如果目标用户主要使用支持 TWA 的 Android 环境，走 TWA。
3. 第三阶段：如果必须离线包、国内渠道包、原生插件或更强设备适配，再启动 Capacitor 方案，并把认证与跨域改造列为前置任务。

## 4. PWA / TWA 前置工作

### 4.1 Web 生产入口

需要先确认生产 Web 入口稳定：

- 站点必须使用 HTTPS。
- `/`、`/api/`、`/images/` 在同一域名下可访问。
- `/sw.js` 不应被长期缓存，确保 Service Worker 可以更新。
- `version.json`、静态资源、卡图缓存策略与当前 PWA 更新逻辑一致。
- `FRONTEND_URL` 与真实生产域名一致，用于邮箱验证和找回密码链接。

### 4.2 Manifest 与图标

当前 PWA manifest 已有 `name`、`short_name`、`description`、`id`、`start_url`、`scope`、`theme_color`、`background_color`、`display: 'standalone'`、标准图标和 maskable 图标。图标文件由 `assets/icon.jpg` 生成，位于 `assets/pwa/`。

正式 Android 分发前仍需确认：

- 是否替换为正式应用图标视觉，而不是继续使用当前占位图。
- 确认图标格式、路径、缓存头和 Service Worker 预缓存策略。
- 确认 manifest 在生产域名可直接访问，并通过 Lighthouse / Chrome DevTools 的 PWA 检查。

### 4.3 TWA 校验

TWA 要求 App 和网站互相证明归属关系。未来实施时需要：

- 生成 Android 包名，当前正式候选为 `xyz.lovelivefun.loveca`，对应生产域名 `loveca.lovelivefun.xyz`。
- 生成签名 key，并记录 SHA-256 指纹。
- 在生产站点根路径发布 `/.well-known/assetlinks.json`。
- App 侧配置 Digital Asset Links 指向生产域名。
- 使用 Bubblewrap 或等价工具生成 TWA Android 项目。
- 在真机上验证：校验通过时应全屏打开；校验失败会退回带浏览器 UI 的 Custom Tab。

仓库已新增 TWA 前置入口：

- `android/twa/README.md`：TWA 打包入口、候选包名、工具链前置和 Bubblewrap 后续命令。
- `android/twa/loveca/`：Bubblewrap 生成的 TWA Android 工程，包名为 `xyz.lovelivefun.loveca`，指向 `https://loveca.lovelivefun.xyz/`。
- `pnpm android:pwa:build`：构建 Web/PWA 产物。
- `pnpm android:twa:doctor`：检查本机 Android 打包工具链前置。
- `pnpm android:assetlinks`：根据 `ANDROID_PACKAGE_NAME` 和 `ANDROID_SHA256_FINGERPRINT` 生成 `assets/.well-known/assetlinks.json`。
- `pnpm android:twa:build:docker`：用 Docker Bubblewrap 在本地生成 TWA APK/AAB，并修正 Docker 写出的文件权限。
- `assets/.well-known/assetlinks.json`：当前测试签名 APK 对应的 Digital Asset Links 文件；换正式 release / upload key 后必须重新生成。

当前本地已可通过 Docker Bubblewrap 生成测试签名包，输出位于 `android/twa/loveca/app-release-signed.apk` 和 `android/twa/loveca/app-release-bundle.aab`。这两个文件和本地测试 keystore 不进入 git。由于线上 `https://loveca.lovelivefun.xyz/manifest.webmanifest` 仍可能是旧 manifest，本地测试构建暂时使用 `--skipPwaValidation`；正式发布前应先部署更新后的 PWA manifest 和图标，并移除该跳过参数。

注意：TWA 适合“线上站点就是 App 内容”的模式。它不会把当前 `client/dist` 作为本地资源包发布，因此离线能力仍取决于网站、Service Worker 和浏览器缓存。

## 5. Capacitor 路线前置工作

### 5.1 工具链要求

未来如果选择 Capacitor，应按官方当前要求准备：

- Node.js 22+ 用于移动端构建工作站。当前 Loveca 根项目声明 `node >=20`，不必因此马上提升服务端运行环境，但 Android 打包机要满足 Capacitor 要求。
- Android Studio。
- Android SDK。
- 物理 Android 设备或 API 24+ 模拟器。
- pnpm 10.x，与现有项目一致。

Capacitor Android 当前支持 API 24+，并依赖 Android WebView / Chrome 版本满足要求。旧设备需要单独真机验收。

### 5.2 建议集成位置

建议把 Capacitor 接在 `client/` 包内，而不是根后端包内：

- `client/package.json` 已经拥有前端构建脚本。
- `client/dist` 是 Capacitor 的 `webDir` 自然来源。
- Android 壳、图标和原生插件主要跟前端发布生命周期绑定。

未来草案配置形态：

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'xyz.lovelivefun.loveca',
  appName: 'Loveca',
  webDir: 'dist',
  server: {
    hostname: 'localhost',
    androidScheme: 'https',
  },
};

export default config;
```

注意：不要把 `server.url` 当作生产加载远端站点的方案。Capacitor 官方配置说明中该选项面向 live reload，不适合生产发布。若只是打开远端站点，TWA 更贴合当前架构。

### 5.3 当前 Loveca 对 Capacitor 的阻塞点

Capacitor 默认本地包模式下，前端页面不是从 `https://loveca.example.com` 加载，而是从 Android WebView 的本地 origin 加载。当前项目因此至少有以下阻塞点：

1. 生产 API CORS 未开放。

   当前 Express 只在开发模式启用 CORS，并只允许本地 Vite 端口。Capacitor 本地页面请求线上 `/api` 会跨源，需要服务端显式允许 Android App 的 WebView origin，且必须带 `credentials: true`。

2. refresh cookie 当前是 `SameSite=Lax`。

   本地 WebView origin 到线上 API 的 `fetch(..., credentials: 'include')` 不再是同源请求，`SameSite=Lax` 不适合作为跨站 XHR 的长期续期方案。需要二选一：
   - 调整 cookie 策略为受控的 `SameSite=None; Secure`，并严格限制 CORS allowlist。
   - 改为移动端专用 token 续期模型，例如用 Capacitor 安全存储插件保存 refresh token，并避免依赖浏览器第三方 cookie。

3. `apiClient` 有同源生产假设。

   当前 `VITE_API_BASE_URL` 的解析逻辑是为了避免生产环境误把同源部署变成跨源请求。Capacitor 路线需要单独确认 Android WebView 下 `window.location.origin`、`VITE_API_BASE_URL` 和图片 URL 的组合是否稳定。

4. 图片路径要统一走 API / 图片代理源。

   当前生产图片依赖 `/images/*` 由 Nginx 代理到对象存储。Capacitor 本地包不能请求本地 `/images/*`，必须让图片 URL 明确指向线上 HTTPS 图片代理源，并继续满足 PWA / WebView 缓存策略。

5. 邮箱链接和深链需要设计。

   邮箱验证、找回密码和共享卡组链接当前按 Web URL 设计。Android App 是否接管这些链接，需要决定是否接入 Android App Links；否则先允许它们在浏览器中打开。

6. 移动端对战体验仍需专项验收。

   即使 Capacitor 壳跑起来，对战页仍需要补触屏操作、hover 替代、拖拽降级、覆盖层、软键盘和安全区验收。

### 5.4 未来 Capacitor 实施轮廓

以下只是未来实施时的轮廓，不应在本草稿阶段执行：

1. 在 `client/` 安装 `@capacitor/core`、`@capacitor/cli`、`@capacitor/android`。
2. 初始化 `client/capacitor.config.ts`，确认 `webDir: 'dist'`。
3. 增加前端 Android 构建脚本，例如先 `pnpm build`，再 `npx cap sync android`。
4. 生成 `client/android/` 原生工程。
5. 在 Android Studio 中配置包名、图标、启动屏、版本号和签名。
6. 修复 API / 图片 / 认证跨域策略。
7. 真机验收登录续期、卡组同步、联机轮询、图片加载、对局流程和离线降级。
8. 生成 release AAB / APK，进入上架或渠道分发流程。

## 6. 移动端体验前置验收

无论 TWA 还是 Capacitor，都必须先把 Web 移动端体验验收到可发布。当前已有基线命令：

```bash
pnpm --dir client test:e2e:mobile
```

正式 Android 包前建议补充：

- 手机竖屏完成登录、注册、会话恢复和登出。
- 手机竖屏完成卡组创建、编辑、保存、导入、导出和选组。
- 手机竖屏完成联机房间创建、加入、锁定卡组、先后手确认、断线恢复。
- 手机竖屏完成一局基础对战流程，至少覆盖换牌、阶段推进、Live 设置、判定、结算和胜负展示。
- 所有主要流程不依赖 hover。
- 对战页核心操作有点击式路径，拖拽只作为增强交互。
- 底部 dock、抽屉、全屏任务层、模态框支持关闭、内部滚动、背景滚动锁定和安全区。
- 输入表单在软键盘弹起时不会遮挡当前输入框和提交按钮。
- 390 x 844、430 x 932、768 x 1024、1024 x 768 四个视口无意外横向滚动。
- Android WebView / Chrome 真机上检查 Service Worker 更新、缓存清理、图片缓存和版本提示。

## 7. 后端与部署检查

### 7.1 TWA / PWA 模式

优先保持同源：

- `https://域名/`：前端。
- `https://域名/api/`：Express API。
- `https://域名/images/`：图片代理。

这种模式下，现有 `SameSite=Lax` refresh cookie 和生产禁用 CORS 的策略仍然成立。

### 7.2 Capacitor 本地包模式

必须新增移动端 API 安全设计：

- 明确允许哪些 App WebView origin 访问生产 API。
- 明确 `credentials: true`、cookie 策略和 CSRF 风险处理。
- 明确 refresh token 是否继续走 httpOnly cookie。
- 明确 Android App 版本过旧时如何兼容 API。
- 明确图片源、缓存策略和对象存储公开路径。
- 禁止生产环境启用明文 HTTP 或 mixed content。

如果这些问题不解决，Capacitor 壳可能可以打开首页，但账号、卡组、联机和图片会出现不稳定失败。

## 8. 发布与运维

正式发布 Android App 前还需要准备：

- 应用包名：使用项目拥有域名的反向域名，发布后不要轻易更换。
- 应用名称、图标、启动屏、主题色、状态栏和导航栏颜色。
- 版本策略：`versionName` 可跟 `client/package.json`，`versionCode` 必须单调递增。
- 签名策略：保管 upload key；如果走 Google Play，启用 Play App Signing。
- 隐私政策：说明账号、邮箱、卡组、对局、日志、图片上传等数据处理。
- 数据安全表单：按 Google Play 或目标渠道要求填写。
- 权限最小化：没有原生能力前不申请相机、存储、定位等权限。
- 崩溃和前端错误观测：至少保留服务端日志、Nginx 日志和前端错误上报方案。
- 回滚策略：TWA/PWA 可通过 Web 回滚；Capacitor 本地包需要应用版本发布回滚或兼容旧包。

## 9. 推荐执行顺序

1. 先把移动端 Web 体验补到可发布，尤其是对战页、覆盖层、软键盘和安全区。
2. 补齐 PWA manifest 图标、安装体验和 Lighthouse PWA 检查。
3. 确认生产 HTTPS、Nginx 同源代理、`/api/health`、`/images/*` 和 Service Worker 更新策略。
4. 如果目标是最快 Android 发布，走 TWA：生成 TWA 工程、配置 Digital Asset Links、签名、真机验证、打包 AAB。
5. 如果目标是本地包或国内渠道，再单独立项 Capacitor：先设计 API / cookie / token / CORS，再接入 Android 工程。
6. Android 包发布前，建立真机验收清单和最小回归集。

## 10. 外部参考

- Capacitor 安装与既有 Web 项目接入：https://capacitorjs.com/docs/getting-started
- Capacitor Android：https://capacitorjs.com/docs/android
- Capacitor 配置：https://capacitorjs.com/docs/config
- Android Trusted Web Activity 概览：https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities
- TWA Quick Start / Bubblewrap：https://developer.chrome.com/docs/android/trusted-web-activity/quick-start
- Android WebView 本地内容加载：https://developer.android.com/develop/ui/views/layout/webapps/load-local-content
- Google Play App Signing：https://developer.android.com/google/play/integrity
