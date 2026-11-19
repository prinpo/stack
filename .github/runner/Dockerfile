FROM node:24-bookworm-slim AS node
FROM redis:8.2-bookworm AS redis

FROM ghcr.io/actions/actions-runner:latest

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends gh ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=redis /usr/local/bin/redis-server /usr/local/bin/redis-server
ENV STACK_TEST_REDIS_SERVER=/usr/local/bin/redis-server
USER runner
CMD ["./run.sh"]
