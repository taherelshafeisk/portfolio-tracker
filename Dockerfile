FROM node:22-alpine

WORKDIR /app

RUN npm install -g pnpm@10.33.0

# Copy workspace config files
COPY package.json pnpm-workspace.yaml ./

# Copy all package.json files needed for workspace resolution
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/db/package.json ./lib/db/
COPY lib/integrations-anthropic-ai/package.json ./lib/integrations-anthropic-ai/
COPY lib/integrations-openai/package.json ./lib/integrations-openai/
COPY lib/portfolio-policy/package.json ./lib/portfolio-policy/

RUN pnpm install --no-frozen-lockfile

# Copy all source
COPY . .

RUN pnpm --filter @workspace/api-server run build

EXPOSE 3001

CMD ["node", "artifacts/api-server/dist/index.cjs"]
