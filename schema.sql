-- =====================================================
-- Orbit Tasks - Supabase Database Schema
-- Cole este código inteiro no SQL Editor do Supabase
-- =====================================================

-- Tabela de Projetos
CREATE TABLE IF NOT EXISTS public.projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de Tarefas
CREATE TABLE IF NOT EXISTS public.tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES public.projects(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  time_spent INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de Templates
CREATE TABLE IF NOT EXISTS public.templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tasks JSONB DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- Permissões de acesso público (app pessoal sem login)
-- =====================================================

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acesso publico a projetos"   ON public.projects   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acesso publico a tarefas"    ON public.tasks      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acesso publico a templates"  ON public.templates  FOR ALL USING (true) WITH CHECK (true);
