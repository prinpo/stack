// Modified for Prinpo Stack. See src/eden-query/README.md.

/**
 * Nested routes tests for Eden TanStack Query
 *
 * These tests verify that deeply nested routes with prefixes and module composition
 * correctly preserve types through the proxy chain.
 *
 * Patterns tested:
 * - Elysia with prefix modules
 * - Nested .use() composition
 * - Multiple levels of route nesting
 * - Path parameters at various depths
 */
import type { treaty } from "@prinpo/stack/client";

import { Elysia, t } from "@prinpo/stack/server";
import { describe, expect, test } from "vite-plus/test";

import type { EdenOptionsProxy } from "../../../src/eden-query/types/decorators";
import type { ExtractRoutes, InferRouteOutput } from "../../../src/eden-query/types/infer";

import { createEdenOptionsProxy } from "../../../src/eden-query/proxy/createOptionsProxy";
import { createTestQueryClient } from "../test-utils/index";

// ============================================================================
// Module-based App Structure
// ============================================================================

// Individual route handlers - separate Elysia instances for each route
const getMeRoute = new Elysia().get("/me", () => ({
  user: { id: "1", name: "Test User", email: "test@example.com" },
}));

const upsertUserRoute = new Elysia().post(
  "/",
  ({ body }) => ({
    user: { id: "1", name: body.name, email: body.email },
  }),
  {
    body: t.Object({
      name: t.String(),
      email: t.String(),
    }),
  },
);

// Module grouping with prefix - composing routes under /users prefix
const usersRoutes = new Elysia({ prefix: "/users" }).use(getMeRoute).use(upsertUserRoute);

// Items module - another example of module composition
const createItemRoute = new Elysia().post(
  "/",
  ({ body }) => ({
    item: { id: "i1", name: body.name, quantity: 10 },
  }),
  {
    body: t.Object({
      name: t.String(),
    }),
  },
);

const getItemRoute = new Elysia().get(
  "/:id",
  ({ params }) => ({
    item: { id: params.id, name: "Item", quantity: 10 },
  }),
  {
    params: t.Object({
      id: t.String(),
    }),
  },
);

const itemsRoutes = new Elysia({ prefix: "/items" }).use(createItemRoute).use(getItemRoute);

// Main app composition - combining all modules
const modularApp = new Elysia()
  .get("/health", () => ({ status: "ok" }))
  .use(usersRoutes)
  .use(itemsRoutes);

type ModularApp = typeof modularApp;

// ============================================================================
// Deeply Nested Routes App
// ============================================================================

const deeplyNestedApp = new Elysia()
  .get("/", () => ({ message: "root" }))
  .get(
    "/api/v1/users/:userId/posts/:postId/comments/:commentId",
    ({ params }) => ({
      userId: params.userId,
      postId: params.postId,
      commentId: params.commentId,
      content: "Comment content",
    }),
    {
      params: t.Object({
        userId: t.String(),
        postId: t.String(),
        commentId: t.String(),
      }),
    },
  )
  .post(
    "/api/v1/users/:userId/posts/:postId/comments",
    ({ params, body }) => ({
      userId: params.userId,
      postId: params.postId,
      id: "new-comment",
      content: body.content,
    }),
    {
      params: t.Object({
        userId: t.String(),
        postId: t.String(),
      }),
      body: t.Object({
        content: t.String(),
      }),
    },
  )
  .get(
    "/api/v1/users/:userId/posts",
    ({ params, query }) => ({
      items: [{ id: "post1", userId: params.userId, title: "Post" }],
      nextCursor: query.cursor ? "next" : null,
    }),
    {
      params: t.Object({
        userId: t.String(),
      }),
      query: t.Object({
        limit: t.Optional(t.Number()),
        cursor: t.Optional(t.String()),
      }),
    },
  );

type DeepApp = typeof deeplyNestedApp;

// ============================================================================
// Type Tests for Modular App Structure
// ============================================================================

