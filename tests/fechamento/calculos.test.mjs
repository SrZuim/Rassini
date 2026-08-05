/* ==========================================================================
   §50 — Testes de BANCO E CÁLCULOS do Fechamento Mensal
   PPM oficial · PPM real · PPM interno · dias sem reclamação · acumulados ·
   retrabalho · sucata · custos · variação mensal · divisão por zero ·
   critérios por vigência.
   ========================================================================== */
import { suite, teste, esperar } from '../runner.mjs';
import * as CALC from '../../services/fechamento/fm-calc.js';

/* Helpers de fixture — dados mínimos e explícitos, nunca "dados de exemplo"
   que escondam o que está sendo verificado. */
const recl = (o = {}) => ({
  id: 'r' + Math.random(), qtd_reclamacoes: 1, qtd_pecas: 1,
  oficial: true, demerito: true, negociada: false, ...o
});
const forn = (qtd, o = {}) => ({ id: 'f' + Math.random(), qtd_fornecida: qtd, ...o });
const ocor = (o = {}) => ({ id: 'o' + Math.random(), qtd_pecas: 1, origem_ocorrencia: 'Produção', ...o });
const prod = (qtd, o = {}) => ({ id: 'p' + Math.random(), qtd_fabricada: qtd, ...o });

const CRITERIO = {
  id: 'c1', indicador: 'ppm_interno', nome: 'Padrão', status: 'Ativo', versao: 1,
  vigencia_inicio: '2026-01-01', vigencia_fim: null, planta: null,
  fontes_incluidas: ['Produção', 'CARE', 'Sucata'], fontes_excluidas: ['Devolução de cliente']
};

/* ========================================================================== */
suite('§8 — PPM externo oficial', () => {

  teste('calcula NG com demérito ÷ fornecidas × 1.000.000', () => {
    const r = CALC.ppmExternoOficial(
      [recl({ qtd_pecas: 3 }), recl({ qtd_pecas: 2 })],
      [forn(100_000)]);
    esperar(r.calculavel).verdadeiro();
    esperar(r.valor).proximo(50);            // 5 / 100000 * 1e6
    esperar(r.memoria.numerador).igual(5);
    esperar(r.memoria.denominador).igual(100_000);
  });

  teste('ignora reclamação NÃO oficial', () => {
    const r = CALC.ppmExternoOficial(
      [recl({ qtd_pecas: 10, oficial: false }), recl({ qtd_pecas: 5 })],
      [forn(1_000_000)]);
    esperar(r.memoria.numerador).igual(5);
    esperar(r.valor).proximo(5);
  });

  teste('ignora reclamação sem demérito', () => {
    const r = CALC.ppmExternoOficial(
      [recl({ qtd_pecas: 10, demerito: false }), recl({ qtd_pecas: 2 })],
      [forn(1_000_000)]);
    esperar(r.memoria.numerador).igual(2);
  });

  teste('ignora registro com soft delete', () => {
    const r = CALC.ppmExternoOficial(
      [recl({ qtd_pecas: 99, deleted_at: '2026-08-01T00:00:00Z' }), recl({ qtd_pecas: 1 })],
      [forn(1_000_000)]);
    esperar(r.memoria.numerador).igual(1);
  });

  teste('divisão por zero devolve "Sem base de fornecimento", não erro nem zero', () => {
    const r = CALC.ppmExternoOficial([recl({ qtd_pecas: 5 })], []);
    esperar(r.calculavel).falso();
    esperar(r.valor).nulo();
    esperar(r.exibicao).igual('Sem base de fornecimento');
    esperar(r.memoria.resultado_exibido).igual('Sem base de fornecimento');
  });

  teste('sem reclamações com base válida resulta em zero (não em "sem base")', () => {
    const r = CALC.ppmExternoOficial([], [forn(50_000)]);
    esperar(r.calculavel).verdadeiro();
    esperar(r.valor).igual(0);
  });

  teste('memória de cálculo traz todos os campos do §8', () => {
    const m = CALC.ppmExternoOficial([recl({ qtd_pecas: 3 })], [forn(1000)]).memoria;
    esperar(m.formula).contem('÷');
    esperar(m.numerador).igual(3);
    esperar(m.denominador).igual(1000);
    esperar(m.resultado_bruto).proximo(3000);
    esperar(m.resultado_exibido).naoNulo();
    esperar(m.calculado_em).naoNulo();
    esperar(m.criterio_nome).naoNulo();
    esperar(m.criterio_versao).igual(1);
  });
});

