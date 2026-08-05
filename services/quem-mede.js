/* ==========================================================================
   RNA One — CONTROLE DE MEDIÇÃO POR CARGO (fonte ÚNICA da regra)
   --------------------------------------------------------------------------
   O campo "Quem Mede" da característica (cadastrado na Biblioteca Técnica) é uma
   ÁREA RESPONSÁVEL. O usuário tem um CARGO. São informações DIFERENTES: comparar
   `quemMede === cargoUsuario` é sempre errado. O vínculo entre as duas acontece
   AQUI, por mapeamento explícito:

       G. Qualidade              →  Auditor                  (auditor)
       Recebimento de Materiais  →  Auditor de Recebimento   (auditor_recebimento)
       Eng. Processos            →  Eng. Processos           (eng_processos)
       Laboratório               →  Laboratório              (laboratorio)

   Toda a plataforma — tela de medição, guarda do salvamento no serviço e (via
   SQL) as políticas RLS — consome ESTE arquivo. NÃO duplicar `if (cargo === ...)`
   espalhado: qualquer mudança de regra acontece só aqui.

   IMPORTANTE: "G. Qualidade" continua sendo o rótulo exibido na Biblioteca —
   o rótulo NUNCA é renomeado no cadastro; quem traduz é a regra.
   ========================================================================== */
import { ROLES } from './config.js';

/* Valores VÁLIDOS de "Quem Mede" (rótulos exibidos na Biblioteca Técnica). */
export const QUEM_MEDE = {
  QUALIDADE:   'G. Qualidade',
  RECEBIMENTO: 'Recebimento de Materiais',
  PROCESSOS:   'Eng. Processos',
  LABORATORIO: 'Laboratório'
};
export const QUEM_MEDE_OPCOES = [
  QUEM_MEDE.QUALIDADE, QUEM_MEDE.RECEBIMENTO, QUEM_MEDE.PROCESSOS, QUEM_MEDE.LABORATORIO
];

/* MAPEAMENTO CENTRALIZADO área responsável → CARGO autorizado (role id interno).
   É o único lugar do sistema onde "Quem Mede" vira cargo. O rótulo de exibição
   do cargo vem de ROLES[id].label (config.js). */
export const QUEM_MEDE_PARA_CARGO = {
  [QUEM_MEDE.QUALIDADE]:   'auditor',
  [QUEM_MEDE.RECEBIMENTO]: 'auditor_recebimento',
  [QUEM_MEDE.PROCESSOS]:   'eng_processos',
  [QUEM_MEDE.LABORATORIO]: 'laboratorio'
};

/* Mesma tabela na forma "área → lista de cargos autorizados". Derivada (nunca
   escrita à mão) para não existir uma segunda verdade. O admin entra por regra
   global (ver canUserMeasure), não por área. */
export const CARGOS_AUTORIZADOS = Object.fromEntries(
  Object.entries(QUEM_MEDE_PARA_CARGO).map(([area, cargo]) => [area, [cargo]])
);

/* O Supervisor NÃO mede por padrão; só visualiza. Regra única e configurável
   (trocar para true libera a medição de todas as características para o
   supervisor, sem espalhar a decisão pelo código). */
export const SUPERVISOR_PODE_MEDIR = false;

/* Normalização forte para comparação: minúsculas, sem acento, pontuação/espaço
   colapsados, artigos ("da", "de", "do") descartados. Com isso "G. Qualidade",
   "g qualidade" e "Gestão da Qualidade" caem em chaves comparáveis, e uma
   diferença de caixa/acento/pontuação nunca mais bloqueia uma medição. */
const _norm = s => String(s ?? '')
  .trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[.\-_/]+/g, ' ').replace(/\s+/g, ' ').trim();
/* Forma "canônica dura": além do _norm, remove conectivos. Usada só como
   SEGUNDA tentativa, para não confundir rótulos legitimamente diferentes. */
const _chave = s => _norm(s).replace(/\b(da|de|do|das|dos|e)\b/g, ' ').replace(/\s+/g, ' ').trim();

/* Apelidos/legado de "Quem Mede". As chaves já estão normalizadas (_norm), então
   basta cobrir as VARIAÇÕES DE NOMENCLATURA — caixa, acento e pontuação são
   resolvidos antes da consulta. Inclui o nome do CARGO ("Auditor", "Laboratório"…)
   porque cadastros antigos gravaram o cargo no lugar da área. */
