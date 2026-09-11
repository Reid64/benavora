import { mintCookieHeader } from "./verify4-mint-session.mjs";

const BASE_URL = "http://localhost:3000";
const APPLICATION_ID = "581f6778-5984-4226-ba8a-2b792042319d"; // FAITH org, PRICE housing_grant application

async function main() {
  const cookieHeader = await mintCookieHeader();
  console.log("Minted session cookies:", cookieHeader.split(";").length);

  const res = await fetch(`${BASE_URL}/api/outcomes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({
      application_id: APPLICATION_ID,
      result: "awarded",
      amount_awarded: 25000,
      funder_feedback: "TEST DATA (verify4-audit 2026-09-11): strong narrative, funded in full.",
    }),
  });
  const text = await res.text();
  console.log("HTTP status:", res.status);
  console.log("Body:", text);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
