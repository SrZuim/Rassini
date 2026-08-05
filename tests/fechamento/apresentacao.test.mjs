/* ==========================================================================
   §50 — Testes da APRESENTAÇÃO
   estrutura e ordem dos slides · nome correto do arquivo · mês correto ·
   valores corretos · campos vazios · textos longos · tabelas extensas ·
   versões (V0/FINAL) · marca d'água.

   A GERAÇÃO dos binários (.pptx/.xlsx) depende de PptxGenJS e SheetJS, que só
   existem no navegador — isso está declarado nas pendências de validação e não
   é simulado aqui. O que se testa é tudo que decide o CONTEÚDO dos arquivos.
   ========================================================================== */
import { suite, teste, esperar } from '../runner.mjs';
import {
  montarSlides, ORDEM_PADRAO, tituloApresentacao, nomeArquivo, nomeMemoria,
  VERSOES, MARCA_PRELIMINAR
} from '../../services/fechamento/fm-apresentacao.js';

const COMP = {
  id: 'c1', planta: 'Planta RJ - Lâminas', mes: 8, ano: 2026, competencia: '08/2026',
  status: 'Em preenchimento', versao: 'V0', responsavel: 'Garantia da Qualidade',
  updated_at: '2026-08-31T12:00:00Z'
};

/* Painel mínimo mas REALISTA — mesma forma que fm-indicadores.consolidar devolve. */
function painelFake(over = {}) {
  const card = (chave, label, exib, extra = {}) => ({
    chave, label, exibicao: exib, unidade: 'un', valor: 1, calculavel: true,
    meta: 50, anterior: 2, variacao: { exibicao: '-1', absoluta: -1 },
    acumulado: { exibicao: '10', soma: 10 }, status: { cor: 'verde', texto: 'Dentro da meta' },
    origem: 'calculado', memoria: null, ...extra
  });
  return {
    competencia: COMP,
    criterio: {
      nome: 'Critério padrão', versao: 1, vigencia_inicio: '2026-01-01', vigencia_fim: null,
      fontes_incluidas: ['Produção', 'CARE'], fontes_excluidas: ['Devolução de cliente'],
      descricao: 'Critério de teste'
    },
    cards: {
      reclamacoes: card('reclamacoes', 'Reclamações externas', '2'),
      reclamacoes_negociadas: card('reclamacoes_negociadas', 'Reclamações negociadas', '1'),
      ppm_externo_oficial: card('ppm_externo_oficial', 'PPM externo oficial', '50', {
        memoria: { formula: 'a ÷ b × 1.000.000', numerador: 5, denominador: 100000,
                   resultado_bruto: 50, resultado_exibido: '50', entradas: {}, detalhe: [] } }),
      ppm_externo_real: card('ppm_externo_real', 'PPM externo real', '80'),
      ocorrencias: card('ocorrencias', 'Ocorrências internas', '4'),
      ppm_interno: card('ppm_interno', 'PPM interno', '1.820'),
      dias_sem_reclamacao: card('dias_sem_reclamacao', 'Dias sem reclamação', '30 dias'),
      quebras_externas: card('quebras_externas', 'Quebras externas', '0'),
      quebras_internas: card('quebras_internas', 'Quebras internas', '1'),
      custo_qualidade: card('custo_qualidade', 'Custo mensal da qualidade', 'R$ 12.300,00'),
      care_inspecoes: card('care_inspecoes', 'Inspeções CARE', '3'),
      care_percentual_ng: card('care_percentual_ng', 'CARE — % NG', '2,3%'),
      planos_atrasados: card('planos_atrasados', 'Planos atrasados', '1'),
      pendencias: card('pendencias', 'Pendências', '2'),
      progresso: card('progresso', 'Progresso do fechamento', '60'),
      seguranca_eventos: card('seguranca_eventos', 'Eventos de segurança', '0'),
      retrabalho: card('retrabalho', 'Índice de retrabalho', '2.500'),
      sucata_ppm: card('sucata_ppm', 'PPM de sucata', '20')
    },
    anual: {
      reclamacoes: { serie: Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, valor: i < 8 ? i : null })), soma: 28 },
      ppm_externo_oficial: { serie: [], exibicao: '45' },
      ppm_externo_real: { serie: [], exibicao: '70' },
      ocorrencias: { serie: [], soma: 30 },
      ppm_interno: { serie: [], exibicao: '1.600' },
      custo_qualidade: { serie: [], soma: 80000 },
      care_inspecoes: { serie: [], soma: 20, meses: 8 },
      seguranca_eventos: { serie: [], soma: 1 },
      pecas_fornecidas: { soma: 4000000 }
    },
    dados: {
      reclamacoes: [
        { id: 'r1', negociada: true, data_reclamacao: '2026-08-05', cliente_oficial: 'Cliente A',
          part_number: 'PN-1', qtd_pecas: 3, motivo_negociacao: 'Acordo comercial', negociado_por: 'Maria' }
      ],
      ocorrencias: [], producao: [], fornecimento: [], custos: [], care: [],
      quebras: [{ id: 'q1', tipo: 'interna', part_number: 'PN-2', cliente: 'Cliente B', quantidade: 5,
                  data_quebra: '2026-08-10', status: 'Atrasada', responsavel: 'Carlos', prazo: '2026-08-20' }],
      seguranca: [{ id: 's1', data: '2026-08-02', categoria: 'RNA', quantidade: 1, descricao: 'Quase acidente' }],
      retrabalho: [], sucata: [],
      acoes: [{ id: 'a1', what: 'Trocar eletrodo', who: 'João', when_: '2026-09-30',
                status: 'Em andamento', percentual: 40, competencia_origem_id: 'c1' }],
      pendencias: [{ id: 'p1', status: 'Aberta', prioridade: 'Alta', titulo: 'Quebra sem RNC', modulo: 'Farol de Quebras' }]
    },
    detalhes: {
      comparativoPPM: { diferenca: 30, diferencaPercentual: 60 },
      diasSemReclamacao: { recorde: 120, ultima: { data: '2026-08-01', cliente: 'Cliente A' } },
      custo: { valor: 12300, limite: 28000, custoPorPeca: 0.12,
               porCategoria: [{ chave: 'Retrabalho', valor: 8000, percentual: 65 }] },
      care: { inspecoes: 3, totalInspecionado: 400, totalNG: 9, percentualNG: 2.25,
              exibicaoPercentual: '2,3%', principalProblema: 'Marca de Ferramenta',
              partNumberReincidente: 'PN-1', rankingDefeitos: [{ chave: 'Marca de Ferramenta', valor: 8 }] },
      cruz: { dias: Array.from({ length: 31 }, (_, i) => ({
                dia: `2026-08-${String(i + 1).padStart(2, '0')}`, status: 'verde',
                motivo: 'Sem ocorrência', ocorrencias: 0, pecasNG: 0 })),
              estatisticas: { diasSemOcorrencia: 31, maiorSequencia: 31, amarelos: 0, vermelhos: 0,
                              criticos: 0, semProducao: 0, percentualConformes: 100 } },
      rankings: {
        defeito: [{ chave: 'Marca de Ferramenta', valor: 35, percentual: 78, posicao: 1 }],
        partNumber: [{ chave: 'PN-1', ocorrencias: 2, posicao: 1 }],
        linha: [], processo: [], cliente: [{ chave: 'Cliente A', valor: 2, posicao: 1 }]
      }
    },
    ...over
  };
}

