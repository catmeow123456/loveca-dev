FROM node:20-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.server.json ./
COPY src ./src

RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm build:server

FROM node:20-alpine AS runtime

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod

COPY --from=build /app/dist ./dist

EXPOSE 3007

CMD ["node", "dist/server/index.js"]
