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
  podeFechamento, podeTransicionar, TRANSICOES, STATUS_COMPETENCIA,
  ACOES_FECHAMENTO, PAPEIS
} from '../../services/fechamento/fm-schema.js';
import { RBAC, can } from '../../services/config.js';

suite('§43 — permissões por perfil', () => {

  teste('administrador pode tudo', () => {
    for (const acao of Object.keys(ACOES_FECHAMENTO)) {
      esperar(podeFechamento('admin', acao)).verdadeiro(`admin deveria poder "${acao}"`);
    }
  });

  teste('gestor da qualidade (supervisor) revisa, aprova, fecha e gera', () => {
    for (const acao of ['revisar', 'aprovar', 'fechar', 'gerar', 'importar', 'lancar', 'ver']) {
      esperar(podeFechamento('supervisor', acao)).verdadeiro(`supervisor deveria poder "${acao}"`);
    }
  });

  teste('gestor NÃO configura metas/critérios nem reabre competência', () => {
    esperar(podeFechamento('supervisor', 'configurar')).falso();
    esperar(podeFechamento('supervisor', 'reabrir')).falso();
    esperar(podeFechamento('supervisor', 'excluir')).falso();
  });

  teste('auditor lança dados mas NÃO aprova (§44.3)', () => {
    esperar(podeFechamento('auditor', 'lancar')).verdadeiro();
    esperar(podeFechamento('auditor', 'ver')).verdadeiro();
    esperar(podeFechamento('auditor', 'aprovar')).falso();
    esperar(podeFechamento('auditor', 'fechar')).falso();
    esperar(podeFechamento('auditor', 'importar')).falso();
    esperar(podeFechamento('auditor', 'reabrir')).falso();
  });

  teste('cargos de medição têm o mesmo alcance do auditor', () => {
    for (const cargo of ['auditor_recebimento', 'eng_processos', 'laboratorio']) {
      esperar(podeFechamento(cargo, 'lancar')).verdadeiro(`${cargo} deveria lançar`);
      esperar(podeFechamento(cargo, 'aprovar')).falso(`${cargo} não deveria aprovar`);
    }
  });

  teste('visitante apenas visualiza (§44.2 não edita)', () => {
    esperar(podeFechamento('visitante', 'ver')).verdadeiro();
    esperar(podeFechamento('visitante', 'lancar')).falso();
    esperar(podeFechamento('visitante', 'aprovar')).falso();
    esperar(podeFechamento('visitante', 'gerar')).falso();
  });

  teste('perfil desconhecido não recebe nenhuma permissão (fail-closed)', () => {
    esperar(podeFechamento('hacker', 'ver')).falso();
    esperar(podeFechamento(undefined, 'lancar')).falso();
    esperar(podeFechamento(null, 'aprovar')).falso();
  });

  teste('reabertura é exclusiva do administrador (§46)', () => {
    esperar(ACOES_FECHAMENTO.reabrir).profundo(['admin']);
  });

  teste('todo perfil do sistema tem um papel mapeado no fechamento', () => {
    for (const role of Object.keys(RBAC)) {
      esperar(PAPEIS[role]).naoNulo(`perfil "${role}" sem papel definido no §43`);
    }
  });
});

suite('§2/§43 — RBAC do módulo na navegação', () => {

  teste('o módulo "fechamento" existe no RBAC de todos os perfis', () => {
    for (const role of Object.keys(RBAC)) {
      esperar(Array.isArray(RBAC[role].fechamento)).verdadeiro(`perfil "${role}" sem entrada de fechamento`);
    }
  });

  teste('admin e supervisor podem aprovar pelo RBAC de módulo', () => {
    esperar(can('admin', 'fechamento', 'approve')).verdadeiro();
    esperar(can('supervisor', 'fechamento', 'approve')).verdadeiro();
  });

  teste('auditor vê e cria, mas não aprova nem exclui', () => {
    esperar(can('auditor', 'fechamento', 'view')).verdadeiro();
    esperar(can('auditor', 'fechamento', 'create')).verdadeiro();
    esperar(can('auditor', 'fechamento', 'approve')).falso();
    esperar(can('auditor', 'fechamento', 'delete')).falso();
  });

  teste('visitante só visualiza', () => {
    esperar(can('visitante', 'fechamento', 'view')).verdadeiro();
    esperar(can('visitante', 'fechamento', 'edit')).falso();
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
