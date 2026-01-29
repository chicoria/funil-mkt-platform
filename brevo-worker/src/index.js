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

function getAreaCodeLength(country, national) {
  if (country === '55') return 2; // Brazil
  if (country === '1') return 3; // USA/Canada
  if (country === '351') return 2; // Portugal
  if (country === '44') return 2; // UK (best-effort)
  if (country === '33') return 1; // France
  if (country === '34') return 2; // Spain
  if (country === '39') return 2; // Italy
  if (country === '49') return 3; // Germany
  if (country === '31') return 2; // Netherlands
  if (country === '32') return 2; // Belgium
  if (country === '41') return 2; // Switzerland
  if (country === '43') return 2; // Austria
  if (country === '46') return 2; // Sweden
  if (country === '47') return 2; // Norway
  if (country === '45') return 2; // Denmark
  if (country === '353') return 2; // Ireland
  if (country === '358') return 2; // Finland
  if (country === '48') return 2; // Poland
  if (country === '420') return 2; // Czech Republic
  if (country === '421') return 2; // Slovakia
  if (country === '30') return 2; // Greece
  if (country === '90') return 3; // Turkey
  if (country === '7') return 3; // Russia/Kazakhstan
  if (country === '380') return 2; // Ukraine
  if (country === '40') return 2; // Romania
  if (country === '36') return 2; // Hungary
  if (country === '81') {
    if (national.length === 10) {
      if (national[0] === '3' || national[0] === '6') return 1; // Tokyo/Osaka
      if (national.indexOf('70') === 0 || national.indexOf('80') === 0 || national.indexOf('90') === 0) {
        return 2; // Mobile prefixes
      }
      return 2;
    }
    if (national.length === 9) {
      if (national[0] === '3' || national[0] === '6') return 1;
      return 2;
    }
    return 2;
  }
  if (national.length === 9) return 2;
  if (national.length === 10) return 3;
  if (national.length === 8) return 2;
  return 0;
}

