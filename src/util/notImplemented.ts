/**
 * Marker for stubbed functionality. Throwing (rather than silently no-op'ing)
 * keeps unfinished code loud during development. Replace call sites as each
 * layer is implemented.
 */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`Not implemented: ${what}`);
    this.name = "NotImplementedError";
  }
}

export function notImplemented(what: string): never {
  throw new NotImplementedError(what);
}
