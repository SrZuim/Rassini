# RNA One — Backend Supabase

Guia rápido para conectar a plataforma a um projeto Supabase real.

## 1. Criar o projeto
1. Acesse https://supabase.com e crie um projeto.
2. Copie **Project URL** e **anon public key** (Settings → API).

## 2. Configurar o front-end
Edite `services/config.js`:

```js
export const SUPABASE = {
  url: 'https://SEU-PROJETO.supabase.co',
  anonKey: 'SUA-ANON-KEY',
  get enabled() { return Boolean(this.url && this.anonKey); }
};
```

Com as credenciais preenchidas, a camada `services/db.js` passa a usar o
Supabase automaticamente (caso contrário, roda em **modo demo** com `localStorage`).

## 3. Criar o banco
No **SQL Editor** do Supabase, execute na ordem:
1. `database/schema.sql` — tabelas, enums, índices e trigger de log
2. `database/rls.sql` — Row Level Security e políticas por perfil
3. `database/seed.sql` — dados iniciais

## 4. Autenticação
1. Authentication → Providers → **Email** habilitado.
2. Crie os usuários (mesmo e-mail do `seed.sql`).
3. Atualize `usuarios.auth_id` com o `id` de `auth.users`:

```sql
update usuarios u set auth_id = a.id
from auth.users a where a.email = u.email;
```

## 5. Storage (fotos/evidências)
Crie os buckets: **`evidencias`**, `comunicados`, `documentos`.

Para o upload de evidências (`assets/js/evidence.js`) funcionar, crie o bucket
`evidencias` (recomendado **público** para leitura) e uma policy de insert para
usuários autenticados:

```sql
-- no Storage: bucket "evidencias" (public read)
insert into storage.buckets (id, name, public) values ('evidencias','evidencias', true)
on conflict (id) do nothing;

create policy "evidencias_insert_auth" on storage.objects for insert to authenticated
  with check (bucket_id = 'evidencias');
create policy "evidencias_read_public" on storage.objects for select to public
  using (bucket_id = 'evidencias');
```

O componente envia a imagem (comprimida) para
`evidencias/<tipo>/<id>/<timestamp>_<arquivo>` e grava a URL pública na tabela
`evidencias`. **Sem Supabase configurado**, ele usa fallback **Base64 local**
automaticamente — a mesma API, pronta para migrar.

## 6. Realtime
Database → Replication → habilite as tabelas `nao_conformidades`, `maquinas`,
`rotinas` para alimentar a Gestão à Vista (`services/integrations/realtime.js`).

## 7. Integrações
- **Power BI**: preencha `configuracoes.powerbi` e use `services/integrations/powerbi.js`.
- **Pipefy**: preencha `configuracoes.pipefy`; recomenda-se uma **Edge Function**
  para não expor o token no client.
