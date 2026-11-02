import { describe, expect, it, vi } from 'vitest';
import worker from '../../src/index';

// BUG-003: o tipo de evento vem do corpo público; o servidor tem de o restringir por endpoint.
const DECOLE = { host: 'https://api.decolesuacarreiraesg.com.br', origin: 'https://decolesuacarreiraesg.com.br', product: 'DECOLE_PLANOVOO' };
// Product Engineer está no catálogo commitado; o teste não depende de configuração por commitar.
const PE = { host: 'https://api.theproductengineer.net', origin: 'https://theproductengineer.net', product: 'PRODUCT_ENGINEER_NEWSLETTER' };

async function post(base: typeof DECOLE, path: string, body: Record<string, unknown>, withOrigin = true, contentType = 'application/json') {
  const send = vi.fn(async () => {});
  const headers: Record<string, string> = { 'Content-Type': contentType };
  if (withOrigin) headers.Origin = base.origin;
  const req = new Request(base.host + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const res = await worker.fetch(req, { FUNNEL_EVENTS: { send } } as never);
  return { res, send, json: (await res.json()) as Record<string, unknown> };
}

const lead = { EMAIL: 'pessoa@example.com', FIRSTNAME: 'Pessoa', product_code: DECOLE.product };

describe('BUG-003 /funnel/precheckout só aceita GENERATE_LEAD', () => {
  for (const [label, extra] of [
    ['event_type de compra', { event_type: 'PURCHASE_APPROVED' }],
    ['event com caixa e pontuação', { event: 'purchase-approved' }],
    ['type de checkout', { type: 'begin checkout' }],
    ['SIGN_UP', { event_type: 'SIGN_UP' }],
    ['PRECHECKOUT_SUBMIT_SUCCESS', { event_type: 'PRECHECKOUT_SUBMIT_SUCCESS' }],
  ] as const) {
    it('recusa ' + label + ' sem enfileirar', async () => {
      const { res, send, json } = await post(DECOLE, '/funnel/precheckout', { ...lead, ...extra });
      expect(res.status).toBe(400);
      expect(json.error).toBe('invalid_event_type');
      expect(send).not.toHaveBeenCalled();
    });
  }

  it('recusa também sem cabeçalho Origin', async () => {
    const { res, send } = await post(DECOLE, '/funnel/precheckout', { ...lead, event_type: 'PURCHASE_APPROVED' }, false);
    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  // Emissores reais: DECOLE ESG / Plano de Voo / Product Engineer enviam GENERATE_LEAD; Entrepontos omite o tipo.
  for (const [label, base, body] of [
    ['DECOLE com event_type GENERATE_LEAD', DECOLE, { ...lead, event_type: 'GENERATE_LEAD' }],
    ['formulário sem tipo', PE, { EMAIL: 'adulto@example.com', product_code: PE.product }],
    ['tipo com caixa e pontuação', PE, { EMAIL: 'adulto@example.com', product_code: PE.product, event_type: 'generate-lead' }],
  ] as const) {
    it('aceita ' + label, async () => {
      const { res, send } = await post(base, '/funnel/precheckout', body);
      expect(res.status).toBe(202);
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'GENERATE_LEAD' }));
    });
  }
});

describe('BUG-003 /funnel/event só aceita eventos públicos do browser', () => {
  // GENERATE_LEAD só entra pelo precheckout (validação de e-mail e Turnstile por tenant).
  for (const type of ['PURCHASE_APPROVED', 'purchase.approved', 'BEGIN_CHECKOUT', 'SIGN_UP', 'PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK', 'GENERATE_LEAD']) {
    it('recusa ' + type, async () => {
      const { res, send, json } = await post(DECOLE, '/funnel/event', { event_type: type, product_code: DECOLE.product, email: 'pessoa@example.com' });
      expect(res.status).toBe(400);
      expect(json.error).toBe('invalid_event_type');
      expect(send).not.toHaveBeenCalled();
    });
  }

  // PAGE_VIEW (omitido) e o beacon ENGAGEMENT_SNAPSHOT da DECOLE.
  for (const body of [
    { product_code: DECOLE.product },
    { event_type: 'ENGAGEMENT_SNAPSHOT', product_code: DECOLE.product, session_id: 's1' },
  ]) {
    it('aceita ' + ((body as Record<string, unknown>).event_type || 'PAGE_VIEW'), async () => {
      const { res, send } = await post(DECOLE, '/funnel/event', body);
      expect(res.status).toBe(202);
      expect(send).toHaveBeenCalledTimes(1);
    });
  }

  // navigator.sendBeacon com string chega como text/plain (decolesuacarreiraesg/site/src/engagement/index.ts).
  it('aceita o beacon ENGAGEMENT_SNAPSHOT enviado como text/plain', async () => {
    const { res, send } = await post(DECOLE, '/funnel/event', { event_type: 'ENGAGEMENT_SNAPSHOT', product_code: DECOLE.product }, true, 'text/plain;charset=UTF-8');
    expect(res.status).toBe(202);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'ENGAGEMENT_SNAPSHOT', product_code: DECOLE.product }));
  });

  it('recusa compra sem Origin e em urlencoded', async () => {
    const send = vi.fn(async () => {});
    const req = new Request(DECOLE.host + '/funnel/event', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ event_type: 'PURCHASE_APPROVED', product_code: DECOLE.product }) });
    const res = await worker.fetch(req, { FUNNEL_EVENTS: { send } } as never);
    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('recusa pedido sem produto', async () => {
    const { res, send } = await post(DECOLE, '/funnel/event', { event_type: 'PAGE_VIEW' });
    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('recusa produto de outro tenant', async () => {
    const { res, send, json } = await post(DECOLE, '/funnel/event', { product_code: PE.product });
    expect(res.status).toBe(400);
    expect(json.error).toBe('unknown_product');
    expect(send).not.toHaveBeenCalled();
  });
});
