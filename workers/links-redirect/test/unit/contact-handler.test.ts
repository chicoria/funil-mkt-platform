import { describe, expect, it } from "vitest";
import { resolveContact } from "../../src/index";

const miniCatalog = {
  tenants: {
    decole: {
      links: {
        contacts: {
          "elizete-wp": {
            type: "whatsapp",
            number: "351915787088",
            defaultText: "Olá Elizete, estou no site e tenho uma dúvida.",
          },
        },
      },
    },
  },
} as const;

describe("resolveContact", () => {
  it("resolve elizete-wp para o tenant decole", () => {
    const contact = resolveContact(miniCatalog, "decole", "elizete-wp");
    expect(contact).not.toBeNull();
    expect(contact?.type).toBe("whatsapp");
    expect(contact?.number).toBe("351915787088");
    expect(contact?.defaultText).toContain("Elizete");
  });

  it("retorna null para slug inexistente no tenant", () => {
    const contact = resolveContact(miniCatalog, "decole", "contato-inexistente");
    expect(contact).toBeNull();
  });

  it("retorna null para tenant desconhecido (isolamento cross-tenant)", () => {
    const contact = resolveContact(miniCatalog, "superare-test", "elizete-wp");
    expect(contact).toBeNull();
  });

  it("retorna null quando tenant nao tem secao links.contacts", () => {
    const catalogSemContatos = { tenants: { decole: { links: {} } } } as const;
    const contact = resolveContact(catalogSemContatos as never, "decole", "elizete-wp");
    expect(contact).toBeNull();
  });
});
