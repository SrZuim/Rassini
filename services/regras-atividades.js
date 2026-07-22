/* ==========================================================================
   RNA One — MOTOR DE REGRAS CONDICIONAIS DE ATIVIDADES (§M06)

   Problema que resolve: hoje uma rotina é atribuída a QUEM executa
   (op_atribuicoes → usuário/cargo/planta+turno), mas não a QUANDO ela se
   aplica. Resultado: o auditor de uma linha que roda Scania recebe também a
   rotina dos demais clientes, e as três variações de Magnaflux aparecem juntas
   mesmo que só uma substância esteja em uso.

   Este módulo acrescenta a segunda pergunta — "esta atividade se aplica ao
   contexto do plantão?" — sem tocar em quem executa:

     op_atribuicoes  → QUEM faz          (matchAtribuicao, já existente)
     op_atividades   → QUANDO se aplica  (condicoes + grupo_regra, aqui)

   DOIS MECANISMOS, em ordem:

   1) CONDIÇÕES (E lógico). Cada atividade pode exigir cliente, processo,
      máquina, linha, tipo de inspeção e/ou substância. Todas precisam passar.
      Atividade SEM condições aplica-se sempre — é o que mantém todo o cadastro
      atual funcionando sem alteração (compatibilidade retroativa).

   2) GRUPO EXCLUSIVO. Atividades do mesmo `grupo_regra` são MUTUAMENTE
      EXCLUSIVAS: entre as que passaram nas condições, só a de maior prioridade
      entra no plantão. É o que garante o "nunca mostrar as duas" do requisito:

        Rotina A · grupo "velocidade_esteira" · condição cliente = Scania
        Rotina B · grupo "velocidade_esteira" · condição cliente ≠ Scania
        → cliente Scania    ⇒ só A
        → cliente Volvo     ⇒ só B

        Magnaflux A/B/C · grupo "magnaflux" · condição substancia = A|B|C
        → substância B      ⇒ só Magnaflux B

   O desempate é determinístico (prioridade → especificidade → código), para o
   mesmo contexto sempre gerar o mesmo plantão — requisito de rastreabilidade.

   Sem dependências: função pura, testável isoladamente e reutilizável tanto na
   montagem do plantão quanto na pré-visualização da Gestão Operacional.
   ========================================================================== */

/* Campos de contexto avaliáveis. Para adicionar um novo critério no futuro,
   basta incluí-lo aqui — o motor, a UI de cadastro e a pré-visualização passam
   a oferecê-lo automaticamente (nenhum `switch` espalhado pelo código). */
export const REGRA_CAMPOS = [
  { slug: 'cliente',       nome: 'Cliente',            icone: 'bi-building' },
  { slug: 'processo',      nome: 'Processo',           icone: 'bi-gear-wide-connected' },
  { slug: 'maquina',       nome: 'Máquina',            icone: 'bi-cpu' },
  { slug: 'linha',         nome: 'Linha',              icone: 'bi-diagram-2' },
  { slug: 'tipo_inspecao', nome: 'Tipo de inspeção',   icone: 'bi-clipboard-check' },
  { slug: 'substancia',    nome: 'Substância',         icone: 'bi-droplet-half' }
];
export const REGRA_CAMPOS_MAP = Object.fromEntries(REGRA_CAMPOS.map(c => [c.slug, c]));

/* Operadores. `em`/`nao_em` aceitam lista (vários valores no mesmo critério),
   evitando ter de cadastrar uma atividade por valor. */
export const REGRA_OPERADORES = [
  { slug: 'igual',     nome: 'é igual a',       lista: false },
  { slug: 'diferente', nome: 'é diferente de',  lista: false },
  { slug: 'em',        nome: 'é um destes',     lista: true  },
  { slug: 'nao_em',    nome: 'não é nenhum de', lista: true  }
];
export const REGRA_OPERADORES_MAP = Object.fromEntries(REGRA_OPERADORES.map(o => [o.slug, o]));

/* Comparação tolerante: ignora caixa, acentos e espaços nas pontas. O contexto
   costuma ser digitado/selecionado por pessoas diferentes ("Scania" x "SCANIA"),
   e uma regra de produção não pode falhar por causa disso. */
