// Minimal API surface hook adapters depend on. Factored out so tests can
// inject a stub without spinning up a real MemoryAPI + fixture repo.
// Adapters accept an optional `deps` parameter; production uses the default
// which returns a real MemoryAPI.

import { MemoryAPI } from "../../memory/api.js";
import type { BlastRadiusResponse } from "../../memory/types.js";

export interface HookApi {
  blastradius(query: { file: string }): Promise<BlastRadiusResponse>;
  close(): Promise<void>;
}

export interface HookDeps {
  makeApi(opts: { dbPath: string; repoPath: string }): HookApi;
}

export const defaultDeps: HookDeps = {
  makeApi(opts) {
    return new MemoryAPI(opts);
  },
};
