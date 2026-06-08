Original prompt: 阅读 game_system_design.md 和相关文档和代码,目前对墙打模式没有"退出房间"的相关按钮,导致每次都得刷新重开房间,你可以模仿联机模式下退出房间的按钮,设计一个这样的按钮出来.

Progress:
- Read `game_system_design.md`, `docs/solitaire-mode-requirements.md`, current game table docs, `OnlineRoomPage`, `GameBoard`, `DebugControl`, `App`, and `gameStore`.
- Found online in-game leave button is rendered by `OnlineRoomPage` as a fixed top-left frosted ghost button with `DoorOpen`.
- Plan: add a local leave/reset store action, expose optional `GameBoard` leave button only for local solitaire mode, and have `App` navigate back to game setup after leaving.
- Implemented `leaveLocalGame`, a solitaire-only in-game leave button in `GameBoard`, and an `App` callback that returns to setup.
- `pnpm --dir client build` passed; only existing Vite chunk-size and Browserslist freshness warnings appeared.
- Per user instruction, skipped dev-server verification in production environment and ran `pnpm build:client`; production client build completed successfully.
