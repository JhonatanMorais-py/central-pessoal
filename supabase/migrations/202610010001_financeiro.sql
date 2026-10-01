create table public.fin_lancamentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  descricao varchar(180) not null check (char_length(trim(descricao)) between 1 and 180),
  tipo text not null check (tipo in ('entrada', 'saida')),
  status text not null default 'pendente' check (status in ('pendente', 'realizado')),
  valor numeric(14,2) not null check (valor > 0),
  data_vencimento date not null,
  data_realizacao date,
  categoria varchar(80),
  observacoes varchar(1000),
  constraint realizacao_consistente check (
    (status = 'pendente' and data_realizacao is null)
    or (status = 'realizado' and data_realizacao is not null)
  )
);

create index fin_lancamentos_user_due
  on public.fin_lancamentos (user_id, status, data_vencimento, created_at desc);

alter table public.fin_lancamentos enable row level security;
revoke all on public.fin_lancamentos from anon;
grant select, insert, update, delete on public.fin_lancamentos to authenticated;

create policy fin_select on public.fin_lancamentos
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy fin_insert on public.fin_lancamentos
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy fin_update on public.fin_lancamentos
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy fin_delete on public.fin_lancamentos
  for delete to authenticated
  using ((select auth.uid()) = user_id);

create function public.touch_fin_lancamento()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_fin_lancamento
before update on public.fin_lancamentos
for each row execute function public.touch_fin_lancamento();
