import dotenv from "dotenv";

import { generateEmbedding } from "../../src/lib/intelligence/embeddings";
import { searchKnowledge } from "../../src/lib/knowledge/db";

dotenv.config({ path: ".env.local" });

async function main() {
  const question = process.argv.slice(2).join(" ").trim();
  if (!question) {
    console.error("Usage: tsx scripts/knowledge/ask.ts \"<question>\"");
    process.exit(2);
  }

  const embedding = await generateEmbedding(question);
  const hits = await searchKnowledge(embedding, question, 5);

  console.log(`\nQ: ${question}`);
  if (hits.length === 0) {
    console.log("  (no hits)");
    return;
  }
  hits.forEach((hit, i) => {
    const snippet = hit.content.slice(0, 160).replace(/\s+/g, " ").trim();
    console.log(`  ${i + 1}. ${hit.title} | ${hit.publisher} | score=${hit.score.toFixed(4)}`);
    console.log(`     ${snippet}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
