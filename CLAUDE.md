# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Backend (from root)
pnpm install          # Install dependencies
pnpm dev              # TypeScript watch mode
pnpm build            # Compile TypeScript
pnpm test             # Run tests (watch mode)
pnpm test:run         # Run tests once
pnpm test:coverage    # Coverage report (requires 80%)
pnpm lint             # ESLint check
pnpm lint:fix         # Auto-fix lint issues
pnpm typecheck        # Type check without emit

# Database (Drizzle ORM)
pnpm db:generate      # Generate migration from schema diff
pnpm db:migrate       # Run pending migrations
pnpm db:push          # Push schema directly (dev only)
pnpm db:pull          # Pull schema from existing DB
pnpm db:studio        # Open Drizzle Studio (DB GUI)

# Frontend (from client/)
cd client && pnpm install
cd client && pnpm dev    # Vite dev server (localhost:5173)
pnpm build:client        # Build frontend (from root)

# Docker (backend runs in Docker container)
docker compose up -d --build api   # Rebuild & restart API container

# Production
pnpm start:prod          # Preview production build
```

## Architecture Overview

Monorepo implementing the Love Live card game (Loveca):
- **`src/`** - Backend: game engine + self-hosted API server (TypeScript, Node.js 20+)
- **`client/`** - Frontend UI (React 19, Vite, Tailwind CSS)
- **`src/shared/`** - Shared types imported by both (via TypeScript path aliases)

### Domain-Driven Design Layers (Game Engine)

```
src/
├── domain/           # Core game logic
│   ├── entities/     # GameState, PlayerState, CardInstance, Zone
│   └── rules/        # live-resolver, cost-calculator, check-timing
├── application/      # Orchestration
│   ├── game-service.ts      # Main game engine
│   ├── game-session.ts      # Session manager with events
│   ├── phase-manager.ts     # Phase state machine (reads config)
│   └── action-handlers/     # Modular action processors
├── server/           # Self-hosted API server (Express.js)
│   ├── app.ts               # Express app factory
│   ├── index.ts             # Server entry point
│   ├── config.ts            # Environment configuration
│   ├── db/pool.ts           # PostgreSQL connection pool
│   ├── db/drizzle.ts        # Drizzle ORM instance (wraps pool)
│   ├── db/schema.ts         # Drizzle table definitions (mirrors init.sql)
│   ├── middleware/           # authenticate, require-auth, require-admin, validate, error-handler
│   ├── routes/              # auth, cards, decks, profiles, images
│   └── services/            # auth-service, mail-service, minio-service
└── shared/
    ├── types/enums.ts       # All game enums
    └── phase-config/        # Phase configuration registry
```

### Client Architecture

```
client/src/
├── components/       # React components (game/, card/, deck/)
├── store/            # Zustand stores
│   ├── gameStore.ts  # Game state + GameSession instance
│   ├── deckStore.ts  # Deck management (local + cloud sync via API)
│   └── authStore.ts  # JWT auth via self-hosted API
└── lib/
    ├── apiClient.ts  # HTTP client with JWT auth, auto-refresh, offline detection
    ├── cardService.ts # Card data CRUD via API
    ├── imageService.ts # Image URL generation (MinIO via Nginx)
    └── imageUploadService.ts # Browser-side compression + API upload
```

## Core Design Principles

### Immutable State
All state changes create new objects. Never mutate directly:
```typescript
// ❌ player.hand.push(card)
// ✅ const newPlayer = { ...player, hand: [...player.hand, card] }
```

### Configuration-Driven Phase Management
Phase flow is defined in `src/shared/phase-config/phase-registry.ts`, not hardcoded in PhaseManager. Adding a new phase:
1. Add enum value to `enums.ts`
2. Add config object to `phase-registry.ts` (includes display, behavior, transitions, autoActions)
3. (Optional) Add special handling in game-service.ts

### "Trust the Player" Philosophy
- System handles rule processing (Chapter 10 rules), not card effects
- Players execute effects manually via drag-and-drop
- `executeCheckTiming()` automatically corrects invalid game states
- UI provides effect windows as hints, not enforced actions

### Action Handler Pattern
Each action type has a dedicated handler in `src/application/action-handlers/`:
```typescript
registerHandler(GameActionType.PLAY_MEMBER, playMemberHandler);
registerHandler(GameActionType.SET_LIVE_CARD, setLiveCardHandler);
```

## Game-Specific Context

Based on official Love Live card game rules (see `detail_rules.md`):
- **Win condition**: 3 successful Lives in success zone
- **10 zones per player**: hand, mainDeck, energyDeck, memberSlots (LEFT/CENTER/RIGHT, each with optional energyBelow cards), energyZone, liveZone, successZone, waitingRoom, exileZone, resolutionZone
- **Card types**: MEMBER, LIVE, ENERGY
- **Heart colors**: PINK, RED, YELLOW, GREEN, BLUE, PURPLE, RAINBOW (wild)

### Key Game Flow
1. MULLIGAN_PHASE → 2. ACTIVE_PHASE (untap) → 3. ENERGY_PHASE (draw energy) → 4. DRAW_PHASE → 5. MAIN_PHASE (player actions) → 6. LIVE_SET_PHASE → 7. PERFORMANCE_PHASE → 8. LIVE_RESULT_PHASE → repeat

## Testing

Tests in `tests/` directory using Vitest:
- `tests/unit/` - Unit tests
- `tests/integration/` - Integration tests
- `tests/simulation/` - Game simulation tests

Coverage requirements: 90-95% for rules/live judgment, 90% for ability/zone operations.

## Key Documentation

- `detail_rules.md` - Official game rules (Chinese)
- `docs/PROJECT_REQUIREMENTS.md` - Project requirements overview
- `docs/coding-standard/` - Development spec
- `docs/self-hosted-migration.md` - Self-hosted migration design (Supabase → PostgreSQL + MinIO + Express)
- `docs/minio-requirements.md` - MinIO deployment requirements
- `docs/doc_writing_guide.md` - Documentation writing guide