/* ========================================================================== */
suite('§9 — PPM externo real', () => {

  teste('soma NG oficiais e negociadas', () => {
    const r = CALC.ppmExternoReal([
      recl({ qtd_pecas: 3 }),
      recl({ qtd_pecas: 7, oficial: false, demerito: false, negociada: true })
    ], [forn(1_000_000)]);
    esperar(r.valor).proximo(10);
    esperar(r.memoria.entradas['Peças NG oficiais']).igual(3);
    esperar(r.memoria.entradas['Peças NG negociadas']).igual(7);
  });

  teste('real ≥ oficial quando há negociadas', () => {
    const reclamacoes = [recl({ qtd_pecas: 2 }), recl({ qtd_pecas: 8, oficial: false, demerito: false, negociada: true })];
    const forns = [forn(1_000_000)];
    const o = CALC.ppmExternoOficial(reclamacoes, forns);
    const r = CALC.ppmExternoReal(reclamacoes, forns);
    esperar(r.valor > o.valor).verdadeiro();
    const cmp = CALC.comparativoPPM(o, r);
    esperar(cmp.diferenca).proximo(8);
    esperar(cmp.diferencaPercentual).proximo(400);   // de 2 para 10 = +400%
  });

  teste('sem base de fornecimento não calcula o comparativo', () => {
    const o = CALC.ppmExternoOficial([recl()], []);
    const r = CALC.ppmExternoReal([recl()], []);
    esperar(CALC.comparativoPPM(o, r).diferenca).nulo();
  });
});

/* ========================================================================== */
suite('§13 — PPM interno e critério configurável', () => {

  teste('conta apenas as fontes incluídas no critério', () => {
    const r = CALC.ppmInterno({
      ocorrencias: [
        ocor({ qtd_pecas: 10, origem_ocorrencia: 'Produção' }),
        ocor({ qtd_pecas: 5,  origem_ocorrencia: 'CARE' }),
        ocor({ qtd_pecas: 99, origem_ocorrencia: 'Devolução de cliente' })  // excluída
      ],
      producao: [prod(1_000_000)]
    }, CRITERIO);
    esperar(r.memoria.numerador).igual(15);
    esperar(r.valor).proximo(15);
  });

  teste('fonte ausente do critério não entra no numerador', () => {
    const r = CALC.ppmInterno({
      ocorrencias: [ocor({ qtd_pecas: 40, origem_ocorrencia: 'Muro da Qualidade' })],
      producao: [prod(1_000_000)]
    }, CRITERIO);
    esperar(r.memoria.numerador).igual(0);
  });

  teste('reclamações só entram se o critério mandar', () => {
    const dados = { ocorrencias: [], producao: [prod(1_000_000)], reclamacoes: [recl({ qtd_pecas: 25 })] };
    esperar(CALC.ppmInterno(dados, CRITERIO).memoria.numerador).igual(0);

    const comReclamacoes = { ...CRITERIO, fontes_incluidas: [...CRITERIO.fontes_incluidas, 'Reclamações oficiais'] };
    esperar(CALC.ppmInterno(dados, comReclamacoes).memoria.numerador).igual(25);
  });

  teste('sucata não é contada duas vezes quando já existe ocorrência de sucata', () => {
    const dados = {
      ocorrencias: [ocor({ qtd_pecas: 30, origem_ocorrencia: 'Sucata' })],
      sucata: [{ id: 's1', quantidade: 30 }],
      producao: [prod(1_000_000)]
    };
    esperar(CALC.ppmInterno(dados, CRITERIO).memoria.numerador).igual(30);
  });

  teste('sem produção devolve "Sem base de produção"', () => {
    const r = CALC.ppmInterno({ ocorrencias: [ocor({ qtd_pecas: 5 })], producao: [] }, CRITERIO);
    esperar(r.calculavel).falso();
    esperar(r.exibicao).igual('Sem base de produção');
  });

  teste('sem critério vigente não calcula', () => {
    const r = CALC.ppmInterno({ ocorrencias: [], producao: [prod(1000)] }, null);
    esperar(r.calculavel).falso();
    esperar(r.exibicao).contem('critério');
  });

  teste('memória registra o critério e a vigência aplicados', () => {
    const m = CALC.ppmInterno({ ocorrencias: [ocor({ qtd_pecas: 1 })], producao: [prod(1000)] }, CRITERIO).memoria;
    esperar(m.criterio_nome).igual('Padrão');
    esperar(m.criterio_versao).igual(1);
    esperar(m.entradas['Vigência do critério']).contem('2026-01-01');
  });
});

