/* ==========================================================================
   §50 — Testes de IMPORTAÇÃO
   arquivo válido · arquivo inválido · cliente não reconhecido · duplicidade ·
   nova versão · coluna ausente · número em formato brasileiro.
   (O teste de rollback do banco está em pendencias/permissoes — aqui fica a
   lógica pura de leitura e validação.)
   ========================================================================== */
import { suite, teste, esperar } from '../runner.mjs';
import * as IMP from '../../services/fechamento/fm-import.js';

const ALIASES = [
  { id: 'a1', nome_oficial: 'Volkswagen Caminhões e Ônibus', ativo: true,
    apelidos: ['MAN Latin América', 'Volkswagen', 'VW'] },
  { id: 'a2', nome_oficial: 'Mercedes-Benz do Brasil', ativo: true, apelidos: ['MBB'] },
  { id: 'a3', nome_oficial: 'Randon Implementos', ativo: true, apelidos: [] }
];

/* ========================================================================== */
suite('§50 — número em formato brasileiro', () => {

  teste('milhar com ponto e decimal com vírgula', () => {
    esperar(IMP.parseNumeroBR('1.234,56')).proximo(1234.56);
    esperar(IMP.parseNumeroBR('1.234.567,89')).proximo(1234567.89);
  });

  teste('decimal simples com vírgula', () => {
    esperar(IMP.parseNumeroBR('1,5')).proximo(1.5);
    esperar(IMP.parseNumeroBR('0,25')).proximo(0.25);
  });

  teste('formato americano continua funcionando', () => {
    esperar(IMP.parseNumeroBR('1234.56')).proximo(1234.56);
  });

  teste('ponto em grupos de três sem vírgula é MILHAR, não decimal', () => {
    /* "1.234" no ERP brasileiro é mil duzentos e trinta e quatro. */
    esperar(IMP.parseNumeroBR('1.234')).igual(1234);
    esperar(IMP.parseNumeroBR('850.000')).igual(850000);
  });

  teste('símbolo de moeda e espaços são ignorados', () => {
    esperar(IMP.parseNumeroBR('R$ 28.000,00')).proximo(28000);
    esperar(IMP.parseNumeroBR(' 1 234,5 ')).proximo(1234.5);
  });

  teste('parênteses indicam negativo (padrão contábil)', () => {
    esperar(IMP.parseNumeroBR('(500)')).igual(-500);
    esperar(IMP.parseNumeroBR('-1.200,50')).proximo(-1200.5);
  });

  teste('vazio vira null, texto inválido vira null', () => {
    esperar(IMP.parseNumeroBR('')).nulo();
    esperar(IMP.parseNumeroBR(null)).nulo();
    esperar(IMP.parseNumeroBR('não informado')).nulo();
    esperar(IMP.parseNumeroBR('12abc')).nulo();
  });

  teste('número já numérico passa intacto', () => {
    esperar(IMP.parseNumeroBR(42)).igual(42);
    esperar(IMP.parseNumeroBR(0)).igual(0);
  });
});

