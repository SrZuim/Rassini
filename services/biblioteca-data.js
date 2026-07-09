/* ==========================================================================
   RNA One — Biblioteca Técnica · Dados semente (modo demo)
   Espelham as tabelas bib_* do Supabase. Em produção, o db.js busca do backend
   (rode database/biblioteca_tecnica.sql). Peças reais de suspensão automotiva.

   Cadastro reestruturado conforme processo Rassini (documento "Características ML"):
   especificações = Cota · Característica · Referência · Valor Nominal ·
   Tol. Mín · Tol. Máx · Unidade · Equipamento de Medição · Quem Mede · Observação.
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

/* Quadrante — preparado para cadastro futuro (inicia vazio; permite criar na tela). */
export const BIB_QUADRANTES = [];

/* CARACTERÍSTICAS ML — lista base do documento de referência da Rassini. */
export const BIB_CARACTERISTICAS_ML = [
  'Abertura','Altura','Altura Livre','Altura Livre Feixe Principal','Altura Livre Feixe Auxiliar',
  'Altura da braçadeira','Altura da cabeça do espigão','Altura da carga de Checagem','Altura do Gancho',
  'Altura do Pacote','Altura do Pacote do Feixe Principal','Altura do Pacote do Feixe Auxiliar',
  'Altura do contra feixe (feixe auxiliar)','Altura do contra feixe Lado Y','Altura do Ressalto','Altura do Rebaixo',
  'Altura na Carga de GVW (normal)','Altura na Carga de Vazio','Ângulo','Carbono (C)',
  'Carga de extração da Bucha','Carga na altura de Checagem','Carga na altura de Design (carga normal ou GVW)',
  'Carga na altura de Jounce','Carga na altura de Rebound','Circularidade','Classe do Material',
  'Cobertura (Shot Peening)','Código do fornecedor','Composição Química','Comprimento','Comprimento Total nos apoios',
  'Comprimento da parte plana','Comprimento do Chanfro','Comprimento do Laminado','Comprimento sobre carga',
  'Comprimento do Ressalto','Comprimento do Rebaixo','Concentricidade','Descarbonetação','Descarbonetação Parcial',
  'Descarbonetação Total','Desfolhamento','Deslocamento','Detalhe do Chanfro (desponte)','Detalhe do Laminado',
  'Detalhe do Olhete','Distância','Distância entre Centro','Distância até o centro do olhete','Dureza',
  'Espalhamento lateral','Espessura','Espessura da ponta','Esquadro','Esquadro e Torção','Forma e posição',
  'Fósforo (P)','Gráfico e Tabela de Cargas e Alturas','Identificação','Identificação de altura',
  'Identificação part number','Identificação logo marca do cliente','Identificação logo marca do fabricante',
  'Largura','Largura da lâmina','Largura da Bucha','Largura do chanfro','Largura do Olhete','Largura do cordão de solda',
  'Logomarca','Manganês (Mn)','Matéria Prima','Microestrutura - Martensita temperada','Mínima redução de área',
  'Mínimo alongamento após fratura','Montagem','Névoa salina','Oblongo (altura)','Oblongo (comprimento)','Observações',
  'ØDiâmetro do furo','ØDiâmetro da cabeça do espigão','ØDiâmetro interno da bucha','ØDiâmetro externo da bucha',
  'ØDiâmetro interno do olhete','ØDiâmetro externo do olhete','Paralelismo','Paralelo','Perpendicularidade',
  'Pintar após montagem','Planicidade','Processo de Soldagem','Propriedades Mecânicas','Proteção Superficial',
  'Raio','Rate K1','Rate K2','Rate Kt','Resistência a corrosão com Salt Spray 5%','Retilineidade','Revisão de desenho',
  'Rugosidade','Semi-comprimento','Semi-comprimento sobre carga','Silício (Si)','Simetria','Enxofre (S)',
  'Tabela de Carga/Altura/Rate','Tamanho de Grão','Tensão mínima de escoamento','Tensão mínima de tração (ruptura)',
  'Tensão Residual','Teste Almen (Shot Peening)','Teste de Fadiga','Torção','Torque','Tratamento superficial',
  'Vanádio (V)','Vista'
].map((nome, i) => ({ id:'car' + String(i + 1).padStart(3, '0'), nome, ativo:true, criado_em:'2026-01-01' }));