/* ========================================================================== */
suite('§13 — vigência do critério (histórico usa o critério da época)', () => {

  const antigo = { ...CRITERIO, id: 'ant', nome: 'Antigo', versao: 1, vigencia_inicio: '2025-01-01', vigencia_fim: '2025-12-31' };
  const novo   = { ...CRITERIO, id: 'nov', nome: 'Novo',   versao: 2, vigencia_inicio: '2026-01-01', vigencia_fim: null };
  const lista  = [antigo, novo];

  teste('data de 2025 usa o critério antigo', () => {
    esperar(CALC.criterioVigente(lista, '2025-07-31').nome).igual('Antigo');
  });

  teste('data de 2026 usa o critério novo', () => {
    esperar(CALC.criterioVigente(lista, '2026-08-31').nome).igual('Novo');
  });

  teste('data anterior a qualquer vigência não encontra critério', () => {
    esperar(CALC.criterioVigente(lista, '2024-05-01')).nulo();
  });

  teste('critério da planta específica vence o global', () => {
    const daPlanta = { ...novo, id: 'pl', nome: 'Planta RJ', planta: 'Planta RJ - Lâminas' };
    const r = CALC.criterioVigente([novo, daPlanta], '2026-08-31', { planta: 'Planta RJ - Lâminas' });
    esperar(r.nome).igual('Planta RJ');
  });

  teste('critério inativo é ignorado', () => {
    esperar(CALC.criterioVigente([{ ...novo, status: 'Inativo' }], '2026-08-31')).nulo();
  });
});

/* ========================================================================== */
suite('§10 — dias sem reclamação', () => {

  teste('conta a partir da última reclamação oficial', () => {
    const r = CALC.diasSemReclamacao([
      recl({ data_reclamacao: '2026-07-10', cliente_oficial: 'Cliente A' }),
      recl({ data_reclamacao: '2026-08-01', cliente_oficial: 'Cliente B' })
    ], '2026-08-31');
    esperar(r.valor).igual(30);
    esperar(r.ultima.cliente).igual('Cliente B');
    esperar(r.ultima.data).igual('2026-08-01');
  });

  teste('reclamação NÃO oficial não zera o contador', () => {
    const r = CALC.diasSemReclamacao([
      recl({ data_reclamacao: '2026-08-01' }),
      recl({ data_reclamacao: '2026-08-28', oficial: false })
    ], '2026-08-31');
    esperar(r.valor).igual(30);
  });

  teste('base vazia informa "Sem reclamações registradas"', () => {
    const r = CALC.diasSemReclamacao([], '2026-08-31');
    esperar(r.calculavel).falso();
    esperar(r.exibicao).igual('Sem reclamações registradas');
    esperar(r.valor).nulo();
  });

  teste('recorde histórico é o maior intervalo entre reclamações', () => {
    const r = CALC.diasSemReclamacao([
      recl({ data_reclamacao: '2026-01-01' }),
      recl({ data_reclamacao: '2026-05-01' }),   // 120 dias
      recl({ data_reclamacao: '2026-05-15' })
    ], '2026-06-01');
    esperar(r.recorde).igual(120);
    esperar(r.diferencaRecorde).igual(103);       // 120 − 17 dias em curso
  });

  teste('sequência em curso maior que o histórico vira o novo recorde', () => {
    const r = CALC.diasSemReclamacao([
      recl({ data_reclamacao: '2026-01-01' }),
      recl({ data_reclamacao: '2026-01-10' })
    ], '2026-08-31');
    esperar(r.recorde).igual(233);
    esperar(r.diferencaRecorde).igual(0);
  });

  teste('diferença de datas não sofre com fuso (§20)', () => {
    esperar(CALC.diasEntre('2026-08-01', '2026-08-02')).igual(1);
    esperar(CALC.diasEntre('2025-12-31', '2026-01-01')).igual(1);
    esperar(CALC.diasEntre('2026-02-28', '2026-03-01')).igual(1);   // 2026 não é bissexto
  });
});

