export type CapabilityType = "agent" | "mcp" | "command" | "script";

export type TriggerRule = {
  type: "keyword" | "project" | "domain" | "entity";
  patterns: string[];
  weight: number;
};

export type Capability = {
  id: string;
  type: CapabilityType;
  name: string;
  triggers: TriggerRule[];
  requires?: string[];
  priority: number;
  invoke?: string; // shell invocation hint for script-type capabilities
};

export type RoutingResult = {
  agents: string[];
  mcps: string[];
  contextHints: string[];
  confidence?: number;
};