/* ========================================================================== */
suite('§24 — leitura do arquivo e cabeçalhos', () => {

  const CSV = [
    'RELATÓRIO DE FATURAMENTO;;;',
    'Planta RJ - Lâminas;;;',
    'Cliente;Faturamento Real;Toneladas;Quantidade de Peças Fornecidas',
    'Volkswagen;1.250.000,00;320,5;850.000',
    'MBB;980.000,00;250,0;620.000'
  ].join('\n');

  teste('detecta ponto e vírgula como separador', () => {
    esperar(IMP.detectarSeparador(CSV)).igual(';');
  });

  teste('detecta vírgula quando é o separador', () => {
    esperar(IMP.detectarSeparador('a,b,c\n1,2,3')).igual(',');
  });

  teste('respeita aspas ao dividir a linha', () => {
    const cel = IMP.parseLinhaCSV('"Empresa; Ltda";100;"texto ""com"" aspas"', ';');
    esperar(cel[0]).igual('Empresa; Ltda');
    esperar(cel[2]).igual('texto "com" aspas');
  });

  teste('acha o cabeçalho mesmo com título nas primeiras linhas (§24)', () => {
    const matriz = IMP.parseCSV(CSV);
    esperar(IMP.acharCabecalho(matriz)).igual(2);
  });

  teste('identifica o campo pelo nome da coluna', () => {
    esperar(IMP.identificarCampo('Cliente')).igual('cliente');
    esperar(IMP.identificarCampo('Quantidade de Peças Fornecidas')).igual('qtd_fornecida');
    esperar(IMP.identificarCampo('Faturamento Real')).igual('faturamento_real');
    esperar(IMP.identificarCampo('Toneladas')).igual('toneladas');
  });

  teste('reconhece sinônimos e variações de escrita', () => {
    esperar(IMP.identificarCampo('CLIENTES')).igual('cliente');
    esperar(IMP.identificarCampo('Faturamento Orçado')).igual('faturamento_orcado');
    esperar(IMP.identificarCampo('Preço médio por peça')).igual('preco_medio_peca');
  });

  teste('coluna desconhecida não é forçada em nenhum campo', () => {
    esperar(IMP.identificarCampo('Observações internas do setor')).nulo();
  });

  teste('mapeamento reporta colunas não reconhecidas', () => {
    const { mapa, naoReconhecidas, faltando } = IMP.mapearColunas(
      ['Cliente', 'Faturamento Real', 'Coluna Estranha', 'Quantidade']);
    esperar(mapa.cliente).igual(0);
    esperar(mapa.qtd_fornecida).igual(3);
    esperar(naoReconhecidas).tamanho(1);
    esperar(faltando).tamanho(0);
  });

  teste('coluna obrigatória ausente é denunciada (§50)', () => {
    const { faltando } = IMP.mapearColunas(['Cliente', 'Toneladas']);
    esperar(faltando).tamanho(1);
    esperar(faltando[0]).igual('Qtd. de peças fornecidas');
  });

  teste('extrai as linhas de dados convertendo os tipos', () => {
    const matriz = IMP.parseCSV(CSV);
    const idx = IMP.acharCabecalho(matriz);
    const { mapa } = IMP.mapearColunas(matriz[idx]);
    const linhas = IMP.extrairLinhas(matriz, idx, mapa);
    esperar(linhas).tamanho(2);
    esperar(linhas[0].dados.cliente).igual('Volkswagen');
    esperar(linhas[0].dados.qtd_fornecida).igual(850000);
    esperar(linhas[0].dados.faturamento_real).proximo(1250000);
    esperar(linhas[0].dados.toneladas).proximo(320.5);
  });

  teste('linhas totalmente vazias são descartadas', () => {
    const matriz = IMP.parseCSV('Cliente;Quantidade\nA;10\n;;\nB;20');
    const { mapa } = IMP.mapearColunas(matriz[0]);
    esperar(IMP.extrairLinhas(matriz, 0, mapa)).tamanho(2);
  });
});

