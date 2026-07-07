# Componentes de UI — RNA One

A casca da aplicação (sidebar, topbar, notificações, guarda de rota e filtro
RBAC do menu) é montada dinamicamente por **`assets/js/app.js`** (`mountShell()`),
evitando duplicação de HTML nas 14 páginas.

Componentes reutilizáveis de renderização vivem em **`assets/js/ui.js`**:

| Helper | Descrição |
|---|---|
| `toast(msg, opts)` | Notificação flutuante (info/ok/warn/crit) |
| `modal({title, content, footer, size})` | Modal Bootstrap padronizado |
| `confirmDialog(msg, onOk, opts)` | Confirmação de ação |
| `loading(bool)` | Overlay de carregamento |
| `el(html)` / `$` / `$$` | Helpers de DOM |

Gráficos: **`assets/js/charts.js`** (`charts.line/bar/hbar/doughnut/radar`) com a
paleta Rassini.

Para adicionar um novo módulo:
1. Inclua-o em `services/config.js` → `MODULES` e na matriz `RBAC`.
2. Crie a página `nome.html` (copie o template de qualquer página existente).
3. Crie `assets/js/pages/nome.js` chamando `mountShell()` e renderizando o conteúdo.

O menu lateral, o card no portal e a guarda de permissão passam a reconhecer o
módulo automaticamente.