describe("Nested Routes - Module Composition", () => {
  describe("ExtractRoutes", () => {
    test("extracts routes from modular app", () => {
      type Routes = ExtractRoutes<ModularApp>;
      type HasRoutes = Routes extends Record<string, unknown> ? true : false;
      const hasRoutes: HasRoutes = true;
      expect(hasRoutes).toBe(true);
    });

    test("has health route at root", () => {
      type Routes = ExtractRoutes<ModularApp>;
      type HasHealth = "health" extends keyof Routes ? true : false;
      const hasHealth: HasHealth = true;
      expect(hasHealth).toBe(true);
    });

    test("has users route segment", () => {
      type Routes = ExtractRoutes<ModularApp>;
      type HasUsers = "users" extends keyof Routes ? true : false;
      const hasUsers: HasUsers = true;
      expect(hasUsers).toBe(true);
    });

    test("has items route segment", () => {
      type Routes = ExtractRoutes<ModularApp>;
      type HasItems = "items" extends keyof Routes ? true : false;
      const hasItems: HasItems = true;
      expect(hasItems).toBe(true);
    });
  });

  describe("Nested Route Type Structure", () => {
    type Routes = ExtractRoutes<ModularApp>;

    test("users.me exists and has get method", () => {
      type UsersRoutes = Routes["users"];
      type HasMe = "me" extends keyof UsersRoutes ? true : false;
      const hasMe: HasMe = true;
      expect(hasMe).toBe(true);

      type MeRoute = UsersRoutes["me"];
      type HasGet = "get" extends keyof MeRoute ? true : false;
      const hasGet: HasGet = true;
      expect(hasGet).toBe(true);
    });

    test("users has post method (root of users module)", () => {
      type UsersRoutes = Routes["users"];
      type HasPost = "post" extends keyof UsersRoutes ? true : false;
      const hasPost: HasPost = true;
      expect(hasPost).toBe(true);
    });

    test("items has post method", () => {
      type ItemsRoutes = Routes["items"];
      type HasPost = "post" extends keyof ItemsRoutes ? true : false;
      const hasPost: HasPost = true;
      expect(hasPost).toBe(true);
    });

    test("items has :id path param for get", () => {
      type ItemsRoutes = Routes["items"];
      type HasIdParam = ":id" extends keyof ItemsRoutes ? true : false;
      const hasIdParam: HasIdParam = true;
      expect(hasIdParam).toBe(true);
    });
  });

  describe("Nested Route Output Types", () => {
    type Routes = ExtractRoutes<ModularApp>;

    test("users.me.get has correct output type", () => {
      type MeRoute = Routes["users"]["me"]["get"];
      type Output = InferRouteOutput<MeRoute>;
      type HasUser = Output extends { user: { id: string; name: string } } ? true : false;
      const hasUser: HasUser = true;
      expect(hasUser).toBe(true);
    });

    test("items.post has correct output type", () => {
      type CreateItemRoute = Routes["items"]["post"];
      type Output = InferRouteOutput<CreateItemRoute>;
      type HasItem = Output extends { item: { id: string; name: string } } ? true : false;
      const hasItem: HasItem = true;
      expect(hasItem).toBe(true);
    });
  });
});

// ============================================================================
// Type Tests for Deeply Nested Routes
// ============================================================================

