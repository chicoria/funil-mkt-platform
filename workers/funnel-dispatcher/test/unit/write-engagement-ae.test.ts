import { describe, it, expect, vi } from "vitest";
import { writeEngagementAe } from "../../src/handlers/write-engagement-ae";
import type { FunnelEvent } from "../../../../packages/shared/src/funnel-event";
import type { AnalyticsEngineDataset } from "../../src/dispatcher";

function makeAe() {
  const written: Parameters<AnalyticsEngineDataset["writeDataPoint"]>[0][] = [];
  const ae: AnalyticsEngineDataset = {
    writeDataPoint: (pt) => { written.push(pt); },
  };
  return { ae, written };
}

function makeEvent(overrides: Partial<FunnelEvent> = {}): FunnelEvent {
  return {
    event_id: "ev-1",
    event_type: "SECTION_VIEW",
    tenant_id: "decole",
    product_code: "DECOLE_ESG_MENTORIA",
    source: "site",
    occurred_at: new Date().toISOString(),
    identity: { session_id: "sess-abc", anonymous_id: "anon-xyz" },
    payload: { section_id: "lp-secao-oferta", section_index: 3, visible_pct: 80 },
    ...overrides,
  };
}

describe("writeEngagementAe", () => {
  it("escreve blobs com tenant, product, anonymous_id, session_id, event_type, section_id", () => {
    const { ae, written } = makeAe();
    writeEngagementAe(makeEvent(), ae, "decole");
    expect(written).toHaveLength(1);
    expect(written[0].blobs).toContain("decole");
    expect(written[0].blobs).toContain("DECOLE_ESG_MENTORIA");
    expect(written[0].blobs).toContain("anon-xyz");
    expect(written[0].blobs).toContain("sess-abc");
    expect(written[0].blobs).toContain("SECTION_VIEW");
  });

  it("usa anonymous_id como index para filtrar depois", () => {
    const { ae, written } = makeAe();
    writeEngagementAe(makeEvent(), ae, "decole");
    expect(written[0].indexes).toContain("anon-xyz");
  });

  it("escreve visible_pct como double quando presente", () => {
    const { ae, written } = makeAe();
    writeEngagementAe(makeEvent({ payload: { visible_pct: 75, section_index: 2 } }), ae, "decole");
    expect(written[0].doubles?.[0]).toBe(75);
  });

  it("escreve vsl_section_key no blob quando evento VSL", () => {
    const { ae, written } = makeAe();
    writeEngagementAe(makeEvent({
      event_type: "VSL_SECTION_START",
      payload: { vsl_section_key: "vslv1_ancoragem-oferta", video_time_sec: 1487.3, vsl_max_pct: 92 }
    }), ae, "decole");
    expect(written[0].blobs).toContain("vslv1_ancoragem-oferta");
    expect(written[0].doubles).toContain(1487.3);
  });

  it("nao escreve se ENGAGEMENT_AE ausente (nao lança erro)", () => {
    // ae = undefined — deve ser no-op
    expect(() => writeEngagementAe(makeEvent(), undefined, "decole")).not.toThrow();
  });

  it("nao escreve eventos que nao sejam de engagement", () => {
    const { ae, written } = makeAe();
    writeEngagementAe(makeEvent({ event_type: "GENERATE_LEAD" }), ae, "decole");
    expect(written).toHaveLength(0);
  });
});
