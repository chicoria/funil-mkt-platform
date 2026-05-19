/**
 * TDD Red — Slice 2.11A.10
 * Verifica que sinais determinísticos (email) têm prioridade sobre
 * probabilísticos (anonymous_id) na resolução de identidade.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Helpers para construir evento mínimo ──────────────────────────────────────

function makeEvent(opts: {
  anonymousId?: string;
  email?: string;
  profileId?: string;
}) {
  return {
    event_id: crypto.randomUUID(),
    event_type: "GENERATE_LEAD",
    product_code: "DECOLE_ESG_MENTORIA",
    source: "site",
    occurred_at: new Date().toISOString(),
    identity: { anonymous_id: opts.anonymousId ?? `anon-${crypto.randomUUID()}` },
    lead: opts.email ? { email: opts.email } : undefined,
    payload: opts.profileId ? { profile_id: opts.profileId } : {},
    attribution: {},
  } as never;
}

// ── Stub de IDENTITY_KV ───────────────────────────────────────────────────────

function makeKv(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    get: vi.fn(async (key: string) => store[key] ?? null),
    put: vi.fn(async (key: string, value: string) => { store[key] = value; }),
    _store: store,
  };
}

// ── Stub de D1 (identity_links) ───────────────────────────────────────────────

function makeIdentityDb() {
  const rows: unknown[] = [];
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(function(this: unknown) { return this; }),
      run: vi.fn(async () => ({ meta: { changes: 1 } })),
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: rows })),
    })),
    _rows: rows,
  };
}

// ── Import da função sob teste (ainda não existe → Red) ───────────────────────

import { resolveIdentityForEvent } from "../../src/handlers/identity";

// ── Testes ────────────────────────────────────────────────────────────────────

const TENANT = "decole";

describe("identity resolution — sinais determinísticos vs probabilísticos", () => {

  beforeEach(() => { vi.clearAllMocks(); });

  it("Regra 1: mesmo email em device diferente → mesmo profile_id (determinístico)", async () => {
    const existingProfileId = crypto.randomUUID();
    const emailHash = await sha256Hex("alice@example.com");
    // KV: email já mapeado para perfil existente, anonId novo
    const kv = makeKv({
      [`decole:identity:email:${emailHash}`]: existingProfileId,
    });
    const event = makeEvent({ anonymousId: "anon-novo-device", email: "alice@example.com" });

    await resolveIdentityForEvent(event, TENANT, kv as never, null);

    expect(event.payload.profile_id).toBe(existingProfileId);
  });

  it("Regra 2: email NOVO no mesmo device → novo profile_id (não herda do anonymous_id)", async () => {
    const profileIdDeEmailA = crypto.randomUUID();
    // KV: anonId ligado a email A; email B é desconhecido
    const kv = makeKv({
      "decole:identity:anon:anon-browser-compartilhado": profileIdDeEmailA,
    });
    const event = makeEvent({ anonymousId: "anon-browser-compartilhado", email: "bob@example.com" });

    await resolveIdentityForEvent(event, TENANT, kv as never, null);

    // Deve criar novo profile — NÃO reutilizar o de email A
    expect(event.payload.profile_id).not.toBe(profileIdDeEmailA);
    expect(typeof event.payload.profile_id).toBe("string");
    expect(event.payload.profile_id.length).toBeGreaterThan(10);
  });

  it("Regra 3: sessão anônima (sem email) → continuidade via anonymous_id", async () => {
    const existingProfileId = crypto.randomUUID();
    const kv = makeKv({
      "decole:identity:anon:anon-sessao": existingProfileId,
    });
    const event = makeEvent({ anonymousId: "anon-sessao" }); // sem email

    await resolveIdentityForEvent(event, TENANT, kv as never, null);

    expect(event.payload.profile_id).toBe(existingProfileId);
  });

  it("Regra 4: novo usuário anônimo (sem email, anon desconhecido) → gera novo profile_id", async () => {
    const kv = makeKv({}); // KV vazio
    const event = makeEvent({ anonymousId: "anon-desconhecido" });

    await resolveIdentityForEvent(event, TENANT, kv as never, null);

    expect(typeof event.payload.profile_id).toBe("string");
    expect(event.payload.profile_id.length).toBeGreaterThan(10);
  });

  it("Regra 5: profile_id explícito no payload → prioridade máxima (não sobrescrever)", async () => {
    const explicito = "profile-explicito-checkout-recovery";
    const kv = makeKv({
      "decole:identity:anon:anon-x": crypto.randomUUID(),
    });
    const event = makeEvent({ anonymousId: "anon-x", email: "alice@example.com", profileId: explicito });

    await resolveIdentityForEvent(event, TENANT, kv as never, null);

    expect(event.payload.profile_id).toBe(explicito);
  });

  it("Regra 6: mesmo email, mesmo device → mesmo profile_id (idempotente)", async () => {
    const existingProfileId = crypto.randomUUID();
    const emailHash = await sha256Hex("alice@example.com");
    const kv = makeKv({
      [`decole:identity:email:${emailHash}`]: existingProfileId,
      "decole:identity:anon:anon-alice": existingProfileId,
    });
    const event = makeEvent({ anonymousId: "anon-alice", email: "alice@example.com" });

    await resolveIdentityForEvent(event, TENANT, kv as never, null);

    expect(event.payload.profile_id).toBe(existingProfileId);
  });

  it("Isolamento cross-tenant: anonymous_id do tenant A não vaza para tenant B", async () => {
    const profileTenantA = crypto.randomUUID();
    // Tenant A tem mapeamento; tenant B é limpo
    const kv = makeKv({
      "tenant-a:identity:anon:anon-compartilhado": profileTenantA,
    });
    const event = makeEvent({ anonymousId: "anon-compartilhado", email: "novo@exemplo.com" });

    await resolveIdentityForEvent(event, "tenant-b", kv as never, null);

    expect(event.payload.profile_id).not.toBe(profileTenantA);
  });
});

// ── Helper SHA-256 (duplicado do worker para os testes) ───────────────────────

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
