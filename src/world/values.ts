import { z } from "zod";

/**
 * Primitive scalar shared by author-defined `state`/`flags` bags and by the
 * typed {@link Action} mutations. Lives in its own module so that
 * `world/actions` (which needs `Value`) and `world/schema` (which needs
 * `Action`, to type story-beat effects) can both import without a cycle.
 */
export const Value = z.union([z.string(), z.number(), z.boolean()]);
export type Value = z.infer<typeof Value>;
