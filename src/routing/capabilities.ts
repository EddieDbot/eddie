import type { Capability } from "./index.ts";

export const CAPABILITIES: Capability[] = [
  // ── Outreach Domain ──
  {
    id: "agent:cold-outreach-strategist",
    type: "agent",
    name: "Cold Outreach Strategist",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "outreach",
          "cold email",
          "prospecting",
          "lead gen",
          "warmup",
          "sequence",
          "campaign",
          "deliverability",
        ],
        weight: 0.9,
      },
      { type: "project", patterns: ["crabill", "leadgen"], weight: 1.0 },
    ],
    requires: ["mcp:instantly"],
    priority: 8,
  },
  {
    id: "agent:copywriter",
    type: "agent",
    name: "Copywriter",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "copy",
          "headline",
          "subject line",
          "cta",
          "email copy",
          "ad copy",
          "landing page copy",
          "write",
        ],
        weight: 0.8,
      },
      {
        type: "domain",
        patterns: ["messaging", "persuasion", "conversion"],
        weight: 0.4,
      },
    ],
    priority: 7,
  },
  {
    id: "agent:clay",
    type: "agent",
    name: "Clay",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "clay",
          "enrichment",
          "waterfall",
          "data table",
          "scoring",
          "FETE",
          "jigsaw",
          "find email",
        ],
        weight: 1.0,
      },
      { type: "project", patterns: ["crabill"], weight: 0.8 },
    ],
    priority: 8,
  },
  {
    id: "agent:dripify",
    type: "agent",
    name: "Dripify",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "dripify",
          "linkedin",
          "connection request",
          "linkedin sequence",
          "linkedin campaign",
        ],
        weight: 1.0,
      },
      { type: "project", patterns: ["crabill"], weight: 0.7 },
    ],
    priority: 8,
  },
  {
    id: "agent:instantly",
    type: "agent",
    name: "Instantly",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "instantly",
          "cold email",
          "email sequence",
          "warmup",
          "email campaign",
          "deliverability",
        ],
        weight: 1.0,
      },
      { type: "project", patterns: ["crabill"], weight: 0.7 },
    ],
    requires: ["mcp:instantly"],
    priority: 8,
  },
  {
    id: "agent:attio",
    type: "agent",
    name: "Attio",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "attio",
          "crm",
          "contacts",
          "pipeline",
          "records",
          "workspace",
        ],
        weight: 1.0,
      },
      { type: "project", patterns: ["crabill"], weight: 0.6 },
    ],
    requires: ["mcp:attio"],
    priority: 7,
  },
  {
    id: "agent:n8n",
    type: "agent",
    name: "n8n",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "n8n",
          "workflow",
          "automation",
          "webhook",
          "trigger",
          "node",
        ],
        weight: 1.0,
      },
      { type: "domain", patterns: ["automate", "integrate"], weight: 0.4 },
    ],
    requires: ["mcp:n8n"],
    priority: 8,
  },
  {
    id: "agent:cal-com",
    type: "agent",
    name: "Cal.com",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "cal.com",
          "booking",
          "calendar",
          "scheduling",
          "availability",
          "event type",
        ],
        weight: 1.0,
      },
    ],
    priority: 7,
  },
  {
    id: "agent:automation-engineer",
    type: "agent",
    name: "Automation Engineer",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "automation system",
          "end-to-end automation",
          "pipeline",
          "automate workflow",
        ],
        weight: 0.8,
      },
      { type: "domain", patterns: ["automate", "orchestrate"], weight: 0.3 },
    ],
    priority: 6,
  },
  // ── Web & Design ──
  {
    id: "agent:website-builder",
    type: "agent",
    name: "Website Builder",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "website",
          "landing page",
          "web page",
          "frontend",
          "nextjs",
          "react",
          "site",
        ],
        weight: 0.9,
      },
      {
        type: "project",
        patterns: ["fanways", "ai-money", "freelance"],
        weight: 0.8,
      },
    ],
    requires: ["mcp:shadcn-ui"],
    priority: 8,
  },
  {
    id: "agent:conversion-architect",
    type: "agent",
    name: "Conversion Architect",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "conversion",
          "funnel",
          "cro",
          "optimize",
          "commitment sequence",
          "landing page",
        ],
        weight: 0.8,
      },
      {
        type: "domain",
        patterns: ["convert", "signup", "purchase"],
        weight: 0.3,
      },
    ],
    priority: 7,
  },
  // ── Strategy ──
  {
    id: "agent:funnel-diagnostician",
    type: "agent",
    name: "Funnel Diagnostician",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "funnel",
          "bottleneck",
          "root cause",
          "diagnose",
          "stage 1",
          "stage 2",
          "pre-chasm",
          "3-question",
          "offer weak",
          "money model",
        ],
        weight: 0.9,
      },
      {
        type: "domain",
        patterns: ["diagnose funnel", "structural issue"],
        weight: 0.5,
      },
    ],
    priority: 7,
  },
  {
    id: "agent:sales-funnel-analyst",
    type: "agent",
    name: "Sales Funnel Analyst",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "funnel analysis",
          "conversion rate",
          "drop-off",
          "cohort",
          "segmentation",
          "statistical significance",
          "a/b test",
          "pipeline health",
          "benchmark",
        ],
        weight: 0.9,
      },
      {
        type: "domain",
        patterns: ["analyze funnel", "funnel data"],
        weight: 0.4,
      },
    ],
    priority: 7,
  },
  {
    id: "agent:sales-strategist",
    type: "agent",
    name: "Sales Strategist",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "sales conversation",
          "close deal",
          "objection",
          "discovery call",
          "spin selling",
          "meddic",
          "gap selling",
          "stakeholder",
          "enterprise sales",
          "pipeline forecast",
        ],
        weight: 0.9,
      },
      { type: "domain", patterns: ["sales process", "closing"], weight: 0.3 },
    ],
    priority: 7,
  },
  {
    id: "agent:business-stage-diagnostician",
    type: "agent",
    name: "Business Stage Diagnostician",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "business stage",
          "stage diagnosis",
          "what stage",
          "ready to scale",
          "product market fit",
          "pre-chasm",
          "chasm crossing",
        ],
        weight: 0.9,
      },
    ],
    priority: 6,
  },
  {
    id: "agent:lead-magnet-designer",
    type: "agent",
    name: "Lead Magnet Designer",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "lead magnet",
          "freebie",
          "opt-in",
          "lead capture",
          "free resource",
          "content upgrade",
          "email list",
        ],
        weight: 0.9,
      },
    ],
    priority: 6,
  },
  {
    id: "agent:operations-designer",
    type: "agent",
    name: "Operations Designer",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "operations",
          "sop",
          "process design",
          "standard operating",
          "workflow design",
          "system design",
          "runbook",
        ],
        weight: 0.8,
      },
    ],
    priority: 6,
  },
  {
    id: "agent:pricing-strategist",
    type: "agent",
    name: "Pricing Strategist",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "pricing",
          "price",
          "ltv",
          "cac",
          "value proposition",
          "tier",
          "plan",
        ],
        weight: 0.9,
      },
      { type: "domain", patterns: ["monetize", "revenue model"], weight: 0.4 },
    ],
    priority: 7,
  },
  {
    id: "agent:revenue-architect",
    type: "agent",
    name: "Revenue Architect",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "revenue stream",
          "revenue model",
          "monetization",
          "mrr",
          "arr",
          "income",
        ],
        weight: 0.9,
      },
      { type: "domain", patterns: ["business model", "revenue"], weight: 0.3 },
    ],
    priority: 7,
  },
  {
    id: "agent:offer-architect",
    type: "agent",
    name: "Offer Architect",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "offer",
          "value proposition",
          "irresistible",
          "product design",
          "package",
        ],
        weight: 0.9,
      },
    ],
    priority: 6,
  },
  // ── Code Quality ──
  {
    id: "agent:build-validator",
    type: "agent",
    name: "Build Validator",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "run tests",
          "build",
          "compile",
          "lint",
          "test suite",
          "ci",
          "bun test",
          "bun check",
          "does it pass",
        ],
        weight: 0.9,
      },
      {
        type: "domain",
        patterns: ["verify build", "check tests"],
        weight: 0.5,
      },
    ],
    priority: 8,
  },
  {
    id: "agent:architecture-verifier",
    type: "agent",
    name: "Architecture Verifier",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "verify architecture",
          "matches plan",
          "plan compliance",
          "architecture review",
          "did we follow",
          "check implementation",
        ],
        weight: 0.9,
      },
    ],
    priority: 7,
  },
  {
    id: "agent:refactor-reviewer",
    type: "agent",
    name: "Refactor Reviewer",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "refactor",
          "code review",
          "clean up",
          "code quality",
          "dead code",
          "improve readability",
          "technical debt",
        ],
        weight: 0.8,
      },
      { type: "domain", patterns: ["clean code", "code smell"], weight: 0.4 },
    ],
    priority: 7,
  },
  {
    id: "agent:security-reviewer",
    type: "agent",
    name: "Security Reviewer",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "security",
          "vulnerability",
          "owasp",
          "inject",
          "xss",
          "sqli",
          "audit",
          "install",
        ],
        weight: 1.0,
      },
    ],
    priority: 9,
  },
  // ── Multi-AI Specialists ──
  {
    id: "agent:chatgpt-specialist",
    type: "agent",
    name: "ChatGPT Specialist",
    triggers: [
      // name-based (explicit routing)
      {
        type: "keyword",
        patterns: [
          "chatgpt",
          "openai",
          "codex",
          "ask chatgpt",
          "gpt-4",
          "gpt-5",
        ],
        weight: 1.0,
      },
      // math / abstract reasoning — codex leads (100% AIME 2025, ARC-AGI-2 52.9%)
      {
        type: "keyword",
        patterns: [
          "math problem",
          "aime",
          "arc-agi",
          "abstract reasoning",
          "novel reasoning",
          "logic puzzle",
          "proof",
        ],
        weight: 0.85,
      },
      // quick single-file edits / mechanical refactors
      {
        type: "keyword",
        patterns: [
          "quick fix",
          "rename all",
          "migrate all",
          "upgrade pattern",
          "mechanical refactor",
          "find and replace",
        ],
        weight: 0.75,
      },
      // voice / image analysis — codex/GPT unique
      {
        type: "keyword",
        patterns: [
          "voice interaction",
          "real-time voice",
          "image analysis",
          "analyze image",
          "describe image",
        ],
        weight: 0.8,
      },
      // provider flexibility
      {
        type: "keyword",
        patterns: [
          "openrouter",
          "local model",
          "provider flexibility",
          "ollama api",
        ],
        weight: 0.9,
      },
    ],
    priority: 6,
  },
  {
    id: "agent:gemini-specialist",
    type: "agent",
    name: "Gemini Specialist",
    triggers: [
      // name-based (explicit routing)
      {
        type: "keyword",
        patterns: ["gemini", "google ai", "ask gemini", "gemini cli"],
        weight: 1.0,
      },
      // large context ingestion — gemini's standout (1M, 99.7% recall)
      {
        type: "keyword",
        patterns: [
          "entire codebase",
          "whole repo",
          "ingest repo",
          "massive context",
          "1m context",
          "large context",
          "all the files",
          "full project",
        ],
        weight: 0.9,
      },
      // video / recording analysis — unique capability
      {
        type: "keyword",
        patterns: [
          "analyze video",
          "video recording",
          "watch this video",
          "timestamp",
          "what happens in the video",
          "video intelligence",
        ],
        weight: 0.95,
      },
      // cross-document synthesis
      {
        type: "keyword",
        patterns: [
          "cross-reference",
          "50 documents",
          "search logs",
          "months of logs",
          "historical analysis",
          "all these files",
        ],
        weight: 0.85,
      },
      // rapid MVP / shell commands / docs
      {
        type: "keyword",
        patterns: [
          "quick prototype",
          "fast mvp",
          "first draft",
          "generate readme",
          "write docs",
          "shell command for",
        ],
        weight: 0.7,
      },
      // Google ecosystem
      {
        type: "keyword",
        patterns: [
          "firebase",
          "google cloud",
          "google search grounding",
          "gcp",
        ],
        weight: 0.9,
      },
    ],
    priority: 6,
  },
  {
    id: "agent:kimi-specialist",
    type: "agent",
    name: "Kimi Specialist",
    triggers: [
      // name-based (explicit routing)
      {
        type: "keyword",
        patterns: ["kimi", "moonshot", "ask kimi", "kimi ai"],
        weight: 1.0,
      },
      // screenshot/video → code — K2.5 standout feature
      {
        type: "keyword",
        patterns: [
          "screenshot to code",
          "video to code",
          "ui from image",
          "design to code",
          "build ui from",
          "convert screenshot",
          "frontend from image",
        ],
        weight: 0.95,
      },
      // Chinese language — unambiguous #1
      {
        type: "keyword",
        patterns: [
          "chinese",
          "中文",
          "mandarin",
          "simplified chinese",
          "traditional chinese",
        ],
        weight: 1.0,
      },
      // cost-sensitive bulk / batch work
      {
        type: "keyword",
        patterns: [
          "bulk process",
          "batch job",
          "high volume",
          "cost sensitive",
          "process many",
          "hundreds of",
          "parallel agents",
        ],
        weight: 0.8,
      },
      // execution-phase coding (after planning is done)
      {
        type: "keyword",
        patterns: [
          "implement this plan",
          "execute the plan",
          "just code it",
          "implement exactly",
          "write the code for",
        ],
        weight: 0.75,
      },
    ],
    priority: 6,
  },
  // ── Research ──
  {
    id: "agent:multi-ai-researcher",
    type: "agent",
    name: "Multi-AI Researcher",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "research",
          "investigate",
          "compare options",
          "explore",
          "analyze market",
          "competitive",
        ],
        weight: 0.8,
      },
      { type: "domain", patterns: ["find out", "look into"], weight: 0.3 },
    ],
    requires: ["mcp:brave-search", "mcp:context7"],
    priority: 7,
  },
  // ── Content ──
  {
    id: "agent:transcript-ingester",
    type: "agent",
    name: "Transcript Ingester",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "transcript",
          "youtube",
          "video",
          "ingest",
          "extract summary",
          "watch",
        ],
        weight: 0.9,
      },
      { type: "entity", patterns: ["youtube.com", "youtu.be"], weight: 1.0 },
    ],
    requires: ["mcp:youtube-transcript"],
    priority: 8,
  },
  {
    id: "agent:transcript-extractor",
    type: "agent",
    name: "Transcript Extractor",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "extract transcript",
          "get transcript",
          "pull transcript",
          "summarize video",
          "video summary",
        ],
        weight: 0.9,
      },
      { type: "entity", patterns: ["youtube.com", "youtu.be"], weight: 0.7 },
    ],
    requires: ["mcp:youtube-transcript"],
    priority: 7,
  },
  {
    id: "agent:book-ingester",
    type: "agent",
    name: "Book Ingester",
    triggers: [
      {
        type: "keyword",
        patterns: ["book", "pdf", "chapter", "extract", "ingest book"],
        weight: 0.9,
      },
    ],
    priority: 7,
  },
  {
    id: "agent:video-creator",
    type: "agent",
    name: "Video Creator",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "create video",
          "video production",
          "remotion",
          "ffmpeg",
          "render video",
        ],
        weight: 0.9,
      },
    ],
    priority: 7,
  },
  // ── Infra / Meta ──
  {
    id: "agent:memory-sync",
    type: "agent",
    name: "Memory Sync",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "memory sync",
          "sync memory",
          "brain vault sync",
          "consolidate memory",
          "update brain vault",
        ],
        weight: 1.0,
      },
    ],
    priority: 6,
  },
  {
    id: "agent:session-closer",
    type: "agent",
    name: "Session Closer",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "shutdown agent",
          "close session",
          "stop teammate",
          "graceful shutdown",
        ],
        weight: 1.0,
      },
    ],
    priority: 6,
  },
  {
    id: "agent:treasure-hunter",
    type: "agent",
    name: "Treasure Hunter",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "treasure hunt",
          "discover components",
          "find github components",
          "github reusable",
          "open source patterns",
        ],
        weight: 0.9,
      },
    ],
    priority: 6,
  },
  {
    id: "agent:self-healer",
    type: "agent",
    name: "Self-Healer",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "heal",
          "fix error",
          "broken",
          "retry",
          "diagnose failure",
          "repair",
        ],
        weight: 1.0,
      },
    ],
    priority: 9,
  },
  {
    id: "agent:architect",
    type: "agent",
    name: "Architect",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "system design",
          "architecture",
          "design pattern",
          "technical design",
          "schema",
        ],
        weight: 0.9,
      },
    ],
    priority: 8,
  },
  {
    id: "agent:role-designer",
    type: "agent",
    name: "Role Designer",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "role design",
          "persona",
          "agent persona",
          "role theory",
          "character design",
          "agent identity",
        ],
        weight: 0.9,
      },
    ],
    priority: 6,
  },
  {
    id: "agent:agent-forge",
    type: "agent",
    name: "Agent Forge",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "new agent",
          "create agent",
          "build agent",
          "agent template",
        ],
        weight: 1.0,
      },
    ],
    priority: 8,
  },
  {
    id: "agent:project-orchestrator",
    type: "agent",
    name: "Project Orchestrator",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "orchestrate",
          "full audit",
          "portfolio review",
          "state of the world",
        ],
        weight: 1.0,
      },
    ],
    priority: 6,
  },
  // ── Scripts / Tools ──
  {
    id: "script:create-custom-gpt",
    type: "script",
    name: "Custom GPT Creator",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "custom gpt",
          "create gpt",
          "build a gpt",
          "make a gpt",
          "gpt for",
          "chatgpt agent",
          "client gpt",
          "handoff gpt",
          "knowledge base gpt",
        ],
        weight: 1.0,
      },
    ],
    invoke: `bun run ~/eddie/src/scripts/create-gpt.ts --name "..." --content-type [book|transcript|tutorial|instructions|database] --topic "..." [--file ./knowledge.pdf]\n# Or manual: --instructions "..." or --instructions-file ./prompt.txt`,
    priority: 8,
  },
  // ── MCPs ──
  {
    id: "mcp:instantly",
    type: "mcp",
    name: "Instantly",
    triggers: [
      {
        type: "keyword",
        patterns: ["instantly", "cold email", "email campaign"],
        weight: 1.0,
      },
    ],
    priority: 8,
  },
  {
    id: "mcp:attio",
    type: "mcp",
    name: "Attio CRM",
    triggers: [
      {
        type: "keyword",
        patterns: ["attio", "crm", "contact record"],
        weight: 1.0,
      },
    ],
    priority: 8,
  },
  {
    id: "mcp:n8n",
    type: "mcp",
    name: "n8n",
    triggers: [
      {
        type: "keyword",
        patterns: ["n8n", "workflow automation"],
        weight: 1.0,
      },
    ],
    priority: 8,
  },
  {
    id: "mcp:brave-search",
    type: "mcp",
    name: "Brave Search",
    triggers: [
      {
        type: "keyword",
        patterns: ["search the web", "look up", "find information", "research"],
        weight: 0.7,
      },
    ],
    priority: 6,
  },
  {
    id: "mcp:context7",
    type: "mcp",
    name: "Context7 (Library Docs)",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "documentation",
          "library docs",
          "api reference",
          "how to use",
        ],
        weight: 0.8,
      },
    ],
    priority: 6,
  },
  {
    id: "mcp:playwright",
    type: "mcp",
    name: "Playwright (Browser)",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "browser",
          "scrape",
          "automate click",
          "screenshot",
          "playwright",
        ],
        weight: 1.0,
      },
      { type: "keyword", patterns: ["website", "landing page"], weight: 0.3 },
    ],
    priority: 7,
  },
  {
    id: "mcp:youtube-transcript",
    type: "mcp",
    name: "YouTube Transcript",
    triggers: [
      {
        type: "keyword",
        patterns: ["youtube", "video transcript", "youtu.be"],
        weight: 1.0,
      },
    ],
    priority: 8,
  },
  {
    id: "mcp:shadcn-ui",
    type: "mcp",
    name: "shadcn/ui Components",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "shadcn",
          "ui component",
          "react component",
          "nextjs component",
        ],
        weight: 1.0,
      },
      {
        type: "keyword",
        patterns: ["website", "frontend", "landing page"],
        weight: 0.2,
      },
    ],
    priority: 6,
  },
  {
    id: "mcp:mermaid",
    type: "mcp",
    name: "Mermaid Diagrams",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "diagram",
          "chart",
          "flowchart",
          "sequence diagram",
          "mermaid",
        ],
        weight: 1.0,
      },
    ],
    priority: 6,
  },
  {
    id: "mcp:vector-memory",
    type: "mcp",
    name: "Vector Memory",
    triggers: [
      {
        type: "keyword",
        patterns: ["remember", "search memory", "recall", "past context"],
        weight: 0.8,
      },
    ],
    priority: 7,
  },
  {
    id: "mcp:cloudflare",
    type: "mcp",
    name: "Cloudflare",
    triggers: [
      {
        type: "keyword",
        patterns: [
          "cloudflare",
          "worker",
          "kv store",
          "r2",
          "d1 database",
          "cdn",
        ],
        weight: 1.0,
      },
    ],
    priority: 7,
  },
];
