import { describe, expect, it } from "vitest";
import { mergeSnapshot } from "../../src/session-engagement";
import type { SessionEngagementSnapshot } from "../../src/session-engagement";

function baseSnapshot(): SessionEngagementSnapshot {
  return {
    session_id: "sess-1",
    tenant_id: "tenant-a",
    product_code: "PROD_X",
    first_seen_at: "2026-05-29T10:00:00.000Z",
    last_seen_at: "2026-05-29T10:00:00.000Z",
    page_views: 1,
    max_scroll_pct: 0,
    lp_sections_viewed: [],
    lp_sections_engaged: [],
    cta_clicks: [],
    vsl_max_pct: 0,
    vsl_sections: [],
    became_lead: false,
    purchased: false,
  };
}

describe("mergeSnapshot", () => {
  it("patch vazio → snapshot inalterado", () => {
    const snap = baseSnapshot();
    const result = mergeSnapshot(snap, {});
    expect(result).toEqual(snap);
  });

  it("section_view idempotente: mesma section_id duas vezes não duplica", () => {
    const snap = { ...baseSnapshot(), lp_sections_viewed: ["s1"] };
    const result = mergeSnapshot(snap, { lp_sections_viewed: ["s1", "s2"] });
    expect(result.lp_sections_viewed).toEqual(["s1", "s2"]);
  });

  it("section_engaged idempotente: mesma section_id duas vezes não duplica", () => {
    const snap = { ...baseSnapshot(), lp_sections_engaged: ["s1"] };
    const result = mergeSnapshot(snap, { lp_sections_engaged: ["s1", "s2"] });
    expect(result.lp_sections_engaged).toEqual(["s1", "s2"]);
  });

  it("funnel_stage nunca regride: PURCHASE + AWARENESS → PURCHASE", () => {
    const snap = { ...baseSnapshot(), funnel_stage: "PURCHASE" as const };
    const result = mergeSnapshot(snap, { funnel_stage: "AWARENESS" });
    expect(result.funnel_stage).toBe("PURCHASE");
  });

  it("funnel_stage avança quando patch é mais alto: AWARENESS + CONVERSION → CONVERSION", () => {
    const snap = { ...baseSnapshot(), funnel_stage: "AWARENESS" as const };
    const result = mergeSnapshot(snap, { funnel_stage: "CONVERSION" });
    expect(result.funnel_stage).toBe("CONVERSION");
  });

  it("vsl_sections acumula watched_sec por section_id (soma, não substitui)", () => {
    const snap = { ...baseSnapshot(), vsl_sections: [{ section_id: "v1", watched_sec: 30 }] };
    const result = mergeSnapshot(snap, { vsl_sections: [{ section_id: "v1", watched_sec: 15 }, { section_id: "v2", watched_sec: 20 }] });
    const v1 = result.vsl_sections.find((s) => s.section_id === "v1");
    const v2 = result.vsl_sections.find((s) => s.section_id === "v2");
    expect(v1?.watched_sec).toBe(45);
    expect(v2?.watched_sec).toBe(20);
  });

  it("cta_clicks soma counts por cta_id", () => {
    const snap = { ...baseSnapshot(), cta_clicks: [{ cta_id: "cta1", count: 2 }] };
    const result = mergeSnapshot(snap, { cta_clicks: [{ cta_id: "cta1", count: 3 }, { cta_id: "cta2", count: 1 }] });
    const c1 = result.cta_clicks.find((c) => c.cta_id === "cta1");
    const c2 = result.cta_clicks.find((c) => c.cta_id === "cta2");
    expect(c1?.count).toBe(5);
    expect(c2?.count).toBe(1);
  });

  it("max_scroll_pct toma o máximo", () => {
    const snap = { ...baseSnapshot(), max_scroll_pct: 50 };
    const result = mergeSnapshot(snap, { max_scroll_pct: 30 });
    expect(result.max_scroll_pct).toBe(50);
  });

  it("max_scroll_pct actualiza quando patch é maior", () => {
    const snap = { ...baseSnapshot(), max_scroll_pct: 30 };
    const result = mergeSnapshot(snap, { max_scroll_pct: 75 });
    expect(result.max_scroll_pct).toBe(75);
  });

  it("vsl_max_pct toma o máximo", () => {
    const snap = { ...baseSnapshot(), vsl_max_pct: 80 };
    const result = mergeSnapshot(snap, { vsl_max_pct: 60 });
    expect(result.vsl_max_pct).toBe(80);
  });

  it("vsl_max_pct actualiza quando patch é maior", () => {
    const snap = { ...baseSnapshot(), vsl_max_pct: 60 };
    const result = mergeSnapshot(snap, { vsl_max_pct: 85 });
    expect(result.vsl_max_pct).toBe(85);
  });
});
