import { mintCookieHeader } from "./verify4-mint-session.mjs";

const BASE_URL = "http://localhost:3000";
const FUNDER_ID = "2521840b-9048-4c77-bd9c-f9f8492529d7"; // Meade Tractor, FAITH org

async function main() {
  const cookieHeader = await mintCookieHeader();
  console.log("Minted session cookies:", cookieHeader.split(";").length);

  const res = await fetch(`${BASE_URL}/api/agents/funder-relationship`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ funderId: FUNDER_ID, event: "response_received" }),
  });
  const text = await res.text();
  console.log("HTTP status:", res.status);
  console.log("Body:", text);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
