import { treaty } from "@prinpo/stack/client";
import DefaultElysia, { Elysia, t } from "@prinpo/stack/server";
import { expectTypeOf } from "vite-plus/test";

const app = new Elysia()
  .get("/api/hello", ({ query }) => ({ message: query.name }), {
    query: t.Object({ name: t.String() }),
  })
  .post("/api/echo", ({ body }) => ({ message: body.message }), {
    body: t.Object({ message: t.String() }),
  });
const api = treaty<typeof app>("http://localhost:3000");

// Compile-only checks through the source public entry points. Never sends requests.
export function nativeContractTypes() {
  expectTypeOf(DefaultElysia).toEqualTypeOf<typeof Elysia>();
  expectTypeOf(api.api.hello.get({ query: { name: "Stack" } })).resolves.toMatchTypeOf<{
    data: { message: string } | null;
  }>();
  void api.api.echo.post({ message: "A typed mutation" });
  // @ts-expect-error The native server schema requires a string.
  void api.api.echo.post({ message: 123 });
  // @ts-expect-error Required query parameters remain required through the facade.
  void api.api.hello.get();
  // @ts-expect-error Unknown routes remain a type error.
  void api.api.unknown.get();
}
