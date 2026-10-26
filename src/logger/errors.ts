import { type ElysiaCustomStatusResponse } from "elysia";
import { type ErrorOptions, EvlogError, createError } from "evlog";

type Guidance = "code" | "why" | "fix" | "link";
// An optional payload cannot guarantee any of its fields, even when guidance guarantees data.
type PublicData<B> = B extends { data: infer D }
  ? undefined extends D
    ? Partial<NonNullable<D>>
    : NonNullable<D>
  : B extends { data?: infer D }
    ? Partial<NonNullable<D>>
    : {};
type GuidanceFields<B> = Pick<B, Extract<keyof B, Guidance>>;
type MergedGuidance<B, D> = {
  [K in keyof GuidanceFields<B>]:
    | GuidanceFields<B>[K]
    | (undefined extends GuidanceFields<B>[K] ? (K extends keyof D ? D[K] : never) : never);
};
type MergeData<B, D> = D extends unknown
  ? Omit<D, keyof GuidanceFields<B>> & MergedGuidance<B, D>
  : never;
type ResponseData<B> = MergeData<B, PublicData<B>>;
type PresentFields<B> = { [K in keyof B]-?: undefined extends B[K] ? never : K }[keyof B];
type DataBody<B> =
  Extract<keyof B, "data" | Guidance> extends never
    ? {}
    : Extract<PresentFields<B>, "data" | Guidance> extends never
      ? { data?: ResponseData<B> }
      : { data: ResponseData<B> };

export type ApiErrorOptions = Omit<ErrorOptions, "status">;
export type ApiErrorBody<S extends number, B extends ApiErrorOptions> = {
  status: S;
  message: B["message"];
} & DataBody<B>;

/** Return this call from a route to declare its failure to Eden. It throws at runtime. */
export function apiError<const S extends number, const B extends ApiErrorOptions>(
  status: S,
  fields: B,
): ElysiaCustomStatusResponse<S, ApiErrorBody<S, B>> {
  throw createError({ ...fields, status });
}

/** Explicit projection: native toJSON also exposes the underlying cause. */
export function publicError(error: EvlogError) {
  const nativeData = error.data;
  // The native getter drops a sole empty guidance string, but the inferred contract retains it.
  const data = {
    ...nativeData,
    ...(error.code !== undefined && { code: error.code }),
    ...(error.why !== undefined && { why: error.why }),
    ...(error.fix !== undefined && { fix: error.fix }),
    ...(error.link !== undefined && { link: error.link }),
  };
  return {
    status: error.status,
    message: error.message,
    ...((nativeData !== undefined || Object.keys(data).length > 0) && { data }),
  };
}
