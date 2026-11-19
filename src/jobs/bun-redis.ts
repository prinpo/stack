import { type IRedisClient, RedisConnection, createBunRedisClient } from "bullmq";
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
  const client = closeableBunClient(createBunRedisClient(raw, { lazyConnect: true }));
  const connectionName = options.connectionName;
  if (connectionName)
    client.on("ready", () => {
      void client.clientSetName(connectionName).catch(() => {});
    });
  return client;
};

/** BullMQ 6.7.6 skips disconnect/quit when already disconnected, leaving its
 * reconnect timer alive. Apply terminal close to factory-owned adapters and
 * blocking duplicates, including late completion of an in-flight reconnect.
 */
function closeableBunClient<Client extends IRedisClient>(client: Client): Client {
  let disposed = false;
  let terminating = false;
  const connect = client.connect.bind(client);
  const disconnect = client.disconnect.bind(client);
  const quit = client.quit.bind(client);
  const duplicate = client.duplicate.bind(client);
  const terminate = () => {
    if (terminating) return;
    terminating = true;
    // Pinned BunRedisClient implementation: bypass its early-return guard so
    // native teardown clears the reconnect timer and detaches raw callbacks.
    Reflect.set(client, "closed", false);
    try {
      disconnect(false);
    } finally {
      terminating = false;
    }
  };
  client.connect = async () => {
    // RedisConnection also uses explicit disconnect/connect for native pause/resume.
    disposed = false;
    try {
      return await connect();
    } finally {
      if (disposed) terminate();
    }
  };
  client.disconnect = (reconnect) => {
    if (reconnect) {
      disposed = false;
      return disconnect(true);
    }
    disposed = true;
    terminate();
  };
  client.quit = async () => {
    disposed = true;
    Reflect.set(client, "closed", false);
    return quit();
  };
  client.duplicate = (...args) => {
    return closeableBunClient(duplicate(...args));
  };
  client.on("close", () => {
    if (disposed) terminate();
  });
  client.on("ready", () => {
    if (disposed) terminate();
  });
  client.on("error", () => {
    if (disposed) terminate();
  });
  return client;
}
