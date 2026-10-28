import { treaty } from "@prinpo/stack/client";
import { publicEnv } from "@prinpo/stack/env/elysia";
import { Elysia } from "@prinpo/stack/server";
import { expectTypeOf } from "vite-plus/test";

import { ENV as clientEnv } from "../examples/fullstack/src/env/client";
import { ENV as serverEnv } from "../examples/fullstack/src/env/server";

expectTypeOf(clientEnv.APP_TITLE).toEqualTypeOf<string>();
expectTypeOf(serverEnv.PORT).toEqualTypeOf<number>();
// @ts-expect-error Client schema types do not merge with server declarations.
void clientEnv.PRINPO_LOG_DIR;

const app = new Elysia()
  .use(publicEnv({ keys: [], path: "/api/settings" }))
  .get("/health", () => "ok");
const api = treaty<typeof app>("http://localhost");
export function endpointTypes() {
  void api.api.settings.get();
  void api.health.get();
  // @ts-expect-error A custom path does not advertise the default endpoint.
  void api.api["public-env"].get();
  // @ts-expect-error The plugin must not introduce arbitrary route keys.
  void api.unknown.get();
}
