-- Histórico de acessos (login) por usuário — rode isso uma vez no SQL Editor
-- do Supabase. Cria a tabela, os índices e as políticas de segurança (RLS):
-- qualquer usuário autenticado só consegue inserir o PRÓPRIO acesso; só o
-- MASTER (ativo) consegue LER o histórico completo. Não há política de
-- update/delete — o histórico é imutável por design.

create table if not exists public.access_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  username text,
  role text,
  logged_in_at timestamptz not null default now()
);

create index if not exists access_logs_user_id_idx on public.access_logs(user_id);
create index if not exists access_logs_logged_in_at_idx on public.access_logs(logged_in_at desc);

alter table public.access_logs enable row level security;

drop policy if exists "access_logs_insert_own" on public.access_logs;
create policy "access_logs_insert_own" on public.access_logs
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "access_logs_select_master" on public.access_logs;
create policy "access_logs_select_master" on public.access_logs
  for select to authenticated
  using (
    exists (
      select 1 from public.app_profiles p
      where p.id = auth.uid()
        and upper(p.role) = 'MASTER'
        and upper(p.status) = 'ATIVO'
    )
  );
