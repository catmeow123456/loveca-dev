# 前端外层架构阶段 A：观测基线

> 文档类型：专题说明
> 适用范围：前端外层导航、关键数据就绪、请求计数与构建体积的可重复观测契约
> 当前状态：开发基线已落地；生产等价设备数据留待后续发布验收持续采样

基线日期：2026-08-26

参考提交：`5006c07aaac08413511859dfb584c7a3e2ff618f`

父方案：[前端外层架构重构需求与设计](requirements-and-design.md)

## 1. 本阶段边界

阶段 A 只建立可重复的观测契约，不引入 React Router、TanStack Query，也不拆分
`gameStore` / `GameSession`。后续阶段必须沿用同一指标名和基线脚本，才能比较
Query、Router 与 runtime 拆包前后的变化。

当前已覆盖：

- document load 与手写 `currentPage` 导航的开始时点；
- 真实页面组件提交后的 surface ready；
- 云端卡组的冷读取、fresh cache、stale cache 与后台刷新结果；
- 本地/远程共享对局视图可显示后的 battle data ready；
- 关键 API 请求数、document navigation 次数与 Playwright trace；
- 初始 JS/CSS、主要异步 chunk 与 Workbox precache 的固定统计脚本。

## 2. User Timing 契约

所有条目统一使用 `loveca:` 前缀；条目 `detail` 至少携带 `navigationId`，不写入用户
身份、卡组内容或对局隐藏信息。

| 名称                                      | 类型    | 含义                                   |
| ----------------------------------------- | ------- | -------------------------------------- |
| `loveca:navigation:start`                 | mark    | document load 或页面状态切换开始       |
| `loveca:navigation:surface-ready`         | mark    | 目标页面的真实 React surface 已提交    |
| `loveca:data:request-start`               | mark    | 关键数据读取开始，区分 cold/background |
| `loveca:navigation:data-ready`            | mark    | 当前导航已有第一份可展示数据           |
| `loveca:data:background-refresh-complete` | mark    | 保留旧数据的后台刷新成功或失败         |
| `loveca:measure:navigation-to-surface`    | measure | 导航开始到目标 surface 可见            |
| `loveca:measure:navigation-to-data`       | measure | 导航开始到第一份可展示数据             |

同一次导航只产生一条 `navigation-to-surface` 和一条 `navigation-to-data` measure。
React Strict Mode 可以重复触发 ready mark，但不能重复生成 measure。

## 3. 固定自动化环境

| 项目       | 基线值                                                              |
| ---------- | ------------------------------------------------------------------- |
| Node       | `v23.6.1`                                                           |
| pnpm       | `11.9.0`                                                            |
| Playwright | `1.58.1`                                                            |
| OS         | Linux `5.15.0-139-generic` x86_64                                   |
| 标准项目   | `tablet-1024x768`，DPR 1，Playwright Chromium                       |
| 动画       | 完整链路使用 `prefers-reduced-motion: reduce`                       |
| 网络       | loopback Vite + 确定性 API mock，不做吞吐/延迟节流                  |
| 缓存档位   | 新 browser context 冷 document；同 document 内 Zustand warm session |

本环境用于防回归和前后版本相对比较，不作为真实设备 P75。生产 P75 必须在固定发布
环境另行采样。卡组 31 秒 freshness 用例使用 Playwright 虚拟时钟，只负责请求计数；
虚拟时钟会替换 Performance 时间源，因此该用例的 timing 不进入基线。User Timing 由未
安装虚拟时钟的“大厅 → 准备 → 本地对局 → 返回准备页”链路采集。

## 4. 参考构建基线

以下数字由 `pnpm --dir client build` 后运行
`pnpm frontend:baseline:bundle -- --json` 取得。脚本统一使用 gzip level 9；这套数字是
后续比较的规范口径，不与 Vite 控制台的十进制展示混用。

| 指标                         |                                  参考值 |
| ---------------------------- | --------------------------------------: |
| 初始 JS raw                  |                         4,010,638 bytes |
| 初始 JS gzip                 |                           895,981 bytes |
| 阶段 D 目标（下降 40%）      |                    ≤ 537,588 bytes gzip |
| 初始 CSS raw / gzip          |                  344,138 / 40,099 bytes |
| 全部 JS chunk                | 71 个；5,778,779 / 1,252,862 bytes gzip |
| `GameBoard` chunk raw / gzip |                 492,326 / 103,555 bytes |
| Workbox precache             |              86 项；9,872,403 raw bytes |

参考提交构建仍包含 `main -> gameStore -> GameSession` 静态依赖。本阶段只记录该事实，
不把观测代码造成的微小体积变化误报为 runtime 拆包收益。

## 5. 标准场景与产物

标准命令：

```bash
pnpm --dir client test:e2e:architecture-baseline
pnpm --dir client build
pnpm frontend:baseline:bundle
pnpm frontend:baseline:bundle -- --json
```

架构 E2E 固定执行三个场景：

1. 后台发现更新，只提示且不产生第二次 document navigation；
2. 大厅与准备页在 freshness 内复用卡组，过期后仅发生一次后台读取；
3. 大厅 → 准备 → 双人本地对局 → 返回准备页，全程一个 document。

每个场景在 `client/test-results/` 下生成：

- `trace.zip`；
- `frontend-architecture-<scenario>.json`，包含 viewport、document URL、按 method/path
  聚合的 API 请求数和 `loveca:` Performance entries。

参考运行中，完整对局链路只有 1 次 document navigation，`GET /api/decks` 只有 1 次。
本地 loopback 单次样本的毫秒数只用于确认指标存在，不作为 P75 验收数字。

## 6. 后续阶段使用规则

- 阶段 B 迁移 Query 后，继续使用同一完整链路比较 API 请求数与 data ready；
- 阶段 C 迁移 Router 后，`navigate()` 取代当前 setter，但保持 timing 名称和 detail 语义；
- 阶段 D 每次 runtime 拆包都必须运行 bundle 脚本，并检查初始入口和远程 surface 依赖图；
- 只有固定环境和脚本未变化的结果可以直接比较；环境变化必须在结果前更新本文件口径。