/* ========================================================================== */
suite('§20/§21 — retrabalho e sucata', () => {

  teste('índice de retrabalho em PPM', () => {
    const r = CALC.indiceRetrabalho([{ id: 'x', qtd_produzida: 10_000, qtd_retrabalhada: 25 }]);
    esperar(r.valor).proximo(2500);
    esperar(r.modo).igual('ppm');
  });

  teste('mesmo dado em percentual', () => {
    const r = CALC.indiceRetrabalho([{ id: 'x', qtd_produzida: 10_000, qtd_retrabalhada: 25 }], { modo: 'percentual' });
    esperar(r.valor).proximo(0.25);
    esperar(r.exibicao).contem('%');
  });

  teste('retrabalho sem produção não divide por zero', () => {
    const r = CALC.indiceRetrabalho([{ id: 'x', qtd_produzida: 0, qtd_retrabalhada: 5 }]);
    esperar(r.calculavel).falso();
    esperar(r.exibicao).igual('Sem base de produção');
  });

  teste('PPM de sucata sobre peças fabricadas', () => {
    const r = CALC.ppmSucata([{ id: 's', quantidade: 12, peso: 30, valor: 100 }], [prod(600_000)]);
    esperar(r.valor).proximo(20);
    esperar(r.memoria.entradas['Peso total (kg)']).igual(30);
  });

  teste('sucata sem produção não calcula', () => {
    esperar(CALC.ppmSucata([{ id: 's', quantidade: 12 }], []).calculavel).falso();
  });
});

/* ========================================================================== */
suite('§19 — custos da qualidade', () => {

  const custos = [
    { id: '1', categoria: 'Retrabalho', valor: 1500, cliente: 'A' },
    { id: '2', categoria: 'Sucata',     valor: 2500, cliente: 'B' },
    { id: '3', categoria: 'Retrabalho', valor: 1000, cliente: 'A' }
  ];

  teste('soma o total do mês', () => {
    esperar(CALC.custoQualidade(custos).valor).igual(5000);
  });

  teste('agrupa por categoria em ordem decrescente', () => {
    const r = CALC.custoQualidade(custos);
    esperar(r.porCategoria[0].chave).igual('Retrabalho');
    esperar(r.porCategoria[0].valor).igual(2500);
    esperar(r.porCategoria[0].percentual).proximo(50);
  });

  teste('compara com o limite mensal configurado', () => {
    esperar(CALC.custoQualidade(custos, { limite: 28000 }).dentroDoLimite).verdadeiro();
    esperar(CALC.custoQualidade(custos, { limite: 4000 }).dentroDoLimite).falso();
  });

  teste('custo por peça produzida informa "sem base" quando não há produção', () => {
    const r = CALC.custoQualidade(custos, { producao: [] });
    esperar(r.custoPorPeca).nulo();
    esperar(r.memoria.entradas['Custo por peça produzida']).igual('Sem base de produção');
  });

  teste('custo por peça com produção informada', () => {
    esperar(CALC.custoQualidade(custos, { producao: [prod(10_000)] }).custoPorPeca).proximo(0.5);
  });

  teste('moeda formatada em real com vírgula decimal (§37)', () => {
    esperar(CALC.fmtMoeda(28000)).contem('28.000,00');
  });
});

