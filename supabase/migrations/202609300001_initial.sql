create table public.cad_ideias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source text not null check (source in ('text','audio')),
  audio_path text,
  original_text text check (char_length(original_text) <= 20000),
  summary text,
  prompt text,
  generate_prompt boolean not null default false,
  status text not null default 'pending' check (status in ('pending','transcribing','generating','ready','error','deleting')),
  error_message text,
  lock_token uuid,
  locked_until timestamptz,
  constraint valid_source check ((source='text' and audio_path is null and original_text is not null) or (source='audio' and audio_path is not null)),
  constraint own_audio_path check (audio_path is null or audio_path ~ ('^' || user_id::text || '/' || id::text || '\.(webm|mp4|ogg)$'))
);
create index cad_ideias_user_created on public.cad_ideias (user_id, created_at desc);
alter table public.cad_ideias enable row level security;
revoke all on public.cad_ideias from anon;
grant select, insert, update, delete on public.cad_ideias to authenticated;
create policy ideias_select on public.cad_ideias for select to authenticated using ((select auth.uid())=user_id);
create policy ideias_insert on public.cad_ideias for insert to authenticated with check ((select auth.uid())=user_id);
create policy ideias_update on public.cad_ideias for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy ideias_delete on public.cad_ideias for delete to authenticated using ((select auth.uid())=user_id);
create function public.touch_idea() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=now(); return new; end; $$;
create trigger touch_idea before update on public.cad_ideias for each row execute function public.touch_idea();
-- Operação atômica: serializa processamento, correção e exclusão entre abas.
create function public.claim_idea(p_id uuid, p_token uuid) returns setof public.cad_ideias
language sql security invoker set search_path='' as $$
  update public.cad_ideias set lock_token=p_token, locked_until=now()+interval '180 seconds'
  where id=p_id and user_id=(select auth.uid()) and (locked_until is null or locked_until < now()) returning *;
$$;
revoke all on function public.claim_idea(uuid,uuid) from public, anon;
grant execute on function public.claim_idea(uuid,uuid) to authenticated;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('audios','audios',false,25000000,array['audio/webm','audio/mp4','audio/ogg'])
on conflict (id) do update set public=false,file_size_limit=25000000,allowed_mime_types=excluded.allowed_mime_types;
create policy audio_select on storage.objects for select to authenticated using (bucket_id='audios' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy audio_insert on storage.objects for insert to authenticated with check (bucket_id='audios' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy audio_update on storage.objects for update to authenticated using (bucket_id='audios' and (storage.foldername(name))[1]=(select auth.uid())::text) with check (bucket_id='audios' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy audio_delete on storage.objects for delete to authenticated using (bucket_id='audios' and (storage.foldername(name))[1]=(select auth.uid())::text);
