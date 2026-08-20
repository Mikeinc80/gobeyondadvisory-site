# The runtime has one dependency, pg, and the web client has no build step. That makes this
# image small and its supply chain short, which is the main reason for both decisions.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/api/package.json services/api/
RUN npm ci
COPY . .
RUN npx tsc -p services/api/tsconfig.json

FROM node:22-alpine
WORKDIR /app

# Runs as a non-root user. The service needs to read its own files and write nothing.
RUN addgroup -S ekorails && adduser -S ekorails -G ekorails

COPY package.json package-lock.json ./
COPY services/api/package.json services/api/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/services/api/dist services/api/dist
COPY apps/web/public apps/web/public
COPY db db
COPY scripts scripts

USER ekorails
EXPOSE 8080

# The service verifies at start-up that migrations are applied, that the ledger balances
# and that the audit chain is intact, and refuses to serve traffic otherwise. There is
# deliberately no flag to skip those checks.
CMD ["node", "services/api/dist/src/main.js"]
