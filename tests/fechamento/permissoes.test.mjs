/* ==========================================================================
   §50 — Testes de PERMISSÕES
   administrador · gestor · responsável · auditor · visitante ·
   competência fechada · máquina de status.

   Observação sobre "planta sem autorização": essa regra é aplicada pelo RLS no
   Postgres (fm_planta_autorizada), fora do alcance de um teste em Node sem
   banco. Ela está coberta pela migration e listada nas pendências de validação
   — não a marcamos como testada aqui.
   ========================================================================== */
import { suite, teste, esperar } from '../runner.mjs';
import {
  podeFechamento, podeAcessarFechamento, podeTransicionar, TRANSICOES,
  STATUS_COMPETENCIA, ACOES_FECHAMENTO, PAPEIS, AREAS, AREAS_GRUPOS, areaPorId
} from '../../services/fechamento/fm-schema.js';
import { RBAC, can, MODULES, GRUPOS_ORDEM } from '../../services/config.js';

const NAO_ADMIN = ['supervisor', 'auditor', 'auditor_recebimento', 'eng_processos', 'laboratorio', 'visitante'];

suite('§5/§43 — o módulo é exclusivo do administrador', () => {

  teste('administrador pode tudo', () => {
    for (const acao of Object.keys(ACOES_FECHAMENTO)) {
      esperar(podeFechamento('admin', acao)).verdadeiro(`admin deveria poder "${acao}"`);
    }
  });

  teste('NENHUM outro perfil pode NADA — nem ver', () => {
    for (const role of NAO_ADMIN) {
      for (const acao of Object.keys(ACOES_FECHAMENTO)) {
        esperar(podeFechamento(role, acao)).falso(`"${role}" não deveria poder "${acao}"`);
      }
    }
  });

  teste('toda ação do módulo lista apenas "admin"', () => {
    for (const [acao, perfis] of Object.entries(ACOES_FECHAMENTO)) {
      esperar(perfis).profundo(['admin'], `ação "${acao}" liberada para além do admin`);
    }
  });

  teste('perfil desconhecido não recebe nenhuma permissão (fail-closed)', () => {
    esperar(podeFechamento('hacker', 'ver')).falso();
    esperar(podeFechamento(undefined, 'lancar')).falso();
    esperar(podeFechamento(null, 'aprovar')).falso();
  });

  teste('todo perfil do sistema tem um papel mapeado no fechamento', () => {
    for (const role of Object.keys(RBAC)) {
      esperar(PAPEIS[role]).naoNulo(`perfil "${role}" sem papel definido no §43`);
    }
  });
});

suite('§7 — quem pode ENTRAR no módulo (sessão + ativo + aprovado + admin)', () => {
  const admin = { id: 'u1', role: 'admin', ativo: true, status: 'aprovado' };

  teste('administrador ativo e aprovado entra', () => {
    esperar(podeAcessarFechamento(admin)).verdadeiro();
  });

  teste('administrador INATIVO é bloqueado', () => {
    esperar(podeAcessarFechamento({ ...admin, ativo: false })).falso();
  });

  teste('administrador NÃO aprovado é bloqueado', () => {
    for (const status of ['pendente', 'recusado', 'bloqueado']) {
      esperar(podeAcessarFechamento({ ...admin, status })).falso(`status "${status}" deveria bloquear`);
    }
  });

  teste('cadastro legado sem status é tratado como aprovado (mesma regra do login)', () => {
    esperar(podeAcessarFechamento({ id: 'u1', role: 'admin', ativo: true })).verdadeiro();
  });

  teste('sem sessão não entra', () => {
    esperar(podeAcessarFechamento(null)).falso();
    esperar(podeAcessarFechamento(undefined)).falso();
    esperar(podeAcessarFechamento({})).falso();
  });

  teste('nenhum outro perfil entra, mesmo ativo e aprovado', () => {
    for (const role of NAO_ADMIN) {
      esperar(podeAcessarFechamento({ id: 'u9', role, ativo: true, status: 'aprovado' }))
        .falso(`"${role}" não deveria entrar`);
    }
  });
});

