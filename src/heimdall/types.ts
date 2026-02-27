export interface PieceDependencies {
  /** npm/bun packages — installed via `bun add` */
  npm?: string[];
  /** GitHub CLI extensions — installed via `gh extension install` */
  ghExtensions?: string[];
  /** System packages — installed via apt/brew */
  system?: string[];
  /** MCP server names — checked in ~/.mcp.json */
  mcps?: string[];
  /** Required environment variables */
  env?: string[];
  /** Minimum Claude subscription tier */
  claudeTier?: "pro" | "max";
}

export interface PiecePermissions {
  /** Read files from Brain Vault */
  brainVaultRead?: boolean;
  /** Write/modify files in Brain Vault */
  brainVaultWrite?: boolean;
  /** Execute arbitrary bash commands */
  bashExec?: boolean;
  /** Make outbound HTTP/network requests */
  network?: boolean;
  /** Send Telegram messages */
  telegram?: boolean;
  /** Spawn background jobs */
  spawnJobs?: boolean;
}

export interface PieceMetadata {
  id: string;
  name: string;
  type: "agent" | "skill" | "script" | "mcp" | "workflow";
  version: string;
  author: string;
  description: string;
  tags: string[];
  /** Capabilities this piece requires from the host EDDIE installation */
  permissions?: PiecePermissions;
  /** Canonical dependency spec — Heimdall dispatches each type to the right installer */
  dependencies?: PieceDependencies;
  /** @deprecated use dependencies instead */
  requires?: {
    envVars?: string[];
    mcps?: string[];
    scripts?: string[];
    claudeTier?: "pro" | "max";
  };
  install: {
    agent?: string;
    script?: string;
    capabilities?: Record<string, unknown>;
  };
  stats?: {
    installs?: number;
    rating?: number;
  };
}

export type RefType = "path" | "name" | "credential" | "id" | "ip" | "email";

export interface PersonalRef {
  line: number;
  match: string;
  type: RefType;
  suggestion: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

export interface ScanResult {
  file: string;
  personalRefs: PersonalRef[];
  clean: boolean;
}

export interface ReviewReport {
  pieceId: string;
  passed: boolean;
  scanResults: ScanResult[];
  duplicateCheck: { similar: string[]; uniquenessScore: number };
  dependencyCheck: { missing: string[]; resolvable: boolean };
  issues: string[];
  recommendations: string[];
}

export interface DepStatus {
  name: string;
  present: boolean;
  installedBy?: "bun" | "gh" | "apt" | "brew" | "manual";
}

export interface DependencyResult {
  npm: DepStatus[];
  ghExtensions: DepStatus[];
  system: DepStatus[];
  mcps: DepStatus[];
  envVars: DepStatus[];
  /** @deprecated */
  scripts: DepStatus[];
  allResolved: boolean;
}

export interface CleanChange {
  file: string;
  line: number;
  original: string;
  replacement: string;
  type: RefType;
}
