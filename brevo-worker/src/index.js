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
    var attributes = {};
    if (first) attributes.FIRSTNAME = first;
    if (last) attributes.LASTNAME = last;
    if (phone) attributes.SMS = phone;

    var doiTemplateId = Number(env.BREVO_DOI_TEMPLATE_ID || '0');
    var doiRedirectUrl = (env.BREVO_DOI_REDIRECT_URL || '').trim();
    var useDoi = doiTemplateId > 0 && doiRedirectUrl;

    var endpoint = useDoi
      ? 'https://api.brevo.com/v3/contacts/doubleOptinConfirmation'
      : 'https://api.brevo.com/v3/contacts';

    var payload = useDoi
      ? {
          email: email,
          includeListIds: listId > 0 ? [listId] : [],
          redirectionUrl: doiRedirectUrl,
          templateId: doiTemplateId,
          attributes: attributes,
        }
      : {
          email: email,
          updateEnabled: true,
          attributes: attributes,
          listIds: listId > 0 ? [listId] : undefined,
        };

    var brevoResp = await fetch(endpoint, {
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

    var postSubmitRedirect = (env.POST_SUBMIT_REDIRECT_URL || env.BREVO_DOI_REDIRECT_URL || '').trim();
    if (postSubmitRedirect) {
      return Response.redirect(postSubmitRedirect, 303);
    }

    return jsonResponse({ ok: true, doi: useDoi }, 200, corsHeaders);
  },
};
