import { describe, expect, it } from 'vitest';
import catalog from '../../../../config/products.catalog.json';
import { tryResolveTenantIdFromHostname } from '../../src/tenant-from-hostname';
import { getTenantAllowedOrigins, getTenantTracking } from '../../src/catalog-v5';

type Event = { eventType: string; chain?: string[]; brevoConfig?: {listId: string; doiIdentity: boolean} };
type Tenant = {products: Record<string, {hotmart?: unknown; funnelEventArchitecture: {events: Event[]}}>;
 links: {routes: {path: string; type: string; productCode: string}[]}};
describe('Entrepontos: isolamento operacional do catálogo', () => {
 it('resolve hosts exatos, origens e tracking próprios', () => {
  for(const host of ['entrepontos.club','www.entrepontos.club','api.entrepontos.club','links.entrepontos.club'])
   expect(tryResolveTenantIdFromHostname(host,catalog)).toBe('entrepontos');
  expect(tryResolveTenantIdFromHostname('entrepontos.club.evil.test',catalog)).toBeUndefined();
  expect(getTenantAllowedOrigins(catalog,'entrepontos')).toEqual(['https://entrepontos.club','https://www.entrepontos.club']);
  expect(getTenantTracking(catalog,'entrepontos')?.ga4?.measurementId).toBe('G-HLHGEBP2H0');
 });
 it('mantém DOI, lista e confirmação separados por público sem checkout', () => {
  const tenant=(catalog.tenants as unknown as Record<string,Tenant>).entrepontos;
  expect(tenant).toBeDefined();
  for(const [code,list,path]of [['ENTREPONTOS_MULHERES','2','/mulheres/confirmado'],['ENTREPONTOS_KIDS','4','/kids/confirmado']]){
   const p=tenant.products[code];const lead=p.funnelEventArchitecture.events.find(e=>e.eventType==='GENERATE_LEAD');
   expect(lead?.chain).toContain('send_brevo_doi');expect(lead?.brevoConfig?.listId).toBe(list);
   expect(lead?.brevoConfig?.doiIdentity).toBe(true);expect(lead?.chain).not.toContain('emit_tracking');
   const signup=p.funnelEventArchitecture.events.find(e=>e.eventType==='SIGN_UP');
   expect(signup?.chain).not.toContain('emit_tracking');
   expect(signup?.chain).toContain('upsert_event_store');
   expect(p.hotmart).toBeUndefined();expect(tenant.links.routes.find(r=>r.productCode===code)).toMatchObject({path,type:'doi_confirmation'});
  }
 });
});

type WsProduct = {
 hotmart?: unknown; precheckout?: {requireEmail?: boolean; requireTurnstile?: boolean; fieldPatterns?: Record<string,string>};
 tracking: {differentiation: {produto: string}; metaPixel: {pixelId: string}};
 brevo: {funnelFields: {steps: string; lastStep: string; lastStepTimestamp: string}; doiFlows?: unknown};
 funnelEventArchitecture: {events: {eventType: string; chain?: string[]; brevoConfig?: {listId?: string; directListIds?: string[]}}[]}};
describe('Entrepontos: inscrição em workshop é produto próprio', () => {
 const products=(catalog.tenants as unknown as Record<string,{products: Record<string,WsProduct>}>).entrepontos.products;
 const cases=[['ENTREPONTOS_WORKSHOP_MULHERES','5','EP_WS_MULHERES','ENTREPONTOS_MULHERES'],
  ['ENTREPONTOS_WORKSHOP_KIDS','6','EP_WS_KIDS','ENTREPONTOS_KIDS']] as const;
 for(const [code,list,prefix,audience] of cases) it(code+' entra na lista '+list+' sem DOI e sem tracking no servidor',()=>{
  const p=products[code];expect(p).toBeDefined();
  const lead=p.funnelEventArchitecture.events.find(e=>e.eventType==='GENERATE_LEAD');
  expect(lead?.chain).toEqual(['resolve_identity','upsert_event_store','update_brevo_funnel']);
  expect(lead?.brevoConfig?.directListIds).toEqual([list]);expect(lead?.brevoConfig?.listId).toBeUndefined();
  expect(p.brevo.doiFlows).toBeUndefined();expect(p.hotmart).toBeUndefined();
  expect(p.brevo.funnelFields).toEqual({steps:prefix+'_FUNIL_STEPS',lastStep:prefix+'_FUNIL_LAST_STEP',lastStepTimestamp:prefix+'_FUNIL_LAST_STEP_TIMESTAMP'});
  expect(p.precheckout).toEqual({requireEmail:true,requireTurnstile:true,fieldPatterns:{edition:'^[a-z0-9-]{1,40}$'}});
  expect((p.brevo as {lists?: {registration?: {id: string}}}).lists?.registration?.id).toBe(list);
  expect(p.tracking.differentiation.produto).toBe(code);
  expect(p.tracking.metaPixel.pixelId).toBe(products[audience].tracking.metaPixel.pixelId);
 });
 it('listas e campos Brevo não se repetem entre os 4 produtos',()=>{
  const codes=['ENTREPONTOS_MULHERES','ENTREPONTOS_KIDS',...cases.map(c=>c[0])];
  const lists=codes.flatMap(c=>products[c].funnelEventArchitecture.events.flatMap(e=>[e.brevoConfig?.listId,...(e.brevoConfig?.directListIds||[])]).filter(Boolean));
  expect(new Set(lists).size).toBe(lists.length);
  const steps=codes.map(c=>products[c].brevo.funnelFields.steps);expect(new Set(steps).size).toBe(4);
 });
});

describe('Catálogo: precheckout.fieldPatterns', () => {
 it('todas as regex compilam (regex inválida daria 500 em todos os pedidos do produto)', () => {
  const tenants=catalog.tenants as unknown as Record<string,{products?: Record<string,{precheckout?: {fieldPatterns?: Record<string,string>}}>}>;
  for(const t of Object.values(tenants)) for(const p of Object.values(t.products||{}))
   for(const pattern of Object.values(p.precheckout?.fieldPatterns||{})) expect(()=>new RegExp(pattern)).not.toThrow();
 });
});
