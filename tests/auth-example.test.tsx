// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { betterAuth } from "better-auth";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { authOptions } from "../examples/fullstack/src/server/auth/config";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test("an unverified signed-in account can request verification from the example", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  const auth = betterAuth({
    ...authOptions,
    database: undefined,
    baseURL: window.location.origin,
    secret: "test-secret-at-least-thirty-two-characters",
  });
  const signed = await auth.api.signUpEmail({
    body: { name: "Ada", email: "ada@example.com", password: "correct-horse-battery" },
  });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(
      input instanceof Request
        ? input
        : new URL(typeof input === "string" ? input : input.href, window.location.origin),
      init,
    );
    // The HTTP session response avoids happy-dom's cookie emulation; delivery still uses the real endpoint.
    if (new URL(request.url).pathname.endsWith("/get-session"))
      return Response.json({
        user: signed.user,
        session: {
          id: "session-1",
          userId: signed.user.id,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      });
    request.headers.set("origin", window.location.origin);
    return auth.handler(request);
  });
  const { AuthView } = await import("../examples/fullstack/src/features/auth/view");
  render(<AuthView />);
  await screen.findByRole("heading", { name: "Session" });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
  });
  await waitFor(() =>
    expect(
      JSON.stringify(output.mock.calls),
      screen.getByRole("status").textContent ?? "",
    ).toContain("/verify-email?"),
  );
});