/* ========================================================================== */
suite('§22 — CARE', () => {

  const care = [
    { id: '1', qtd_inspecionada: 100, qtd_ng: 3, tipo_defeito: 'Marca de Ferramenta', part_number: '23B511151D' },
    { id: '2', qtd_inspecionada: 200, qtd_ng: 1, tipo_defeito: 'Rebarba',             part_number: '23B511151D' },
    { id: '3', qtd_inspecionada: 100, qtd_ng: 5, tipo_defeito: 'Marca de Ferramenta', part_number: 'XPTO-1' }
  ];

  teste('totais e percentual de NG', () => {
    const r = CALC.indicadoresCare(care);
    esperar(r.totalInspecionado).igual(400);
    esperar(r.totalNG).igual(9);
    esperar(r.percentualNG).proximo(2.25);
  });

  teste('principal problema é CALCULADO pela maior quantidade (§22)', () => {
    esperar(CALC.indicadoresCare(care).principalProblema).igual('Marca de Ferramenta');
    esperar(CALC.indicadoresCare(care).principalProblemaQtd).igual(8);
  });

  teste('Part Number com maior reincidência', () => {
    const r = CALC.indicadoresCare(care);
    esperar(r.partNumberReincidente).igual('23B511151D');
    esperar(r.partNumberReincidenteQtd).igual(2);
  });

  teste('sem inspeções não inventa percentual', () => {
    const r = CALC.indicadoresCare([]);
    esperar(r.percentualNG).nulo();
    esperar(r.exibicaoPercentual).igual('Sem inspeções registradas');
  });
});

/* ========================================================================== */
suite('§31 — avaliação contra a meta', () => {

  teste('menor ou igual: dentro da meta', () => {
    esperar(CALC.avaliarMeta(30, 50, { comparacao: '<=' }).cor).igual('verde');
  });

  teste('menor ou igual: fora da meta', () => {
    const r = CALC.avaliarMeta(80, 50, { comparacao: '<=' });
    esperar(r.cor).igual('vermelho');
    esperar(r.dentro).falso();
  });

  teste('zona de atenção pinta de amarelo antes de estourar', () => {
    esperar(CALC.avaliarMeta(48, 50, { comparacao: '<=' }).cor).igual('amarelo');
  });

  teste('maior ou igual (satisfação do cliente)', () => {
    esperar(CALC.avaliarMeta(95, 90, { comparacao: '>=' }).dentro).verdadeiro();
    esperar(CALC.avaliarMeta(85, 90, { comparacao: '>=' }).dentro).falso();
  });

  teste('faixa usa mínimo e máximo', () => {
    esperar(CALC.avaliarMeta(15, 10, { comparacao: 'faixa', valorMax: 20 }).dentro).verdadeiro();
    esperar(CALC.avaliarMeta(25, 10, { comparacao: 'faixa', valorMax: 20 }).dentro).falso();
  });

  teste('sem dados fica cinza; sem meta fica azul (§6)', () => {
    esperar(CALC.avaliarMeta(null, 50).cor).igual('cinza');
    esperar(CALC.avaliarMeta(30, null).cor).igual('azul');
  });

  teste('meta mais específica (cliente) vence a global', () => {
    const metas = [
      { id: '1', indicador: 'ppm_externo_oficial', status: 'Ativo', valor: 50 },
      { id: '2', indicador: 'ppm_externo_oficial', status: 'Ativo', valor: 25, cliente: 'Cliente A' }
    ];
    esperar(CALC.metaVigente(metas, 'ppm_externo_oficial', { cliente: 'Cliente A' }).valor).igual(25);
    esperar(CALC.metaVigente(metas, 'ppm_externo_oficial', {}).valor).igual(50);
  });
});

