import { z } from "zod";

const structuredApiError = z.object({
  status: z.number(),
  value: z.object({
    status: z.number(),
    message: z.string(),
    data: z
      .looseObject({
        code: z.string().optional(),
        why: z.string().optional(),
        fix: z.string().optional(),
        link: z.string().optional(),
      })
      .optional(),
  }),
});

export type StructuredApiError = z.infer<typeof structuredApiError>;

/** Validate the common envelope while retaining any endpoint-specific fields and literals. */
export function isStructuredApiError<E>(error: E): error is E & StructuredApiError {
  return structuredApiError.safeParse(error).success;
}