describe("Nested Routes - Deep Nesting", () => {
  describe("ExtractRoutes for deeply nested paths", () => {
    type Routes = ExtractRoutes<DeepApp>;

    test("has api segment", () => {
      type HasApi = "api" extends keyof Routes ? true : false;
      const hasApi: HasApi = true;
      expect(hasApi).toBe(true);
    });

    test("has api.v1 segment", () => {
      type HasV1 = "v1" extends keyof Routes["api"] ? true : false;
      const hasV1: HasV1 = true;
      expect(hasV1).toBe(true);
    });

    test("has api.v1.users segment", () => {
      type HasUsers = "users" extends keyof Routes["api"]["v1"] ? true : false;
      const hasUsers: HasUsers = true;
      expect(hasUsers).toBe(true);
    });

    test("api.v1.users has :userId path param", () => {
      type UsersRoute = Routes["api"]["v1"]["users"];
      type HasUserId = ":userId" extends keyof UsersRoute ? true : false;
      const hasUserId: HasUserId = true;
      expect(hasUserId).toBe(true);
    });

    test("deeply nested comments route has correct structure", () => {
      type UsersRoute = Routes["api"]["v1"]["users"];
      type UserIdRoute = UsersRoute[":userId"];
      type PostsRoute = UserIdRoute["posts"];
      type PostIdRoute = PostsRoute[":postId"];
      type CommentsRoute = PostIdRoute["comments"];

      type HasPost = "post" extends keyof CommentsRoute ? true : false;
      type HasCommentId = ":commentId" extends keyof CommentsRoute ? true : false;

      const hasPost: HasPost = true;
      const hasCommentId: HasCommentId = true;

      expect(hasPost).toBe(true);
      expect(hasCommentId).toBe(true);
    });
  });

  describe("Deep nested route output types", () => {
    type Routes = ExtractRoutes<DeepApp>;

    test("deeply nested GET route has correct output", () => {
      type CommentRoute =
        Routes["api"]["v1"]["users"][":userId"]["posts"][":postId"]["comments"][":commentId"]["get"];
      type Output = InferRouteOutput<CommentRoute>;

      type HasUserId = Output extends { userId: string } ? true : false;
      type HasPostId = Output extends { postId: string } ? true : false;
      type HasCommentId = Output extends { commentId: string } ? true : false;
      type HasContent = Output extends { content: string } ? true : false;

      const hasUserId: HasUserId = true;
      const hasPostId: HasPostId = true;
      const hasCommentId: HasCommentId = true;
      const hasContent: HasContent = true;

      expect(hasUserId).toBe(true);
      expect(hasPostId).toBe(true);
      expect(hasCommentId).toBe(true);
      expect(hasContent).toBe(true);
    });

    test("posts route with cursor has correct output for infinite query", () => {
      type PostsRoute = Routes["api"]["v1"]["users"][":userId"]["posts"]["get"];
      type Output = InferRouteOutput<PostsRoute>;

      type HasItems = Output extends { items: unknown[] } ? true : false;
      type HasNextCursor = Output extends { nextCursor: string | null } ? true : false;

      const hasItems: HasItems = true;
      const hasNextCursor: HasNextCursor = true;

      expect(hasItems).toBe(true);
      expect(hasNextCursor).toBe(true);
    });
  });
});

// ============================================================================
// EdenOptionsProxy Type Tests for Nested Routes
// ============================================================================

describe("EdenOptionsProxy - Nested Routes", () => {
  describe("Modular App Proxy Types", () => {
    type Proxy = EdenOptionsProxy<ModularApp>;

    test("proxy has health.get.queryOptions", () => {
      type HealthGet = Proxy["health"]["get"];
      type HasQueryOptions = "queryOptions" extends keyof HealthGet ? true : false;
      const hasQueryOptions: HasQueryOptions = true;
      expect(hasQueryOptions).toBe(true);
    });

    test("proxy has users.me.get.queryOptions", () => {
      type UsersMeGet = Proxy["users"]["me"]["get"];
      type HasQueryOptions = "queryOptions" extends keyof UsersMeGet ? true : false;
      const hasQueryOptions: HasQueryOptions = true;
      expect(hasQueryOptions).toBe(true);
    });

    test("proxy has users.post.mutationOptions", () => {
      type UsersPost = Proxy["users"]["post"];
      type HasMutationOptions = "mutationOptions" extends keyof UsersPost ? true : false;
      const hasMutationOptions: HasMutationOptions = true;
      expect(hasMutationOptions).toBe(true);
    });

    test("proxy has items callable for :id param", () => {
      type ItemsProxy = Proxy["items"];
      // Check if it's callable with { id: string | number }
      type IsCallable = ItemsProxy extends (params: { id: string | number }) => unknown
        ? true
        : false;
      const isCallable: IsCallable = true;
      expect(isCallable).toBe(true);
    });

    test("proxy items({ id }).get.queryOptions exists", () => {
      type ItemsProxy = Proxy["items"];
      type ItemById = ItemsProxy extends (params: { id: string | number }) => infer R ? R : never;
      type HasGet = "get" extends keyof ItemById ? true : false;
      const hasGet: HasGet = true;
      expect(hasGet).toBe(true);
    });
  });

  describe("Deep Nested Proxy Types", () => {
    type Proxy = EdenOptionsProxy<DeepApp>;

    test("proxy api.v1.users is callable for :userId", () => {
      type UsersProxy = Proxy["api"]["v1"]["users"];
      type IsCallable = UsersProxy extends (params: { userId: string | number }) => unknown
        ? true
        : false;
      const isCallable: IsCallable = true;
      expect(isCallable).toBe(true);
    });

    test("deeply nested proxy chain preserves types", () => {
      type UsersProxy = Proxy["api"]["v1"]["users"];

      // After calling with userId, we should get posts
      type UserByIdProxy = UsersProxy extends (params: { userId: string | number }) => infer R
        ? R
        : never;

      type HasPosts = "posts" extends keyof UserByIdProxy ? true : false;
      const hasPosts: HasPosts = true;
      expect(hasPosts).toBe(true);
    });
  });
});