const ALIASES_QUEM_MEDE = {
  // --- G. Qualidade → Auditor
  'g qualidade': QUEM_MEDE.QUALIDADE,
  'qualidade': QUEM_MEDE.QUALIDADE,
  'gestao da qualidade': QUEM_MEDE.QUALIDADE,
  'gerencia da qualidade': QUEM_MEDE.QUALIDADE,
  'garantia da qualidade': QUEM_MEDE.QUALIDADE,
  'gq': QUEM_MEDE.QUALIDADE,
  'auditor': QUEM_MEDE.QUALIDADE,
  'auditor da qualidade': QUEM_MEDE.QUALIDADE,
  // --- Recebimento de Materiais → Auditor de Recebimento
  'recebimento': QUEM_MEDE.RECEBIMENTO,
  'recebimento de materiais': QUEM_MEDE.RECEBIMENTO,
  'auditor de recebimento': QUEM_MEDE.RECEBIMENTO,
  'inspecao de recebimento': QUEM_MEDE.RECEBIMENTO,
  // --- Eng. Processos → Eng. Processos
  'eng processos': QUEM_MEDE.PROCESSOS,
  'eng de processos': QUEM_MEDE.PROCESSOS,
  'engenharia de processos': QUEM_MEDE.PROCESSOS,
  'engenharia processos': QUEM_MEDE.PROCESSOS,
  'processos': QUEM_MEDE.PROCESSOS,
  // --- Laboratório → Laboratório
  'lab': QUEM_MEDE.LABORATORIO,
  'laboratorio': QUEM_MEDE.LABORATORIO,
  'laboratorio de ensaios': QUEM_MEDE.LABORATORIO
  // 'Metrologia' e outros desconhecidos NÃO são mapeados de propósito: viram
  // "responsável não reconhecido" (bloqueado, corrigível pelo admin na Biblioteca).
};

/* Normalização de CARGOS (role) legados para os ids canônicos. Cobre valores em
   minúsculo, sem acento ou com nomenclatura antiga. Os RÓTULOS oficiais
   (ROLES[id].label) entram automaticamente logo abaixo — não repetir aqui. */
const NORMALIZACAO_CARGOS = {
  'administrador': 'admin', 'admin': 'admin',
  'supervisor': 'supervisor',
  'auditor': 'auditor',
  'auditor da qualidade': 'auditor',
  'auditor de recebimento': 'auditor_recebimento',
  'auditor_recebimento': 'auditor_recebimento',
  'recebimento': 'auditor_recebimento',
  'eng processos': 'eng_processos',
  'eng de processos': 'eng_processos',
  'eng_processos': 'eng_processos',
  'engenharia de processos': 'eng_processos',
  'engenharia_processos': 'eng_processos',
  'laboratorio': 'laboratorio',
  'lab': 'laboratorio',
  'visitante': 'visitante'
};
/* Rótulos oficiais dos cargos ("Auditor de Recebimento", "Eng. Processos", …)
   viram alias automaticamente: se o banco gravar o LABEL em vez do id, o cargo
   continua sendo reconhecido. */
for (const [id, r] of Object.entries(ROLES)) {
  NORMALIZACAO_CARGOS[_norm(r.label)] ??= id;
  NORMALIZACAO_CARGOS[_norm(id)] ??= id;
}

/* Índices por chave dura (sem conectivos) — 2ª tentativa da normalização. */
const _porChave = obj => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[_chave(k)] ??= v;
  return out;
};
const ALIASES_QUEM_MEDE_CHAVE = _porChave(ALIASES_QUEM_MEDE);
const NORMALIZACAO_CARGOS_CHAVE = _porChave(NORMALIZACAO_CARGOS);

/* Canônicos oficiais indexados pelas duas formas. */
const CANON_QM_NORM  = Object.fromEntries(QUEM_MEDE_OPCOES.map(o => [_norm(o), o]));
const CANON_QM_CHAVE = Object.fromEntries(QUEM_MEDE_OPCOES.map(o => [_chave(o), o]));

/** O campo "Quem Mede" está PREENCHIDO no cadastro? (null/undefined/'' = não).
    "Sem responsável" só pode ser exibido quando isto for false. */
export function quemMedePreenchido(valor) {
  return String(valor ?? '').trim() !== '';
}

/** Rótulo canônico de "Quem Mede" a partir de qualquer variação/legado.
    Retorna '' quando não há responsável RECONHECÍVEL (campo vazio ou nome fora
    da lista oficial e dos aliases). */
export function normalizarQuemMede(valor) {
  const n = _norm(valor);
  if (!n) return '';
  return CANON_QM_NORM[n] || ALIASES_QUEM_MEDE[n]
      || CANON_QM_CHAVE[_chave(n)] || ALIASES_QUEM_MEDE_CHAVE[_chave(n)] || '';
}

