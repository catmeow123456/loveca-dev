FROM node:22-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.server.json ./
COPY src ./src

RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm build:server

FROM node:22-alpine AS runtime

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

COPY --from=build /app/dist ./dist
COPY assets/decks ./assets/decks

EXPOSE 3007

CMD ["node", "dist/server/index.js"]
