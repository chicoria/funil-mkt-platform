function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
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
    var origin = request.headers.get('origin') || '';
    var allowedOrigin = env.ALLOWED_ORIGIN || '*';
    var corsHeaders = {
      'access-control-allow-origin': allowedOrigin === '*' ? '*' : origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (allowedOrigin !== '*' && origin && origin !== allowedOrigin) {
      return jsonResponse({ ok: false, error: 'origin_not_allowed' }, 403, corsHeaders);
    }

    if (request.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, corsHeaders);
    }

    var data = await parseBody(request);
    var email = (data.EMAIL || data.email || '').trim().toLowerCase();
    if (!email) {
      return jsonResponse({ ok: false, error: 'email_required' }, 400, corsHeaders);
    }

    var first = (data.FIRSTNAME || data.first_name || '').trim();
    var last = (data.LASTNAME || data.last_name || '').trim();
    var phone = normalizePhone(data.SMS || data.phone, data.SMS__COUNTRY_CODE || data.country_code);

    var turnstileToken = data['cf-turnstile-response'];
    var ip = request.headers.get('CF-Connecting-IP') || '';
    var turnstileOk = await verifyTurnstile(turnstileToken, ip, env.TURNSTILE_SECRET);
    if (!turnstileOk) {
      return jsonResponse({ ok: false, error: 'captcha_failed' }, 400, corsHeaders);
    }

    var listId = Number(env.BREVO_LIST_ID || '0');
    var payload = {
      email: email,
      updateEnabled: true,
      attributes: {},
    };
    if (listId > 0) payload.listIds = [listId];
    if (first) payload.attributes.FIRSTNAME = first;
    if (last) payload.attributes.LASTNAME = last;
    if (phone) payload.attributes.SMS = phone;

    var brevoResp = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'api-key': env.BREVO_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    if (!brevoResp.ok) {
      var errText = await brevoResp.text();
      return jsonResponse({ ok: false, error: 'brevo_error', detail: errText }, 502, corsHeaders);
    }

    return jsonResponse({ ok: true }, 200, corsHeaders);
  },
};
