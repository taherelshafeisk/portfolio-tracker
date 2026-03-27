// Re-exports the generated Zod schema values without the TypeScript interface types
// that live in ./generated/types/ (which share the same names and cause export collisions).
// Also re-exports `z` so consumers can extend schemas without a separate zod dependency.
export * from "./generated/api";
export { z } from "zod";
