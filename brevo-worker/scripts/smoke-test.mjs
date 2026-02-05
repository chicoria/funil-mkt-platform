const smokeUrl = process.env.SMOKE_URL || "https://forms.decolesuacarreiraesg.com.br/brevo";
const smokeOrigin = process.env.SMOKE_ORIGIN || "https://decolesuacarreiraesg.com.br";
const expectedStatus = Number(process.env.SMOKE_EXPECTED_STATUS || 400);
const expectedError = process.env.SMOKE_EXPECTED_ERROR || "email_required";
const maxAttempts = Number(process.env.SMOKE_MAX_ATTEMPTS || 10);
const delayMs = Number(process.env.SMOKE_DELAY_MS || 3000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasExpectedError(bodyText) {
  if (!bodyText) return false;
  try {
    const parsed = JSON.parse(bodyText);
    return parsed && parsed.error === expectedError;
  } catch {
    return bodyText.includes(`"error":"${expectedError}"`);
  }
}

async function run() {
  console.log(
    `[smoke] url=${smokeUrl} origin=${smokeOrigin} expectedStatus=${expectedStatus} expectedError=${expectedError}`
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(smokeUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: smokeOrigin,
          accept: "application/json",
        },
        body: "{}",
      });

      const bodyText = await response.text();
      const okStatus = response.status === expectedStatus;
      const okError = hasExpectedError(bodyText);

      if (okStatus && okError) {
        console.log(`[smoke] OK on attempt ${attempt}/${maxAttempts}`);
        return;
      }

      console.log(
        `[smoke] attempt ${attempt}/${maxAttempts} failed: status=${response.status} body=${bodyText.slice(
          0,
          240
        )}`
      );
    } catch (error) {
      console.log(`[smoke] attempt ${attempt}/${maxAttempts} error: ${String(error)}`);
    }

    if (attempt < maxAttempts) {
      await sleep(delayMs);
    }
  }

  throw new Error("Smoke test failed after max attempts");
}

run().catch((error) => {
  console.error(`[smoke] FAILED: ${String(error)}`);
  process.exit(1);
});
