const smokeUrl = process.env.SMOKE_URL || "";
const expectedStatus = Number(process.env.SMOKE_EXPECTED_STATUS || 200);

async function run() {
  if (!smokeUrl) {
    throw new Error("SMOKE_URL is required for api-events-consumer smoke test");
  }

  console.log(`[smoke] url=${smokeUrl} expectedStatus=${expectedStatus}`);

  const response = await fetch(smokeUrl, {
    method: "GET",
    headers: {
      accept: "application/json",
    },
  });

  const bodyText = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(`Unexpected status=${response.status} body=${bodyText.slice(0, 240)}`);
  }

  console.log("[smoke] OK");
}

run().catch((error) => {
  console.error(`[smoke] FAILED: ${String(error)}`);
  process.exit(1);
});
