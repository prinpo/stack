# Build from the repository root: docker build -f examples/fullstack/Dockerfile .
FROM oven/bun:1.4.5 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts
RUN bun --no-env-file scripts/generate-database-exports.ts
RUN cd examples/fullstack && bun run stack build

FROM oven/bun:1.4.5 AS runtime
WORKDIR /app
# Stack publishes Bun/TypeScript sources and externalizes runtime packages.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/examples/fullstack/package.json ./examples/fullstack/package.json
COPY --from=build /app/examples/fullstack/dist ./examples/fullstack/dist
COPY --from=build /app/examples/fullstack/env ./examples/fullstack/env
WORKDIR /app/examples/fullstack
ENV NODE_ENV=production HOST=0.0.0.0
EXPOSE 3000
ENTRYPOINT ["bun", "--no-env-file", "/app/src/cli/main.ts"]
CMD ["start"]
