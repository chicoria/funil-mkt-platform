import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import worker from "../../src/index";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");

function makeSqliteD1(db) {
  return {
    prepare(query) {
      let binds = [];
      return {
        bind(...values) {
          binds = values;
          return this;
        },
        async run() {
          db.prepare(query).run(...binds);
          return {};
        },
        async first() {
          return db.prepare(query).get(...binds) || null;
        },
      };
    },
  };
}

function makeKv() {
  const store = new Map();
  return {
    get: vi.fn(async (key) => store.get(key) ?? null),
    put: vi.fn(async (key, value) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key) => {
      store.delete(key);
    }),
  };
}

function createLegacyIdentityDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE identity_links (
      profile_id TEXT PRIMARY KEY,
      anonymous_id TEXT,
      email_hash TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_identity_links_anonymous_id ON identity_links(anonymous_id);
    CREATE UNIQUE INDEX idx_identity_links_email_hash ON identity_links(email_hash);
  `);
  return db;
}

function createLegacyEventStoreDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE funnel_events (
      event_id TEXT PRIMARY KEY,
      profile_id TEXT,
      anonymous_id TEXT,
      email_hash TEXT,
      event_type TEXT NOT NULL,
      product_code TEXT NOT NULL,
      source TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_funnel_events_profile ON funnel_events(profile_id, occurred_at);
  `);
  return db;
}

describe("D1 tenant migrations", () => {
  it("rebuilds legacy identity and event tables so tenants can share ids", async () => {
    const identityDb = createLegacyIdentityDb();
    const eventStoreDb = createLegacyEventStoreDb();
    const env = {
      DEDUPE_KV: makeKv(),
      IDENTITY_KV: makeKv(),
      IDENTITY_DB: makeSqliteD1(identityDb),
      EVENT_STORE_DB: makeSqliteD1(eventStoreDb),
      CATALOG_JSON: JSON.stringify({
        tenants: {
          decole: {
            products: {
              PLANOVOO: {
                funnelEventArchitecture: {
                  events: [{ eventType: "GENERATE_LEAD", chain: ["resolve_identity", "upsert_event_store"] }],
                },
              },
            },
          },
          superare: {
            products: {
              PLANOVOO: {
                funnelEventArchitecture: {
                  events: [{ eventType: "GENERATE_LEAD", chain: ["resolve_identity", "upsert_event_store"] }],
                },
              },
            },
          },
        },
      }),
    };
    const base = {
      event_id: "evt-shared",
      event_type: "GENERATE_LEAD",
      product_code: "PLANOVOO",
      source: "site",
      occurred_at: "2026-05-14T12:00:00.000Z",
      lead: { email: "same@example.com" },
      identity: { anonymous_id: "anon-shared" },
      payload: {},
    };

    await worker.queue(
      {
        messages: [
          { body: { ...base, tenant_id: "decole" } },
          { body: { ...base, tenant_id: "superare" } },
        ],
      },
      env
    );

    expect(identityDb.prepare("SELECT COUNT(*) AS count FROM identity_links").get().count).toBe(4);
    expect(eventStoreDb.prepare("SELECT COUNT(*) AS count FROM funnel_events WHERE event_id = 'evt-shared'").get().count).toBe(2);
    expect(
      identityDb.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_identity_links_anonymous_id'").get()
    ).toBeUndefined();
    expect(
      eventStoreDb.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_funnel_events_profile'").get()
    ).toBeUndefined();
  });

  it("preserves previous email aliases when the same anonymous_id submits a new email", async () => {
    const identityDb = new DatabaseSync(":memory:");
    const eventStoreDb = createLegacyEventStoreDb();
    const env = {
      DEDUPE_KV: makeKv(),
      IDENTITY_KV: makeKv(),
      IDENTITY_DB: makeSqliteD1(identityDb),
      EVENT_STORE_DB: makeSqliteD1(eventStoreDb),
      CATALOG_JSON: JSON.stringify({
        products: {
          DECOLE_ESG_MENTORIA: {
            funnelEventArchitecture: {
              events: [{ eventType: "GENERATE_LEAD", chain: ["resolve_identity", "upsert_event_store"] }],
            },
          },
        },
      }),
    };

    const base = {
      event_type: "GENERATE_LEAD",
      product_code: "DECOLE_ESG_MENTORIA",
      source: "site",
      occurred_at: "2026-05-19T10:00:00.000Z",
      identity: { anonymous_id: "anon-same-browser" },
      payload: {},
    };
    const firstEvent = {
      ...base,
      event_id: "evt-old-email",
      lead: { email: "old@example.com" },
      payload: {},
    };
    const secondEvent = {
      ...base,
      event_id: "evt-new-email",
      occurred_at: "2026-05-19T10:01:00.000Z",
      lead: { email: "new@example.com" },
      payload: {},
    };

    await worker.queue({ messages: [{ body: firstEvent }, { body: secondEvent }] }, env);

    const eventProfiles = eventStoreDb
      .prepare("SELECT DISTINCT profile_id FROM funnel_events WHERE event_id IN ('evt-old-email', 'evt-new-email')")
      .all();
    expect(eventProfiles).toHaveLength(1);

    const aliasRows = identityDb
      .prepare(
        `SELECT profile_id, anonymous_id, email_hash
         FROM identity_links
         WHERE tenant_id = 'decole'
         ORDER BY anonymous_id IS NULL, email_hash`
      )
      .all();
    expect(aliasRows).toHaveLength(3);
    expect(aliasRows.filter((row) => row.email_hash)).toHaveLength(2);
    expect(new Set(aliasRows.map((row) => row.profile_id))).toEqual(new Set([eventProfiles[0].profile_id]));
  });
});
