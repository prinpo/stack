import type { Treaty } from "@elysiajs/eden";
import type { QueryClientConfig } from "@tanstack/react-query";
import type { AnyElysia } from "elysia";
import type { JSX, ReactNode } from "react";

import { treaty } from "@elysiajs/eden";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { EdenOptionsProxy } from "./eden-query/types/decorators";

import { createEdenOptionsProxy } from "./eden-query/proxy/createOptionsProxy";

/** Select a static route branch without changing requests or cache keys. */
type ApiPath<T, TPrefix extends string> = TPrefix extends `/${infer Rest}`
  ? ApiPath<T, Rest>
  : TPrefix extends `${infer Head}/${infer Rest}`
    ? Head extends keyof T
      ? ApiPath<T[Head], Rest>
      : never
    : TPrefix extends ""
      ? T
      : TPrefix extends keyof T
        ? T[TPrefix]
        : never;

interface ApiClientConfig {
  /** Native Treaty configuration, including headers and fetcher. */
  treaty?: Treaty.Config;
  /** Native QueryClient configuration. Each factory call owns its cache. */
  query?: QueryClientConfig;
}

export type CreateApiClientOptions<
  TApp extends AnyElysia,
  TPrefix extends string = "",
> = ApiClientConfig &
  (TPrefix extends ""
    ? { prefix?: "" }
    : {
        /** Static route prefix to omit from api/eden access, retained in URLs and keys. */
        prefix: TPrefix &
          (ApiPath<EdenOptionsProxy<TApp>, TPrefix> extends never ? never : unknown);
      });

export interface ApiClient<TApp extends AnyElysia, TPrefix extends string = ""> {
  api: ApiPath<Treaty.Create<TApp>, TPrefix>;
  eden: ApiPath<EdenOptionsProxy<TApp>, TPrefix>;
  queryClient: QueryClient;
  ApiProvider: (props: { children: ReactNode }) => JSX.Element;
}

export function createApiClient<TApp extends AnyElysia>(origin: string): ApiClient<TApp>;
// Keep the common /api prefix ergonomic when only the app generic is supplied.
export function createApiClient<TApp extends AnyElysia>(
  origin: string,
  options: CreateApiClientOptions<TApp, "/api">,
): ApiClient<TApp, "/api">;
export function createApiClient<TApp extends AnyElysia, TPrefix extends string = "">(
  origin: string,
  options: CreateApiClientOptions<TApp, TPrefix>,
): ApiClient<TApp, TPrefix>;

/** Create the Treaty client, Query cache, options proxy, and Query provider. */
export function createApiClient<TApp extends AnyElysia, TPrefix extends string = "">(
  origin: string,
  options: ApiClientConfig & { prefix?: TPrefix } = {},
): ApiClient<TApp, TPrefix> {
  const client = treaty<TApp>(origin, options.treaty);
  const queryClient = new QueryClient(options.query);
  const proxy = createEdenOptionsProxy<TApp>({ client });
  const segments = (options.prefix ?? "").split("/").filter(Boolean);

  function scope<T>(value: T): ApiPath<T, TPrefix> {
    let branch: unknown = value;
    for (const segment of segments) branch = (branch as Record<string, unknown>)[segment];
    return branch as ApiPath<T, TPrefix>;
  }

  function ApiProvider({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  return {
    api: scope(client),
    eden: scope(proxy),
    queryClient,
    ApiProvider,
  };
}
