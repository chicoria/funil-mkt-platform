interface QueueBinding {
  send(message: unknown): Promise<void>;
}

interface Env {
  HOTMART_EVENTS?: QueueBinding;
  HOTMART_WEBHOOK_TOKEN?: string;
}

type InputData = Record<string, unknown>;

interface HotmartQueuedEvent {
  source: "hotmart";
  receivedAt: string;
  eventType: string;
  eventId: string;
  email: string;
  payload: InputData;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function getByPath(data: InputData, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = data;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as InputData)[part];
  }
  return current;
}

function pickString(data: InputData, paths: string[]): string {
  for (const path of paths) {
    const value = asString(getByPath(data, path));
    if (value) return value;
  }
  return "";
}

function bearerToken(request: Request): string {
  const header = asString(request.headers.get("authorization"));
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? asString(match[1]) : "";
}

function isAuthorized(request: Request, env: Env): boolean {
  const requiredToken = asString(env.HOTMART_WEBHOOK_TOKEN);
  if (!requiredToken) return true;

  const url = new URL(request.url);
  const candidates = [
    asString(request.headers.get("x-hotmart-hottok")),
    asString(request.headers.get("x-hotmart-token")),
    asString(request.headers.get("x-webhook-token")),
    bearerToken(request),
    asString(url.searchParams.get("hottok")),
    asString(url.searchParams.get("token")),
  ].filter(Boolean);

  return candidates.some((candidate) => candidate === requiredToken);
}

async function parseBody(request: Request): Promise<InputData> {
  const contentType = asString(request.headers.get("content-type")).toLowerCase();

  if (contentType.includes("application/json")) {
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as InputData;
      }
    } catch {
      return {};
    }
    return {};
  }

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const data: InputData = {};
    form.forEach((value, key) => {
      data[key] = typeof value === "string" ? value : value.name;
    });
    return data;
  }

  const raw = await request.text();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as InputData;
    }
  } catch {
    return { raw };
  }

  return { raw };
}

function buildQueuedEvent(payload: InputData): HotmartQueuedEvent {
  const eventType = pickString(payload, ["event", "event_name", "type", "name", "data.event"]) || "unknown";
  const eventId =
    pickString(payload, ["id", "event_id", "transaction", "transaction_id", "data.id", "data.transaction"]) ||
    crypto.randomUUID();
  const email = pickString(payload, [
    "email",
    "buyer.email",
    "customer.email",
    "data.buyer.email",
    "data.customer.email",
    "data.email",
  ]);

  return {
    source: "hotmart",
    receivedAt: new Date().toISOString(),
    eventType,
    eventId,
    email,
    payload,
  };
}

function logStage(stage: string, details: InputData): void {
  console.log(JSON.stringify({ stage, ...details }));
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname.endsWith("/health")) {
      return jsonResponse({ ok: true, worker: "api-hotmart-webhook" }, 200);
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
    }

    if (!isAuthorized(request, env)) {
      return jsonResponse({ ok: false, error: "unauthorized" }, 401);
    }

    if (!env.HOTMART_EVENTS) {
      return jsonResponse({ ok: false, error: "queue_not_configured" }, 500);
    }

    const payload = await parseBody(request);
    const event = buildQueuedEvent(payload);

    await env.HOTMART_EVENTS.send(event);
    logStage("enqueued", {
      eventType: event.eventType,
      eventId: event.eventId,
      hasEmail: !!event.email,
    });

    return jsonResponse(
      {
        ok: true,
        queued: true,
        eventType: event.eventType,
        eventId: event.eventId,
      },
      202
    );
  },
};

export default worker;
