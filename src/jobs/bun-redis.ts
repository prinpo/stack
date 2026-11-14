import { RedisConnection, createBunRedisClient } from "bullmq";
import { RedisClient } from "bun";

// BullMQ owns each factory-created adapter and closes its blocking duplicates.
// Respect an application-installed factory; installing the default opens no connections.
RedisConnection.clientFactory ??= (options) => {
  const host = options.host ?? "127.0.0.1";
  const hostname = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const url = new URL(options.url ?? `redis://${hostname}:${options.port ?? 6379}`);
  if (options.username !== undefined) url.username = options.username;
  if (options.password !== undefined) url.password = options.password;
  if (options.db !== undefined) url.pathname = String(options.db);
  if (options.tls) url.protocol = "rediss:";
  const raw = new RedisClient(url.toString(), {
    connectionTimeout: options.connectTimeout ?? options.connectionTimeout,
    idleTimeout: options.idleTimeout,
    enableOfflineQueue: options.enableOfflineQueue,
    enableAutoPipelining: options.enableAutoPipelining,
    tls: options.tls,
    // The BullMQ adapter owns reconnection, including recreating closed Bun clients.
    autoReconnect: false,
    maxRetries: 0,
  });
  const client = createBunRedisClient(raw, { lazyConnect: true });
  const connectionName = options.connectionName;
  if (connectionName)
    client.on("ready", () => {
      void client.clientSetName(connectionName).catch(() => {});
    });
  return client;
};
