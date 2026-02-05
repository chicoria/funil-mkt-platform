const smokeUrl = process.env.SMOKE_URL || "https://api.decolesuacarreiraesg.com.br/webhooks/hotmart";
const expectedStatus = Number(process.env.SMOKE_EXPECTED_STATUS || 202);
const maxAttempts = Number(process.env.SMOKE_MAX_ATTEMPTS || 10);
const delayMs = Number(process.env.SMOKE_DELAY_MS || 3000);
const smokeToken = process.env.SMOKE_TOKEN || "";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log(`[smoke] url=${smokeUrl} expectedStatus=${expectedStatus}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(smokeUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(smokeToken ? { "x-hotmart-hottok": smokeToken } : {}),
        },
        body: JSON.stringify({
          event: "SMOKE_TEST",
          id: `smoke-${Date.now()}`,
          buyer: { email: "smoke@exemplo.com" },
        }),
      });

      const bodyText = await response.text();
      if (response.status === expectedStatus) {
        console.log(`[smoke] OK on attempt ${attempt}/${maxAttempts}`);
        return;
      }

      console.log(
        `[smoke] attempt ${attempt}/${maxAttempts} failed: status=${response.status} body=${bodyText.slice(0, 240)}`
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
