# CitraCRM

CRM pessoal para organizar ideias, finanças e tarefas em um só lugar. O módulo financeiro registra entradas, saídas, contas a pagar e contas a receber; tarefas podem ser concluídas e reabertas; ideias aceitam texto ou áudio. A aplicação usa HTML, CSS e JavaScript com Vite, Supabase Auth/PostgreSQL/Storage e publicação estática no Render.

## 1. Preparar o Supabase

1. Crie um projeto no [Supabase](https://supabase.com/dashboard). Guarde sua URL `https://SEU-PROJETO.supabase.co` e a **publishable key** (`sb_publishable_...`, Settings → API Keys). A chave legada `anon` também funciona. Nunca use `service_role` ou secret key no navegador.
2. Gere um token pessoal em **Account → Access Tokens** e preencha `SUPABASE_ACCESS_TOKEN` no arquivo `.env`. Essa variável é privada e serve somente para autenticar o Supabase CLI. Ela não usa o prefixo `VITE_`, não entra no bundle do navegador e não deve ser configurada no Render.
3. Abra **SQL Editor** e execute, na ordem, as migrações `202609300001_initial.sql`, `202610010001_financeiro.sql` e `202610010002_tarefas.sql` em `supabase/migrations/`. Elas criam ideias, lançamentos financeiros, tarefas, políticas RLS e o bucket privado `audios`. Alternativamente, carregue as variáveis com `set -a; source .env; set +a`, execute `npx supabase link --project-ref SEU-PROJETO` e depois `npx supabase db push`.
4. Em **Authentication → Sign In / Providers**, desative **Allow new users to sign up**. O `config.toml` faz isso no ambiente local, mas não substitui a configuração do projeto hospedado. Mantenha login por e-mail e senha habilitado.
5. Em **Authentication → Users → Add user → Create new user**, crie seu e-mail e uma senha forte e marque confirmação automática do e-mail. A aplicação não oferece cadastro público, convite ou recuperação de senha. Para redefinir sua senha, use o painel administrativo do Supabase.
6. Em **Authentication → URL Configuration**, configure o Site URL final do Render. Para o desenvolvimento, inclua `http://localhost:5173` entre as URLs permitidas.

## 2. Configurar a Groq e publicar a função

Crie uma chave em [Groq Console](https://console.groq.com/keys). Não a coloque no `.env` do front-end. Copie o exemplo da função:

```bash
cp supabase/functions/.env.example supabase/functions/.env
```

Edite `supabase/functions/.env`, que é ignorado pelo Git:

- `GROQ_API_KEY`: sua chave privada.
- `GROQ_TRANSCRIPTION_MODEL=whisper-large-v3-turbo`.
- `GROQ_TEXT_MODEL=openai/gpt-oss-20b`.
- `MAX_AUDIO_BYTES=25000000`: pode diminuir; o código limita o máximo a 25 MB por envio multipart.
- `MAX_RECORDING_SECONDS=300`: duração configurada no servidor.
- `ALLOWED_ORIGINS=http://localhost:5173,https://SEU-SITE.onrender.com`: origens exatas, sem barra final. Troque pelo endereço real do Render. Adicione domínio próprio se necessário.

Enquanto a integração de IA não estiver configurada, use `VITE_AI_ENABLED=false`. Nesse modo, texto e áudio são salvos normalmente, mas transcrição, resumo e prompt ficam desativados. Depois de publicar a Edge Function com um provedor configurado, altere a variável para `true` e gere um novo build.

No terminal, na raiz do projeto:

```bash
set -a
source .env
set +a
npx supabase link --project-ref SEU-PROJETO
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy ideias
```

`SUPABASE_URL` e as chaves públicas são fornecidos automaticamente pelo ambiente Edge do Supabase. A função prefere `SUPABASE_PUBLISHABLE_KEYS.default` e usa `SUPABASE_ANON_KEY` como fallback para ambientes legados. A função não usa `service_role`. `verify_jwt=false` desativa apenas a verificação legada no gateway: **cada chamada valida o Bearer token com `auth.getUser` antes de consultar os dados**. O cliente interno repassa o token e respeita RLS. Não remover essa validação. A configuração permite JWTs assimétricos e chaves publishable.

Antes de usar, confira na sua conta se os dois modelos estão ativos e autorizados. A API autenticada `GET https://api.groq.com/openai/v1/models` lista os modelos disponíveis; não exponha a chave para fazer essa verificação no navegador. Os identificadores padrão constavam da documentação oficial consultada em **30/09/2026**. Mudanças futuras exigem ajustar os segredos e verificar suporte a `verbose_json` (transcrição) e `json_object` (texto).

## 3. Executar localmente

Requer Node.js 22.12+ ou 24 e npm.

```bash
npm ci
cp .env.example .env
```

Preencha `.env` com URL e chave **públicas** do projeto. Defina `VITE_MAX_RECORDING_SECONDS=300` (mantenha igual ao segredo da função). Depois:

```bash
npm run dev
```

Abra `http://localhost:5173`. Faça login com o usuário criado. O front-end local usa o Supabase hospedado que você configurou; não é necessário Docker nem servidor Node em produção. Reinicie Vite depois de alterar `.env`. Sem configuração, a tela mostra instruções de preparação, sem simular dados salvos.

### Demonstração local sem Supabase

Este repositório inclui `.env.demo` para testar a interface imediatamente com `npm run dev:demo`. Use `teste@local.dev` e senha `teste123`. Nesse modo, o servidor de desenvolvimento do Vite mantém ideias, áudios, lançamentos financeiros e tarefas somente em memória e simula resumo, prompt e transcrição. Os dados são apagados ao reiniciar o servidor. O plugin de demonstração só é usado no servidor de desenvolvimento e não faz parte de `npm run build` nem da publicação no Render.

Para usar um Supabase real localmente, preencha o arquivo `.env` já criado na raiz e execute `npm run dev`. Preencha também `supabase/functions/.env` antes de publicar a função.

O microfone exige HTTPS ou localhost. Acesso por um IP local usando HTTP normalmente não permite gravar. Chrome, Firefox e Safari modernos são negociados com `MediaRecorder.isTypeSupported`. Os formatos usados são WebM/Opus, MP4 e Ogg/Opus; não há conversão nem renomeação de formato.

## 4. Publicar como Static Site no Render

1. Coloque este projeto em um repositório Git privado ou público, sem `.env`, chaves nem arquivos de áudio. O `.gitignore` está pronto.
2. No Render, selecione **New → Static Site**, conecte o repositório e a branch.
3. Defina **Build Command**: `npm ci && npm run build`.
4. Defina **Publish Directory**: `dist`.
5. Adicione `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` e `VITE_MAX_RECORDING_SECONDS=300` como variáveis de ambiente do site. Esses valores são públicos e incorporados no build.
6. Publique. Copie o domínio HTTPS real para `ALLOWED_ORIGINS` da função e para Site URL no Supabase. Atualize os segredos pelo comando da seção 2. Alterações em variáveis `VITE_` exigem novo build no Render.
7. Use o `render.yaml` como Blueprint para aplicar também os cabeçalhos de segurança. Na criação manual, replique em **Headers** os cabeçalhos do YAML, principalmente a CSP e `Permissions-Policy`. Se usar domínio personalizado no Supabase, ajuste `connect-src` e `media-src` na CSP.

Não configure Web Service pago ou processo `npm run dev` para produção: o artefato servido é somente `dist`. `npm run build && npm run preview` permite testar o build localmente. O repositório inclui fontes via Google Fonts, com fallback sans-serif se elas não carregarem.

## Fluxos e recuperação

- **Tarefas:** permite criar, editar, concluir, reabrir, buscar, filtrar e excluir. O prazo é opcional; tarefas pendentes com prazo anterior ao dia atual são identificadas como atrasadas.
- A contagem no menu representa apenas tarefas pendentes. Os cartões do módulo mostram pendentes, concluídas e atrasadas.
- Cada tarefa pertence ao usuário autenticado e está protegida por políticas RLS de leitura, criação, alteração e exclusão.
- **Financeiro:** um lançamento de entrada pendente representa uma conta a receber; uma saída pendente representa uma conta a pagar. Ao marcar como recebido ou pago, o valor passa para o saldo realizado e para os totais do mês da data de realização.
- Os cartões mostram saldo realizado, entradas e saídas do mês e o total em aberto. Busca, tipo e situação filtram a lista sem alterar os totais gerais.
- Valores financeiros são armazenados como `numeric(14,2)`, nunca como ponto flutuante. Data de realização é obrigatória para registros realizados e proibida para pendentes; o banco também valida essas regras.
- Todos os lançamentos pertencem ao usuário autenticado. As quatro políticas RLS bloqueiam leitura, criação, alteração e exclusão de dados de outro usuário.
- Texto: salva primeiro a ideia; a função gera resumo e, opcionalmente, prompt.
- Áudio: solicita microfone somente ao clicar, mostra contador, permite parar/cancelar/ouvir/regravar, faz upload privado, salva registro e então transcreve. A transcrição é persistida antes da geração.
- O áudio e o texto são formas alternativas de criar uma ideia; limpe/envie o texto antes de iniciar uma gravação.
- Transcrição usa `language=pt`. Segmentos com confiança baixa, probabilidade elevada de silêncio ou repetição recebem marca de trecho incompreensível/incerto. É uma heurística, não garantia de transcrição perfeita. Ouça e revise.
- **Corrigir texto → Salvar correção** salva a versão corrigida e invalida resumo/prompt anteriores. **Salvar e gerar resumo + prompt** salva antes de chamar a IA. Não há retranscrição quando já existe texto, inclusive corrigido.
- Falhas de IA preservam o registro e o áudio. Use **Tentar novamente**; o mesmo registro é atualizado. Não há retry automático que consuma a cota repetidamente.
- Envios usam UUID estável durante a tentativa e inserção idempotente; uma resposta perdida não duplica a ideia. Se upload/registro falharem, mantenha a aba aberta e clique novamente em **Salvar ideia**. O navegador avisa ao sair com rascunho. Rascunhos ainda não enviados não persistem após fechar/recarregar a página.
- Não existe transação distribuída entre Storage e PostgreSQL. Se o upload concluir e você fechar a aba antes de criar o registro, o áudio pode ficar órfão no bucket. O caminho é `seu-usuario/uuid-da-ideia.ext`; confira se esse UUID existe em `cad_ideias` antes de remover manualmente o objeto pelo painel. Não há rotina automática destrutiva.
- Uma trava de até 180 segundos impede chamadas concorrentes para a mesma ideia (processamento, correção ou exclusão). Em interrupções abruptas do servidor, aguarde três minutos e tente novamente. As chamadas Groq têm timeout de 55 segundos por etapa.
- Reprodução usa URL assinada válida por 10 minutos. Clique em **Ouvir áudio original** para renovar. URLs assinadas são temporariamente acessíveis a quem as possuir; não as compartilhe.
- Exclusão pede confirmação e remove primeiro o áudio. Se essa etapa falhar, mantém o registro; se remover áudio mas falhar no banco, mantém indicação para repetir a exclusão e concluir. O botão continua disponível. Não exclua usuários diretamente antes de limpar suas ideias: a cascata do banco não remove objetos do Storage.
- Textos da IA são renderizados via `textContent`, nunca como HTML. O prompt é somente texto para cópia manual. A IA recebe instruções de não ampliar o escopo e tratar a ideia como dados; revise o resultado, pois modelos podem errar.

## Limites e custos

O gratuito não é ilimitado. A Groq aplica limites por requisições, tokens e duração de áudio, conforme conta/modelo, e pode retornar HTTP 429. Consulte **Limits** no Console e configure limites de gasto. O Supabase também tem cotas de banco, Storage, tráfego e Edge Functions; o Render tem limites próprios de banda/build.

O site para a gravação em cinco minutos por padrão. O servidor verifica tamanho, MIME, extensão e assinatura do contêiner (WebM/MP4/Ogg); a Groq valida/decodifica o áudio. A duração é conferida pelo metadado retornado pela transcrição, portanto um cliente adulterado pode consumir uma chamada antes dessa verificação. Não há transcodificador nem decoder de duração no servidor. Áudios acima da duração têm a transcrição preservada para revisão, e a geração pode ser retomada usando esse texto. Tamanho máximo de 25 MB é aplicado antes da chamada e no bucket. Alterar a duração não aumenta o limite de bytes. Textos: até 20.000 caracteres. Histórico: páginas de 30 ideias.

## Validação

```bash
npm test
npx playwright install chromium
npm run test:e2e
npx deno check supabase/functions/ideias/index.ts
npx deno test --allow-env tests/edge.test.ts
npm run build
```

- Testes Node: tarefas, conversão de moeda, totais financeiros, negociação de formatos e validação de áudio/IA; as três migrações são executadas em PostgreSQL WASM (PGlite) com dois usuários para testar RLS e consistência. O esquema Auth/Storage é simulado nesse teste.
- Testes de navegador Chromium: tarefas e financeiro completos, login, texto, geração, cópia, correção, exclusão/cancelamento, logout, cota/retry sem duplicação, gravação via MediaRecorder com microfone sintético, limite automático, upload e layout móvel. As APIs são simuladas, sem gastar cota.
- Testes Edge: executam o handler real com transporte HTTP simulado. Não substituem teste com serviço hospedado.
- Build não exige chaves reais. Sem elas, integrações reais, reprodução remota, qualidade de áudio físico, Safari/iOS e publicação não podem ser confirmadas.

### Checklist após configurar os serviços reais

1. Entrar com usuário válido; tentar senha incorreta e verificar erro. Confirmar que cadastro público está desativado no painel.
2. Enviar texto com e sem "Gerar prompt"; conferir registro, resumo, prompt e cópia.
3. Permitir o microfone, gravar, parar, ouvir o rascunho, regravar, cancelar e atingir o limite. Negar permissão e verificar mensagem.
4. Enviar áudio: observar upload/transcrição/geração, conferir áudio no bucket privado e transcrição em português no banco. Ouvir o original pelo histórico e renovar link depois de expirar.
5. Corrigir texto e gerar novamente: conferir que usa a correção, sem nova transcrição.
6. Simular falha de Groq (modelo temporariamente inválido); verificar preservação do áudio e erro, restaurar configuração e tentar novamente sem duplicar registro.
7. Recarregar e confirmar histórico; abrir duas abas e tentar processar a mesma ideia simultaneamente.
8. Cancelar exclusão, depois confirmar; conferir ausência no banco e Storage. Simular falha de Storage em projeto de teste para verificar exclusão parcial e nova tentativa.
9. Criar segundo usuário administrativo temporário; confirmar que não acessa registros, arquivos, signed URLs nem função para IDs do primeiro. Remover esse usuário de teste depois.
10. Repetir gravação/reprodução no celular real e no domínio HTTPS do Render.

## Arquivos e referências oficiais

`src/`: interface e integração; `supabase/migrations/`: esquema/RLS; `supabase/functions/ideias/`: processamento, correção e exclusão; `tests/`: validação; `render.yaml`: hospedagem.

Documentação consultada em 30/09/2026:

- [Groq — Speech to Text](https://console.groq.com/docs/speech-to-text): formatos, tamanho, `verbose_json` e indicadores de confiança.
- [Groq — Models](https://console.groq.com/docs/models) e [Rate Limits](https://console.groq.com/docs/rate-limits).
- [Supabase — autenticação explícita em Edge Functions](https://supabase.com/docs/guides/functions/auth-legacy-jwt).
- [Supabase — bucket privado](https://supabase.com/docs/guides/storage/buckets/fundamentals) e [URLs assinadas](https://supabase.com/docs/guides/storage/serving/downloads).
- [Render — Static Sites](https://render.com/docs/static-sites).

- [Supabase — migração de chaves](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).
- [Groq — Structured Outputs e JSON mode](https://console.groq.com/docs/structured-outputs).
