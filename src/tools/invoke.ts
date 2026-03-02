import { storeFact } from "../memory/store.ts";
import { searchMemory, type MemoryResult } from "../memory/search.ts";
import { logger } from "../utils/logger.ts";

type StoreAction = {
  tool: "vector-memory";
  action: "store";
  params: {
    content: string;
    category?: "goal" | "fact" | "preference" | "learning" | "task" | "idea";
    tags?: string[];
  };
};

type SearchMemoryAction = {
  tool: "vector-memory";
  action: "search";
  params: { query: string; limit?: number };
};

export type ToolAction = StoreAction | SearchMemoryAction;

export type InvokeResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function invoke<T = unknown>(
  call: ToolAction,
): Promise<InvokeResult<T>> {
  try {
    switch (call.tool) {
      case "vector-memory":
        return (await handleVectorMemory(call)) as InvokeResult<T>;
      default:
        return { ok: false, error: `Unknown tool: ${(call as any).tool}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("tools:invoke", {
      tool: call.tool,
      action: call.action,
      error: msg,
    });
    return { ok: false, error: msg };
  }
}

async function handleVectorMemory(
  call: StoreAction | SearchMemoryAction,
): Promise<InvokeResult> {
  if (call.action === "store") {
    const { content, category = "fact" } = call.params;
    await storeFact(content, category);
    return { ok: true, data: { stored: true } };
  }

  if (call.action === "search") {
    const { query, limit = 10 } = call.params;
    const results: MemoryResult[] = await searchMemory(query, limit);
    return { ok: true, data: results };
  }

  return {
    ok: false,
    error: `Unknown vector-memory action: ${(call as any).action}`,
  };
}
