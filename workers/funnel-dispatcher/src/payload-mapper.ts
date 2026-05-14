type Obj = Record<string, unknown>;

const FILTERS: Record<string, (v: unknown) => unknown> = {
  first_name: (v) => (typeof v === "string" ? v.split(" ")[0] : v),
  lowercase:  (v) => (typeof v === "string" ? v.toLowerCase() : v),
  uppercase:  (v) => (typeof v === "string" ? v.toUpperCase() : v),
  format_brl: (v) => {
    const value = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(value)) return v;
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  },
  date_br: (v) => {
    if (typeof v !== "string" && typeof v !== "number") return v;
    const date = new Date(v);
    if (Number.isNaN(date.getTime())) return v;
    return date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  },
};

function resolvePath(obj: unknown, segments: string[]): unknown {
  let current: unknown = obj;
  for (const seg of segments) {
    if (current === null || current === undefined || typeof current !== "object") return null;
    current = (current as Obj)[seg];
  }
  return current ?? null;
}

export function mapValue(obj: unknown, expr: string): unknown {
  const fallbackParts = expr.split("??").map((part) => part.trim()).filter(Boolean);
  if (fallbackParts.length > 1) {
    for (const part of fallbackParts) {
      const value = mapValue(obj, part);
      if (value !== null && value !== undefined && value !== "") return value;
    }
    return null;
  }

  const [pathPart, ...filterParts] = expr.split("|");
  const path = pathPart.trim();

  if (!path.startsWith("$.")) return null;

  const segments = path.slice(2).split(".");
  let value = resolvePath(obj, segments);

  if (value === null) return null;

  for (const raw of filterParts) {
    const filterName = raw.trim();
    const fn = FILTERS[filterName];
    if (fn) {
      value = fn(value);
    }
  }

  return value;
}

export function mapPayload(obj: unknown, mapping: Record<string, string>): Obj {
  const result: Obj = {};
  for (const [key, expr] of Object.entries(mapping)) {
    const value = mapValue(obj, expr);
    if (value !== null) {
      result[key] = value;
    }
  }
  return result;
}

// Placeholders use plain dot-paths (no $. prefix), since the context is a known local object, not event data.
export function interpolate(template: string, context: unknown): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path: string) => {
    const segments = path.trim().split(".");
    const value = resolvePath(context, segments);
    if (value === null || value === undefined) return "";
    return String(value);
  });
}