/* EQUIPAMENTO DE MEDIÇÃO — valores distintos do documento de referência. */
export const BIB_EQUIPAMENTOS_MEDICAO = [
  'Visual','Paquímetro','Micrômetro','Trena','Traçador de Altura','Máquina de Carga','Braço Faro',
  'Durômetro','Rugosímetro','Goniômetro','Torquímetro','Espectrômetro (certificado)','Laboratório / Certificado',
  'Certificado','Marcação','Gravação a quente','Embuchadeira','Calibrador de Raio','Calibrador de Folga','OK/NOK'
].map((nome, i) => ({ id:'eq' + String(i + 1).padStart(2, '0'), nome, ativo:true }));

/* QUEM MEDE — perfis responsáveis pela medição (permite cadastro futuro). */
export const BIB_QUEM_MEDE = [
  'G. DA QUALIDADE','ENG. DE PROCESSO','LABORATÓRIO','TODOS'
].map((nome, i) => ({ id:'qm' + (i + 1), nome, ativo:true }));

/* Status possíveis de uma peça (ciclo de vida da ficha). */
export const BIB_STATUS = ['Ativo', 'Em revisão', 'Arquivado', 'Obsoleto'];
export const BIB_DOC_CATEGORIAS = ['Desenho', 'Especificação', 'Norma', 'Instrução de Trabalho', 'Plano de Controle', 'Relatório', 'Certificado', 'Outro'];
export const BIB_CRITICIDADES = ['Crítico', 'Alta', 'Média', 'Baixa', 'Visual', '100%'];

