-- Migration 003: Jobs table + User Settings table
-- Run this in the Supabase SQL Editor at:
-- https://supabase.com/dashboard/project/gwksyrpaqbfszymzytoq/sql

-- Jobs table (replaces data/jobs.json flat file)
CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  model text NOT NULL,
  prompt text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'killed')),
  tmux_session text NOT NULL,
  output_path text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  duration_ms int,
  error text,
  timeout_ms int,
  outcome text CHECK (outcome IN ('success', 'partial', 'failed', 'unknown')),
  outcome_summary text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_started_at ON jobs (started_at DESC);

-- Disable RLS so EDDIE can read/write (anon key, server-side only)
ALTER TABLE jobs DISABLE ROW LEVEL SECURITY;

-- User settings table (persists voiceReply + mode across restarts)
CREATE TABLE IF NOT EXISTS user_settings (
  chat_id bigint NOT NULL,
  key text NOT NULL,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (chat_id, key)
);

ALTER TABLE user_settings DISABLE ROW LEVEL SECURITY;
