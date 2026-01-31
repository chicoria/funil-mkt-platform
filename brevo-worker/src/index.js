/**
 * Retorna uma resposta JSON com o corpo, status e headers especificados.
 */
function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
  });
}

function normalizePhone(rawPhone, rawCountry) {
  if (!rawPhone) return '';
  var digits = String(rawPhone).replace(/\D+/g, '');
  var country = String(rawCountry || '').replace(/\D+/g, '');
  if (country && digits.indexOf(country) !== 0) {
    digits = country + digits;
  }
  return digits;
}

function buildCorsHeaders(allowedOrigin, origin) {
  return {
    'access-control-allow-origin': allowedOrigin === '*' ? '*' : origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-brevo-ajax',
    'access-control-max-age': '86400',
  };
}

function logStage(reqId, stage, data) {
  var payload = Object.assign({ reqId: reqId, stage: stage }, data || {});
  console.log(JSON.stringify(payload));
}

function isOriginAllowed(allowedOrigin, origin) {
  if (allowedOrigin === '*') return true;
  if (!origin) return true;
  return origin === allowedOrigin;
}

function getRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return String(Date.now()) + '-' + Math.random().toString(16).slice(2);
}

function normalizeLeadInput(data) {
  var email = (data.EMAIL || data.email || '').trim().toLowerCase();
  var first = (data.FIRSTNAME || data.first_name || '').trim();
  var last = (data.LASTNAME || data.last_name || '').trim();
  var phoneCountry = (data.SMS__COUNTRY_CODE || data.country_code || '').trim();
  var phone = normalizePhone(data.SMS || data.phone, phoneCountry);
  var leadId = (data.LEAD_ID || data.lead_id || '').trim();

  return {
    email: email,
    first: first,
    last: last,
    phoneCountry: phoneCountry,
    phone: phone,
    leadId: leadId,
  };
}

function buildAttributes(lead) {
  var attributes = {};
  if (lead.first) attributes.FIRSTNAME = lead.first;
  if (lead.last) attributes.LASTNAME = lead.last;
  if (lead.phone) attributes.SMS = lead.phone;
  if (lead.leadId) attributes.LEAD_ID = lead.leadId;
  return attributes;
}

function buildRedirectUrl(baseUrl, params) {
  if (!baseUrl) return '';
  var url;
  try {
    url = new URL(baseUrl);
  } catch (err) {
    return baseUrl;
  }
  Object.keys(params || {}).forEach(function (key) {
    var value = params[key];
    if (value === undefined || value === null || value === '') return;
    if (url.searchParams.has(key)) return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

function parseCookies(cookieHeader) {
  var output = {};
  if (!cookieHeader) return output;
  cookieHeader.split(';').forEach(function (pair) {
    var idx = pair.indexOf('=');
    if (idx === -1) return;
    var key = pair.slice(0, idx).trim();
    var value = pair.slice(idx + 1).trim();
    if (!key) return;
    output[key] = decodeURIComponent(value);
  });
  return output;
}

function extractMetaIds(data, cookieHeader) {
  var cookies = parseCookies(cookieHeader);
  var fbp = (data.FBP || data.fbp || data._fbp || '').trim();
  if (!fbp) fbp = cookies._fbp || '';
  var fbc = (data.FBC || data.fbc || data._fbc || '').trim();
  if (!fbc) fbc = cookies._fbc || '';
  var fbclid = (data.FBCLID || data.fbclid || '').trim();
  return {
    fbp: fbp,
    fbc: fbc,
    fbclid: fbclid,
  };
}

function getDoiConfig(env, leadId, metaIds) {
  var templateId = Number(env.BREVO_DOI_TEMPLATE_ID || '0');
  var baseRedirect = (env.BREVO_DOI_REDIRECT_URL || '').trim();
  var redirectUrl = buildRedirectUrl(baseRedirect, {
    lead_id: leadId || undefined,
    fbp: metaIds && metaIds.fbp ? metaIds.fbp : undefined,
    fbc: metaIds && metaIds.fbc ? metaIds.fbc : undefined,
    fbclid: metaIds && metaIds.fbclid ? metaIds.fbclid : undefined,
  });
  var useDoi = templateId > 0 && redirectUrl;
  return {
    templateId: templateId,
    redirectUrl: redirectUrl,
    useDoi: useDoi,
  };
}

function buildBrevoRequest(email, attributes, listId, doiConfig) {
  var endpoint = doiConfig.useDoi
    ? 'https://api.brevo.com/v3/contacts/doubleOptinConfirmation'
    : 'https://api.brevo.com/v3/contacts';

  var payload = doiConfig.useDoi
    ? {
        email: email,
        includeListIds: listId > 0 ? [listId] : [],
        redirectionUrl: doiConfig.redirectUrl,
        templateId: doiConfig.templateId,
        attributes: attributes,
      }
    : {
        email: email,
        updateEnabled: true,
        attributes: attributes,
        listIds: listId > 0 ? [listId] : undefined,
      };

  return {
    endpoint: endpoint,
    payload: payload,
  };
}

function parseBrevoError(payloadText) {
  var parsed = null;
  try {
    parsed = JSON.parse(payloadText);
  } catch (err) {
    return { code: '', message: payloadText || '' };
  }
  return {
    code: parsed && parsed.code ? String(parsed.code) : '',
    message: parsed && parsed.message ? String(parsed.message) : payloadText || '',
  };
}

async function sendBrevo(requestConfig, apiKey) {
  return fetch(requestConfig.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(requestConfig.payload),
  });
}

async function parseBody(request) {
  var contentType = request.headers.get('content-type') || '';
  if (contentType.indexOf('application/json') !== -1) {
    return request.json();
  }
  var form = await request.formData();
  var data = {};
  form.forEach(function (value, key) {
    data[key] = value;
  });
  return data;
}

async function verifyTurnstile(token, ip, secret) {
  if (!secret) return true;
  if (!token) return false;
  var resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({
      secret: secret,
      response: token,
      remoteip: ip || '',
    }),
  });
  var json = await resp.json();
  return !!json.success;
}