function splitPhoneForHotmart(phoneDigits, rawCountry) {
  var digits = String(phoneDigits || '').replace(/\D+/g, '');
  if (!digits) return { phoneac: '', phonenumber: '' };
  var country = String(rawCountry || '').replace(/\D+/g, '');
  if (country && digits.indexOf(country) === 0) {
    digits = digits.slice(country.length);
  }
  var areaLen = getAreaCodeLength(country, digits);
  if (!areaLen || digits.length <= areaLen) {
    return { phoneac: '', phonenumber: digits };
  }
  return { phoneac: digits.slice(0, areaLen), phonenumber: digits.slice(areaLen) };
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
    var reqId =
      (typeof crypto !== 'undefined' && crypto.randomUUID && crypto.randomUUID()) ||
      String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    var startedAt = Date.now();
    var origin = request.headers.get('origin') || '';
    var allowedOrigin = env.ALLOWED_ORIGIN || '*';
    var corsHeaders = {
      'access-control-allow-origin': allowedOrigin === '*' ? '*' : origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    };

    if (request.method === 'OPTIONS') {
      console.log(
        JSON.stringify({ reqId: reqId, stage: 'preflight', origin: origin, ok: true })
      );
      return new Response(null, { headers: corsHeaders });
    }

    if (allowedOrigin !== '*' && origin && origin !== allowedOrigin) {
      console.log(
        JSON.stringify({
          reqId: reqId,
          stage: 'origin_check',
          ok: false,
          origin: origin,
          allowedOrigin: allowedOrigin,
        })
      );
      return jsonResponse({ ok: false, error: 'origin_not_allowed' }, 403, corsHeaders);
    }

    if (request.method !== 'POST') {
      console.log(
        JSON.stringify({
          reqId: reqId,
          stage: 'method_check',
          ok: false,
          method: request.method,
        })
      );
      return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, corsHeaders);
    }

    var data = await parseBody(request);
    var email = (data.EMAIL || data.email || '').trim().toLowerCase();
    if (!email) {
      console.log(
        JSON.stringify({ reqId: reqId, stage: 'validate', ok: false, reason: 'no_email' })
      );
      return jsonResponse({ ok: false, error: 'email_required' }, 400, corsHeaders);
    }

    var first = (data.FIRSTNAME || data.first_name || '').trim();
    var last = (data.LASTNAME || data.last_name || '').trim();
    var phoneCountry = (data.SMS__COUNTRY_CODE || data.country_code || '').trim();
    var phone = normalizePhone(data.SMS || data.phone, phoneCountry);
    var doc = (data.DOC || data.doc || data.CPF || data.cpf || data.CNPJ || data.cnpj || '').trim();
    var zip = (data.ZIP || data.zip || data.CEP || data.cep || '').trim();
    console.log(
      JSON.stringify({
        reqId: reqId,
        stage: 'parsed',
        ok: true,
        hasFirst: !!first,
        hasLast: !!last,
        hasPhone: !!phone,
      })
    );

    var turnstileToken = data['cf-turnstile-response'];
    var ip = request.headers.get('CF-Connecting-IP') || '';
    var turnstileOk = await verifyTurnstile(turnstileToken, ip, env.TURNSTILE_SECRET);
    if (!turnstileOk) {
      console.log(
        JSON.stringify({ reqId: reqId, stage: 'turnstile', ok: false })
      );
      return jsonResponse({ ok: false, error: 'captcha_failed' }, 400, corsHeaders);
    }
    console.log(JSON.stringify({ reqId: reqId, stage: 'turnstile', ok: true }));

    var listId = Number(env.BREVO_LIST_ID || '0');
    var attributes = {};
    if (first) attributes.FIRSTNAME = first;
    if (last) attributes.LASTNAME = last;
    if (phone) attributes.SMS = phone;

    var doiTemplateId = Number(env.BREVO_DOI_TEMPLATE_ID || '0');
    var doiRedirectUrl = (env.BREVO_DOI_REDIRECT_URL || '').trim();
    var useDoi = doiTemplateId > 0 && doiRedirectUrl;
    console.log(
      JSON.stringify({
        reqId: reqId,
        stage: 'doi_check',
        ok: true,
        useDoi: useDoi,
        listId: listId,
      })
    );

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
      console.log(
        JSON.stringify({
          reqId: reqId,
          stage: 'brevo',
          ok: false,
          status: brevoResp.status,
        })
      );
      return jsonResponse({ ok: false, error: 'brevo_error', detail: errText }, 502, corsHeaders);
    }
    console.log(
      JSON.stringify({
        reqId: reqId,
        stage: 'brevo',
        ok: true,
        status: brevoResp.status,
      })
    );

    var postSubmitRedirect = (env.POST_SUBMIT_REDIRECT_URL || env.BREVO_DOI_REDIRECT_URL || '').trim();
    if (postSubmitRedirect) {
      var fullName = [first, last].filter(Boolean).join(' ');
      var phoneParts = splitPhoneForHotmart(phone, phoneCountry);
      var redirectUrl = buildRedirectUrl(postSubmitRedirect, {
        name: fullName || undefined,
        email: email,
        doc: doc || undefined,
        zip: zip || undefined,
        phoneac: phoneParts.phoneac || undefined,
        phonenumber: phoneParts.phonenumber || undefined,
        first_name: first || undefined,
        last_name: last || undefined,
        phone: phone || undefined,
        phone_country: phoneCountry || undefined,
        EMAIL: email,
        FIRSTNAME: first || undefined,
        LASTNAME: last || undefined,
        SMS: phone || undefined,
        SMS__COUNTRY_CODE: phoneCountry || undefined,
      });
      console.log(
        JSON.stringify({
          reqId: reqId,
          stage: 'redirect',
          ok: true,
          hasRedirect: true,
          ms: Date.now() - startedAt,
        })
      );
      return Response.redirect(redirectUrl, 303);
    }

    console.log(
      JSON.stringify({
        reqId: reqId,
        stage: 'done',
        ok: true,
        ms: Date.now() - startedAt,
      })
    );
    return jsonResponse({ ok: true, doi: useDoi }, 200, corsHeaders);
  },
};
