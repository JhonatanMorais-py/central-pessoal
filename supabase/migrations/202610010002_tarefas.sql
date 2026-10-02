create table public.tarefas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  titulo varchar(180) not null check (char_length(trim(titulo)) between 1 and 180),
  descricao varchar(1000),
  data_limite date,
  concluida boolean not null default false,
  concluida_em timestamptz,
  constraint conclusao_consistente check (
    (concluida and concluida_em is not null)
    or (not concluida and concluida_em is null)
  )
);

create index tarefas_user_status_due
  on public.tarefas (user_id, concluida, data_limite, created_at desc);

alter table public.tarefas enable row level security;
revoke all on public.tarefas from anon;
grant select, insert, update, delete on public.tarefas to authenticated;

create policy tarefas_select on public.tarefas
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy tarefas_insert on public.tarefas
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy tarefas_update on public.tarefas
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy tarefas_delete on public.tarefas
  for delete to authenticated
  using ((select auth.uid()) = user_id);

create function public.touch_tarefa()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_tarefa
before update on public.tarefas
for each row execute function public.touch_tarefa();
