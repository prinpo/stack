// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { organizationClient } from "../src/auth/client-plugins";
import { createAuthClient, useOrganizationBySlug } from "../src/auth/react";

afterEach(cleanup);

test("URL-scoped organization state clears when the native client signs out", async () => {
  let signedIn = true;
  const client = createAuthClient({
    baseURL: "http://localhost:3000",
    plugins: [organizationClient()],
    fetchOptions: {
      customFetchImpl: async (input) => {
        const path = new URL(
          input instanceof Request ? input.url : typeof input === "string" ? input : input.href,
        ).pathname;
        if (path.endsWith("/sign-out")) {
          signedIn = false;
          return Response.json({ success: true });
        }
        if (path.endsWith("/get-session"))
          return Response.json(
            signedIn
              ? {
                  user: { id: "user-1", email: "ada@example.com", name: "Ada" },
                  session: {
                    id: "session-1",
                    userId: "user-1",
                    expiresAt: new Date(Date.now() + 60_000).toISOString(),
                  },
                }
              : null,
          );
        return Response.json({
          id: "org-1",
          name: "Research",
          slug: "research",
          members: [],
          invitations: [],
        });
      },
    },
  });
  const { result } = renderHook(() => useOrganizationBySlug(client, "research"));
  await waitFor(() => expect(result.current.data?.name).toBe("Research"));
  await act(async () => {
    await client.signOut();
  });
  await waitFor(() => expect(result.current.data).toBeNull());
});
