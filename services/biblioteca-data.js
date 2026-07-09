/* ==========================================================================
   RNA One — Biblioteca Técnica · Dados semente (modo demo)
   Espelham as tabelas bib_* do Supabase. Em produção, o db.js busca do backend
   (rode database/biblioteca_tecnica.sql). Peças reais de suspensão automotiva.
   ========================================================================== */

/* ------------------------------------------------------------- catálogos --- */
export const BIB_CLIENTES = [
  { id:'cl1', nome:'Volvo',          ativo:true },
  { id:'cl2', nome:'Scania',         ativo:true },
  { id:'cl3', nome:'Mercedes-Benz',  ativo:true },
  { id:'cl4', nome:'Volkswagen',     ativo:true },
  { id:'cl5', nome:'Ford',           ativo:true },
  { id:'cl6', nome:'Randon',         ativo:true },
  { id:'cl7', nome:'DAF',            ativo:true },
  { id:'cl8', nome:'Iveco',          ativo:true }
];

export const BIB_PLANTAS = [
  { id:'pl1', nome:'Planta Jarinu',            ativo:true },
  { id:'pl2', nome:'Planta Rio Nova Iguaçu',   ativo:true },
  { id:'pl3', nome:'Planta SP 01',             ativo:true },
  { id:'pl4', nome:'Planta SP 02',             ativo:true }
];

export const BIB_FAMILIAS = [
  { id:'fm1', nome:'Feixe de Molas',        ativo:true },
  { id:'fm2', nome:'Mola Parabólica',       ativo:true },
  { id:'fm3', nome:'Mola Helicoidal',       ativo:true },
  { id:'fm4', nome:'Lâmina',                ativo:true },
  { id:'fm5', nome:'Grampo',                ativo:true },
  { id:'fm6', nome:'Barra Estabilizadora',  ativo:true },
  { id:'fm7', nome:'Tirante',               ativo:true }
];

export const BIB_CATEGORIAS = [
  { id:'ct1', nome:'Suspensão',   ativo:true },
  { id:'ct2', nome:'Estrutural',  ativo:true },
  { id:'ct3', nome:'Fixação',     ativo:true },
  { id:'ct4', nome:'Funcional',   ativo:true }
];

export const BIB_PROCESSOS = [
  { id:'pr1', nome:'Estampagem',          ativo:true },
  { id:'pr2', nome:'Tratamento Térmico',  ativo:true },
  { id:'pr3', nome:'Usinagem',            ativo:true },
  { id:'pr4', nome:'Montagem',            ativo:true },
  { id:'pr5', nome:'Pintura',             ativo:true },
  { id:'pr6', nome:'Jateamento (Shot Peening)', ativo:true }
];

export const BIB_TIPOS = [
  { id:'tp1', nome:'Componente',    ativo:true },
  { id:'tp2', nome:'Conjunto',      ativo:true },
  { id:'tp3', nome:'Submontagem',   ativo:true }
];

/* Status possíveis de uma peça (ciclo de vida da ficha). */
export const BIB_STATUS = ['Ativo', 'Em revisão', 'Arquivado', 'Obsoleto'];

/* Categorias de documento e periodicidades reaproveitadas nos selects. */
export const BIB_DOC_CATEGORIAS = ['Desenho', 'Especificação', 'Norma', 'Instrução de Trabalho', 'Plano de Controle', 'Relatório', 'Certificado', 'Outro'];
export const BIB_PERIODICIDADES  = ['Por peça', 'Por hora', 'Por turno', 'Diária', 'Semanal', 'Setup', 'Amostral'];
export const BIB_CRITICIDADES    = ['Crítico', 'Alta', 'Média', 'Baixa', 'Visual', '100%'];

