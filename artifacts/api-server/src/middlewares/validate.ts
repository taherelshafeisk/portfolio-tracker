import type { Request, Response, NextFunction } from "express";

type ParseSuccess = { success: true; data: unknown };
type ParseFailure = { success: false; error: { issues: ReadonlyArray<{ path: (string | number)[]; message: string }> } };

interface Schema {
  safeParse(data: unknown): ParseSuccess | ParseFailure;
}

/**
 * Returns an Express middleware that validates req.body against the given Zod schema.
 * On success, req.body is replaced with the parsed (coerced) value and next() is called.
 * On failure, responds 400 with { error, issues }.
 */
export function validate(schema: Schema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Validation failed",
        issues: result.error.issues.map(i => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
