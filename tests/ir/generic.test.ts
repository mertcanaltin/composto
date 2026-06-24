import { describe, it, expect } from "vitest";
import { extractGenericStructure, isGenericLang } from "../../src/ir/generic.js";

// Modeled on the ada C++ URL parser the coverage gap exposed. The generic
// extractor has no grammar — it's the Tier-2 fallback that keeps Composto from
// being blind on braced languages it can't deeply parse yet.
const CPP = `// ada url parser
#include <string_view>
#include "ada.h"

namespace ada {

struct url_components {
  uint32_t protocol_end;
  uint32_t host_start;
};

class url_aggregator : public url_base {
 public:
  bool set_href(std::string_view input);
  std::string_view get_protocol() const noexcept;
 private:
  std::string buffer;
};

result<url_aggregator> parse(std::string_view input, const url* base_url) {
  if (input.empty()) {
    return result<url_aggregator>{};
  }
  return parse_url(input, base_url);
}

}  // namespace ada
`;

describe("isGenericLang", () => {
  it("claims braced languages we don't deeply parse", () => {
    expect(isGenericLang("src/url.cpp")).toBe(true);
    expect(isGenericLang("include/ada.h")).toBe(true);
    expect(isGenericLang("Main.java")).toBe(true);
  });
  it("declines languages with deep tree-sitter IR and non-code files", () => {
    expect(isGenericLang("src/index.ts")).toBe(false);
    expect(isGenericLang("app.py")).toBe(false);
    expect(isGenericLang("README.md")).toBe(false);
  });
});

describe("extractGenericStructure (C++)", () => {
  const ir = extractGenericStructure(CPP, "url.cpp");

  it("captures includes as USE", () => {
    expect(ir).toContain("USE:string_view");
    expect(ir).toContain("USE:ada.h");
  });

  it("captures namespaces, classes and structs with inheritance", () => {
    expect(ir).toContain("NS:ada");
    expect(ir).toContain("CLASS:url_components");
    expect(ir).toContain("CLASS:url_aggregator");
    expect(ir).toContain("url_base"); // base retained
  });

  it("captures function definitions and member prototypes", () => {
    expect(ir).toContain("FN:parse");
    expect(ir).toContain("FN:set_href");
    expect(ir).toContain("FN:get_protocol");
  });

  it("does NOT mistake call sites or data fields for declarations", () => {
    expect(ir).not.toContain("FN:parse_url"); // call site inside parse()
    expect(ir).not.toContain("FN:protocol_end"); // bare field, no parens
    expect(ir).not.toContain("protocol_end");
  });

  it("is a real token win and emits no brace noise", () => {
    expect(ir.length).toBeGreaterThan(0);
    expect(ir.length).toBeLessThan(CPP.length);
    expect(ir).not.toMatch(/^\s*[{}]\s*$/m);
  });
});
