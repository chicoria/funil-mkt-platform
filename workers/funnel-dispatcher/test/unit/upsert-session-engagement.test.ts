import { describe, it, expect } from "vitest";
import { createHandlers } from "../../src/handlers/index";
import type { FunnelEvent } from "../../../../packages/shared/src/funnel-event";
import type { DispatcherEnv } from "../../src/dispatcher";

// ── Mock D1 ───────────────────────────────────────────────────────────────────

type QueryCall = { query: string; binds: unknown[]; type: "run" | "first" };

function makeEventStoreDb(rowFn?: (query: string, binds: unknown[]) => unknown) {
  const calls: QueryCall[] = [];

  const db = {
    prepare(query: string) {
      let currentBinds: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          currentBinds = [...values];
          return {
            async run() {
              calls.push({ query, binds: currentBinds, type: "run" });
              return {};
            },
            async first<T = unknown>() {
              const result = rowFn ? rowFn(query, currentBinds) : null;
              calls.push({ query, binds: currentBinds, type: "first" });
              return result as T | null;
            },
          };
        },
        async run() {
          calls.push({ query, binds: [], type: "run" });
          return {};
        },
        async first<T = unknown>() {
          const result = rowFn ? rowFn(query, []) : null;
          calls.push({ query, binds: [], type: "first" });
          return result as T | null;
        },
      };
    },
  };

  return { db, calls };
}

function makeEnv(db: ReturnType<typeof makeEventStoreDb>["db"]): DispatcherEnv {
  return { EVENT_STORE_DB: db } as unknown as DispatcherEnv;
}

