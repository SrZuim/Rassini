/* ==========================================================================
   RNA One — CONTROLE DE MEDIÇÃO POR CARGO (fonte ÚNICA da regra)
   --------------------------------------------------------------------------
   O campo "Quem Mede" da característica (cadastrado na Biblioteca Técnica)
   define QUAL CARGO pode assumir/editar/preencher aquela medição. Toda a
   plataforma — tela de medição, guarda do salvamento no serviço e (via SQL)
   as políticas RLS — consome ESTE arquivo. NÃO duplicar `if (cargo === ...)`
   espalhado: qualquer mudança de regra acontece só aqui.

   IMPORTANTE (§1): "G. Qualidade" continua sendo o rótulo exibido na Biblioteca.
   Internamente ele corresponde ao CARGO Auditor (role id `auditor`). O vínculo é
   feito por esta regra de negócio — o rótulo NUNCA é renomeado no cadastro.
   ========================================================================== */
import { ROLES } from './config.js';

/* Valores VÁLIDOS de "Quem Mede" (rótulos exibidos na Biblioteca Técnica, §3). */
export const QUEM_MEDE = {
  QUALIDADE:   'G. Qualidade',
  RECEBIMENTO: 'Recebimento de Materiais',
  PROCESSOS:   'Eng. Processos',
  LABORATORIO: 'Laboratório'
};
export const QUEM_MEDE_OPCOES = [
  QUEM_MEDE.QUALIDADE, QUEM_MEDE.RECEBIMENTO, QUEM_MEDE.PROCESSOS, QUEM_MEDE.LABORATORIO
];

/* Mapeamento "Quem Mede" (rótulo) → CARGO autorizado (role id interno, §4).
   O rótulo de exibição do cargo vem de ROLES[id].label (config.js). */
export const QUEM_MEDE_PARA_CARGO = {
  [QUEM_MEDE.QUALIDADE]:   'auditor',
  [QUEM_MEDE.RECEBIMENTO]: 'auditor_recebimento',
  [QUEM_MEDE.PROCESSOS]:   'eng_processos',
  [QUEM_MEDE.LABORATORIO]: 'laboratorio'
};

/* §9 — o Supervisor NÃO mede por padrão; só visualiza. Regra única e
   configurável (trocar para true libera a medição de todas as características
   para o supervisor, sem espalhar a decisão pelo código). */
export const SUPERVISOR_PODE_MEDIR = false;

/* §18 — apelidos/legado de "Quem Mede" para normalização (relatórios/cadastros
   antigos). Comparação é feita já normalizada (sem acento, minúsculo, sem
   pontuação repetida), então basta cobrir as variações de nomenclatura. */
const ALIASES_QUEM_MEDE = {
  'qualidade': QUEM_MEDE.QUALIDADE,
  'g qualidade': QUEM_MEDE.QUALIDADE,
  'gerencia da qualidade': QUEM_MEDE.QUALIDADE,
  'garantia da qualidade': QUEM_MEDE.QUALIDADE,
  'recebimento': QUEM_MEDE.RECEBIMENTO,
  'recebimento de materiais': QUEM_MEDE.RECEBIMENTO,
  'engenharia de processos': QUEM_MEDE.PROCESSOS,
  'eng processos': QUEM_MEDE.PROCESSOS,
  'processos': QUEM_MEDE.PROCESSOS,
  'lab': QUEM_MEDE.LABORATORIO,
  'laboratorio': QUEM_MEDE.LABORATORIO
  // 'Metrologia' e outros desconhecidos NÃO são mapeados de propósito: viram
  // "sem responsável" (bloqueado, corrigível pelo admin) conforme §18.
};

/* §19 — normalização de CARGOS (role) legados para os ids canônicos. Cobre
   valores em minúsculo, sem acento ou com nomenclatura antiga. */
const NORMALIZACAO_CARGOS = {
  'administrador': 'admin', 'admin': 'admin',
  'supervisor': 'supervisor',
  'auditor': 'auditor',
  'auditor de recebimento': 'auditor_recebimento',
  'auditor_recebimento': 'auditor_recebimento',
  'recebimento': 'auditor_recebimento',
  'eng processos': 'eng_processos',
  'eng_processos': 'eng_processos',
  'engenharia de processos': 'eng_processos',
  'engenharia_processos': 'eng_processos',
  'laboratorio': 'laboratorio',
  'lab': 'laboratorio',
  'visitante': 'visitante'
};

