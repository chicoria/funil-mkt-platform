import { describe, expect, it, vi } from 'vitest';
import worker from '../../src/index';

// products.{code}.precheckout: regras por produto (ex.: inscrição em workshop exige email e edição).
const CATALOG = JSON.stringify({
  tenants: {
    t: {
      domains: ['api.t.example'],
      allowedOrigins: ['https://t.example'],
      products: {
        T_NEWSLETTER: {},
        T_WORKSHOP: { precheckout: { requireEmail: true, fieldPatterns: { edition: '^[a-z0-9-]{1,40}$', note: '^.*$' } } },
        T_PROTECTED: { precheckout: { requireTurnstile: true } },
      },
    },
  },
});

async function post(body: Record<string, unknown>) {
  const send = vi.fn(async () => {});
  const req = new Request('https://api.t.example/funnel/precheckout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://t.example' },
    body: JSON.stringify(body),
  });
  const res = await worker.fetch(req, { FUNNEL_EVENTS: { send }, CATALOG_JSON: CATALOG } as never);
  return { res, send, json: (await res.json()) as Record<string, unknown> };
}

const registration = { product_code: 'T_WORKSHOP', email: 'pessoa@example.com', edition: '2026-11-mulheres-lisboa', note: 'ok' };

describe('precheckout — regras do produto no catálogo', () => {
  it('aceita inscrição com email e edição válidos e guarda a edição no payload', async () => {
    const { res, send } = await post(registration);
    expect(res.status).toBe(202);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      product_code: 'T_WORKSHOP',
      payload: expect.objectContaining({ edition: '2026-11-mulheres-lisboa' }),
    }));
  });

  it('recusa inscrição sem email', async () => {
    const { res, send, json } = await post({ ...registration, email: undefined });
    expect(res.status).toBe(400);
    expect(json.error).toBe('email_required');
    expect(send).not.toHaveBeenCalled();
  });

  for (const [label, edition] of [
    ['sem edição', undefined],
    ['edição com maiúsculas e espaços', 'Edição Lisboa'],
    ['edição longa demais', 'a'.repeat(41)],
    ['edição não-string', 42],
  ] as const) {
    it('recusa ' + label, async () => {
      const { res, send, json } = await post({ ...registration, edition });
      expect(res.status).toBe(400);
      expect(json.error).toBe('invalid_field');
      expect(json.field).toBe('edition');
      expect(send).not.toHaveBeenCalled();
    });
  }

  it('produto sem regras continua a aceitar lead sem email nem edição', async () => {
    const { res, send } = await post({ product_code: 'T_NEWSLETTER' });
    expect(res.status).toBe(202);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('recusa email mal formatado antes de exigir email', async () => {
    const { res, json } = await post({ ...registration, email: 'sem-arroba' });
    expect(res.status).toBe(400);
    expect(json.error).toBe('invalid_email');
  });

  it('recusa valor acima de 256 caracteres antes de aplicar a regex', async () => {
    const { res, send, json } = await post({ ...registration, note: 'x'.repeat(257) });
    expect(res.status).toBe(400);
    expect(json).toMatchObject({ error: 'invalid_field', field: 'note' });
    expect(send).not.toHaveBeenCalled();
  });

  // Sem o secret do tenant a verificação Turnstile não corre; um produto que a exige fecha em vez de passar.
  it('produto com requireTurnstile recusa quando o tenant não tem secret Turnstile', async () => {
    const { res, send, json } = await post({ product_code: 'T_PROTECTED', email: 'pessoa@example.com' });
    expect(res.status).toBe(503);
    expect(json.error).toBe('turnstile_not_configured');
    expect(send).not.toHaveBeenCalled();
  });
});