/** Cargo (role id) canônico a partir de um valor de role legado/variado. */
export function normalizarCargo(role) {
  const n = _norm(role);
  if (!n) return '';
  if (ROLES[n]) return n;                       // já é um id válido ('auditor', ...)
  return NORMALIZACAO_CARGOS[n] || NORMALIZACAO_CARGOS_CHAVE[_chave(n)] || (ROLES[role] ? role : '');
}

/* --------------------------------------------------------------- CARGO DO USUÁRIO
   FONTE OFICIAL DO CARGO: `usuarios.role` (é a única coluna de cargo que existe
   no banco; `cargo`, `job_role`, `user_role` e `department` NÃO existem). Os
   demais nomes são aceitos apenas como tolerância a perfis montados por outras
   telas/integrações — nunca como fonte concorrente.

   `area` é o ÚLTIMO recurso e existe só para não punir perfis antigos: ela pode
   estar null (e frequentemente está), então NUNCA pode ser exigida. Um perfil com
   role='auditor' e area=null resolve para 'auditor' sem olhar a área. */
const CAMPOS_CARGO = ['role', 'cargo', 'perfil', 'job_role', 'user_role', 'funcao'];
const CAMPOS_AREA  = ['area', 'setor', 'department', 'departamento'];

export function cargoDoUsuario(perfil) {
  if (!perfil) return '';
  if (typeof perfil === 'string') return normalizarCargo(perfil);
  for (const campo of CAMPOS_CARGO) {
    const c = normalizarCargo(perfil[campo]);
    if (c) return c;
  }
  /* Último recurso: derivar da ÁREA do perfil (Qualidade → auditor). Só chega
     aqui quem não tem nenhum campo de cargo preenchido. */
  for (const campo of CAMPOS_AREA) {
    const cargo = obterCargoResponsavel(perfil[campo]);
    if (cargo) return cargo;
  }
  return '';
}

/** Cargo (role id) responsável por um valor de "Quem Mede". null = sem
    responsável reconhecível (característica bloqueada até correção no cadastro). */
export function obterCargoResponsavel(quemMede) {
  const canon = normalizarQuemMede(quemMede);
  return canon ? (QUEM_MEDE_PARA_CARGO[canon] || null) : null;
}

/** Cargos autorizados a medir uma área responsável (lista; [] = nenhum). */
export function cargosAutorizados(quemMede) {
  const canon = normalizarQuemMede(quemMede);
  return canon ? (CARGOS_AUTORIZADOS[canon] || []) : [];
}

/** Rótulo de exibição do cargo (para mensagens/tooltip): usa ROLES[id].label. */
export function rotuloCargo(roleId) {
  return ROLES[normalizarCargo(roleId)]?.label || roleId || '—';
}
/** Rótulo do cargo de um PERFIL completo (resolve role/cargo/área antes). */
export function rotuloCargoUsuario(perfil) {
  const c = cargoDoUsuario(perfil);
  return c ? rotuloCargo(c) : 'sem cargo definido';
}
/** Rótulo de exibição do cargo responsável por um "Quem Mede". */
export function rotuloCargoResponsavel(quemMede) {
  const id = obterCargoResponsavel(quemMede);
  return id ? rotuloCargo(id) : '';
}

/* ------------------------------------------------------------------ AUTORIZAÇÃO
   FUNÇÃO ÚNICA de verificação. Todo o resto do sistema (UI, serviço de medição,
   progresso, gate do Avançar) chama daqui — direta ou indiretamente. */

/** O usuário pode medir uma característica desta área responsável?
    @param {string} areaResponsavel valor de "Quem Mede" (rótulo da Biblioteca)
    @param {object|string} perfilUsuario perfil completo do usuário (ou role id) */
export function canUserMeasure(areaResponsavel, perfilUsuario) {
  const cargo = cargoDoUsuario(perfilUsuario);
  if (!cargo) return false;                                  // perfil ainda não carregado
  if (cargo === 'admin') return true;                        // admin sempre
  if (cargo === 'supervisor') return !!SUPERVISOR_PODE_MEDIR;
  if (cargo === 'visitante') return false;
  const autorizados = cargosAutorizados(areaResponsavel);
  if (!autorizados.length) return false;                     // sem responsável → só admin
  return autorizados.includes(cargo);
}

