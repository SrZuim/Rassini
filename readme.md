# RNA One — Plataforma Integrada de Operações Industriais
### Rassini NHK Automotive

Plataforma corporativa interna para **monitoramento industrial, auditorias,
check-in de plantão, produtividade de auditores, checklist de máquinas,
não conformidades, planos de ação e indicadores** — com identidade visual
Rassini NHK (grafite, cinza industrial, branco e amarelo institucional) e
arquitetura pronta para Indústria 4.0.

---

## ▶️ Como rodar

A plataforma é **100% estática** (HTML/CSS/JS ES6) e funciona em **modo demo**
sem backend. Como usa ES Modules, sirva por HTTP (não abra via `file://`):

```bash
# na pasta do projeto
python -m http.server 5566
# acesse http://localhost:5566/login.html
```

A plataforma **abre primeiro em `login.html`** — toda página interna exige sessão
válida (redireciona ao login se não autenticado e mostra "Acesso restrito" se o
perfil não tiver permissão).

### 🔐 Login local (usuários pré-programados)

Credenciais em [`services/users.json`](services/users.json) — **edite ali** e-mails,
senhas e perfis:

| Perfil | E-mail | Senha | Vai para |
|---|---|---|---|
| Administrador | `admin@rassini.com` | `admin123` | Portal completo |
| Supervisor | `supervisor@rassini.com` | `supervisor123` | Dashboard (consulta) |
| Auditor | `auditor@rassini.com` | `auditor123` | Check-in do plantão |
| Visitante | `visitante@rassini.com` | `visitante123` | Home institucional |

Ou use **Acesso rápido** na tela de login. A sessão expira em **8 horas**, o
logout encerra a sessão, e os acessos (login/logout/falha) ficam registrados em
**Administração → Logs de Acesso**. A senha nunca é gravada na sessão.

> Modo demo persiste em `localStorage`. Em *Meu Perfil* há a opção de restaurar
> os dados de demonstração. Migração para Supabase Auth: ver `supabase/README.md`.

## 🔌 Conectar ao Supabase

Preencha `services/config.js → SUPABASE` e execute os SQLs em `database/`.
Passo a passo completo em [`supabase/README.md`](supabase/README.md).

---

## 🧱 Arquitetura

```
/index.html  login.html  dashboard.html  monitoramento.html  checkin.html
/rotinas.html  diario.html  auditorias.html  checklist.html  ocorrencias.html
/planos-acao.html  documentos.html  treinamentos.html  perfil.html

/assets/css/rna.css            → design system (tema Rassini, componentes)
/assets/js/app.js              → app shell (sidebar/topbar, guarda, RBAC)
/assets/js/ui.js               → toasts, modais, helpers de DOM
/assets/js/charts.js           → fábrica de gráficos (Chart.js)
/assets/js/pages/*.js          → lógica de cada página
/assets/rassini/               → imagens da marca (logos, banners, fábrica)

/services/config.js            → módulos, perfis, RBAC, status, SLA
/services/auth.js              → autenticação e sessão
/services/db.js                → camada de dados (demo localStorage ↔ Supabase)
/services/seed.js              → dados semente do modo demo
/services/supabaseClient.js    → cliente Supabase (lazy)
/services/integrations/        → Power BI, Pipefy, Realtime (stubs fase 2)

/database/schema.sql  rls.sql  seed.sql   → banco Supabase (21 tabelas + RLS)
/supabase/README.md                       → guia de setup do backend
/components/README.md                     → padrão de componentes
```

### Decisões de arquitetura
- **Shell único injetado por JS**: navegação, guarda de rota e permissões em um só lugar.
- **RBAC central** (`config.js`): perfil → módulo → ação (`view/create/edit/delete/approve/export`).
- **Camada de dados abstrata**: mesma API para demo (`localStorage`) e Supabase.
- **Trilha de auditoria** (`logs`): registra quem, o quê, quando, antes/depois e dispositivo.
- **Escalável**: novo módulo = 1 entrada em `MODULES` + 1 página + 1 script.

## 👥 Perfis e permissões

| Perfil | Acesso |
|---|---|
| **Administrador** | Total em todos os módulos |
| **Supervisor** | Cria/edita/aprova auditorias, NCs e planos; publica comunicados |
| **Auditor** | Executa rotinas, diário, checklist, abre NCs e planos |
| **Visitante** | Somente leitura |

## 📦 Módulos
Monitoramento (Gestão à Vista/Andon) · Check-in do Plantão · Minhas Rotinas ·
Diário de Bordo · Auditorias (LPA) · Checklist de Máquinas · Não Conformidades ·
Plano de Ação (5W2H) · Dashboard/Indicadores · Power BI · Comunicados ·
Documentos · Treinamentos · Meu Perfil.

## 🚀 Recursos Indústria 4.0 incorporados
- **OEE** por máquina e **Eficiência do plantão**
- **Painel Andon** com alerta de defeito crítico em tempo real
- **Modo TV / Gestão à Vista** (kiosk fullscreen, auto-refresh)
- **SLA por severidade** em NCs e planos de ação
- Abertura **automática de NC crítica** a partir do checklist reprovado

## 🛠️ Stack
HTML5 · CSS3 · JavaScript ES6+ · Bootstrap 5 · Chart.js · Bootstrap Icons ·
Font Awesome · Supabase (Auth, DB, Storage, Realtime).

---
© 2026 Rassini NHK Automotive — Uso interno.
