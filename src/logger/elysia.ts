import { Elysia, ElysiaCustomStatusResponse, status as elysiaStatus } from "elysia";
import {
  type DrainContext,
  type ErrorOptions,
  type EvlogConfig,
  EvlogError,
  createError,
  defineEvlog,
  initLogger,
  toLoggerConfig,
  toMiddlewareOptions,
} from "evlog";
import { type FsConfig } from "evlog/fs";
import {
  type MiddlewareLoggerResult,
  createMiddlewareLogger,
  extractSafeHeaders,
} from "evlog/toolkit";
import { format } from "node:util";

import { apiError, publicError } from "./errors";
import { developmentDrain } from "./persistence";

type FrameworkError = "NOT_FOUND" | "PARSE" | "UNKNOWN";
type FrameworkFields = Partial<
  Pick<ErrorOptions, "message" | "code" | "why" | "fix" | "link" | "data">
>;

export interface LoggerOptions extends EvlogConfig {
  /** Development-only file output. Defaults to five files of approximately 10 MiB each. */
  persistence?: false | Partial<FsConfig>;
  errors?: Partial<Record<FrameworkError, FrameworkFields>>;
}

const defaults = {
  NOT_FOUND: { status: 404, message: "Not found" },
  PARSE: { status: 400, message: "Malformed request" },
  UNKNOWN: { status: 500, message: "Internal server error" },
};

/** Configure once, then reuse this plugin on the main app and its route modules. */
export function logger({ persistence, errors, ...input }: LoggerOptions = {}) {
  const options = defineEvlog(input);
  const environment = options.environment ?? options.env?.environment ?? process.env.NODE_ENV;
  const fileDrain =
    persistence !== false && environment !== "production"
      ? developmentDrain({
          ...(process.env.LOG_DIR ? { dir: process.env.LOG_DIR } : {}),
          ...persistence,
        })
      : undefined;
  const drain = options.drain;
  const config = {
    ...options,
    drain: fileDrain
      ? async (ctx: DrainContext) => {
          await fileDrain(ctx);
          await drain?.(ctx);
        }
      : drain,
  };
  initLogger(toLoggerConfig(config));
  const middleware = toMiddlewareOptions(config);
  const requests = new WeakMap<Request, MiddlewareLoggerResult>();

  return (
    new Elysia({ name: "prinpo:logger" })
      .onRequest(({ request }) => {
        const url = new URL(request.url);
        requests.set(
          request,
          createMiddlewareLogger({
            ...middleware,
            method: request.method,
            path: url.pathname,
            requestId: request.headers.get("x-request-id") ?? undefined,
            headers: extractSafeHeaders(request.headers),
          }),
        );
      })
      .derive({ as: "global" }, ({ request }) => {
        const state = requests.get(request);
        if (!state) throw new Error("Register logger on the main Elysia instance before routes");
        return { log: state.logger, apiError };
      })
      // Low-level registration keeps response-producing hooks out of success inference.
      .onError(({ request, error, code, set }) => {
        const state = requests.get(request);
        if (error instanceof ElysiaCustomStatusResponse) return error;
        if (EvlogError.isEvlogError(error)) {
          state?.logger.error(error);
          set.status = error.status;
          return Response.json(publicError(error), { status: error.status });
        }
        if (code === "VALIDATION") {
          state?.logger.error(error);
          return;
        }
        const category: FrameworkError =
          code === "NOT_FOUND" ? "NOT_FOUND" : code === "PARSE" ? "PARSE" : "UNKNOWN";
        const mapped = createError({
          ...defaults[category],
          ...errors?.[category],
          cause: error instanceof Error ? error : new Error(format(error)),
        });
        state?.logger.error(mapped);
        set.status = mapped.status;
        return Response.json(publicError(mapped), { status: mapped.status });
      })
      .as("global")
      .onAfterResponse({ as: "global" }, async ({ request, responseValue, set }) => {
        const state = requests.get(request);
        requests.delete(request);
        // Elysia applies set.status to a 200 Response; an explicit non-200 Response wins.
        const status =
          responseValue instanceof Response && responseValue.status !== 200
            ? responseValue.status
            : elysiaStatus(set.status ?? 200).code;
        await state?.finish({ status });
      })
  );
}