/** Compatibilidade: mesma regra, assinatura antiga (cargo solto + rótulo). */
export function usuarioPodeMedir({ cargoUsuario, quemMede, usuario } = {}) {
  return canUserMeasure(quemMede, usuario ?? cargoUsuario);
}

/** Conveniência: perfil da sessão + característica (snapshot em
    insp_caracteristicas, campo `quem_mede`). */
export function usuarioPodeMedirCaracteristica(user, caracteristica) {
  return canUserMeasure(caracteristica?.quem_mede, user);
}

/* --------------------------------------------------------------------- MOTIVOS
   Tipos possíveis (a UI usa para escolher a mensagem e o ícone):
     sem_cargo               → o perfil não trouxe cargo algum (não carregou / RLS)
     sem_responsavel         → "Quem Mede" VAZIO no cadastro
     responsavel_desconhecido→ "Quem Mede" preenchido, mas fora da lista oficial
     supervisor / visitante  → política de perfil
     cargo_incorreto         → é de outra área                                   */
export function motivoBloqueioMedicao(user, caracteristica) {
  if (usuarioPodeMedirCaracteristica(user, caracteristica)) return null;
  const quemMede = caracteristica?.quem_mede;
  const cargo = cargoDoUsuario(user);

  if (!cargo) return { tipo: 'sem_cargo',
    msg: 'Seu cargo não pôde ser identificado no perfil. Recarregue a página ou peça ao administrador para revisar seu cadastro.' };
  if (cargo === 'visitante') return { tipo: 'visitante',
    msg: 'O perfil Visitante acompanha a inspeção, mas não registra medições.' };

  if (!quemMedePreenchido(quemMede)) return { tipo: 'sem_responsavel',
    msg: 'Esta característica não possui responsável definido em "Quem Mede". Solicite a correção na Biblioteca Técnica.' };

  const responsavel = obterCargoResponsavel(quemMede);
  if (!responsavel) return { tipo: 'responsavel_desconhecido', quemMede,
    msg: `"${quemMede}" não é uma área responsável reconhecida. Ajuste o campo "Quem Mede" desta característica na Biblioteca Técnica para uma das opções oficiais.` };

  if (cargo === 'supervisor') return { tipo: 'supervisor', cargoResponsavel: responsavel,
    msg: 'O perfil Supervisor acompanha a inspeção, mas não registra medições.' };

  return { tipo: 'cargo_incorreto', cargoResponsavel: responsavel,
    msg: `Esta medição é da área ${normalizarQuemMede(quemMede)} e deve ser realizada por um usuário com cargo ${rotuloCargo(responsavel)}. Seu cargo é ${rotuloCargo(cargo)}.` };
}

/* ---------------------------------------------------------------- DIAGNÓSTICO
   Depuração da autorização SEM poluir o console em produção. Fica desligada por
   padrão; para investigar um caso real, o administrador liga na própria máquina:

       localStorage.setItem('rna_debug_quem_mede', '1')   // ou ?debugQuemMede=1

   Assim o log de diagnóstico existe quando é necessário e desaparece sozinho
   depois — sem precisar editar/remover código. */
export function debugQuemMedeAtivo() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('rna_debug_quem_mede') === '1') return true;
    if (typeof location !== 'undefined' && /[?&]debugQuemMede=1/.test(location.search)) return true;
  } catch { /* ambiente sem DOM (testes/node) */ }
  return false;
}

/** Fotografia completa da decisão — o que entrou, o que foi normalizado e o
    resultado. Usada pelo log de diagnóstico e por mensagens de suporte. */
export function diagnosticoMedicao(user, caracteristica) {
  const quemMede = caracteristica?.quem_mede;
  const cargo = cargoDoUsuario(user);
  return {
    responsibleArea: quemMede ?? null,
    areaNormalizada: normalizarQuemMede(quemMede) || null,
    userRole: user?.role ?? null,
    userCargo: user?.cargo ?? null,
    userArea: user?.area ?? null,
    normalizedRole: cargo || null,
    allowedRoles: cargosAutorizados(quemMede),
    canMeasure: canUserMeasure(quemMede, user),
    motivo: motivoBloqueioMedicao(user, caracteristica)?.tipo || null
  };
}

/** Emite o diagnóstico no console SOMENTE quando a depuração está ligada. */
export function logDiagnosticoMedicao(user, caracteristica, contexto = '') {
  if (!debugQuemMedeAtivo()) return;
  console.log('%c[QUEM-MEDE]' + (contexto ? ' ' + contexto : ''),
    'color:#0a7cff;font-weight:bold', diagnosticoMedicao(user, caracteristica));
}
