type Obj = Record<string, unknown>;

const FILTERS: Record<string, (v: string) => string> = {
  first_name: (v) => v.split(" ")[0],
  lowercase:  (v) => v.toLowerCase(),
  uppercase:  (v) => v.toUpperCase(),
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
  const [pathPart, ...filterParts] = expr.split("|");
  const path = pathPart.trim();

  if (!path.startsWith("$.")) return null;

  const segments = path.slice(2).split(".");
  let value = resolvePath(obj, segments);

  if (value === null) return null;

  for (const raw of filterParts) {
    const filterName = raw.trim();
    const fn = FILTERS[filterName];
    if (fn && typeof value === "string") {
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
