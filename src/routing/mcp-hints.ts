export const MCP_LOAD_HINTS: Record<string, string> = {
  instantly: "ToolSearch: 'instantly' → loads Instantly cold email tools",
  attio: "ToolSearch: 'attio crm' → loads Attio CRM tools",
  n8n: "ToolSearch: 'n8n workflow' → loads n8n automation tools",
  context7: "ToolSearch: 'context7' → loads library documentation",
  playwright: "ToolSearch: 'playwright browser' → loads browser automation",
  "youtube-transcript":
    "ToolSearch: 'youtube transcript' → loads YouTube tools",
  "shadcn-ui": "ToolSearch: 'shadcn ui' → loads UI component reference",
  mermaid: "ToolSearch: 'mermaid diagram' → loads diagram tools",
  "vector-memory": "ToolSearch: 'vector memory' → loads memory search",
  cloudflare: "ToolSearch: 'cloudflare' → loads Cloudflare tools",
};

export function getMcpHints(mcps: string[]): string {
  return mcps
    .map((mcp) => MCP_LOAD_HINTS[mcp] ?? `ToolSearch: '${mcp}'`)
    .join("\n");
}