/* ========================================================================== */
suite('§34 — variação mensal e acumulados', () => {

  teste('variação absoluta e percentual', () => {
    const v = CALC.variacao(1820, 1450);
    esperar(v.absoluta).igual(370);
    esperar(v.percentual).proximo(25.517241, 5);
    esperar(v.tendencia).igual('subiu');
  });

  teste('mês anterior zero não gera divisão por zero', () => {
    const v = CALC.variacao(10, 0);
    esperar(v.absoluta).igual(10);
    esperar(v.percentual).nulo();
  });

  teste('sem base anterior não inventa variação', () => {
    esperar(CALC.variacao(10, null).tendencia).igual('sem_base');
  });

  teste('acumulado anual soma os meses informados', () => {
    const a = CALC.acumuladoAnual([{ mes: 1, valor: 10 }, { mes: 2, valor: 20 }, { mes: 3, valor: null }]);
    esperar(a.soma).igual(30);
    esperar(a.meses).igual(2);
    esperar(a.serie).tamanho(12);
    esperar(a.serie[11].valor).nulo();
  });

  teste('PPM acumulado é a razão dos totais, NÃO a soma dos PPM', () => {
    /* Jan: 10 NG / 100.000 = 100 PPM · Fev: 5 NG / 900.000 = 5,56 PPM
       Somar daria 105,56 — errado. O correto é 15/1.000.000 = 15 PPM. */
    const acc = CALC.ppmAcumulado([
      { mes: 1, numerador: 10, denominador: 100_000 },
      { mes: 2, numerador: 5,  denominador: 900_000 }
    ]);
    esperar(acc.valor).proximo(15);
    esperar(acc.denominador).igual(1_000_000);
  });

  teste('PPM acumulado sem denominador informa "Sem base acumulada"', () => {
    esperar(CALC.ppmAcumulado([{ mes: 1, numerador: 5, denominador: 0 }]).exibicao).igual('Sem base acumulada');
  });
});

