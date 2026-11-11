import { expectTypeOf } from "vite-plus/test";

import { ENV as clientEnv } from "../examples/fullstack/src/env-gen/client";
import { ENV as serverEnv } from "../examples/fullstack/src/env-gen/server";

expectTypeOf(clientEnv.CLIENT_PUBLIC_STATIC).toEqualTypeOf<string>();
expectTypeOf(clientEnv.CLIENT_PUBLIC_DYNAMIC).toEqualTypeOf<string>();
expectTypeOf(serverEnv.SERVER_PUBLIC_STATIC).toEqualTypeOf<string>();
expectTypeOf(serverEnv.SERVER_PUBLIC_DYNAMIC).toEqualTypeOf<string>();
expectTypeOf(serverEnv.SERVER_SECRET_STATIC).toEqualTypeOf<string>();
expectTypeOf(serverEnv.SERVER_SECRET_DYNAMIC).toEqualTypeOf<string>();
// @ts-expect-error Client schema types do not merge with server declarations.
void clientEnv.LOG_DIR;
// @ts-expect-error Server secret settings are absent from the client schema.
void clientEnv.SERVER_SECRET_STATIC;
// @ts-expect-error Dynamic server secrets are also absent from the client schema.
void clientEnv.SERVER_SECRET_DYNAMIC;
