import type { BetterAuthOptions } from "better-auth";

import { APIError } from "better-auth/api";
import { Elysia, ElysiaCustomStatusResponse, status } from "elysia";

import type { apiError as requestApiError } from "../logger/errors";

import { validateAuthDelivery } from "./delivery";
import { authStartup } from "./startup";

interface SessionData {
  user: { id: string };
  session: { id: string };
}
interface AuthInstance {
  handler: (request: Request) => Promise<Response>;
  options: BetterAuthOptions;
  $context: Promise<{ options: BetterAuthOptions }>;
  $Infer: { Session: SessionData };
  api: {
    getSession: (input: {
      headers: Headers;
      returnHeaders: true;
    }) => Promise<{ headers: Headers; response: unknown }>;
  };
}
export interface AuthRequestContext {
  request: Request;
  set: { headers: Record<string, string | number | string[] | undefined> };
  apiError?: typeof requestApiError;
}
type Input = AuthRequestContext | Request;
type OrgAPI = {
  getFullOrganization: (input: {
    headers: Headers;
    query: { organizationSlug: string };
  }) => Promise<unknown>;
};
type OrgResult<A> = A extends { api: { getFullOrganization: (...args: never[]) => infer Result } }
  ? Awaited<Result>
  : never;

function failure<const Code extends 401 | 404>(input: Input, code: Code, message: string) {
  if (!(input instanceof Request) && input.apiError) return input.apiError(code, { message });
  return status(code, { status: code, message });
}

function isHiddenOrganizationError(error: unknown) {
  return (
    error instanceof APIError &&
    (error.statusCode === 403 ||
      error.statusCode === 404 ||
      error.body?.code === "ORGANIZATION_NOT_FOUND")
  );
}

/** Bind once to the native auth instance. Request caching and cookie refresh stay request-local. */
export function createAuthHelpers<A extends AuthInstance>(auth: A) {
  type Session = A["$Infer"]["Session"];
  const sessions = new WeakMap<Request, Promise<{ headers: Headers; response: unknown }>>();
  async function getSession(input: Input): Promise<Session | null> {
    const request = input instanceof Request ? input : input.request;
    let pending = sessions.get(request);
    if (!pending) {
      pending = auth.api.getSession({ headers: request.headers, returnHeaders: true });
      sessions.set(request, pending);
    }
    const result = await pending;
    if (!(input instanceof Request)) {
      const cookies = result.headers.getSetCookie();
      if (cookies.length) {
        const previous = input.set.headers["set-cookie"];
        const all = [
          ...(Array.isArray(previous) ? previous : typeof previous === "string" ? [previous] : []),
          ...cookies,
        ];
        input.set.headers["set-cookie"] = [...new Set(all)];
      }
    }
    return result.response as Session | null;
  }
  async function getUser(input: Input): Promise<Session["user"] | null> {
    return (await getSession(input))?.user ?? null;
  }
  async function requireSession(input: Input) {
    return (await getSession(input)) ?? failure(input, 401, "Authentication required");
  }
  async function getOrganizationBySlug(input: Input, slug: string): Promise<OrgResult<A> | null> {
    const session = await getSession(input);
    if (!session) return null;
    if (!("getFullOrganization" in auth.api))
      throw new Error("Enable the native organization plugin before using organization helpers.");
    const request = input instanceof Request ? input : input.request;
    try {
      return (await (auth.api as AuthInstance["api"] & OrgAPI).getFullOrganization({
        headers: request.headers,
        query: { organizationSlug: slug },
      })) as OrgResult<A>;
    } catch (error) {
      if (isHiddenOrganizationError(error)) return null;
      throw error;
    }
  }
  async function requireOrganization(input: Input, slug: string) {
    if (!(await getSession(input))) return failure(input, 401, "Authentication required");
    return (
      (await getOrganizationBySlug(input, slug)) ?? failure(input, 404, "Organization not found")
    );
  }
  type MemberResult =
    NonNullable<OrgResult<A>> extends { members: infer Members extends unknown[] }
      ? Members[number]
      : never;
  async function getMembership(input: Input, slug: string): Promise<MemberResult | null> {
    const user = await getUser(input);
    if (!user) return null;
    if (!("listMembers" in auth.api))
      throw new Error("Enable the native organization plugin before using membership helpers.");
    const request = input instanceof Request ? input : input.request;
    const list = auth.api.listMembers as (input: {
      headers: Headers;
      query: { organizationSlug: string; filterField: string; filterValue: string; limit: number };
    }) => Promise<{ members: MemberResult[] }>;
    try {
      const result = await list({
        headers: request.headers,
        query: { organizationSlug: slug, filterField: "userId", filterValue: user.id, limit: 1 },
      });
      return result.members[0] ?? null;
    } catch (error) {
      if (isHiddenOrganizationError(error)) return null;
      throw error;
    }
  }
  async function requireMembership(input: Input, slug: string) {
    if (!(await getUser(input))) return failure(input, 401, "Authentication required");
    return (await getMembership(input, slug)) ?? failure(input, 404, "Organization not found");
  }
  async function validate() {
    validateAuthDelivery((await auth.$context).options);
  }
  function elysia() {
    return new Elysia({ name: "prinpo:auth", seed: auth })
      .decorate(authStartup, validate)
      .mount(auth.handler)
      .macro({
        auth: {
          async resolve(context) {
            const session = await requireSession(context);
            if (session instanceof ElysiaCustomStatusResponse) return session;
            return {
              user: session.user as Session["user"],
              session: session.session as Session["session"],
            };
          },
        },
      });
  }
  return {
    getSession,
    getUser,
    requireSession,
    getOrganizationBySlug,
    requireOrganization,
    getMembership,
    requireMembership,
    elysia,
    validate,
  };
}
