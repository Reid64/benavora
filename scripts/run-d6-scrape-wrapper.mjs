import { spawnSync } from "node:child_process";

const result = spawnSync("pnpm", ["scrape:foundations"], {
  stdio: "inherit",
  env: {
    ...process.env,
    SCRAPER_START_OFFSET: "60",
    SCRAPER_BATCH_LIMIT: "300",
  },
  shell: true,
});

process.exit(result.status ?? 1);
