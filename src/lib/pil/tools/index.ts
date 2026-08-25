import type { AgentContext } from "@/lib/pil/agent-runner";
import { webCrawlTool } from "@/lib/pil/tools/web-crawler";
import { irs990Tool } from "@/lib/pil/tools/irs-990-tool";
import { newsSearchTool } from "@/lib/pil/tools/news-search";
import { webSearchTool } from "@/lib/pil/tools/web-search";
import { entityLookupTool } from "@/lib/pil/tools/entity-lookup";

// Tool registry for the Prospect Intelligence Layer (PIL-03). Concrete tools
// (web-crawler.ts, irs-990-tool.ts, news-search.ts, web-search.ts,
// entity-lookup.ts) register themselves below by name. AgentRunner's own
// permitted-tool check (agent-runner.ts's `useTool`/ToolNotPermittedError)
// guards cost-ledger writes; each Tool.execute here additionally guards its
// own execution the same way, so a tool invoked directly (bypassing
// AgentRunner.useTool) still can't run outside its calling agent's
// context.tools allow-list.

export interface ToolResult {
  success: boolean;
  data: unknown;
  cost_usd: number;
  tokens_used?: number;
  source_snapshot_id?: string;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  execute(params: Record<string, unknown>, context: AgentContext): Promise<ToolResult>;
}

const REGISTRY: Record<string, Tool> = {
  [webCrawlTool.name]: webCrawlTool,
  [irs990Tool.name]: irs990Tool,
  [newsSearchTool.name]: newsSearchTool,
  [webSearchTool.name]: webSearchTool,
  [entityLookupTool.name]: entityLookupTool,
};

export function getTool(name: string): Tool {
  const tool = REGISTRY[name];
  if (!tool) {
    throw new Error(`Unknown PIL tool: ${name}`);
  }
  return tool;
}

export function listTools(): Tool[] {
  return Object.values(REGISTRY);
}
