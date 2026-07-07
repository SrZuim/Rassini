/* ==========================================================================
   RNA One — Cadastro central de Funcionários
   ---------------------------------------------------------------------------
   Fonte única de nomes para os campos de auditor, supervisor, responsável e
   equipe em todo o sistema. Editável no painel Admin (tabela `funcionarios`).
   • Base em CAIXA ALTA; a interface exibe com properNome() (Title Case).
   • Áreas canônicas usadas nas regras de seleção:
       AREA_SUPERVISOR = 'CQ - Supervisor'  → aparece no campo Supervisor
       AREA_AUDITOR    = 'CQ - Auditor'      → aparece no campo Auditor
   ========================================================================== */

export const AREA_SUPERVISOR = 'CQ - Supervisor';
export const AREA_AUDITOR    = 'CQ - Auditor';

export const FUNCIONARIOS_DEFAULT = [
  { id:'f01614', matricula:'01614', nome:'HATUS DE AZEVEDO NEVES',           area:'CQ - Supervisor',  planta:'Planta Rio Nova Iguaçu', ativo:true },
  { id:'f02994', matricula:'02994', nome:'IZABELA AZEVEDO ANDREA',           area:'Metrologia',       planta:'Planta Rio Nova Iguaçu', ativo:true },
  { id:'f02289', matricula:'02289', nome:'DANIEL DE SOUZA ALMEIDA',          area:'CQ - Auditor',     planta:'Planta Rio Nova Iguaçu', ativo:true },
  { id:'f02758', matricula:'02758', nome:'CARLOS HENRIQUE DA SILVA SOARES',  area:'CQ - Recebimento', planta:'Planta Rio Nova Iguaçu', ativo:true },
  { id:'f00742', matricula:'00742', nome:'RENATO DE SOUZA COSTA',            area:'CQ - Auditor',     planta:'Planta Rio Nova Iguaçu', ativo:true },
  { id:'f02674', matricula:'02674', nome:'RUBENS MOREIRA DUIM',              area:'GQ - Analista',    planta:'Planta Rio Nova Iguaçu', ativo:true },
  { id:'f02235', matricula:'02235', nome:'LUIZ FERNANDO MENEZES VAZ',        area:'CQ - CEP',         planta:'Planta Rio Nova Iguaçu', ativo:true },
  { id:'f02583', matricula:'02583', nome:'DANILO CARDOSO MUSSEL DA SILVA',   area:'CQ - Auditor',     planta:'Planta Rio Nova Iguaçu', ativo:true },
  { id:'f01356', matricula:'01356', nome:'DICKSON DOS SANTOS CUNHA',         area:'CQ - Auditor',     planta:'Planta Rio Nova Iguaçu', ativo:true },
  { id:'f01849', matricula:'01849', nome:'ALDOBERTO DE SOUZA ARAUJO',        area:'CQ - CEP',         planta:'Planta Rio Nova Iguaçu', ativo:true },
  { id:'f02790', matricula:'02790', nome:'THIAGO DE SOUZA AUGUSTO',          area:'CQ - CEP',         planta:'Planta Rio Nova Iguaçu', ativo:true },
  { id:'f03011', matricula:'03011', nome:'NATHALIA VASCONCELLOS DE ANDRADE', area:'Laboratório',      planta:'Planta Rio Nova Iguaçu', ativo:true },
  { id:'f02277', matricula:'02277', nome:'BRUNO CAVALCANTE DE ALCANTARA',    area:'CQ - Auditor',     planta:'Planta Rio Nova Iguaçu', ativo:true }
];

/* Conectores que permanecem minúsculos no Title Case de nomes. */
const MINUS = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'du']);

/** Formata um nome (mesmo em CAIXA ALTA) para exibição: "Hatus de Azevedo Neves". */
export function properNome(nome = '') {
  return String(nome).toLowerCase().trim().split(/\s+/)
    .map((w, i) => (i > 0 && MINUS.has(w)) ? w : (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** Normaliza uma área (troca en-dash por hífen, remove espaços extras). */
export function normArea(area = '') {
  return String(area).replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
}

/** Filtra funcionários ativos por área canônica (aceita en-dash). */
export function porArea(lista, area) {
  const alvo = normArea(area).toLowerCase();
  return (lista || []).filter(f => f.ativo !== false && normArea(f.area).toLowerCase() === alvo);
}

/** Resolve o nome de exibição a partir de um id/matrícula, buscando na lista. */
export function nomePorId(lista, id) {
  const f = (lista || []).find(x => x.id === id || x.matricula === id);
  return f ? properNome(f.nome) : null;
}
