import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request profile context (MI-3). The manifest layer wraps a tool call in
 * runWithProfile() when the model passes an explicit `instance`; everything
 * below (config → auth → http → policy → caches) resolves the profile through
 * activeProfile() at call time, so no api/ signature ever threads it.
 */
const als = new AsyncLocalStorage<string>();

export function runWithProfile<T>(profile: string, fn: () => T): T {
  return als.run(profile, fn);
}

/** The profile of the current tool call, when one was explicitly requested. */
export function currentRequestProfile(): string | undefined {
  return als.getStore();
}
