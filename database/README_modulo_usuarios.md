# RNA One — Módulo Corporativo de Usuários

Cadastro público, aprovação e gerenciamento de usuários, 100% dentro da RNA One
(sem acessar o Supabase manualmente para liberar acesso).

Fluxo: **Funcionário solicita → Administrador analisa → Aprova/Recusa → Usuário acessa conforme o perfil.**

---

## 1. Arquivos do módulo

### Criados
| Arquivo | Função |
|---|---|
| `database/modulo_usuarios.sql` | Colunas, enum, `usuarios_logs`, triggers de signup/guard, RPCs, RLS |
| `database/rollback_modulo_usuarios.sql` | Reversão segura (sem apagar dados) |
| `database/README_modulo_usuarios.md` | Este guia |
| `cadastro.html` | Cadastro público (mesma identidade do login) |
| `admin-usuarios.html` | Casca da tela de administração |
| `assets/js/pages/admin-usuarios.js` | Dashboard, tabela, filtros, drawer e ações |
| `services/usuarios.js` | Serviço de leitura + RPCs (com fallback demo) |

### Modificados (aditivos, marcados com `[MÓDULO USUÁRIOS]`)
| Arquivo | O que mudou |
|---|---|
| `services/auth.js` | `auth.signup()`, `emailCorporativoValido()`, gate de status no login, carimbo de último login |
| `services/config.js` | Módulo `usuarios` em `MODULES` + `RBAC` (só admin) |
| `assets/js/app.js` | Notificações em tempo real no sino (Supabase Realtime) |
| `assets/js/pages/perfil.js` | Botões "Alterar foto" e "Alterar senha" |
| `assets/css/rna.css` | CSS do drawer lateral + skeleton loading |
| `login.html` | Link "Solicitar acesso" |

### Reutilizados sem alteração
`app.js/mountShell`, `ui.js` (toast/modal/confirm), `db.js`, `supabaseclient.js`,
`integrations/realtime.js`, tabela `notificacoes`, identidade visual e RBAC existentes.

---

## 2. Guia de instalação

### 2.1 Banco (Supabase → SQL Editor)
Execute na ordem (todos idempotentes):
1. `database/schema.sql`  *(se ainda não aplicado)*
2. `database/rls.sql`  *(se ainda não aplicado)*
3. `database/fix_auth_usuarios.sql`  *(se ainda não aplicado)*
4. **`database/modulo_usuarios.sql`**  ← este módulo

### 2.2 Configurações do painel Supabase
1. **Authentication → Providers → Email → desative "Confirm email".**
   O único gate passa a ser a aprovação do administrador.
2. **Database → Replication →** habilite a tabela **`notificacoes`** (para o sino em tempo real).
3. Storage é **opcional** — a foto de perfil é salva como imagem comprimida (Base64)
   na coluna `usuarios.avatar`; não requer bucket.

### 2.3 Front-end
Nenhum passo extra: as credenciais em `services/config.js` já ativam o backend real.
Basta publicar os arquivos novos/modificados.

---

## 3. Guia de migração (compatibilidade)

- **Colunas** adicionadas via `ADD COLUMN IF NOT EXISTS` — nenhuma tabela recriada.
- **Backfill automático:** todo usuário que já existia recebe `status='aprovado'` e
  `ativo=true`, então **continua logando sem interrupção**.
- **Domínio corporativo:** a trava `@rassininhk.com.br` vale **apenas para
  cadastros novos**. Contas atuais (`admin@rassini.com`, e-mail do admin) são
  preservadas — ver ramo (a) da função `fn_usuario_signup`.
- **Roles:** mantém o padrão interno (`admin/supervisor/auditor/visitante`) e o
  enum `perfil_tipo` já existente. Nada foi renomeado.

### Estados do usuário
| status | ativo | login | significado |
|---|---|---|---|
| `pendente`  | false | ❌ bloqueado | aguardando aprovação |
| `aprovado`  | true  | ✅ liberado  | acesso normal |
| `recusado`  | false | ❌ bloqueado | solicitação negada |
| `bloqueado` | false | ❌ bloqueado | acesso suspenso pelo admin |

---

## 4. Segurança (defesa em profundidade — requisito #14)

Mesmo via DevTools / Postman / RPC / SQL direto, **é impossível**:
- Nascer/tornar-se **admin** ou **supervisor** no auto-cadastro
  → `fn_usuario_signup` faz *clamp* server-side para `auditor/visitante`.
- Um não-admin alterar o próprio `role`, `status`, `ativo`, `email` ou `planta`
  → `fn_guard_usuarios_update` (BEFORE UPDATE) restaura os valores antigos.
- Aprovar/promover/excluir sem ser admin
  → RPCs `SECURITY DEFINER` checam `current_perfil()='admin'`.
- Admin agir sobre si mesmo em bloqueio/cargo/exclusão
  → guarda explícita nas RPCs.
- Cadastrar com domínio não corporativo
  → validado no front **e** no trigger do banco.

Toda ação administrativa é registrada em `usuarios_logs`
(quem, quem foi afetado, ação, antes/depois, data/hora, IP quando disponível).

---

## 5. Plano de rollback

Execute `database/rollback_modulo_usuarios.sql` no SQL Editor. Ele:
- remove triggers, funções e RPCs do módulo;
- restaura o gatilho original de vínculo de `auth_id`;
- dropa `usuarios_logs`;
- **mantém** as colunas novas e os dados dos usuários (drop é opcional e está
  comentado no fim do script).

No front-end, para reverter:
1. remova `cadastro.html`, `admin-usuarios.html`,
   `assets/js/pages/admin-usuarios.js`, `services/usuarios.js`;
2. reverta os trechos marcados `[MÓDULO USUÁRIOS]` em `auth.js`, `config.js`,
   `app.js`, `perfil.js`, `rna.css` e `login.html` (todos isolados).

Como todas as mudanças de front são aditivas, remover os arquivos novos e os
blocos marcados restaura exatamente o comportamento anterior.

---

## 6. Checklist de teste

- [ ] `modulo_usuarios.sql` roda sem erro; `SELECT ... FROM usuarios` mostra os
      antigos como `aprovado/true`.
- [ ] Cadastro com `@gmail.com` é recusado ("Utilize seu e-mail corporativo…").
- [ ] Cadastro com `@rassininhk.com.br` cria usuário `pendente/inativo`.
- [ ] Login desse usuário mostra "aguardando aprovação".
- [ ] Admin vê o card "Cadastros pendentes" e a linha na tabela.
- [ ] Aprovar → usuário passa a logar normalmente.
- [ ] Recusar/Bloquear → login exibe a mensagem correta.
- [ ] Alterar cargo funciona; tentar alterar o próprio cargo é bloqueado.
- [ ] Nova solicitação dispara o sino em tempo real para o admin logado.
- [ ] "Meu Perfil" troca foto e senha; não expõe cargo/status/planta.
- [ ] `usuarios_logs` registra cada ação.