export default {
  async fetch(request, env) {
    var reqId = getRequestId();
    var startedAt = Date.now();
    var origin = request.headers.get('origin') || '';
    var allowedOrigin = env.ALLOWED_ORIGIN || '*';
    var corsHeaders = buildCorsHeaders(allowedOrigin, origin);

    if (request.method === 'OPTIONS') {
      logStage(reqId, 'preflight', { ok: true, origin: origin });
      return new Response(null, { headers: corsHeaders });
    }

    if (!isOriginAllowed(allowedOrigin, origin)) {
      logStage(reqId, 'origin_check', {
        ok: false,
        origin: origin,
        allowedOrigin: allowedOrigin,
      });
      return jsonResponse({ ok: false, error: 'origin_not_allowed' }, 403, corsHeaders);
    }

    if (request.method !== 'POST') {
      logStage(reqId, 'method_check', { ok: false, method: request.method });
      return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, corsHeaders);
    }

    var data = await parseBody(request);
    var metaIds = extractMetaIds(data, request.headers.get('cookie') || '');
    var lead = normalizeLeadInput(data);
    if (!lead.email) {
      logStage(reqId, 'validate', { ok: false, reason: 'no_email' });
      return jsonResponse({ ok: false, error: 'email_required' }, 400, corsHeaders);
    }

    logStage(reqId, 'parsed', {
      ok: true,
      hasFirst: !!lead.first,
      hasLast: !!lead.last,
      hasPhone: !!lead.phone,
    });

    var turnstileToken = data['cf-turnstile-response'];
    var ip = request.headers.get('CF-Connecting-IP') || '';
    var turnstileOk = await verifyTurnstile(turnstileToken, ip, env.TURNSTILE_SECRET);
    if (!turnstileOk) {
      logStage(reqId, 'turnstile', { ok: false });
      return jsonResponse({ ok: false, error: 'captcha_failed' }, 400, corsHeaders);
    }
    logStage(reqId, 'turnstile', { ok: true });

    var listId = Number(env.BREVO_LIST_ID || '0');
    var attributes = buildAttributes(lead);
    var doiConfig = getDoiConfig(env, lead.leadId, metaIds);
    logStage(reqId, 'doi_check', {
      ok: true,
      useDoi: doiConfig.useDoi,
      listId: listId,
    });

    var brevoRequest = buildBrevoRequest(lead.email, attributes, listId, doiConfig);

    var brevoResp = await sendBrevo(brevoRequest, env.BREVO_API_KEY);
    if (!brevoResp.ok) {
      var errText = await brevoResp.text();
      var err = parseBrevoError(errText);
      logStage(reqId, 'brevo', { ok: false, status: brevoResp.status, code: err.code });
      return jsonResponse(
        {
          ok: false,
          error: 'brevo_error',
          code: err.code || undefined,
          message: err.message || errText || 'Brevo error',
          detail: errText || undefined,
        },
        brevoResp.status,
        corsHeaders
      );
    }

    logStage(reqId, 'brevo', { ok: true, status: brevoResp.status });

    logStage(reqId, 'done', { ok: true, ms: Date.now() - startedAt });
    return jsonResponse({ ok: true, doi: doiConfig.useDoi }, 200, corsHeaders);
  },
};
