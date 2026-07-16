/* ==========================================================================
   RNA One — Modelos padrão de Rotina (SP1..SP5, Magnaflux, Temp. e Umidade)
   ---------------------------------------------------------------------------
   Estes são os DADOS INICIAIS (seed) dos modelos — não são regra de código.
   Depois de instalados no banco, o administrador cria/edita/duplica modelos e
   itens pela Gestão Operacional SEM tocar neste arquivo (§1, §22).
   Fonte única: alimenta o modo demo (GESTAO_OP) e o instalador idempotente
   `garantirModelosPadrao()` (verifica pelo código antes de inserir, §29).
   ========================================================================== */

/* Item com os padrões do cadastro — evita repetir 15 campos por linha. */
const item = (o) => ({
  descricao: '', unidade: '', unidade_simbolo: '',
  tipo_resposta: 'decimal', tipo_validacao: 'sem_validacao',
  limite_min: null, limite_max: null, valor_nominal: null, valor_esperado: '',
  especificacao_texto: '', frequencia_item: 'diario',
  obrigatorio: true, permite_obs: true, permite_foto: true, exige_foto_nc: false,
  regra_condicional: null, contexto_chave: null, opcoes: [], ativo: true,
  ...o
});

/* ------------------------------------------------------- blocos reutilizáveis */

/* Identificação (§6) — informativos: não aprovam nem reprovam. */
const IDENTIFICACAO = () => [
  item({ nome: 'Produto', tipo_resposta: 'texto', unidade: 'Part Number', especificacao_texto: 'Part Number', tipo_validacao: 'texto', obrigatorio: true }),
  item({ nome: 'Lâmina', tipo_resposta: 'texto', unidade: 'Número da lâmina', especificacao_texto: 'Número da lâmina', tipo_validacao: 'texto', obrigatorio: true }),
  item({ nome: 'Lote', tipo_resposta: 'texto', unidade: 'Número do lote', especificacao_texto: 'Número do lote', tipo_validacao: 'texto', obrigatorio: true }),
  item({ nome: 'OP', tipo_resposta: 'texto', unidade: 'Número da OP', especificacao_texto: 'Número da OP', tipo_validacao: 'texto', obrigatorio: false })
];

/* Tipo de cliente (§19) — alimenta o contexto que liga/desliga os itens
   condicionais (Scania × Demais clientes). Preparado para, no futuro, vir
   automaticamente do Part Number/cliente cadastrado. */
const TIPO_CLIENTE = () => item({
  nome: 'Tipo de cliente', tipo_resposta: 'lista', opcoes: ['Scania', 'Demais clientes'],
  tipo_validacao: 'texto', contexto_chave: 'tipo_cliente', obrigatorio: true,
  especificacao_texto: 'Define quais itens condicionais serão exibidos',
  permite_foto: false
});

/* Amperagem — uma linha por turbina (§6, §8, §10). */
const turbinas = (n) => Array.from({ length: n }, (_, i) => item({
  nome: `Amperagem — Turbina ${i + 1}`,
  unidade: 'Ampère', unidade_simbolo: 'A', tipo_resposta: 'decimal',
  tipo_validacao: 'intervalo', limite_min: 79, limite_max: 92,
  especificacao_texto: '79 a 92 A', frequencia_item: 'diario', obrigatorio: true
}));

/* Arco Almen — uma linha por plaqueta. */
const plaquetas = (n) => Array.from({ length: n }, (_, i) => item({
  nome: `Arco Almen — Plaqueta ${i + 1}`,
  unidade: 'mm', unidade_simbolo: 'mm', tipo_resposta: 'decimal',
  tipo_validacao: 'intervalo', limite_min: 0.50, limite_max: 0.90,
  especificacao_texto: '0,50 a 0,90 mm', frequencia_item: 'diario', obrigatorio: true
}));

/* Velocidade da esteira — condicional por cliente. */
const esteira = () => [
  item({
    nome: 'Velocidade da esteira — Produtos Scania',
    unidade: 'Segundos', unidade_simbolo: 's', tipo_resposta: 'decimal',
    tipo_validacao: 'intervalo', limite_min: 14, limite_max: 16,
    especificacao_texto: '14 a 16 s', frequencia_item: 'diario',
    regra_condicional: { campo: 'tipo_cliente', igual: 'Scania' }
  }),
  item({
    nome: 'Velocidade da esteira — Demais clientes',
    unidade: 'Segundos', unidade_simbolo: 's', tipo_resposta: 'decimal',
    tipo_validacao: 'intervalo', limite_min: 9, limite_max: 11,
    especificacao_texto: '9 a 11 s', frequencia_item: 'diario',
    regra_condicional: { campo: 'tipo_cliente', igual: 'Demais clientes' }
  })
];

const granulometria = () => item({
  nome: 'Granulometria', unidade: 'Porcentagem', unidade_simbolo: '%', tipo_resposta: 'decimal',
  tipo_validacao: 'minimo', limite_min: 90, especificacao_texto: 'Mínimo 90 %',
  frequencia_item: 'uma_vez_semana', obrigatorio: true
});

const tensaoResidual = () => item({
  nome: 'Tensão residual', tipo_resposta: 'codigo', tipo_validacao: 'sem_validacao',
  especificacao_texto: 'ID ou código Pipefy', frequencia_item: 'semanal',
  obrigatorio: false, permite_obs: true
});