/* ========================================================================== */
suite('§26 — validação da importação', () => {

  const linhasDe = csv => {
    const matriz = IMP.parseCSV(csv);
    const idx = IMP.acharCabecalho(matriz);
    const { mapa } = IMP.mapearColunas(matriz[idx]);
    return IMP.extrairLinhas(matriz, idx, mapa);
  };

  teste('arquivo válido: todas as linhas passam', () => {
    const linhas = linhasDe('Cliente;Quantidade de Peças Fornecidas\nVolkswagen;850.000\nMBB;620.000');
    const { resumo } = IMP.validarLinhas(linhas, ALIASES);
    esperar(resumo.validos).igual(2);
    esperar(resumo.invalidos).igual(0);
    esperar(resumo.podeConfirmar).verdadeiro();
  });

  teste('cliente não reconhecido bloqueia a importação (§25)', () => {
    const linhas = linhasDe('Cliente;Quantidade de Peças Fornecidas\nEmpresa Desconhecida SA;1000');
    const { linhas: v, resumo } = IMP.validarLinhas(linhas, ALIASES);
    esperar(v[0].classificacao_cliente).igual('nao_cadastrado');
    esperar(v[0].status).igual('invalido');
    esperar(resumo.clientesNaoReconhecidos).igual(1);
    esperar(resumo.podeConfirmar).falso();
    esperar(resumo.motivoBloqueio).contem('erro crítico');
  });

  teste('cliente com erro de digitação gera ALERTA e não é associado sozinho (§25)', () => {
    const linhas = linhasDe('Cliente;Quantidade de Peças Fornecidas\nMercedez Benz;1000');
    const { linhas: v } = IMP.validarLinhas(linhas, ALIASES);
    esperar(v[0].classificacao_cliente).igual('possivel');
    esperar(v[0].cliente_oficial).nulo();          // exige confirmação humana
    esperar(v[0].sugestao_cliente).igual('Mercedes-Benz do Brasil');
    esperar(v[0].status).igual('alerta');
  });

  /* Hífen, pontuação e sufixo societário NÃO são ambiguidade: "Mercedes-Benz do
     Brasil" e "Mercedes Benz do Brasil Ltda." são o mesmo cliente escrito de
     duas formas. Tratar isso como "possível associação" criaria uma confirmação
     manual inútil em toda importação. */
  teste('diferença apenas de pontuação/sufixo é reconhecimento EXATO, não alerta', () => {
    const linhas = linhasDe([
      'Cliente;Quantidade de Peças Fornecidas',
      'Mercedes Benz do Brasil;1000',
      'RANDON IMPLEMENTOS LTDA.;2000'
    ].join('\n'));
    const { linhas: v } = IMP.validarLinhas(linhas, ALIASES);
    esperar(v[0].classificacao_cliente).igual('reconhecido');
    esperar(v[0].cliente_oficial).igual('Mercedes-Benz do Brasil');
    esperar(v[1].classificacao_cliente).igual('reconhecido');
    esperar(v[1].cliente_oficial).igual('Randon Implementos');
  });

  teste('apelido cadastrado é reconhecido exatamente', () => {
    const linhas = linhasDe('Cliente;Quantidade de Peças Fornecidas\nMAN Latin América;1000');
    const { linhas: v } = IMP.validarLinhas(linhas, ALIASES);
    esperar(v[0].classificacao_cliente).igual('reconhecido');
    esperar(v[0].cliente_oficial).igual('Volkswagen Caminhões e Ônibus');
  });

  teste('mesmo apelido em dois clientes vira DUPLICIDADE', () => {
    const conflito = [...ALIASES, { id: 'a9', nome_oficial: 'Outro Cliente', ativo: true, apelidos: ['VW'] }];
    const linhas = linhasDe('Cliente;Quantidade de Peças Fornecidas\nVW;1000');
    const { linhas: v } = IMP.validarLinhas(linhas, conflito);
    esperar(v[0].classificacao_cliente).igual('duplicidade');
    esperar(v[0].status).igual('invalido');
  });

  teste('linha duplicada é detectada (§26)', () => {
    const linhas = linhasDe('Cliente;Quantidade de Peças Fornecidas\nVolkswagen;1000\nVW;2000');
    const { resumo } = IMP.validarLinhas(linhas, ALIASES);
    esperar(resumo.duplicados).igual(1);
    esperar(resumo.podeConfirmar).falso();
  });

  teste('campo obrigatório vazio é erro', () => {
    const linhas = linhasDe('Cliente;Quantidade de Peças Fornecidas\nVolkswagen;');
    const { linhas: v, resumo } = IMP.validarLinhas(linhas, ALIASES);
    esperar(v[0].status).igual('invalido');
    esperar(resumo.valoresVazios).igual(1);
  });

  teste('número inválido é erro com o valor original na mensagem', () => {
    const linhas = linhasDe('Cliente;Quantidade de Peças Fornecidas\nVolkswagen;mil peças');
    const { linhas: v } = IMP.validarLinhas(linhas, ALIASES);
    esperar(v[0].status).igual('invalido');
    esperar(v[0].erros.join(' ')).contem('mil peças');
  });

  teste('valor negativo gera alerta, não erro', () => {
    const linhas = linhasDe('Cliente;Quantidade de Peças Fornecidas\nVolkswagen;(500)');
    const { linhas: v, resumo } = IMP.validarLinhas(linhas, ALIASES);
    esperar(v[0].status).igual('alerta');
    esperar(resumo.valoresNegativos).igual(1);
    esperar(resumo.podeConfirmar).verdadeiro();     // alerta não bloqueia
  });

  teste('arquivo sem linhas de dados não pode ser confirmado', () => {
    const { resumo } = IMP.validarLinhas([], ALIASES);
    esperar(resumo.podeConfirmar).falso();
    esperar(resumo.motivoBloqueio).contem('nenhuma linha');
  });
});

