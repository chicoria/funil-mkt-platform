import { describe, expect, it } from "vitest";
import {
  mapValue,
  mapPayload,
  interpolate,
} from "../../src/payload-mapper";

// ---------------------------------------------------------------------------
// mapValue — resolve paths like $.buyer.email
// ---------------------------------------------------------------------------

describe("mapValue", () => {
  const event = {
    data: {
      buyer: { email: "user@email.com", name: "João Silva" },
      purchase: {
        transaction: "TRX-100",
        price: { value: 197.0 },
        payment: { type: "CREDIT_CARD" },
      },
      product: { name: "Plano de Voo" },
    },
  };

  it("resolves a simple nested path", () => {
    expect(mapValue(event, "$.data.buyer.email")).toBe("user@email.com");
  });

  it("resolves deeply nested numeric value", () => {
    expect(mapValue(event, "$.data.purchase.price.value")).toBe(197.0);
  });

  it("returns null for non-existent path", () => {
    expect(mapValue(event, "$.data.buyer.phone")).toBeNull();
  });

  it("returns null for empty object", () => {
    expect(mapValue({}, "$.data.buyer.email")).toBeNull();
  });

  it("returns null for path traversing a non-object", () => {
    expect(mapValue(event, "$.data.buyer.email.something")).toBeNull();
  });

  it("resolves top-level field", () => {
    expect(mapValue({ foo: "bar" }, "$.foo")).toBe("bar");
  });

  it("preserves boolean values", () => {
    expect(mapValue({ active: true }, "$.active")).toBe(true);
  });

  it("preserves zero as a valid value", () => {
    expect(mapValue({ count: 0 }, "$.count")).toBe(0);
  });

  it("preserves false as a valid value", () => {
    expect(mapValue({ active: false }, "$.active")).toBe(false);
  });

  it("preserves empty string as a valid value", () => {
    expect(mapValue({ name: "" }, "$.name")).toBe("");
  });

  it("returns null when obj is null", () => {
    expect(mapValue(null, "$.foo")).toBeNull();
  });

  it("returns null when path has no $ prefix", () => {
    expect(mapValue(event, "data.buyer.email")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mapValue with pipe filters
// ---------------------------------------------------------------------------

describe("mapValue with filters", () => {
  const event = {
    buyer: { name: "João Carlos Silva", email: "j@e.com" },
  };

  it("applies first_name filter", () => {
    expect(mapValue(event, "$.buyer.name | first_name")).toBe("João");
  });

  it("first_name on empty string returns empty", () => {
    expect(mapValue({ buyer: { name: "" } }, "$.buyer.name | first_name")).toBe("");
  });

  it("first_name on single word returns the word", () => {
    expect(mapValue({ buyer: { name: "Maria" } }, "$.buyer.name | first_name")).toBe("Maria");
  });

  it("returns null when source value is null (filter not applied)", () => {
    expect(mapValue({}, "$.buyer.name | first_name")).toBeNull();
  });

  it("applies lowercase filter", () => {
    expect(mapValue({ s: "HELLO" }, "$.s | lowercase")).toBe("hello");
  });

  it("applies uppercase filter", () => {
    expect(mapValue({ s: "hello" }, "$.s | uppercase")).toBe("HELLO");
  });

  it("ignores unknown filter gracefully (returns value as-is)", () => {
    expect(mapValue(event, "$.buyer.name | unknown_filter")).toBe("João Carlos Silva");
  });

  it("chains multiple filters", () => {
    expect(mapValue({ s: "Hello World" }, "$.s | first_name | uppercase")).toBe("HELLO");
  });

  it("trims whitespace around filter name", () => {
    expect(mapValue(event, "$.buyer.name |  first_name ")).toBe("João");
  });
});

// ---------------------------------------------------------------------------
// mapPayload — maps multiple fields
// ---------------------------------------------------------------------------

describe("mapPayload", () => {
  const event = {
    data: {
      buyer: { email: "user@email.com", name: "Maria Silva" },
      purchase: { transaction: "TRX-200", price: { value: 99 } },
      product: { name: "Curso ABC" },
    },
  };

  it("maps all fields from a mapping object", () => {
    const mapping = {
      email: "$.data.buyer.email",
      nome: "$.data.buyer.name",
      transacao: "$.data.purchase.transaction",
      valor: "$.data.purchase.price.value",
    };

    expect(mapPayload(event, mapping)).toEqual({
      email: "user@email.com",
      nome: "Maria Silva",
      transacao: "TRX-200",
      valor: 99,
    });
  });

  it("omits keys whose value resolved to null", () => {
    const mapping = {
      email: "$.data.buyer.email",
      phone: "$.data.buyer.phone",
    };

    const result = mapPayload(event, mapping);
    expect(result).toEqual({ email: "user@email.com" });
    expect(result).not.toHaveProperty("phone");
  });

  it("applies filters in mapping values", () => {
    const mapping = {
      primeiroNome: "$.data.buyer.name | first_name",
    };
    expect(mapPayload(event, mapping)).toEqual({ primeiroNome: "Maria" });
  });

  it("returns empty object for empty mapping", () => {
    expect(mapPayload(event, {})).toEqual({});
  });

  it("includes false and zero in result (not omitted)", () => {
    const obj = { a: false, b: 0 };
    const result = mapPayload(obj, { a: "$.a", b: "$.b" });
    expect(result).toEqual({ a: false, b: 0 });
  });

  it("supports flat payload (no data wrapper)", () => {
    const flat = {
      buyer: { email: "flat@email.com" },
    };
    expect(mapPayload(flat, { email: "$.buyer.email" })).toEqual({
      email: "flat@email.com",
    });
  });
});

// ---------------------------------------------------------------------------
// interpolate — template string replacement
// ---------------------------------------------------------------------------

describe("interpolate", () => {
  it("replaces a single placeholder", () => {
    expect(
      interpolate("https://app.decole.com/formulario/{{response.token}}", {
        response: { token: "abc-123" },
      })
    ).toBe("https://app.decole.com/formulario/abc-123");
  });

  it("replaces multiple placeholders", () => {
    expect(
      interpolate("{{a.x}}/{{b.y}}", { a: { x: "1" }, b: { y: "2" } })
    ).toBe("1/2");
  });

  it("replaces missing placeholder with empty string", () => {
    expect(
      interpolate("prefix/{{response.missing}}/suffix", { response: {} })
    ).toBe("prefix//suffix");
  });

  it("returns string as-is when no placeholders", () => {
    expect(interpolate("no-placeholders", {})).toBe("no-placeholders");
  });

  it("handles nested context paths", () => {
    expect(
      interpolate("{{a.b.c}}", { a: { b: { c: "deep" } } })
    ).toBe("deep");
  });

  it("coerces numeric values to string", () => {
    expect(
      interpolate("value={{data.count}}", { data: { count: 42 } })
    ).toBe("value=42");
  });
});
