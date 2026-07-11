import { describe, expect, it } from "vitest";
import { resolveSocialResponderProvider } from "../../src/social-responder-selection";

describe("resolveSocialResponderProvider", () => {
  it("default é zernio para facebook", () => {
    expect(resolveSocialResponderProvider("facebook")).toBe("zernio");
  });

  it("default é zernio para instagram", () => {
    expect(resolveSocialResponderProvider("instagram")).toBe("zernio");
  });

  it("override do catálogo tem precedência sobre o default (facebook -> meta)", () => {
    expect(resolveSocialResponderProvider("facebook", { facebook: "meta" })).toBe("meta");
  });

  it("override parcial não afeta a plataforma não sobrescrita", () => {
    expect(resolveSocialResponderProvider("instagram", { facebook: "meta" })).toBe("zernio");
  });
});