/* ========================================================================== */
suite('§16 — Cruz da Qualidade', () => {

  const base = { mes: 8, ano: 2026, producao: [], ocorrencias: [], quebras: [], diasManuais: [] };
  const comProducao = dias => dias.map(d => prod(1000, { data: d }));

  teste('agosto/2026 tem 31 dias', () => {
    esperar(CALC.cruzDaQualidade(base).dias).tamanho(31);
  });

  teste('dia com produção e sem ocorrência fica VERDE', () => {
    const r = CALC.cruzDaQualidade({ ...base, producao: comProducao(['2026-08-01']) });
    esperar(r.dias[0].status).igual('verde');
  });

  teste('dia sem produção fica CINZA (não verde)', () => {
    esperar(CALC.cruzDaQualidade(base).dias[0].status).igual('cinza');
  });

  teste('ocorrência leve fica AMARELO', () => {
    const r = CALC.cruzDaQualidade({
      ...base, producao: comProducao(['2026-08-05']),
      ocorrencias: [ocor({ data: '2026-08-05', qtd_pecas: 2 })]
    });
    esperar(r.dias[4].status).igual('amarelo');
  });

  teste('ocorrência relevante (≥10 peças) fica VERMELHO', () => {
    const r = CALC.cruzDaQualidade({
      ...base, producao: comProducao(['2026-08-05']),
      ocorrencias: [ocor({ data: '2026-08-05', qtd_pecas: 15 })]
    });
    esperar(r.dias[4].status).igual('vermelho');
  });

  teste('quebra no dia fica PRETO', () => {
    const r = CALC.cruzDaQualidade({
      ...base, producao: comProducao(['2026-08-10']),
      quebras: [{ id: 'q', data_quebra: '2026-08-10' }]
    });
    esperar(r.dias[9].status).igual('preto');
    esperar(r.dias[9].motivo).contem('quebra');
  });

  teste('regra de cor é configurável (§16)', () => {
    const dados = { ...base, producao: comProducao(['2026-08-05']), ocorrencias: [ocor({ data: '2026-08-05', qtd_pecas: 5 })] };
    esperar(CALC.cruzDaQualidade(dados).dias[4].status).igual('amarelo');
    esperar(CALC.cruzDaQualidade(dados, { vermelho_min_pecas: 3 }).dias[4].status).igual('vermelho');
  });

  teste('sobreposição manual vence a regra automática', () => {
    const r = CALC.cruzDaQualidade({
      ...base, producao: comProducao(['2026-08-05']),
      ocorrencias: [ocor({ data: '2026-08-05', qtd_pecas: 50 })],
      diasManuais: [{ dia: '2026-08-05', status_manual: 'cinza', justificativa: 'Parada programada' }]
    });
    esperar(r.dias[4].status).igual('cinza');
    esperar(r.dias[4].motivo).igual('Parada programada');
    esperar(r.dias[4].manual).verdadeiro();
  });

  teste('estatísticas: dias verdes, maior sequência e % conformes', () => {
    const r = CALC.cruzDaQualidade({
      ...base,
      producao: comProducao(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04']),
      ocorrencias: [ocor({ data: '2026-08-03', qtd_pecas: 1 })]
    });
    esperar(r.estatisticas.diasSemOcorrencia).igual(3);
    esperar(r.estatisticas.maiorSequencia).igual(2);
    esperar(r.estatisticas.amarelos).igual(1);
    esperar(r.estatisticas.percentualConformes).proximo(75);
  });
});

/* ========================================================================== */
suite('§15 — rankings dos principais problemas', () => {

  const atual = {
    ocorrencias: [
      ocor({ tipo_defeito: 'Marca de Ferramenta', qtd_pecas: 30, part_number: 'PN-1', linha: 'L1', processo: 'P1' }),
      ocor({ tipo_defeito: 'Rebarba',             qtd_pecas: 10, part_number: 'PN-1', linha: 'L2', processo: 'P1' }),
      ocor({ tipo_defeito: 'Marca de Ferramenta', qtd_pecas: 5,  part_number: 'PN-2', linha: 'L1', processo: 'P2' })
    ],
    reclamacoes: [recl({ cliente_oficial: 'Cliente A', qtd_reclamacoes: 2 }), recl({ cliente_oficial: 'Cliente B' })]
  };

  teste('defeito com maior quantidade lidera', () => {
    const r = CALC.rankings(atual);
    esperar(r.defeito[0].chave).igual('Marca de Ferramenta');
    esperar(r.defeito[0].valor).igual(35);
    esperar(r.defeito[0].percentual).proximo(77.777777, 4);
  });

  teste('Part Number é ranqueado por REINCIDÊNCIA, não por quantidade', () => {
    const r = CALC.rankings(atual);
    esperar(r.partNumber[0].chave).igual('PN-1');
    esperar(r.partNumber[0].ocorrencias).igual(2);
  });

  teste('linha, processo e cliente também são ranqueados', () => {
    const r = CALC.rankings(atual);
    esperar(r.linha[0].chave).igual('L1');
    esperar(r.processo[0].chave).igual('P1');
    esperar(r.cliente[0].chave).igual('Cliente A');
  });

  teste('compara com a posição do mês anterior', () => {
    const anterior = { ocorrencias: [ocor({ tipo_defeito: 'Rebarba', qtd_pecas: 99 })], reclamacoes: [] };
    const r = CALC.rankings(atual, anterior);
    const marca = r.defeito.find(d => d.chave === 'Marca de Ferramenta');
    esperar(marca.posicaoAnterior).nulo();
    esperar(marca.tendencia).igual('novo');
    const rebarba = r.defeito.find(d => d.chave === 'Rebarba');
    esperar(rebarba.posicaoAnterior).igual(1);
    esperar(rebarba.tendencia).igual('melhora');   // caiu de 99 para 10 peças
  });

  teste('campo não informado vira "(não informado)" em vez de sumir', () => {
    const r = CALC.agrupar([ocor({ tipo_defeito: null, qtd_pecas: 5 })], 'tipo_defeito', 'qtd_pecas');
    esperar(r[0].chave).igual('(não informado)');
  });
});
