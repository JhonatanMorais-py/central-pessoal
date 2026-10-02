import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("migração PostgreSQL: isolamento de dois usuários, Storage privado e trava atômica", async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
 grant usage on schema public,auth,storage to authenticated;grant all on storage.objects to authenticated;
 insert into auth.users values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');`);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/202609300001_initial.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/202610010001_financeiro.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/202610010002_tarefas.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(
    (await db.query("select public from storage.buckets")).rows[0].public,
    false,
  );
  await db.exec(`set role authenticated; set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
 insert into public.cad_ideias(id,source,original_text) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','text','minha ideia');
 insert into public.fin_lancamentos(descricao,tipo,status,valor,data_vencimento) values ('Cliente A','entrada','pendente',1250.50,'2026-10-10');
 insert into public.tarefas(titulo,data_limite) values ('Minha tarefa','2026-10-10');
 insert into storage.objects(bucket_id,name) values ('audios','11111111-1111-4111-8111-111111111111/test.webm');`);
  assert.equal((await db.query("select * from cad_ideias")).rows.length, 1);
  assert.equal((await db.query("select * from fin_lancamentos")).rows.length, 1);
  assert.equal((await db.query("select * from tarefas")).rows.length, 1);
  assert.equal(
    (
      await db.query(
        `select * from claim_idea('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',gen_random_uuid())`,
      )
    ).rows.length,
    1,
  );
  assert.equal(
    (
      await db.query(
        `select * from claim_idea('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',gen_random_uuid())`,
      )
    ).rows.length,
    0,
  );
  await db.exec(
    `set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';`,
  );
  assert.equal((await db.query("select * from cad_ideias")).rows.length, 0);
  assert.equal((await db.query("select * from fin_lancamentos")).rows.length, 0);
  assert.equal((await db.query("select * from tarefas")).rows.length, 0);
  assert.equal(
    (await db.query("select * from storage.objects")).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query(
        `update cad_ideias set original_text='invadido' returning id`,
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (await db.query(`delete from cad_ideias returning id`)).rows.length,
    0,
  );
  assert.equal(
    (await db.query(`update fin_lancamentos set valor=1 returning id`)).rows.length,
    0,
  );
  assert.equal(
    (await db.query(`delete from fin_lancamentos returning id`)).rows.length,
    0,
  );
  assert.equal(
    (await db.query(`update tarefas set concluida=true, concluida_em=now() returning id`)).rows.length,
    0,
  );
  assert.equal((await db.query(`delete from tarefas returning id`)).rows.length, 0);
  await assert.rejects(
    () =>
      db.exec(
        `insert into cad_ideias(user_id,source,original_text) values ('11111111-1111-4111-8111-111111111111','text','forjado')`,
      ),
    /row-level security/,
  );
  await assert.rejects(
    () =>
      db.exec(
        `insert into storage.objects(bucket_id,name) values ('audios','11111111-1111-4111-8111-111111111111/forjado.webm')`,
      ),
    /row-level security/,
  );
  await assert.rejects(
    () =>
      db.exec(
        `insert into fin_lancamentos(user_id,descricao,tipo,valor,data_vencimento) values ('11111111-1111-4111-8111-111111111111','forjado','saida',10,current_date)`,
      ),
    /row-level security/,
  );
  await assert.rejects(
    () =>
      db.exec(
        `insert into fin_lancamentos(descricao,tipo,status,valor,data_vencimento) values ('inválido','entrada','realizado',10,current_date)`,
      ),
    /realizacao_consistente/,
  );
  await assert.rejects(
    () =>
      db.exec(
        `insert into tarefas(user_id,titulo) values ('11111111-1111-4111-8111-111111111111','forjada')`,
      ),
    /row-level security/,
  );
  await assert.rejects(
    () => db.exec(`insert into tarefas(titulo,concluida) values ('inválida',true)`),
    /conclusao_consistente/,
  );
  await db.close();
});
