-- Migration 004: Model comparisons tracking table
-- Tracks quality scores and win rates across multi-model parallel runs

CREATE TABLE IF NOT EXISTS model_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL,
  prompt_preview TEXT NOT NULL,
  claude_score SMALLINT,
  codex_score SMALLINT,
  gemini_score SMALLINT,
  kimi_score SMALLINT,
  winner TEXT NOT NULL,
  synthesis_added_value BOOLEAN DEFAULT false,
  claude_duration_ms INTEGER,
  codex_duration_ms INTEGER,
  gemini_duration_ms INTEGER,
  kimi_duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_model_comparisons_created_at ON model_comparisons (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_comparisons_winner ON model_comparisons (winner);
CREATE INDEX IF NOT EXISTS idx_model_comparisons_task_type ON model_comparisons (task_type);

ALTER TABLE model_comparisons DISABLE ROW LEVEL SECURITY;
