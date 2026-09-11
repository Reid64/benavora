import { mintCookieHeader } from "./verify4-mint-session.mjs";

const BASE_URL = "http://localhost:3000";

async function main() {
  const cookieHeader = await mintCookieHeader();
  console.log("COOKIE HEADER:", cookieHeader);

  const res = await fetch(`${BASE_URL}/api/agents/funder-relationship`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({ funderId: "2521840b-9048-4c77-bd9c-f9f8492529d7", event: "response_received" }),
    redirect: "manual",
  });
  console.log("status", res.status);
  for (const [k, v] of res.headers.entries()) console.log(k, ":", v);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
