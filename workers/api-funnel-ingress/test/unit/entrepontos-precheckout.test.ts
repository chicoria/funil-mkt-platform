import { describe, expect, it, vi } from 'vitest';
import worker from '../../src/index';

describe('Entrepontos precheckout', () => {
 for(const product of ['ENTREPONTOS_MULHERES','ENTREPONTOS_KIDS']){
  it('enfileira '+product+' sem devolver confirmação com PII na URL',async()=>{
   const send=vi.fn(async()=>{});
   const req=new Request('https://api.entrepontos.club/funnel/precheckout',{method:'POST',headers:{Origin:'https://entrepontos.club','Content-Type':'application/json'},body:JSON.stringify({EMAIL:'adulto@example.com',FIRSTNAME:'Adulto',product_code:product})});
   const res=await worker.fetch(req,{FUNNEL_EVENTS:{send}} as never);
   const body=await res.json() as Record<string,unknown>;
   expect(res.status).toBe(202);expect(body.redirect_url).toBeUndefined();
   expect(send).toHaveBeenCalledWith(expect.objectContaining({tenant_id:'entrepontos',product_code:product,lead:expect.objectContaining({email:'adulto@example.com'})}));
  });
 }
 // BUG-002: corpo sem e-mail válido ou com produto desconhecido não pode virar evento UNKNOWN_PRODUCT.
 for(const [label,body,error] of [
  ['corpo vazio',{},'unknown_product'],
  ['e-mail inválido',{EMAIL:'x',product_code:'ENTREPONTOS_KIDS'},'invalid_email'],
  ['e-mail não string',{email:123,product_code:'ENTREPONTOS_KIDS'},'invalid_email'],
  ['e-mail em branco com EMAIL inválido',{email:' ',EMAIL:'x',product_code:'ENTREPONTOS_KIDS'},'invalid_email'],
  ['sem produto',{EMAIL:'adulto@example.com'},'unknown_product'],
  ['produto de outro tenant',{EMAIL:'adulto@example.com',product_code:'DECOLE_PLANOVOO'},'unknown_product'],
 ] as const){
  it('recusa '+label,async()=>{
   const send=vi.fn(async()=>{});
   const req=new Request('https://api.entrepontos.club/funnel/precheckout',{method:'POST',headers:{Origin:'https://entrepontos.club','Content-Type':'application/json'},body:JSON.stringify(body)});
   const res=await worker.fetch(req,{FUNNEL_EVENTS:{send}} as never);
   const json=await res.json() as Record<string,unknown>;
   expect(res.status).toBe(400);expect(json.error).toBe(error);expect(send).not.toHaveBeenCalled();
  });
 }
 it('recusa origem de outro tenant',async()=>{
  const send=vi.fn(async()=>{});
  const req=new Request('https://api.entrepontos.club/funnel/precheckout',{method:'POST',headers:{Origin:'https://theproductengineer.net','Content-Type':'application/json'},body:JSON.stringify({EMAIL:'adulto@example.com',product_code:'ENTREPONTOS_KIDS'})});
  const res=await worker.fetch(req,{FUNNEL_EVENTS:{send}} as never);expect(res.status).toBe(403);expect(send).not.toHaveBeenCalled();
 });
});
