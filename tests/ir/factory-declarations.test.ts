import { describe, it, expect } from "vitest";
import { astWalkIR } from "../../src/ir/ast-walker.js";

describe("astWalkIR - factory declarations (call expressions with anonymous functions)", () => {
  describe("import source extraction", () => {
    it("preserves module source for long multi-line imports", async () => {
      const code = `import {
  AAAAAAAAAAAAA, BBBBBBBBBBBBB, CCCCCCCCCCCCC,
  DDDDDDDDDDDDD, EEEEEEEEEEEEE, FFFFFFFFFFFFF,
  type GGGGGGGGGGGGG,
} from "some-really-long-module-path/deep/nested";`;
      const ir = await astWalkIR(code, "app.ts");
      expect(ir).toContain("some-really-long-module-path/deep/nested");
      expect(ir).not.toContain("import {");
    });

    it("extracts source from single-quote imports", async () => {
      const code = `import { a } from 'module-x';`;
      const ir = await astWalkIR(code, "app.ts");
      expect(ir).toContain("USE:module-x");
    });
  });

  describe("Effect.gen handler extraction", () => {
    it("surfaces handler methods inside Effect.gen factories", async () => {
      const code = `
export const ChatRpcLive = ChatRpc.toLayer(
  Effect.gen(function* () {
    const repo = yield* ChatRepository;
    return {
      send: (input: SendInput) => Effect.gen(function* () { return yield* repo.save(input); }),
      list: (input: ListInput) => repo.list(input),
    };
  })
);`;
      const ir = await astWalkIR(code, "rpc-live.ts");
      expect(ir).toContain("OUT FN:ChatRpcLive");
      expect(ir).toContain("METHOD:send(input: SendInput)");
      expect(ir).toContain("METHOD:list(input: ListInput)");
    });

    it("extracts handlers through .pipe(...) wrappers", async () => {
      const code = `
export const Live = Service.toLayer(
  Effect.gen(function* () {
    return {
      foo: (x: number) => x * 2,
      bar: (y: string) => y.toUpperCase(),
    };
  })
).pipe(
  Layer.provide(Dep1.Default),
  Layer.provide(Dep2.Default),
);`;
      const ir = await astWalkIR(code, "live.ts");
      expect(ir).toContain("OUT FN:Live");
      expect(ir).toContain("METHOD:foo(x: number)");
      expect(ir).toContain("METHOD:bar(y: string)");
    });

    it("marks async arrow-function methods", async () => {
      const code = `
export const X = make(Effect.gen(function* () {
  return { fetch: async (id: string) => db.get(id) };
}));`;
      const ir = await astWalkIR(code, "x.ts");
      expect(ir).toContain("ASYNC METHOD:fetch(id: string)");
    });

    it("skips private (_ and #) method keys", async () => {
      const code = `
export const X = make(function() {
  return {
    _internal: (x: number) => x,
    public: (y: string) => y,
  };
});`;
      const ir = await astWalkIR(code, "x.ts");
      expect(ir).toContain("METHOD:public(y: string)");
      expect(ir).not.toContain("_internal");
    });

    it("does not emit METHOD lines for non-factory call declarations", async () => {
      const code = `
export const config = loadConfig({ env: "prod", debug: false });
export function main() { return 1; }`;
      const ir = await astWalkIR(code, "x.ts");
      expect(ir).toContain("FN:main");
      expect(ir).not.toContain("METHOD:");
    });
  });

  describe("multiple handlers + nested declarations", () => {
    it("emits helpers defined alongside the returned handler object", async () => {
      const code = `
export const Live = make(Effect.gen(function* () {
  const repo = yield* Repo;
  function helper(x: number) { return x + 1; }
  return {
    run: (input: string) => helper(input.length),
  };
}));`;
      const ir = await astWalkIR(code, "live.ts");
      expect(ir).toContain("OUT FN:Live");
      expect(ir).toContain("METHOD:run(input: string)");
      expect(ir).toContain("FN:helper(x: number)");
    });
  });
});