const norm = v => String(v ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
const comoLista = v => (Array.isArray(v) ? v : String(v ?? '').split(/[;,|]/)).map(norm).filter(Boolean);

/** Uma condição isolada casa com o contexto? */
export function avaliarCondicao(cond, contexto = {}) {
  if (!cond?.campo) return true;                       // condição incompleta não restringe
  const atual = norm(contexto[cond.campo]);
  const alvoLista = comoLista(cond.valor);
  if (!alvoLista.length) return true;                  // sem valor definido não restringe

  /* Contexto NÃO informado: a condição não pode ser considerada satisfeita.
     Fail-closed proposital — se o plantão não diz o cliente, a rotina exclusiva
     de Scania não deve entrar "por acaso". A exceção é `nao_em`/`diferente`,
     onde ausência de valor de fato não viola a proibição. */
  if (!atual) return cond.operador === 'diferente' || cond.operador === 'nao_em';

  switch (cond.operador) {
    case 'diferente': return atual !== alvoLista[0];
    case 'em':        return alvoLista.includes(atual);
    case 'nao_em':    return !alvoLista.includes(atual);
    case 'igual':
    default:          return atual === alvoLista[0];
  }
}

/** Todas as condições da atividade (E lógico). Sem condições → sempre aplica. */
export function atividadeAtendeContexto(atividade, contexto = {}) {
  const conds = normalizarCondicoes(atividade?.condicoes);
  if (!conds.length) return true;
  return conds.every(c => avaliarCondicao(c, contexto));
}

/** Aceita array, JSON em texto (Supabase jsonb às vezes volta string) ou nulo. */
export function normalizarCondicoes(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(c => c && c.campo);
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p.filter(c => c && c.campo) : []; }
    catch { return []; }
  }
  return [];
}

/** Descrição legível — usada na Gestão Operacional e no diagnóstico do plantão. */
export function descreverCondicoes(atividade) {
  const conds = normalizarCondicoes(atividade?.condicoes);
  if (!conds.length) return 'Sem restrição — aplica-se sempre';
  return conds.map(c => {
    const campo = REGRA_CAMPOS_MAP[c.campo]?.nome || c.campo;
    const op = REGRA_OPERADORES_MAP[c.operador]?.nome || 'é igual a';
    const val = Array.isArray(c.valor) ? c.valor.join(', ') : c.valor;
    return `${campo} ${op} ${val}`;
  }).join(' · ');
}

/* Especificidade = nº de condições. Entre duas atividades do mesmo grupo com a
   mesma prioridade, vence a mais específica: "cliente = Scania" (1 condição)
   ganha da genérica sem condição, que funciona como fallback natural. */
const especificidade = a => normalizarCondicoes(a?.condicoes).length;
const prioridadeDe = a => Number(a?.prioridade_regra ?? 0) || 0;

/** Ordem determinística de desempate dentro de um grupo exclusivo. */
export function compararNoGrupo(a, b) {
  return prioridadeDe(b) - prioridadeDe(a)
    || especificidade(b) - especificidade(a)
    || String(a?.codigo || a?.nome || '').localeCompare(String(b?.codigo || b?.nome || ''));
}

/* ============================================================ MOTOR PRINCIPAL
   Recebe as atividades JÁ filtradas por atribuição (quem executa) e devolve as
   que valem para este contexto, resolvendo os grupos exclusivos.

   `diagnostico` explica cada descarte — é o que alimenta a pré-visualização da
   Gestão Operacional ("por que esta rotina não apareceu no plantão?") e evita
   que a regra vire uma caixa-preta para o administrador. */
export function aplicarRegras(atividades = [], contexto = {}) {
  const aplicaveis = [];
  const diagnostico = [];

  for (const a of atividades) {
    if (atividadeAtendeContexto(a, contexto)) { aplicaveis.push(a); continue; }
    diagnostico.push({
      atividade_id: a.id, nome: a.nome, incluida: false, motivo: 'condicao',
      detalhe: `Não atende ao contexto: ${descreverCondicoes(a)}`
    });
  }

  /* Grupos exclusivos: só o vencedor entra. Atividade sem `grupo_regra` não
     participa de exclusividade — segue direto (comportamento atual). */
  const grupos = new Map();
  const soltas = [];
  for (const a of aplicaveis) {
    const g = String(a.grupo_regra || '').trim();
    if (!g || a.exclusivo_por_grupo === false) { soltas.push(a); continue; }
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g).push(a);
  }

  const selecionadas = [...soltas];
  for (const [grupo, membros] of grupos) {
    const ordenados = [...membros].sort(compararNoGrupo);
    const vencedor = ordenados[0];
    selecionadas.push(vencedor);
    diagnostico.push({
      atividade_id: vencedor.id, nome: vencedor.nome, incluida: true, motivo: 'grupo_vencedor',
      detalhe: `Selecionada no grupo exclusivo "${grupo}" (prioridade ${prioridadeDe(vencedor)})`
    });
    for (const perdedor of ordenados.slice(1)) {
      diagnostico.push({
        atividade_id: perdedor.id, nome: perdedor.nome, incluida: false, motivo: 'grupo_perdedor',
        detalhe: `Preterida no grupo exclusivo "${grupo}" — "${vencedor.nome}" tem precedência`
      });
    }
  }

  return { atividades: selecionadas, diagnostico };
}

/** Contexto do plantão, tolerante a registro antigo (sem a coluna `contexto`). */
export function contextoDoPlantao(plantao) {
  const c = plantao?.contexto;
  const base = (c && typeof c === 'object') ? c
    : (typeof c === 'string' ? (() => { try { return JSON.parse(c) || {}; } catch { return {}; } })() : {});
  // `linha` também existe como coluna própria do plantão em bases antigas.
  return { linha: plantao?.linha || '', ...base };
}