// ============================================================================
// Runtime Tests with Mock Client
// ============================================================================

describe("Nested Routes - Runtime Proxy Behavior", () => {
  const queryClient = createTestQueryClient();

  function createMockModularClient() {
    const mockClient = {
      health: {
        get: async () => ({ data: { status: "ok" }, error: null }),
      },
      users: Object.assign(
        {},
        {
          me: {
            get: async () => ({
              data: {
                user: { id: "1", name: "Test User", email: "test@example.com" },
              },
              error: null,
            }),
          },
          post: async (body: { name: string; email: string }) => ({
            data: { user: { id: "1", name: body.name, email: body.email } },
            error: null,
          }),
        },
      ),
      items: Object.assign(
        (params: { id: string }) => ({
          get: async () => ({
            data: {
              item: { id: params.id, name: "Item", quantity: 10 },
            },
            error: null,
          }),
        }),
        {
          post: async (body: { name: string }) => ({
            data: { item: { id: "i1", name: body.name, quantity: 10 } },
            error: null,
          }),
        },
      ),
    };

    return mockClient as unknown as ReturnType<typeof treaty<ModularApp>>;
  }

  function createModularEden() {
    const client = createMockModularClient();
    return createEdenOptionsProxy<ModularApp>({ client, queryClient });
  }

  test("health.get.queryOptions works", async () => {
    const eden = createModularEden();

    const options = eden.health.get.queryOptions({});

    expect(options.queryKey[0]).toEqual(["health", "get"]);
    expect(options.eden.path).toBe("health.get");
  });

  test("users.me.get.queryOptions works", async () => {
    const eden = createModularEden();

    const options = eden.users.me.get.queryOptions({});

    expect(options.queryKey[0]).toEqual(["users", "me", "get"]);
    expect(options.eden.path).toBe("users.me.get");

    const result = await queryClient.fetchQuery(options);
    expect(result).toEqual({
      user: { id: "1", name: "Test User", email: "test@example.com" },
    });
  });

  test("users.post.mutationOptions works", async () => {
    const eden = createModularEden();

    const options = eden.users.post.mutationOptions();

    expect(options.mutationKey).toEqual([["users", "post"]]);
    expect(options.eden.path).toBe("users.post");

    const result = await options.mutationFn({
      name: "New User",
      email: "new@example.com",
    });
    expect(result).toEqual({
      user: { id: "1", name: "New User", email: "new@example.com" },
    });
  });

  test("items({ id }).get.queryOptions works", async () => {
    const eden = createModularEden();

    const options = eden.items({ id: "i123" }).get.queryOptions({});

    expect(options.queryKey[0]).toEqual(["items", "get"]);
    expect(options.eden.path).toBe("items.get");

    const result = await queryClient.fetchQuery(options);
    expect(result).toEqual({
      item: { id: "i123", name: "Item", quantity: 10 },
    });
  });

  test("items.post.mutationOptions works", async () => {
    const eden = createModularEden();

    const options = eden.items.post.mutationOptions();

    expect(options.mutationKey).toEqual([["items", "post"]]);

    const result = await options.mutationFn({ name: "New Item" });
    expect(result).toEqual({
      item: { id: "i1", name: "New Item", quantity: 10 },
    });
  });
});

