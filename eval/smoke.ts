// Sends one small request to both providers and prints what each returns.
// Run: node eval/smoke.ts

import { choice, confidence, noul, score, send, upstreamMs, type Provider } from "./lib.ts";

const body = {
  state: "Help! My payouts have been failing for 3 days and nobody replies.",
  questions: {
    is_urgent: noul("Does this convey urgency?"),
    department: choice("Which team should handle this?", {
      billing: "Payments, refunds, invoices",
      technical: "Bugs, outages, integrations",
      sales: "Pricing, plans, new business",
    }),
    frustration: score("How frustrated is the customer?", ["Calm", "Frustrated", "Very angry"]),
  },
};

const decimals = (n: number) => (String(n).split(".")[1] ?? "").length;

for (const provider of ["vercel", "typesafe"] as Provider[]) {
  console.log(`\n=== ${provider} ===`);
  try {
    const res = await send("smoke", body, { note: "smoke" }, { provider });
    console.log("status", res.status, "latencyMs", Math.round(res.latencyMs), "upstreamMs", upstreamMs(res));
    console.log("top-level response keys:", Object.keys(res.raw).join(", "));
    console.log("usage:", JSON.stringify(res.usage));
    console.log("answers key order:", Object.keys(res.answers).join(", "));
    console.log("request key order: ", Object.keys(body.questions).join(", "));
    console.log("normalized answers:", JSON.stringify(res.answers));
    console.log("raw answers:", JSON.stringify(res.raw.answers));
    for (const [name, a] of Object.entries(res.answers)) {
      const p = a.probabilities;
      if (!Object.keys(p).length) continue;
      const own = confidence(p);
      console.log(
        `  ${name}: probs [${Object.keys(p).join(",")}] decimals ${Object.values(p).map(decimals).join(",")}`,
        `sum ${Object.values(p).reduce((x, y) => x + y, 0)}`,
        `confidence ${a.confidence ?? "none"} vs formula ${own.toFixed(3)}`,
        a.confidence === undefined ? "" : `match=${Math.abs(a.confidence - own) < 0.006}`,
      );
      console.log(`  ${name}: legend ${a.legend ? JSON.stringify(a.legend) : "none"}`);
    }
    console.log("header names:", Object.keys(res.headers).sort().join(", "));
  } catch (e) {
    console.log("FAILED:", String(e).slice(0, 400));
  }
}