function makeEngagementSnapshotEvent(overrides: Partial<FunnelEvent> = {}): FunnelEvent {
  return {
    event_id: "evt-snap-1",
    event_type: "ENGAGEMENT_SNAPSHOT",
    product_code: "DECOLE_ESG_MENTORIA",
    source: "site",
    occurred_at: "2026-01-15T10:00:00.000Z",
    identity: { anonymous_id: "anon-abc", session_id: "sess-xyz" },
    payload: {
      page_views: 4,
      max_scroll_pct: 60,
      lp_sections_viewed: ["section-hero", "section-oferta"],
      lp_sections_engaged: ["section-hero"],
      cta_clicks: [],
      vsl_max_pct: 30,
      vsl_sections: [],
    },
    ...overrides,
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const existingDbRow = {
  tenant_id: "decole",
  session_id: "sess-xyz",
  product_code: "DECOLE_ESG_MENTORIA",
  anonymous_id: "anon-abc",
  profile_id: null,
  funnel_stage: null,
  first_seen_at: "2026-01-15T09:00:00.000Z",
  last_seen_at: "2026-01-15T09:30:00.000Z",
  page_views: 3,
  max_scroll_pct: 40,
  lp_sections_viewed: '["section-hero"]',
  lp_sections_engaged: '[]',
  cta_clicks: '[]',
  vsl_version: null,
  vsl_max_pct: 0,
  vsl_sections: '[]',
  became_lead: 0,
  purchased: 0,
};

// ── Testes ────────────────────────────────────────────────────────────────────

describe("upsert_session_engagement handler", () => {
  const handlers = createHandlers();
  const handler = handlers["upsert_session_engagement"];

  it("1. UPSERT nova sessão — insere linha nova quando session_id não existe", async () => {
    const { db, calls } = makeEventStoreDb();
    const env = makeEnv(db);
    const event = makeEngagementSnapshotEvent();

    await handler(event, env);

    const upsertCall = calls.find(
      (c) => c.type === "run" && c.query.includes("INSERT INTO session_engagement") && c.query.includes("ON CONFLICT")
    );
    expect(upsertCall).toBeDefined();
    // Confirma que session_id e tenant_id foram passados como binds
    expect(upsertCall!.binds).toContain("sess-xyz");
    expect(upsertCall!.binds).toContain("decole");
  });

  it("2. MERGE sessão existente — faz merge com mergeSnapshot e actualiza", async () => {
    const { db, calls } = makeEventStoreDb((query) => {
      if (query.includes("SELECT") && query.includes("session_engagement")) {
        return existingDbRow;
      }
      return null;
    });
    const env = makeEnv(db);
    // payload: page_views=4; existente: page_views=3 → merged=7
    const event = makeEngagementSnapshotEvent({
      payload: {
        page_views: 4,
        max_scroll_pct: 60,
        lp_sections_viewed: ["section-oferta"],
        lp_sections_engaged: [],
        cta_clicks: [],
        vsl_max_pct: 0,
        vsl_sections: [],
      },
    });

    await handler(event, env);

    const upsertCall = calls.find(
      (c) => c.type === "run" && c.query.includes("INSERT INTO session_engagement")
    );
    expect(upsertCall).toBeDefined();
    // page_views está no índice 8 (0-based) dos binds: tenant,session,product,anon,profile,stage,first,last,page_views,...
    const pageViewsIndex = 8;
    expect(upsertCall!.binds[pageViewsIndex]).toBe(7); // 3 existing + 4 from event
    // lp_sections_viewed deve ser union: ["section-hero"] ∪ ["section-oferta"]
    const sectionsViewedIndex = 10;
    const sectionsViewed = JSON.parse(upsertCall!.binds[sectionsViewedIndex] as string);
    expect(sectionsViewed).toContain("section-hero");
    expect(sectionsViewed).toContain("section-oferta");
  });

  it("3. Stitching GENERATE_LEAD — UPDATE session_engagement SET profile_id, became_lead=1 WHERE anonymous_id AND profile_id IS NULL", async () => {
    const { db, calls } = makeEventStoreDb();
    const env = makeEnv(db);
    const event: FunnelEvent = {
      event_id: "evt-lead-1",
      event_type: "GENERATE_LEAD",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "site",
      occurred_at: "2026-01-15T11:00:00.000Z",
      identity: { anonymous_id: "anon-abc", session_id: "sess-xyz" },
      payload: { profile_id: "profile-99" },
    };

    await handler(event, env);

    const stitchCall = calls.find(
      (c) =>
        c.type === "run" &&
        c.query.includes("UPDATE session_engagement") &&
        c.query.includes("became_lead=1") &&
        c.query.includes("profile_id IS NULL")
    );
    expect(stitchCall).toBeDefined();
    expect(stitchCall!.binds).toContain("profile-99");
    expect(stitchCall!.binds).toContain("anon-abc");
    expect(stitchCall!.binds).toContain("decole");
  });

  it("4. Stitching PURCHASE_APPROVED — UPDATE session_engagement SET purchased=1 WHERE profile_id", async () => {
    const { db, calls } = makeEventStoreDb();
    const env = makeEnv(db);
    const event: FunnelEvent = {
      event_id: "evt-purchase-1",
      event_type: "PURCHASE_APPROVED",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "hotmart",
      occurred_at: "2026-01-15T12:00:00.000Z",
      identity: { anonymous_id: "anon-abc" },
      payload: { profile_id: "profile-99" },
    };

    await handler(event, env);

    const stitchCall = calls.find(
      (c) =>
        c.type === "run" &&
        c.query.includes("UPDATE session_engagement") &&
        c.query.includes("purchased=1")
    );
    expect(stitchCall).toBeDefined();
    expect(stitchCall!.binds).toContain("profile-99");
    expect(stitchCall!.binds).toContain("decole");
  });

  it("5. Idempotência — SQL usa ON CONFLICT (UPSERT seguro em re-entrega)", async () => {
    const { db, calls } = makeEventStoreDb();
    const env = makeEnv(db);
    const event = makeEngagementSnapshotEvent();

    await handler(event, env);

    const upsertCall = calls.find(
      (c) => c.type === "run" && c.query.includes("INSERT INTO session_engagement")
    );
    expect(upsertCall).toBeDefined();
    expect(upsertCall!.query).toContain("ON CONFLICT");
    expect(upsertCall!.query).toContain("DO UPDATE SET");
  });

  it("6. Skip quando session_id ausente em evento engagement_rollup", async () => {
    const { db, calls } = makeEventStoreDb();
    const env = makeEnv(db);
    const event = makeEngagementSnapshotEvent({
      identity: { anonymous_id: "anon-abc" }, // sem session_id
    });

    await handler(event, env);

    const upsertCall = calls.find(
      (c) => c.type === "run" && c.query.includes("INSERT INTO session_engagement")
    );
    expect(upsertCall).toBeUndefined();
  });

  it("7. Skip quando EVENT_STORE_DB não está configurado", async () => {
    const env = {} as DispatcherEnv;
    const event = makeEngagementSnapshotEvent();
    // Não deve lançar excepção
    await expect(handler(event, env)).resolves.toBeUndefined();
  });
});