/* Imagem placeholder (SVG data-uri) usada quando a peça não tem foto. */
export const BIB_IMG_PLACEHOLDER =
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
       <rect width="600" height="400" fill="#eef1f4"/>
       <path d="M120 250l90-110 70 80 50-45 150 175H120z" fill="#cdd4dc"/>
       <circle cx="180" cy="150" r="34" fill="#cdd4dc"/>
       <text x="300" y="360" font-family="Inter,Arial" font-size="22" fill="#9aa4b0" text-anchor="middle">Sem imagem</text>
     </svg>`);

/* -------------------------------------------------------------- peças ------ */
export const BIB_PECAS_DEFAULT = [
  {
    id:'bp01', codigo:'RCE-001', nome:'Feixe de Mola Traseiro',
    descricao:'Feixe de molas parabólico traseiro para caminhão pesado, 3 lâminas, olhal fechado.',
    cliente:'Volvo', familia:'Feixe de Molas', linha:'Linha 02 — Feixes', processo:'Montagem',
    tipo:'Conjunto', aplicacao:'Eixo traseiro — Volvo FH', categoria:'Suspensão',
    peso:'62,4 kg', material:'SAE 5160H', acabamento:'Pintura eletrostática', cor:'Preto',
    status:'Ativo', planta:'Planta Jarinu', fornecedor:'Aço Villares',
    norma:'ABNT NBR 6329', especificacao:'ET-RCE-001 Rev.C', responsavel:'Ana Beatriz',
    data_revisao:'2026-05-18', revisao:3,
    observacoes:'Conferir torque dos grampos em U conforme plano de controle PC-001.',
    imagem:null, galeria:[], ativo:true,
    created_at:'2025-11-02', updated_at:'2026-05-18', created_by:'u1'
  },
  {
    id:'bp02', codigo:'RCE-014', nome:'Mola Parabólica Dianteira',
    descricao:'Mola parabólica dianteira de 2 lâminas, alta flexibilidade, para eixo direcional.',
    cliente:'Scania', familia:'Mola Parabólica', linha:'Linha 02 — Feixes', processo:'Tratamento Térmico',
    tipo:'Componente', aplicacao:'Eixo dianteiro — Scania R450', categoria:'Suspensão',
    peso:'28,1 kg', material:'SAE 51B60', acabamento:'Shot peening + pintura', cor:'Cinza grafite',
    status:'Ativo', planta:'Planta Jarinu', fornecedor:'Gerdau',
    norma:'DIN 17221', especificacao:'ET-RCE-014 Rev.B', responsavel:'Carlos Mendes',
    data_revisao:'2026-04-30', revisao:2,
    observacoes:'Dureza pós-têmpera crítica para durabilidade.',
    imagem:null, galeria:[], ativo:true,
    created_at:'2025-12-10', updated_at:'2026-04-30', created_by:'u1'
  },
  {
    id:'bp03', codigo:'LM-206', nome:'Lâmina Principal 2ª',
    descricao:'Lâmina principal (2ª posição) do feixe traseiro, com furação central para pino.',
    cliente:'Mercedes-Benz', familia:'Lâmina', linha:'Linha 01 — Molas', processo:'Estampagem',
    tipo:'Componente', aplicacao:'Feixe traseiro — MB Axor', categoria:'Estrutural',
    peso:'11,7 kg', material:'SAE 5160', acabamento:'Jateado', cor:'Natural',
    status:'Em revisão', planta:'Planta Rio Nova Iguaçu', fornecedor:'ArcelorMittal',
    norma:'ABNT NBR 6329', especificacao:'ET-LM-206 Rev.A', responsavel:'Ana Beatriz',
    data_revisao:'2026-06-22', revisao:1,
    observacoes:'Revisão em andamento — validar novo raio de dobra.',
    imagem:null, galeria:[], ativo:true,
    created_at:'2026-06-22', updated_at:'2026-06-22', created_by:'u1'
  },
  {
    id:'bp04', codigo:'GR-330', nome:'Grampo em U M20',
    descricao:'Grampo em U rosca M20 para fixação do feixe ao eixo, com porcas e arruelas.',
    cliente:'Randon', familia:'Grampo', linha:'Linha 04 — Usinagem CNC', processo:'Usinagem',
    tipo:'Submontagem', aplicacao:'Fixação de feixe — Suspensão Randon', categoria:'Fixação',
    peso:'3,2 kg', material:'SAE 1045', acabamento:'Zincado', cor:'Prata',
    status:'Ativo', planta:'Planta SP 01', fornecedor:'Ciser',
    norma:'ISO 898-1', especificacao:'ET-GR-330 Rev.D', responsavel:'Carlos Mendes',
    data_revisao:'2026-03-14', revisao:4,
    observacoes:'Torque de aperto 320 N·m ±5%.',
    imagem:null, galeria:[], ativo:true,
    created_at:'2025-09-01', updated_at:'2026-03-14', created_by:'u1'
  },
  {
    id:'bp05', codigo:'HC-118', nome:'Mola Helicoidal Traseira',
    descricao:'Mola helicoidal de compressão para suspensão traseira de utilitário leve.',
    cliente:'Volkswagen', familia:'Mola Helicoidal', linha:'Linha 03 — Têmpera', processo:'Tratamento Térmico',
    tipo:'Componente', aplicacao:'Suspensão traseira — VW Delivery', categoria:'Suspensão',
    peso:'4,8 kg', material:'SAE 9254', acabamento:'Pintura epóxi', cor:'Preto fosco',
    status:'Ativo', planta:'Planta SP 02', fornecedor:'Gerdau',
    norma:'SAE J157', especificacao:'ET-HC-118 Rev.A', responsavel:'Ana Beatriz',
    data_revisao:'2026-02-05', revisao:1,
    observacoes:'',
    imagem:null, galeria:[], ativo:true,
    created_at:'2026-02-05', updated_at:'2026-02-05', created_by:'u1'
  },
  {
    id:'bp06', codigo:'BE-402', nome:'Barra Estabilizadora Dianteira',
    descricao:'Barra estabilizadora tubular dianteira com buchas e abraçadeiras.',
    cliente:'Ford', familia:'Barra Estabilizadora', linha:'Linha 04 — Usinagem CNC', processo:'Usinagem',
    tipo:'Conjunto', aplicacao:'Eixo dianteiro — Ford Cargo', categoria:'Estrutural',
    peso:'9,6 kg', material:'SAE 26MnB5', acabamento:'Fosfatizado + pintura', cor:'Preto',
    status:'Arquivado', planta:'Planta Jarinu', fornecedor:'Vallourec',
    norma:'ASTM A513', especificacao:'ET-BE-402 Rev.B', responsavel:'Carlos Mendes',
    data_revisao:'2025-10-19', revisao:2,
    observacoes:'Peça arquivada — substituída pela BE-410.',
    imagem:null, galeria:[], ativo:false,
    created_at:'2025-06-11', updated_at:'2025-10-19', created_by:'u1'
  }
];

/* ------------------------------------------------------------- métricas ---- */
/* nominal/tol_min/tol_max numéricos → a peça BP01 tem 1 métrica FORA de padrão
   (Flecha livre: nominal 205 abaixo do tol_min 206) para demonstrar o alerta. */
export const BIB_METRICAS_DEFAULT = [
  // RCE-001
  { id:'mt01', peca_id:'bp01', nome:'Comprimento total',   nominal:1520, tol_min:1518, tol_max:1522, unidade:'mm', metodo:'Medição direta', equipamento:'Trena calibrada', periodicidade:'Amostral', observacao:'', ordem:1 },
  { id:'mt02', peca_id:'bp01', nome:'Largura da lâmina',   nominal:90,   tol_min:89.5, tol_max:90.5, unidade:'mm', metodo:'Medição direta', equipamento:'Paquímetro',      periodicidade:'Por peça',  observacao:'', ordem:2 },
  { id:'mt03', peca_id:'bp01', nome:'Espessura da lâmina', nominal:16,   tol_min:15.8, tol_max:16.2, unidade:'mm', metodo:'Medição direta', equipamento:'Micrômetro',      periodicidade:'Por peça',  observacao:'', ordem:3 },
  { id:'mt04', peca_id:'bp01', nome:'Flecha livre',        nominal:205,  tol_min:206,  tol_max:210,  unidade:'mm', metodo:'Dispositivo',    equipamento:'Gabarito de flecha', periodicidade:'Amostral', observacao:'Verificar sob carga zero', ordem:4 },
  { id:'mt05', peca_id:'bp01', nome:'Dureza',              nominal:44,   tol_min:42,   tol_max:48,   unidade:'HRC', metodo:'Ensaio',        equipamento:'Durômetro Rockwell', periodicidade:'Amostral', observacao:'', ordem:5 },
  // RCE-014
  { id:'mt06', peca_id:'bp02', nome:'Comprimento total',   nominal:1360, tol_min:1357, tol_max:1363, unidade:'mm', metodo:'Medição direta', equipamento:'Trena calibrada', periodicidade:'Amostral', observacao:'', ordem:1 },
  { id:'mt07', peca_id:'bp02', nome:'Espessura no centro', nominal:22,   tol_min:21.7, tol_max:22.3, unidade:'mm', metodo:'Medição direta', equipamento:'Micrômetro',      periodicidade:'Por peça',  observacao:'', ordem:2 },
  { id:'mt08', peca_id:'bp02', nome:'Dureza pós-têmpera',  nominal:46,   tol_min:44,   tol_max:50,   unidade:'HRC', metodo:'Ensaio',        equipamento:'Durômetro Rockwell', periodicidade:'Por hora', observacao:'Característica crítica', ordem:3 },
  // LM-206
  { id:'mt09', peca_id:'bp03', nome:'Comprimento',         nominal:1180, tol_min:1178, tol_max:1182, unidade:'mm', metodo:'Medição direta', equipamento:'Trena calibrada', periodicidade:'Amostral', observacao:'', ordem:1 },
  { id:'mt10', peca_id:'bp03', nome:'Largura',             nominal:90,   tol_min:89.5, tol_max:90.5, unidade:'mm', metodo:'Medição direta', equipamento:'Paquímetro',      periodicidade:'Por peça',  observacao:'', ordem:2 },
  { id:'mt11', peca_id:'bp03', nome:'Diâmetro do furo',    nominal:16,   tol_min:16,   tol_max:16.2, unidade:'mm', metodo:'Medição direta', equipamento:'Pino passa/não-passa', periodicidade:'Por peça', observacao:'', ordem:3 },
  // GR-330
  { id:'mt12', peca_id:'bp04', nome:'Rosca',               nominal:20,   tol_min:19.8, tol_max:20,   unidade:'mm', metodo:'Calibrador',     equipamento:'Calibrador de rosca', periodicidade:'Setup', observacao:'M20 x 1,5', ordem:1 },
  { id:'mt13', peca_id:'bp04', nome:'Abertura interna',    nominal:104,  tol_min:103,  tol_max:105,  unidade:'mm', metodo:'Medição direta', equipamento:'Paquímetro',      periodicidade:'Por peça',  observacao:'', ordem:2 },
  // HC-118
  { id:'mt14', peca_id:'bp05', nome:'Diâmetro do fio',     nominal:12.5, tol_min:12.3, tol_max:12.7, unidade:'mm', metodo:'Medição direta', equipamento:'Micrômetro',      periodicidade:'Por peça',  observacao:'', ordem:1 },
  { id:'mt15', peca_id:'bp05', nome:'Altura livre',        nominal:385,  tol_min:382,  tol_max:388,  unidade:'mm', metodo:'Dispositivo',    equipamento:'Gabarito',        periodicidade:'Amostral',  observacao:'', ordem:2 },
  { id:'mt16', peca_id:'bp05', nome:'Constante elástica',  nominal:34,   tol_min:32,   tol_max:36,   unidade:'N/mm', metodo:'Ensaio',       equipamento:'Máquina universal', periodicidade:'Amostral', observacao:'', ordem:3 },
  // BE-402
  { id:'mt17', peca_id:'bp06', nome:'Diâmetro externo',    nominal:32,   tol_min:31.7, tol_max:32.3, unidade:'mm', metodo:'Medição direta', equipamento:'Paquímetro',      periodicidade:'Por peça',  observacao:'', ordem:1 },
  { id:'mt18', peca_id:'bp06', nome:'Comprimento',         nominal:1240, tol_min:1237, tol_max:1243, unidade:'mm', metodo:'Medição direta', equipamento:'Trena calibrada', periodicidade:'Amostral',  observacao:'', ordem:2 }
];

/* --------------------------------------------------------- pontos inspeção - */
export const BIB_PONTOS_DEFAULT = [
  { id:'pt01', peca_id:'bp01', descricao:'Verificar trincas nas lâminas', criticidade:'100%',   metodo:'Partícula magnética', periodicidade:'Por peça', equipamento:'Yoke magnético', foto:null, ordem:1 },
  { id:'pt02', peca_id:'bp01', descricao:'Verificar pintura e cobertura', criticidade:'Visual', metodo:'Inspeção visual',     periodicidade:'Por peça', equipamento:'—',            foto:null, ordem:2 },
  { id:'pt03', peca_id:'bp01', descricao:'Verificar empenamento',         criticidade:'Alta',   metodo:'Régua / gabarito',    periodicidade:'Amostral', equipamento:'Régua de aço', foto:null, ordem:3 },
  { id:'pt04', peca_id:'bp02', descricao:'Verificar dureza superficial',  criticidade:'Crítico',metodo:'Durômetro',           periodicidade:'Por hora', equipamento:'Durômetro',    foto:null, ordem:1 },
  { id:'pt05', peca_id:'bp02', descricao:'Verificar descarbonetação',     criticidade:'Alta',   metodo:'Metalografia',        periodicidade:'Amostral', equipamento:'Microscópio',  foto:null, ordem:2 },
  { id:'pt06', peca_id:'bp03', descricao:'Verificar raio de dobra',       criticidade:'Alta',   metodo:'Gabarito',            periodicidade:'Por peça', equipamento:'Gabarito de raio', foto:null, ordem:1 },
  { id:'pt07', peca_id:'bp04', descricao:'Verificar rosca (passa/não-passa)', criticidade:'100%', metodo:'Calibrador',       periodicidade:'Por peça', equipamento:'Calibrador de rosca', foto:null, ordem:1 },
  { id:'pt08', peca_id:'bp05', descricao:'Verificar acamamento (sag)',    criticidade:'Média',  metodo:'Ensaio de carga',     periodicidade:'Amostral', equipamento:'Máquina universal', foto:null, ordem:1 },
  { id:'pt09', peca_id:'bp06', descricao:'Verificar solda das abraçadeiras', criticidade:'Alta', metodo:'Inspeção visual + LP', periodicidade:'Por peça', equipamento:'Líquido penetrante', foto:null, ordem:1 }
];

/* ------------------------------------------------------------ documentos --- */
export const BIB_DOCUMENTOS_DEFAULT = [
  { id:'dc01', peca_id:'bp01', nome:'Desenho RCE-001 Rev.C', categoria:'Desenho',        versao:'C', data:'2026-05-18', responsavel:'Ana Beatriz',   descricao:'Desenho técnico do feixe traseiro.', url:null, tipo:'pdf',  tamanho:'820 KB' },
  { id:'dc02', peca_id:'bp01', nome:'Plano de Controle PC-001', categoria:'Plano de Controle', versao:'2', data:'2026-05-18', responsavel:'Carlos Mendes', descricao:'Plano de controle dimensional.',      url:null, tipo:'xlsx', tamanho:'44 KB' },
  { id:'dc03', peca_id:'bp02', nome:'Especificação ET-RCE-014', categoria:'Especificação', versao:'B', data:'2026-04-30', responsavel:'Carlos Mendes', descricao:'Especificação de material e têmpera.', url:null, tipo:'pdf', tamanho:'610 KB' },
  { id:'dc04', peca_id:'bp04', nome:'Norma ISO 898-1',          categoria:'Norma',          versao:'—', data:'2025-09-01', responsavel:'Ana Beatriz',   descricao:'Propriedades mecânicas de fixadores.', url:null, tipo:'pdf', tamanho:'1,2 MB' }
];

/* Mapa nome→default para o seeding/reset do módulo (estilo CATALOGOS). */
export const BIBLIOTECA = {
  bib_pecas:           BIB_PECAS_DEFAULT,
  bib_metricas:        BIB_METRICAS_DEFAULT,
  bib_pontos_inspecao: BIB_PONTOS_DEFAULT,
  bib_documentos:      BIB_DOCUMENTOS_DEFAULT,
  bib_historico:       [],
  bib_versoes:         [],
  bib_favoritos:       [],
  bib_clientes:        BIB_CLIENTES,
  bib_plantas:         BIB_PLANTAS,
  bib_familias:        BIB_FAMILIAS,
  bib_categorias:      BIB_CATEGORIAS,
  bib_processos:       BIB_PROCESSOS,
  bib_tipos:           BIB_TIPOS
};
