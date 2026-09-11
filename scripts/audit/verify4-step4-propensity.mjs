import { mintCookieHeader } from "./verify4-mint-session.mjs";

const BASE_URL = "http://localhost:3000";

async function main() {
  const cookieHeader = await mintCookieHeader();
  console.log("Minted session cookies:", cookieHeader.split(";").length);

  const res = await fetch(`${BASE_URL}/api/agents/propensity-scoring?batch=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ limit: 5 }),
  });
  const text = await res.text();
  console.log("HTTP status:", res.status);
  console.log("Body:", text);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