/* ========================================================================== */
suite('§36 — estrutura e ordem da apresentação', () => {

  teste('a ordem oficial tem exatamente 18 seções', () => {
    esperar(ORDEM_PADRAO).tamanho(18);
  });

  teste('a ordem do requisito é respeitada slide a slide', () => {
    const esperado = ['capa', 'reclamacoes_ppm', 'negociadas_ppm', 'negociadas_det', 'comparativo_recl',
      'criterios_ppm', 'ocorrencias_ppm', 'principais_probl', 'cruz_qualidade', 'seguranca',
      'quebras_externas', 'quebras_internas', 'custos', 'melhoria_continua', 'care_mensal',
      'care_acumulada', 'plano_5w2h', 'pendencias'];
    esperar(ORDEM_PADRAO.map(s => s.slug)).profundo(esperado);
  });

  teste('monta um slide por seção, numerados em sequência', () => {
    const slides = montarSlides(painelFake());
    esperar(slides).tamanho(18);
    esperar(slides.map(s => s.numero)).profundo(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  teste('a ordem é configurável — um subconjunto gera só aqueles slides', () => {
    const slides = montarSlides(painelFake(), [
      { slug: 'capa', titulo: 'Capa', tipo: 'capa' },
      { slug: 'custos', titulo: 'Custos', tipo: 'grafico' }
    ]);
    esperar(slides).tamanho(2);
    esperar(slides[1].slug).igual('custos');
    esperar(slides[1].numero).igual(2);
  });
});

/* ========================================================================== */
suite('§37 — regras de cada slide', () => {
  const slides = montarSlides(painelFake());

  teste('todo slide traz planta, mês/ano e área', () => {
    for (const s of slides) {
      esperar(s.planta).igual('Planta RJ - Lâminas');
      esperar(s.periodo).igual('Agosto 2026');
      esperar(s.area).igual('Garantia da Qualidade');
    }
  });

  teste('todo slide declara a fonte dos dados de forma discreta', () => {
    for (const s of slides.filter(x => x.slug !== 'capa')) {
      esperar(s.fonte).contem('RNA One');
    }
  });

  teste('o rodapé identifica a competência correta', () => {
    esperar(slides[1].rodape).contem('Agosto 2026');
    esperar(slides[1].rodape).contem('Planta RJ');
  });

  teste('a capa lista planta, competência, área e responsável', () => {
    const capa = slides[0];
    esperar(capa.subtitulo).igual('Agosto 2026');
    const chaves = capa.linhas.map(([k]) => k);
    esperar(chaves.includes('Planta')).verdadeiro();
    esperar(chaves.includes('Competência')).verdadeiro();
    esperar(chaves.includes('Responsável')).verdadeiro();
  });

  teste('moeda sai em real com vírgula decimal e milhar', () => {
    const custos = slides.find(s => s.slug === 'custos');
    const limite = custos.auxiliares.find(([k]) => k === 'Limite mensal')[1];
    esperar(limite).contem('28.000,00');
    esperar(limite).contem('R$');
  });

  teste('percentual usa vírgula decimal', () => {
    const cruz = slides.find(s => s.slug === 'cruz_qualidade');
    esperar(cruz.auxiliares.find(([k]) => k.startsWith('Percentual'))[1]).contem('100');
  });
});

/* ========================================================================== */
suite('§36 — conteúdo dos slides usa os dados reais', () => {
  const slides = montarSlides(painelFake());
  const por = slug => slides.find(s => s.slug === slug);

  teste('reclamações e PPM externo trazem os cartões do painel', () => {
    const s = por('reclamacoes_ppm');
    esperar(s.indicadores).tamanho(2);
    esperar(s.indicadores[0].valor).igual('2');
    esperar(s.indicadores[1].label).igual('PPM externo oficial');
  });

  teste('slide de PPM real mostra o comparativo oficial × real', () => {
    const s = por('negociadas_ppm');
    const mapa = Object.fromEntries(s.comparativo);
    esperar(mapa['PPM oficial']).igual('50');
    esperar(mapa['PPM real']).igual('80');
    esperar(mapa['Diferença absoluta']).contem('30');
  });

  teste('detalhamento lista somente reclamações negociadas', () => {
    const s = por('negociadas_det');
    esperar(s.tabela.linhas).tamanho(1);
    esperar(s.tabela.linhas[0][4]).igual('Acordo comercial');
  });

  teste('critérios do PPM interno mostram vigência, versão e fontes', () => {
    const mapa = Object.fromEntries(por('criterios_ppm').texto);
    esperar(mapa['Critério vigente']).igual('Critério padrão');
    esperar(mapa['Versão']).igual('1');
    esperar(mapa['Fontes incluídas']).contem('Produção');
    esperar(mapa['Vigência']).contem('01/01/2026');
  });

  teste('principais problemas trazem os quatro rankings e o Pareto', () => {
    const s = por('principais_probl');
    esperar(s.rankings).tamanho(4);
    esperar(s.pareto.labels[0]).igual('Marca de Ferramenta');
  });

  teste('Cruz da Qualidade leva os 31 dias de agosto e as estatísticas', () => {
    const s = por('cruz_qualidade');
    esperar(s.cruz.dias).tamanho(31);
    esperar(s.auxiliares.find(([k]) => k === 'Dias sem ocorrência')[1]).igual('31');
  });

  teste('farol separa quebras externas e internas', () => {
    esperar(por('quebras_internas').tabela.linhas).tamanho(1);
    esperar(por('quebras_externas').tabela.linhas).tamanho(0);
  });

  teste('quebra atrasada aparece com o texto do farol, não só a cor', () => {
    esperar(por('quebras_internas').farol[0].texto).igual('Atrasado');
    esperar(por('quebras_internas').farol[0].cor).igual('vermelho');
  });

  teste('plano 5W2H traz as sete colunas do método', () => {
    const s = por('plano_5w2h');
    esperar(s.tabela.cabecalho.slice(0, 7)).profundo(['What', 'Why', 'Where', 'When', 'Who', 'How', 'How much']);
    esperar(s.tabela.linhas).tamanho(1);
  });

  teste('pendências trazem o resumo das atualizações', () => {
    const s = montarSlides(painelFake(), ORDEM_PADRAO, { resumo: ['Frase de teste.'] })
      .find(x => x.slug === 'pendencias');
    esperar(s.resumo).profundo(['Frase de teste.']);
    esperar(s.tabela.linhas).tamanho(1);
  });

  teste('observação do apresentador chega ao slide certo', () => {
    const s = montarSlides(painelFake(), ORDEM_PADRAO, { observacoes: { custos: 'Comentar o pico de frete.' } })
      .find(x => x.slug === 'custos');
    esperar(s.observacaoApresentador).igual('Comentar o pico de frete.');
  });
});

/* ========================================================================== */
suite('§50 — campos vazios e tabelas extensas', () => {

  teste('seção sem dados marca o estado e explica em vez de mostrar zero', () => {
    const p = painelFake();
    p.dados.seguranca = [];
    p.dados.acoes = [];
    const slides = montarSlides(p);
    const seg = slides.find(s => s.slug === 'seguranca');
    esperar(seg.estado).igual('sem_dados');
    const plano = slides.find(s => s.slug === 'plano_5w2h');
    esperar(plano.estado).igual('sem_dados');
    esperar(plano.vazio).contem('Nenhum plano');
  });

  teste('reclamações negociadas vazias produzem mensagem, não tabela vazia sem contexto', () => {
    const p = painelFake();
    p.dados.reclamacoes = [];
    const s = montarSlides(p).find(x => x.slug === 'negociadas_det');
    esperar(s.tabela.linhas).tamanho(0);
    esperar(s.vazio).contem('Nenhuma reclamação negociada');
  });

  teste('tabela extensa é preservada inteira no modelo (o corte é só no PPTX)', () => {
    const p = painelFake();
    p.dados.acoes = Array.from({ length: 120 }, (_, i) => ({
      id: 'a' + i, what: 'Ação ' + i, who: 'Resp', when_: '2026-09-01', status: 'Em andamento', percentual: 0
    }));
    const s = montarSlides(p).find(x => x.slug === 'plano_5w2h');
    esperar(s.tabela.linhas).tamanho(120);
  });

  teste('texto longo é truncado com reticências, sem quebrar a célula', () => {
    const p = painelFake();
    p.dados.acoes = [{ id: 'a1', what: 'x'.repeat(300), who: 'R', when_: '2026-09-01', status: 'Em andamento', percentual: 0 }];
    const s = montarSlides(p).find(x => x.slug === 'plano_5w2h');
    const celula = s.tabela.linhas[0][0];
    esperar(celula.length <= 45).verdadeiro();
    esperar(celula.endsWith('…')).verdadeiro();
  });

  teste('indicador sem base mostra o motivo no slide, não um número', () => {
    const p = painelFake();
    p.cards.ppm_externo_oficial = {
      ...p.cards.ppm_externo_oficial, calculavel: false,
      exibicao: 'Sem base de fornecimento', status: { cor: 'cinza', texto: 'Sem base de fornecimento' }
    };
    const s = montarSlides(p).find(x => x.slug === 'reclamacoes_ppm');
    esperar(s.indicadores[1].valor).igual('Sem base de fornecimento');
    esperar(s.estado).igual('sem_dados');
  });

  teste('critério ausente marca o slide como alerta', () => {
    const p = painelFake({ criterio: null });
    const s = montarSlides(p).find(x => x.slug === 'criterios_ppm');
    esperar(s.estado).igual('alerta');
    esperar(s.texto[0][1]).contem('Nenhum critério');
  });
});

/* ========================================================================== */
suite('§39/§40 — nomes de arquivo e versões', () => {

  teste('título segue o padrão do requisito', () => {
    esperar(tituloApresentacao(COMP, 'V0')).igual('Apresentação Qualidade Planta RJ - Agosto 2026 V0');
  });

  teste('nome do .pptx e do .pdf batem com o §39', () => {
    esperar(nomeArquivo(COMP, 'V0', 'pptx')).igual('Apresentação Qualidade Planta RJ - Agosto 2026 V0.pptx');
    esperar(nomeArquivo(COMP, 'V0', 'pdf')).igual('Apresentação Qualidade Planta RJ - Agosto 2026 V0.pdf');
  });

  teste('nome da memória de cálculo bate com o §39', () => {
    esperar(nomeMemoria(COMP)).igual('Memória de Cálculo Qualidade Planta RJ - Agosto 2026.xlsx');
  });

  teste('o mês do nome acompanha a competência', () => {
    esperar(nomeArquivo({ ...COMP, mes: 9 }, 'V1', 'pptx')).contem('Setembro 2026');
    esperar(nomeArquivo({ ...COMP, mes: 12, ano: 2027 }, 'FINAL', 'pptx')).contem('Dezembro 2027');
  });

  teste('a planta usa o nome curto no arquivo', () => {
    esperar(nomeArquivo({ ...COMP, planta: 'Planta SP - Helicoidal' }, 'V0', 'pptx')).contem('Planta SP');
  });

  teste('V0/V1/V2 são preliminares; FINAL não é', () => {
    esperar(VERSOES.V0.preliminar).verdadeiro();
    esperar(VERSOES.V1.preliminar).verdadeiro();
    esperar(VERSOES.V2.preliminar).verdadeiro();
    esperar(VERSOES.FINAL.preliminar).falso();
  });

  teste('a marca da versão preliminar é a exigida pelo §40', () => {
    esperar(MARCA_PRELIMINAR).igual('VERSÃO PRELIMINAR');
  });
});