/* Cobertura — condicional por cliente. */
const cobertura = () => [
  item({
    nome: 'Cobertura — Produtos Scania', unidade: 'Porcentagem', unidade_simbolo: '%',
    tipo_resposta: 'decimal', tipo_validacao: 'minimo', limite_min: 100,
    especificacao_texto: 'Mínimo 100 %', frequencia_item: 'diario',
    regra_condicional: { campo: 'tipo_cliente', igual: 'Scania' }
  }),
  item({
    nome: 'Cobertura — Demais clientes', unidade: 'Porcentagem', unidade_simbolo: '%',
    tipo_resposta: 'decimal', tipo_validacao: 'minimo', limite_min: 90,
    especificacao_texto: 'Mínimo 90 %', frequencia_item: 'diario',
    regra_condicional: { campo: 'tipo_cliente', igual: 'Demais clientes' }
  })
];

/* Monta um modelo SP: nº de turbinas e de plaquetas variam por linha (§5). */
const modeloSP = (n, turb, plaq) => ({
  codigo: `SP${n}`, nome: `SP${n}`,
  descricao: `Rotina de shot peening da linha SP${n} — ${turb} turbina(s) e ${plaq} plaqueta(s) Almen.`,
  categoria: 'Qualidade', frequencia: 'Diária', horario: '',
  itens: [
    ...IDENTIFICACAO(), TIPO_CLIENTE(),
    ...turbinas(turb), ...esteira(), granulometria(),
    ...plaquetas(plaq), tensaoResidual(), ...cobertura()
  ]
});

/* ============================================================ MODELOS PADRÃO */
export const MODELOS_PADRAO = [
  /* SP1 e SP2: 1 turbina · 3 plaquetas — modelos INDEPENDENTES (§7). */
  modeloSP(1, 1, 3),
  modeloSP(2, 1, 3),
  /* SP3 e SP4: 2 turbinas · 3 plaquetas — independentes entre si (§8, §9). */
  modeloSP(3, 2, 3),
  modeloSP(4, 2, 3),
  /* SP5: 4 turbinas · 4 plaquetas (§10). */
  modeloSP(5, 4, 4),

  /* Magnaflux (§11) */
  {
    codigo: 'MAGNAFLUX', nome: 'Magnaflux',
    descricao: 'Controle de concentração dos banhos de partícula magnética.',
    categoria: 'Qualidade', frequencia: 'Diária', horario: '',
    itens: [
      item({
        nome: 'Magnaflux ML-500WB', unidade: 'ml', unidade_simbolo: 'ml', tipo_resposta: 'decimal',
        tipo_validacao: 'intervalo', limite_min: 0.02, limite_max: 0.07,
        especificacao_texto: '0,02 a 0,07 ml', frequencia_item: 'diario', obrigatorio: true
      }),
      item({
        nome: 'Metalcheck CLY-2000', unidade: 'ml', unidade_simbolo: 'ml', tipo_resposta: 'decimal',
        tipo_validacao: 'intervalo', limite_min: 0.10, limite_max: 0.40,
        especificacao_texto: '0,10 a 0,40 ml', frequencia_item: 'diario', obrigatorio: true
      })
    ]
  },

  /* Temperatura e Umidade (§12) */
  {
    codigo: 'TEMP_UMIDADE', nome: 'Temperatura e Umidade',
    descricao: 'Controle ambiental da sala de metrologia / laboratório.',
    categoria: 'Qualidade', frequencia: 'Diária', horario: '',
    itens: [
      item({
        nome: 'Temperatura', unidade: 'Graus Celsius', unidade_simbolo: '°C', tipo_resposta: 'decimal',
        tipo_validacao: 'intervalo', limite_min: 18, limite_max: 22,
        especificacao_texto: '18 °C a 22 °C', frequencia_item: 'diario', obrigatorio: true
      }),
      item({
        nome: 'Umidade', unidade: 'Umidade Relativa', unidade_simbolo: 'UR', tipo_resposta: 'decimal',
        tipo_validacao: 'intervalo', limite_min: 48, limite_max: 72,
        especificacao_texto: '48 a 72 UR', frequencia_item: 'diario', obrigatorio: true
      })
    ]
  }
];

/* IDs estáveis no modo demo (o Supabase gera os seus via gen_random_uuid). */
const idModelo = codigo => `mod-${String(codigo).toLowerCase()}`;
const idItem = (codigo, i) => `mit-${String(codigo).toLowerCase()}-${String(i).padStart(2, '0')}`;

/** Linhas prontas para as tabelas op_atividades / op_atividade_itens. */
export function construirSeedModelos() {
  const atividades = [], itens = [];
  for (const m of MODELOS_PADRAO) {
    const id = idModelo(m.codigo);
    atividades.push({
      id, tipo_slug: 'rotina', is_template: true,
      codigo: m.codigo, nome: m.nome, descricao: m.descricao, categoria: m.categoria,
      frequencia: m.frequencia, horario: m.horario || '',
      planta: '', setor: '', turno: '', responsavel: 'todos',
      exec_observacao: 'opcional', exec_foto: 'opcional', permite_na: true,
      obrigatoria: true, status: 'publicada', versao: 1, anexos: [],
      created_by: 'sistema', created_at: '2026-01-01', updated_at: '2026-01-01'
    });
    m.itens.forEach((it, i) => itens.push({ id: idItem(m.codigo, i + 1), atividade_id: id, ordem: i + 1, ...it }));
  }
  return { atividades, itens };
}

/* Seed do modo demo. */
const _seed = construirSeedModelos();
export const MODELOS_ATIVIDADES = _seed.atividades;
export const MODELOS_ITENS = _seed.itens;
