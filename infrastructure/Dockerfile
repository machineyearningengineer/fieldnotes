FROM node:26.12.1-bookworm-slim@sha256:88e480776c6149ff1d098cd304f44bf18057fb5d284a3329b78162d29821e28c
RUN npm install --global pnpm@12.1.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
RUN pnpm install --filter @valyu-research/api... --filter @valyu-research/worker... --prod --frozen-lockfile --ignore-scripts
USER node
ENV NODE_ENV=production
CMD ["node", "apps/api/src/main.ts"]