// ============================================================================
// Type Inference Helper Tests
// ============================================================================

describe("Nested Routes - Type Inference Utilities", () => {
  describe("inferInput / inferOutput from nested routes", () => {
    type Proxy = EdenOptionsProxy<ModularApp>;

    test("~types.output from users.me.get is correct", () => {
      type UsersMeGet = Proxy["users"]["me"]["get"];
      type Output = UsersMeGet["~types"]["output"];

      type IsCorrect = Output extends {
        user: { id: string; name: string; email: string };
      }
        ? true
        : false;
      const isCorrect: IsCorrect = true;
      expect(isCorrect).toBe(true);
    });

    test("~types.input from users.post is correct", () => {
      type UsersPost = Proxy["users"]["post"];
      type Input = UsersPost["~types"]["input"];

      type IsCorrect = Input extends { name: string; email: string } ? true : false;
      const isCorrect: IsCorrect = true;
      expect(isCorrect).toBe(true);
    });

    test("~types.output from items.post is correct", () => {
      type ItemsPost = Proxy["items"]["post"];
      type Output = ItemsPost["~types"]["output"];

      type IsCorrect = Output extends { item: { id: string; name: string } } ? true : false;
      const isCorrect: IsCorrect = true;
      expect(isCorrect).toBe(true);
    });
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Nested Routes - Edge Cases", () => {
  describe("Multiple path params at same level", () => {
    const multiParamApp = new Elysia().get(
      "/orgs/:orgId/teams/:teamId/members/:memberId",
      ({ params }) => ({
        orgId: params.orgId,
        teamId: params.teamId,
        memberId: params.memberId,
        name: "Member",
      }),
      {
        params: t.Object({
          orgId: t.String(),
          teamId: t.String(),
          memberId: t.String(),
        }),
      },
    );

    type MultiParamApp = typeof multiParamApp;
    type Routes = ExtractRoutes<MultiParamApp>;

    test("routes structure has all nested params", () => {
      type HasOrgs = "orgs" extends keyof Routes ? true : false;
      const hasOrgs: HasOrgs = true;
      expect(hasOrgs).toBe(true);

      type OrgsRoute = Routes["orgs"];
      type HasOrgId = ":orgId" extends keyof OrgsRoute ? true : false;
      const hasOrgId: HasOrgId = true;
      expect(hasOrgId).toBe(true);
    });

    test("output type is preserved through all nesting levels", () => {
      type MemberRoute =
        Routes["orgs"][":orgId"]["teams"][":teamId"]["members"][":memberId"]["get"];
      type Output = InferRouteOutput<MemberRoute>;

      type HasAllFields = Output extends {
        orgId: string;
        teamId: string;
        memberId: string;
        name: string;
      }
        ? true
        : false;
      const hasAllFields: HasAllFields = true;
      expect(hasAllFields).toBe(true);
    });
  });

  describe("Mixed static and dynamic segments", () => {
    const mixedApp = new Elysia()
      .get("/api/public/info", () => ({ info: "public" }))
      .get(
        "/api/users/:id/private/settings",
        ({ params }) => ({
          userId: params.id,
          settings: { theme: "dark" },
        }),
        {
          params: t.Object({ id: t.String() }),
        },
      );

    type MixedApp = typeof mixedApp;
    type Routes = ExtractRoutes<MixedApp>;

    test("static path segments work", () => {
      type PublicInfo = Routes["api"]["public"]["info"]["get"];
      type Output = InferRouteOutput<PublicInfo>;

      type HasInfo = Output extends { info: string } ? true : false;
      const hasInfo: HasInfo = true;
      expect(hasInfo).toBe(true);
    });

    test("mixed static and dynamic segments work", () => {
      type SettingsRoute = Routes["api"]["users"][":id"]["private"]["settings"]["get"];
      type Output = InferRouteOutput<SettingsRoute>;

      type HasUserId = Output extends { userId: string } ? true : false;
      type HasSettings = Output extends { settings: { theme: string } } ? true : false;

      const hasUserId: HasUserId = true;
      const hasSettings: HasSettings = true;

      expect(hasUserId).toBe(true);
      expect(hasSettings).toBe(true);
    });
  });
});