/* Imagem placeholder (SVG data-uri) usada quando a peça não tem foto. */
export const BIB_IMG_PLACEHOLDER =
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
       <rect width="600" height="400" fill="#eef1f4"/>
       <path d="M120 250l90-110 70 80 50-45 150 175H120z" fill="#cdd4dc"/>
       <circle cx="180" cy="150" r="34" fill="#cdd4dc"/>
       <text x="300" y="360" font-family="Inter,Arial" font-size="22" fill="#9aa4b0" text-anchor="middle">Sem imagem</text>
     </svg>`);

/* helpers de lookup para montar o seed de especificações por nome */
const _car = n => (BIB_CARACTERISTICAS_ML.find(c => c.nome === n) || {}).id || null;
const _eq  = n => (BIB_EQUIPAMENTOS_MEDICAO.find(c => c.nome === n) || {}).id || null;
const _qm  = n => (BIB_QUEM_MEDE.find(c => c.nome === n) || {}).id || null;

/* -------------------------------------------------------------- peças ------ */
export const BIB_PECAS_DEFAULT = [
  {
    id:'bp01', codigo:'RCE-001', nome:'Feixe de Mola Traseiro',
    cliente:'Volvo', familia:'Feixe de Molas', quadrante:'',
    peso:'62,4 kg', material:'SAE 5160H', acabamento:'Pintura eletrostática', cor:'Preto',
    status:'Ativo', planta:'Planta Jarinu', norma:'ABNT NBR 6329', especificacao:'ET-RCE-001 Rev.C',
    revisao_desenho:3, data_revisao_desenho:'2026-05-18', numero_ad:'AD-2026-0158',
    revisao:3, observacoes:'Conferir torque dos grampos em U conforme PC-001.',
    imagem:null, galeria:[], ativo:true, created_at:'2025-11-02', updated_at:'2026-05-18', created_by:'u1'
  },
  {
    id:'bp02', codigo:'RCE-014', nome:'Mola Parabólica Dianteira',
    cliente:'Scania', familia:'Mola Parabólica', quadrante:'',
    peso:'28,1 kg', material:'SAE 51B60', acabamento:'Shot peening + pintura', cor:'Cinza grafite',
    status:'Ativo', planta:'Planta Jarinu', norma:'DIN 17221', especificacao:'ET-RCE-014 Rev.B',
    revisao_desenho:2, data_revisao_desenho:'2026-04-30', numero_ad:'AD-2026-0092',
    revisao:2, observacoes:'Dureza pós-têmpera crítica.',
    imagem:null, galeria:[], ativo:true, created_at:'2025-12-10', updated_at:'2026-04-30', created_by:'u1'
  },
  {
    id:'bp03', codigo:'LM-206', nome:'Lâmina Principal 2ª',
    cliente:'Mercedes-Benz', familia:'Lâmina', quadrante:'',
    peso:'11,7 kg', material:'SAE 5160', acabamento:'Jateado', cor:'Natural',
    status:'Em revisão', planta:'Planta Rio Nova Iguaçu', norma:'ABNT NBR 6329', especificacao:'ET-LM-206 Rev.A',
    revisao_desenho:1, data_revisao_desenho:'2026-06-22', numero_ad:'AD-2026-0203',
    revisao:1, observacoes:'Validar novo raio de dobra.',
    imagem:null, galeria:[], ativo:true, created_at:'2026-06-22', updated_at:'2026-06-22', created_by:'u1'
  },
  {
    id:'bp04', codigo:'GR-330', nome:'Grampo em U M20',
    cliente:'Randon', familia:'Grampo', quadrante:'',
    peso:'3,2 kg', material:'SAE 1045', acabamento:'Zincado', cor:'Prata',
    status:'Ativo', planta:'Planta SP 01', norma:'ISO 898-1', especificacao:'ET-GR-330 Rev.D',
    revisao_desenho:4, data_revisao_desenho:'2026-03-14', numero_ad:'AD-2025-0451',
    revisao:4, observacoes:'Torque 320 N·m ±5%.',
    imagem:null, galeria:[], ativo:true, created_at:'2025-09-01', updated_at:'2026-03-14', created_by:'u1'
  },
  {
    id:'bp05', codigo:'HC-118', nome:'Mola Helicoidal Traseira',
    cliente:'Volkswagen', familia:'Mola Helicoidal', quadrante:'',
    peso:'4,8 kg', material:'SAE 9254', acabamento:'Pintura epóxi', cor:'Preto fosco',
    status:'Ativo', planta:'Planta SP 02', norma:'SAE J157', especificacao:'ET-HC-118 Rev.A',
    revisao_desenho:1, data_revisao_desenho:'2026-02-05', numero_ad:'AD-2026-0031',
    revisao:1, observacoes:'',
    imagem:null, galeria:[], ativo:true, created_at:'2026-02-05', updated_at:'2026-02-05', created_by:'u1'
  },
  {
    id:'bp06', codigo:'BE-402', nome:'Barra Estabilizadora Dianteira',
    cliente:'Ford', familia:'Barra Estabilizadora', quadrante:'',
    peso:'9,6 kg', material:'SAE 26MnB5', acabamento:'Fosfatizado + pintura', cor:'Preto',
    status:'Arquivado', planta:'Planta Jarinu', norma:'ASTM A513', especificacao:'ET-BE-402 Rev.B',
    revisao_desenho:2, data_revisao_desenho:'2025-10-19', numero_ad:'AD-2025-0288',
    revisao:2, observacoes:'Substituída pela BE-410.',
    imagem:null, galeria:[], ativo:false, created_at:'2025-06-11', updated_at:'2025-10-19', created_by:'u1'
  }
];

/* -------------------------------------------------- especificações (bib_metricas)
   Modelo Rassini: cota, característica (id), referência, valor nominal, tolerâncias,
   unidade, equipamento de medição (id), quem mede (id), observação.
   A peça RCE-001 tem 1 especificação FORA de tolerância (Altura Livre) p/ demo. */
export const BIB_METRICAS_DEFAULT = [
  // RCE-001
  { id:'mt01', peca_id:'bp01', cota:1, caracteristica_id:_car('Comprimento Total nos apoios'), referencia:'Vista A', nominal:1520, tol_min:1518, tol_max:1522, unidade:'mm', equipamento_id:_eq('Trena'),      quem_mede_id:_qm('G. DA QUALIDADE'), observacao:'', ordem:1 },
  { id:'mt02', peca_id:'bp01', cota:2, caracteristica_id:_car('Largura da lâmina'),            referencia:'Vista B', nominal:90,   tol_min:89.5, tol_max:90.5, unidade:'mm', equipamento_id:_eq('Paquímetro'), quem_mede_id:_qm('G. DA QUALIDADE'), observacao:'', ordem:2 },
  { id:'mt03', peca_id:'bp01', cota:3, caracteristica_id:_car('Espessura'),                    referencia:'Detalhe A', nominal:16, tol_min:15.8, tol_max:16.2, unidade:'mm', equipamento_id:_eq('Micrômetro'), quem_mede_id:_qm('G. DA QUALIDADE'), observacao:'', ordem:3 },
  { id:'mt04', peca_id:'bp01', cota:4, caracteristica_id:_car('Altura Livre'),                 referencia:'Vista C', nominal:205,  tol_min:206,  tol_max:210,  unidade:'mm', equipamento_id:_eq('Trena'),      quem_mede_id:_qm('ENG. DE PROCESSO'), observacao:'Sob carga zero', ordem:4 },
  { id:'mt05', peca_id:'bp01', cota:5, caracteristica_id:_car('Dureza'),                       referencia:'—',       nominal:44,   tol_min:42,   tol_max:48,   unidade:'HRC', equipamento_id:_eq('Durômetro'), quem_mede_id:_qm('LABORATÓRIO'), observacao:'', ordem:5 },
  // RCE-014
  { id:'mt06', peca_id:'bp02', cota:1, caracteristica_id:_car('Comprimento'),                  referencia:'Vista A', nominal:1360, tol_min:1357, tol_max:1363, unidade:'mm', equipamento_id:_eq('Trena'),      quem_mede_id:_qm('G. DA QUALIDADE'), observacao:'', ordem:1 },
  { id:'mt07', peca_id:'bp02', cota:2, caracteristica_id:_car('Espessura'),                    referencia:'Vista B', nominal:22,   tol_min:21.7, tol_max:22.3, unidade:'mm', equipamento_id:_eq('Micrômetro'), quem_mede_id:_qm('G. DA QUALIDADE'), observacao:'', ordem:2 },
  { id:'mt08', peca_id:'bp02', cota:3, caracteristica_id:_car('Dureza'),                       referencia:'—',       nominal:46,   tol_min:44,   tol_max:50,   unidade:'HRC', equipamento_id:_eq('Durômetro'), quem_mede_id:_qm('LABORATÓRIO'), observacao:'Característica crítica', ordem:3 },
  // LM-206
  { id:'mt09', peca_id:'bp03', cota:1, caracteristica_id:_car('Comprimento'),                  referencia:'Vista A', nominal:1180, tol_min:1178, tol_max:1182, unidade:'mm', equipamento_id:_eq('Trena'),      quem_mede_id:_qm('G. DA QUALIDADE'), observacao:'', ordem:1 },
  { id:'mt10', peca_id:'bp03', cota:2, caracteristica_id:_car('Largura'),                      referencia:'Vista B', nominal:90,   tol_min:89.5, tol_max:90.5, unidade:'mm', equipamento_id:_eq('Paquímetro'), quem_mede_id:_qm('G. DA QUALIDADE'), observacao:'', ordem:2 },
  { id:'mt11', peca_id:'bp03', cota:3, caracteristica_id:_car('ØDiâmetro do furo'),            referencia:'Detalhe A', nominal:16, tol_min:16,   tol_max:16.2, unidade:'mm', equipamento_id:_eq('Micrômetro'), quem_mede_id:_qm('G. DA QUALIDADE'), observacao:'', ordem:3 },
  // GR-330
  { id:'mt12', peca_id:'bp04', cota:1, caracteristica_id:_car('Comprimento'),                  referencia:'Vista A', nominal:104,  tol_min:103,  tol_max:105,  unidade:'mm', equipamento_id:_eq('Paquímetro'), quem_mede_id:_qm('G. DA QUALIDADE'), observacao:'Abertura interna', ordem:1 },
  { id:'mt13', peca_id:'bp04', cota:2, caracteristica_id:_car('Ângulo'),                       referencia:'Vista B', nominal:90,   tol_min:89,   tol_max:91,   unidade:'°',  equipamento_id:_eq('Goniômetro'), quem_mede_id:_qm('ENG. DE PROCESSO'), observacao:'', ordem:2 },
  // HC-118
  { id:'mt14', peca_id:'bp05', cota:1, caracteristica_id:_car('Altura Livre'),                 referencia:'Vista A', nominal:385,  tol_min:382,  tol_max:388,  unidade:'mm', equipamento_id:_eq('Trena'),          quem_mede_id:_qm('ENG. DE PROCESSO'), observacao:'', ordem:1 },
  { id:'mt15', peca_id:'bp05', cota:2, caracteristica_id:_car('Rate K1'),                      referencia:'—',       nominal:34,   tol_min:32,   tol_max:36,   unidade:'N/mm', equipamento_id:_eq('Máquina de Carga'), quem_mede_id:_qm('ENG. DE PROCESSO'), observacao:'', ordem:2 },
  // BE-402
  { id:'mt16', peca_id:'bp06', cota:1, caracteristica_id:_car('Comprimento'),                  referencia:'Vista A', nominal:1240, tol_min:1237, tol_max:1243, unidade:'mm', equipamento_id:_eq('Trena'),      quem_mede_id:_qm('G. DA QUALIDADE'), observacao:'', ordem:1 }
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
  bib_quadrantes:      BIB_QUADRANTES,
  caracteristicas_ml:  BIB_CARACTERISTICAS_ML,
  equipamentos_medicao: BIB_EQUIPAMENTOS_MEDICAO,
  quem_mede:           BIB_QUEM_MEDE
};
