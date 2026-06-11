# Loveca Web 客户端

React + Vite + TypeScript 客户端，负责牌桌、卡组管理、卡牌管理后台、账号流程和正式联机房间界面。

## 常用命令

```bash
pnpm --dir client dev
pnpm --dir client build
pnpm --dir client lint
pnpm --dir client preview
```

## 主要目录

- `src/components/game`：牌桌、玩家区域、阶段面板、判定与结算 UI
- `src/components/pages`：首页、对局入口、正式联机、调试联机、分享卡组页面
- `src/components/deck`、`src/components/deck-editor`：卡组列表、导入导出、构筑编辑器
- `src/components/admin`：卡牌管理与联机房间监控
- `src/store`：Zustand 状态管理
- `src/lib`：REST API、图片、卡牌、联机和 AI 服务客户端

## 后端依赖

生产与完整开发流程依赖根项目的 Express API。客户端默认同源访问 API；本地调试可通过 `VITE_API_BASE_URL` 指向后端服务。
