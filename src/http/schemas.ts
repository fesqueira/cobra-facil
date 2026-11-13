import { z } from "zod";

export const errorSchema = z
  .object({
    error: z.object({
      code: z.string().meta({ example: "VALIDATION_ERROR" }),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .meta({ id: "Error" });

/** Response schemas for the error status codes a route can answer with. */
export const errors = (...codes: number[]) => Object.fromEntries(codes.map((c) => [c, errorSchema]));
