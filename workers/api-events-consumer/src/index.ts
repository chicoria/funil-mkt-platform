interface Env {
  BREVO_API_KEY?: string;
  BREVO_LIST_BEGIN_CHECKOUT?: string;
  BREVO_LIST_PURCHASE?: string;
  BREVO_LIST_CART_ABANDONMENT?: string;
}

interface HotmartQueuedEvent {
  source?: string;
  eventType?: string;
  eventId?: string;
  email?: string;
  payload?: Record<string, unknown>;
}

interface QueueMessage<T> {
  body: T;
}

interface MessageBatch<T> {
  messages: Array<QueueMessage<T>>;
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

function getByPath(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = data;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function eventTypeNormalized(eventType: string): string {
  return eventType.toLowerCase().replace(/\s+/g, "_");
}

function resolveEmail(event: HotmartQueuedEvent): string {
  const direct = asString(event.email);
  if (direct) return direct;

  const payload = event.payload || {};
  const paths = ["email", "buyer.email", "customer.email", "data.buyer.email", "data.customer.email", "data.email"];

  for (const path of paths) {
    const value = asString(getByPath(payload, path));
    if (value) return value;
  }

  return "";
}

function resolveListId(eventType: string, env: Env): number {
  const type = eventTypeNormalized(eventType);

  if (type.includes("purchase_out_of_shopping_cart") || type.includes("cart_abandon")) {
    return Number(env.BREVO_LIST_CART_ABANDONMENT || env.BREVO_LIST_BEGIN_CHECKOUT || "0");
  }

  if (type.includes("begin_checkout") || type.includes("checkout_started")) {
    return Number(env.BREVO_LIST_BEGIN_CHECKOUT || "0");
  }

  if (
    type.includes("purchase_approved") ||
    type.includes("purchase_complete") ||
    type.includes("purchase") ||
    type.includes("approved")
  ) {
    return Number(env.BREVO_LIST_PURCHASE || "0");
  }

  return 0;
}

async function upsertContactToList(email: string, listId: number, apiKey: string): Promise<void> {
  if (!apiKey) {
    throw new Error("BREVO_API_KEY not configured");
  }

  const response = await fetch("https://api.brevo.com/v3/contacts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      email,
      updateEnabled: true,
      listIds: [listId],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Brevo API failed (${response.status}): ${detail.slice(0, 500)}`);
  }
}

async function processEvent(event: HotmartQueuedEvent, env: Env): Promise<boolean> {
  const eventType = asString(event.eventType);
  if (!eventType) {
    console.log(JSON.stringify({ stage: "skip", reason: "missing_event_type", eventId: event.eventId || "" }));
    return false;
  }

  const email = resolveEmail(event);
  if (!email) {
    console.log(JSON.stringify({ stage: "skip", reason: "missing_email", eventType }));
    return false;
  }

  const listId = resolveListId(eventType, env);
  if (listId <= 0) {
    console.log(
      JSON.stringify({ stage: "skip", reason: "event_not_mapped", eventType, eventId: event.eventId || "" })
    );
    return false;
  }

  await upsertContactToList(email, listId, asString(env.BREVO_API_KEY));
  console.log(JSON.stringify({ stage: "processed", eventType, eventId: event.eventId || "", email, listId }));
  return true;
}

const worker = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname.endsWith("/health")) {
      return jsonResponse({ ok: true, worker: "api-events-consumer" }, 200);
    }

    return jsonResponse({ ok: false, error: "not_found" }, 404);
  },

  async queue(batch: MessageBatch<HotmartQueuedEvent>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      await processEvent(message.body || {}, env);
    }
  },
};

export default worker;
