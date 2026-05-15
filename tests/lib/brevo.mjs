#!/usr/bin/env node
import { poll } from "./wait.mjs";

const DEFAULT_BREVO_BASE_URL = "https://api.brevo.com/v3";

function brevoApiKey() {
  return process.env.BREVO_API_KEY_DECOLE || process.env.BREVO_API_KEY || "";
}

function brevoBaseUrl() {
  return (process.env.BREVO_BASE_URL || DEFAULT_BREVO_BASE_URL).replace(/\/+$/, "");
}

async function brevoGet(path, params = {}) {
  const apiKey = brevoApiKey();
  if (!apiKey) {
    throw new Error("missing_required_env: BREVO_API_KEY_DECOLE or BREVO_API_KEY");
  }

  const url = new URL(`${brevoBaseUrl()}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      "api-key": apiKey,
      accept: "application/json",
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`brevo_get_failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

export async function getTransactionalEmails(params = {}) {
  return brevoGet("/smtp/emails", params);
}

export async function getTransactionalEmailContent(uuid) {
  if (!uuid) throw new Error("missing_brevo_uuid");
  return brevoGet(`/smtp/emails/${encodeURIComponent(uuid)}`);
}

export async function waitForTransactionalEmail(email, opts = {}) {
  const {
    templateId,
    timeout = 120000,
    interval = 5000,
    description = `brevo email ${email}`,
  } = opts;

  return poll(async () => {
    const result = await getTransactionalEmails({
      email,
      ...(templateId ? { templateId } : {}),
      sort: "desc",
      limit: 10,
    });
    const emails = Array.isArray(result.transactionalEmails) ? result.transactionalEmails : [];
    return emails.find((entry) => {
      if (entry.email !== email) return false;
      if (templateId && Number(entry.templateId) !== Number(templateId)) return false;
      return Boolean(entry.uuid);
    }) || null;
  }, { timeout, interval, description });
}