/* Normalização forte para comparação: minúsculas, sem acento, pontuação/espaço
   colapsados. 'G. Qualidade' e 'g qualidade' comparam iguais. */
const _norm = s => String(s ?? '')
  .trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[.\-_/]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Rótulo canônico de "Quem Mede" a partir de qualquer variação/legado.
    Retorna '' quando não há responsável reconhecível (§18 → bloqueia + admin). */
export function normalizarQuemMede(valor) {
  const n = _norm(valor);
  if (!n) return '';
  const canonPorNorm = Object.fromEntries(QUEM_MEDE_OPCOES.map(o => [_norm(o), o]));
  if (canonPorNorm[n]) return canonPorNorm[n];
  return ALIASES_QUEM_MEDE[n] || '';
}

/** Cargo (role id) canônico a partir de um valor de role legado/variado (§19). */
export function normalizarCargo(role) {
  const n = _norm(role);
  if (!n) return '';
  if (ROLES[n]) return n;                       // já é um id válido ('auditor', ...)
  return NORMALIZACAO_CARGOS[n] || (ROLES[role] ? role : '');
}

/** §4 — cargo (role id) responsável por um valor de "Quem Mede". null = sem
    responsável reconhecível (característica bloqueada até correção no cadastro). */
export function obterCargoResponsavel(quemMede) {
  const canon = normalizarQuemMede(quemMede);
  return canon ? (QUEM_MEDE_PARA_CARGO[canon] || null) : null;
}

/** Rótulo de exibição do cargo (para mensagens/tooltip): usa ROLES[id].label. */
export function rotuloCargo(roleId) {
  return ROLES[normalizarCargo(roleId)]?.label || roleId || '—';
}
/** Rótulo de exibição do cargo responsável por um "Quem Mede". */
export function rotuloCargoResponsavel(quemMede) {
  const id = obterCargoResponsavel(quemMede);
  return id ? rotuloCargo(id) : '';
}

/** §4/§11 — o usuário (pelo CARGO) pode medir uma característica com este
    "Quem Mede"? Admin sempre; supervisor só se SUPERVISOR_PODE_MEDIR; visitante
    nunca; demais: o cargo tem de bater com o responsável do "Quem Mede".
    Sem responsável reconhecível → ninguém mede (exceto admin), por §18. */
export function usuarioPodeMedir({ cargoUsuario, quemMede } = {}) {
  const cargo = normalizarCargo(cargoUsuario);
  if (cargo === 'admin') return true;                                   // §8
  if (cargo === 'supervisor') return !!SUPERVISOR_PODE_MEDIR;           // §9
  if (cargo === 'visitante' || !cargo) return false;                    // §10
  const responsavel = obterCargoResponsavel(quemMede);
  if (!responsavel) return false;                                       // §18 (só admin destrava)
  return cargo === responsavel;
}

/** Conveniência: recebe o objeto de usuário da sessão e a característica
    (snapshot em insp_caracteristicas, campo `quem_mede`). */
export function usuarioPodeMedirCaracteristica(user, caracteristica) {
  return usuarioPodeMedir({ cargoUsuario: user?.role, quemMede: caracteristica?.quem_mede });
}

/** Motivo do bloqueio de uma característica para um usuário (para UI/log/erro).
    Retorna null quando ELE PODE medir. */
export function motivoBloqueioMedicao(user, caracteristica) {
  if (usuarioPodeMedirCaracteristica(user, caracteristica)) return null;
  const responsavel = obterCargoResponsavel(caracteristica?.quem_mede);
  if (!responsavel) return { tipo: 'sem_responsavel',
    msg: 'Esta característica não possui responsável definido em "Quem Mede". Solicite a correção na Biblioteca Técnica.' };
  return { tipo: 'cargo_incorreto', cargoResponsavel: responsavel,
    msg: `Esta medição deve ser realizada por um usuário com cargo ${rotuloCargo(responsavel)}.` };
}
