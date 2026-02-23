export type ToolUse = {
  name: string;
  result?: string;
};

export type ParsedResponse = {
  text: string;
  toolUses: ToolUse[];
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalCostUsd?: number;
  };
};

export function parseStreamJson(output: string): ParsedResponse {
  const lines = output.trim().split("\n").filter(Boolean);
  const texts: string[] = [];
  const toolUses: ToolUse[] = [];
  let error: string | undefined;
  let usage: ParsedResponse["usage"];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);

      if (obj.type === "assistant" && obj.message?.content) {
        for (const block of obj.message.content) {
          if (block.type === "text") {
            texts.push(block.text);
          }
          if (block.type === "tool_use") {
            toolUses.push({ name: block.name });
          }
        }
      }

      if (obj.type === "result") {
        if (obj.result && texts.length === 0) {
          texts.push(obj.result);
        }
        // Extract usage data from Claude CLI result event
        if (obj.usage || obj.total_cost_usd !== undefined) {
          usage = {
            inputTokens: obj.usage?.input_tokens ?? 0,
            outputTokens: obj.usage?.output_tokens ?? 0,
            totalCostUsd: obj.total_cost_usd,
          };
        }
      }

      if (obj.type === "tool_result") {
        const existing = toolUses[toolUses.length - 1];
        if (existing && obj.content) {
          existing.result = typeof obj.content === "string"
            ? obj.content.slice(0, 200)
            : JSON.stringify(obj.content).slice(0, 200);
        }
      }

      if (obj.type === "error") {
        error = obj.error?.message ?? JSON.stringify(obj);
      }
    } catch {
      // skip malformed lines
    }
  }

  return {
    text: texts.join("\n"),
    toolUses,
    ...(error && { error }),
    ...(usage && { usage }),
  };
}