suite('§2/§3 — RBAC e posição do módulo na navegação', () => {

  teste('o módulo "fechamento" existe no RBAC de todos os perfis', () => {
    for (const role of Object.keys(RBAC)) {
      esperar(Array.isArray(RBAC[role].fechamento)).verdadeiro(`perfil "${role}" sem entrada de fechamento`);
    }
  });

  teste('somente o admin tem qualquer ação de módulo no fechamento', () => {
    for (const acao of ['view', 'create', 'edit', 'delete', 'approve', 'export']) {
      esperar(can('admin', 'fechamento', acao)).verdadeiro(`admin deveria ter "${acao}"`);
      for (const role of NAO_ADMIN) {
        esperar(can(role, 'fechamento', acao)).falso(`"${role}" não deveria ter "${acao}"`);
      }
    }
  });

  teste('menu vazio para não-admin: RBAC.fechamento é lista vazia', () => {
    for (const role of NAO_ADMIN) {
      esperar(RBAC[role].fechamento).tamanho(0, `"${role}" ainda enxerga o módulo`);
    }
  });

  teste('§3 — Fechamento Mensal é grupo principal próprio, fora de Qualidade', () => {
    const mod = MODULES.find(m => m.id === 'fechamento');
    esperar(mod).naoNulo();
    esperar(mod.group).igual('Fechamento Mensal');
    esperar(GRUPOS_ORDEM.includes('Fechamento Mensal')).verdadeiro();
    /* Entre Qualidade e Administração, como pede o requisito. */
    esperar(GRUPOS_ORDEM.indexOf('Fechamento Mensal') > GRUPOS_ORDEM.indexOf('Qualidade')).verdadeiro();
    esperar(GRUPOS_ORDEM.indexOf('Fechamento Mensal') < GRUPOS_ORDEM.indexOf('Administração')).verdadeiro();
  });

  teste('§3 — o submenu cobre as 6 seções e só aponta para áreas existentes', () => {
    const mod = MODULES.find(m => m.id === 'fechamento');
    esperar(mod.submenu.map(g => g.label)).profundo(AREAS_GRUPOS);
    for (const g of mod.submenu) {
      for (const i of g.itens) {
        esperar(areaPorId(i.hash)).naoNulo(`submenu aponta para área inexistente: #${i.hash}`);
      }
    }
  });

  teste('§3 — toda área do módulo está em algum grupo declarado', () => {
    for (const a of AREAS) {
      esperar(AREAS_GRUPOS.includes(a.grupo)).verdadeiro(`área "${a.id}" com grupo inválido: ${a.grupo}`);
    }
  });

  teste('nenhum módulo pré-existente perdeu permissões (§51.30)', () => {
    /* Trava de regressão: as permissões que existiam antes do Fechamento Mensal
       continuam idênticas. Se alguém alterar uma delas por engano, quebra aqui. */
    esperar(can('supervisor', 'ocorrencias', 'view')).verdadeiro();
    esperar(can('supervisor', 'ocorrencias', 'create')).falso();
    esperar(can('auditor', 'op_auditorias', 'execute')).verdadeiro();
    esperar(can('auditor', 'admin', 'view')).falso();
    esperar(can('visitante', 'perfil', 'view')).verdadeiro();
    esperar(can('visitante', 'dashboard', 'view')).falso();
    esperar(can('admin', 'usuarios', 'delete')).verdadeiro();
    esperar(can('supervisor', 'rel_dim_producao', 'view')).falso();
  });
});

suite('§4 — máquina de status da competência', () => {

  teste('todos os 10 status do requisito existem', () => {
    esperar(STATUS_COMPETENCIA).tamanho(10);
    for (const s of ['Não iniciado', 'Em preenchimento', 'Aguardando informações', 'Em revisão',
                     'Devolvido para correção', 'Aguardando aprovação', 'Aprovado', 'Fechado',
                     'Reaberto', 'Cancelado']) {
      esperar(STATUS_COMPETENCIA.includes(s)).verdadeiro(`status "${s}" ausente`);
    }
  });

  teste('fluxo feliz do §42 é permitido de ponta a ponta', () => {
    esperar(podeTransicionar('Não iniciado', 'Em preenchimento')).verdadeiro();
    esperar(podeTransicionar('Em preenchimento', 'Em revisão')).verdadeiro();
    esperar(podeTransicionar('Em revisão', 'Aguardando aprovação')).verdadeiro();
    esperar(podeTransicionar('Aguardando aprovação', 'Aprovado')).verdadeiro();
    esperar(podeTransicionar('Aprovado', 'Fechado')).verdadeiro();
  });

  teste('devolução para correção é permitida na revisão e na aprovação', () => {
    esperar(podeTransicionar('Em revisão', 'Devolvido para correção')).verdadeiro();
    esperar(podeTransicionar('Aguardando aprovação', 'Devolvido para correção')).verdadeiro();
    esperar(podeTransicionar('Devolvido para correção', 'Em preenchimento')).verdadeiro();
  });

  teste('não é possível pular da abertura direto para aprovado ou fechado', () => {
    esperar(podeTransicionar('Não iniciado', 'Aprovado')).falso();
    esperar(podeTransicionar('Não iniciado', 'Fechado')).falso();
    esperar(podeTransicionar('Em preenchimento', 'Fechado')).falso();
  });

  teste('competência FECHADA só sai por reabertura (§46)', () => {
    esperar(TRANSICOES['Fechado']).profundo(['Reaberto']);
    esperar(podeTransicionar('Fechado', 'Em preenchimento')).falso();
    esperar(podeTransicionar('Fechado', 'Aprovado')).falso();
  });

  teste('reaberta volta a aceitar preenchimento e revisão', () => {
    esperar(podeTransicionar('Reaberto', 'Em preenchimento')).verdadeiro();
    esperar(podeTransicionar('Reaberto', 'Aguardando aprovação')).verdadeiro();
  });

  teste('competência CANCELADA é terminal', () => {
    esperar(TRANSICOES['Cancelado']).tamanho(0);
    for (const s of STATUS_COMPETENCIA) {
      esperar(podeTransicionar('Cancelado', s)).falso(`Cancelado não deveria ir para ${s}`);
    }
  });

  teste('transição para o mesmo status é recusada', () => {
    for (const s of STATUS_COMPETENCIA) esperar(podeTransicionar(s, s)).falso();
  });

  teste('todo destino declarado é um status válido', () => {
    for (const [de, destinos] of Object.entries(TRANSICOES)) {
      esperar(STATUS_COMPETENCIA.includes(de)).verdadeiro(`origem "${de}" não é status válido`);
      for (const para of destinos) {
        esperar(STATUS_COMPETENCIA.includes(para)).verdadeiro(`destino "${para}" (de "${de}") não é status válido`);
      }
    }
  });
});