/* ========================================================================== */
suite('§27 — comparação entre versões', () => {

  const linhasDe = csv => {
    const matriz = IMP.parseCSV(csv);
    const { mapa } = IMP.mapearColunas(matriz[0]);
    return IMP.extrairLinhas(matriz, 0, mapa);
  };

  const V1 = [
    { cliente_oficial: 'Volkswagen Caminhões e Ônibus', qtd_fornecida: 850000 },
    { cliente_oficial: 'Mercedes-Benz do Brasil',       qtd_fornecida: 620000 },
    { cliente_oficial: 'Randon Implementos',            qtd_fornecida: 100000 }
  ];

  teste('detecta registros alterados, adicionados e removidos', () => {
    const linhas = linhasDe([
      'Cliente;Quantidade de Peças Fornecidas',
      'Volkswagen;900.000',        // alterado
      'MBB;620.000',               // inalterado
      'Randon Implementos;100.000' // inalterado
    ].join('\n'));
    const { resumo } = IMP.validarLinhas(linhas, ALIASES, { anterior: V1 });
    esperar(resumo.alterados).igual(1);
    esperar(resumo.adicionados).igual(0);
    esperar(resumo.removidos).igual(0);
  });

  teste('cliente que sumiu da nova versão é listado como removido', () => {
    const linhas = linhasDe('Cliente;Quantidade de Peças Fornecidas\nVolkswagen;850.000');
    const { resumo } = IMP.validarLinhas(linhas, ALIASES, { anterior: V1 });
    esperar(resumo.removidos).igual(2);
    esperar(resumo.listaRemovidos[0].cliente).naoNulo();
  });

  teste('variação acima do limite gera alerta (§27)', () => {
    const linhas = linhasDe('Cliente;Quantidade de Peças Fornecidas\nVolkswagen;1.000.000');
    const { linhas: v, resumo } = IMP.validarLinhas(linhas, ALIASES, { anterior: V1, limiteVariacao: 10 });
    esperar(resumo.variacaoAlta).igual(1);
    esperar(v[0].alertas.join(' ')).contem('Variação de 17.6%');
  });

  teste('variação dentro do limite não alerta', () => {
    const linhas = linhasDe('Cliente;Quantidade de Peças Fornecidas\nVolkswagen;860.000');
    const { resumo } = IMP.validarLinhas(linhas, ALIASES, { anterior: V1, limiteVariacao: 10 });
    esperar(resumo.variacaoAlta).igual(0);
  });

  teste('cliente novo é marcado como adicionado', () => {
    const linhas = linhasDe('Cliente;Quantidade de Peças Fornecidas\nMBB;10.000');
    const { linhas: v } = IMP.validarLinhas(linhas, ALIASES, { anterior: [V1[0]] });
    esperar(v[0].diff.tipo).igual('adicionado');
  });
});
