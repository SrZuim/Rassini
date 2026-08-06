/* ==========================================================================
   RNA One — BIBLIOTECA TÉCNICA: código da peça e gravação das cotas
   ---------------------------------------------------------------------------
   Cobre os testes obrigatórios da correção do erro
     duplicate key value violates unique constraint "bib_pecas_codigo_uidx"
   nas duas frentes que o produziam:
     • identidade do código (normalização + unicidade), e
     • plano de gravação das cotas (não inserir de novo o que já está gravado).
   Rode com:  node tests/run-all.mjs
   ========================================================================== */
import { suite, teste, esperar } from './runner.mjs';
import {
  normalizarCodigo, validarCodigo, codigosIguais, acharConflito,
  ehErroCodigoDuplicado, escaparLike, CodigoDuplicadoError,
  MSG_CODIGO_DUPLICADO, MSG_CODIGO_OBRIGATORIO
} from '../services/biblioteca-codigo.js';
import { planejarSincronizacao, mudou } from '../services/biblioteca-cotas.js';

/* Cadastro de referência (como o banco devolve: id + codigo). */
const BANCO = [
  { id: 'p1', codigo: '54321-A' },
  { id: 'p2', codigo: '12345' },
  { id: 'p3', codigo: 'MOLA 700 X' }
];

/* Cota como o formulário monta: sem `id` quando é nova, com `id` quando veio do
   banco, e com `_draft` (rascunho da tela, que nunca vai para o banco). */
const cota = (n, extra = {}) => ({
  cota: n, tipo_especificacao: 'TOLERANCIA', nominal: 10 + n, tol_min: 9, tol_max: 11,
  unidade: 'mm', quem_mede_id: 'q1', observacao: '', ...extra
});

/* ======================================================= 1) CÓDIGO DA PEÇA */
suite('Código da peça — normalização (fonte única de consulta e gravação)', () => {

  teste('10) código vazio é recusado', () => {
    esperar(validarCodigo('')).igual(MSG_CODIGO_OBRIGATORIO);
    esperar(validarCodigo(null)).igual(MSG_CODIGO_OBRIGATORIO);
    esperar(validarCodigo(undefined)).igual(MSG_CODIGO_OBRIGATORIO);
  });

  teste('10) código só com espaços é recusado (vira vazio ao normalizar)', () => {
    esperar(normalizarCodigo('    ')).igual('');
    esperar(validarCodigo('    ')).igual(MSG_CODIGO_OBRIGATORIO);
    esperar(validarCodigo('\t \n')).igual(MSG_CODIGO_OBRIGATORIO);
  });

  teste('11) espaços nas pontas somem; espaços internos são colapsados', () => {
    esperar(normalizarCodigo('  12345  ')).igual('12345');
    esperar(normalizarCodigo('MOLA   700   X')).igual('MOLA 700 X');
  });

  teste('12) caixa não cria peça diferente', () => {
    esperar(normalizarCodigo('abc-123')).igual('ABC-123');
    esperar(codigosIguais('abc-123', 'ABC-123')).verdadeiro();
    esperar(codigosIguais(' abc 123 ', 'ABC 123')).verdadeiro();
  });

  teste('caracteres invisíveis (NBSP, zero-width, BOM) não criam peça diferente', () => {
    const ch = c => String.fromCharCode(c);
    const nbsp = '12345' + ch(0x00A0);          // espaco inquebravel
    const zwsp = '123' + ch(0x200B) + '45';     // zero-width space
    const bom  = ch(0xFEFF) + '12345';          // BOM colado no inicio
    esperar(normalizarCodigo(nbsp)).igual('12345');
    esperar(normalizarCodigo(zwsp)).igual('12345');
    esperar(normalizarCodigo(bom)).igual('12345');
    esperar(codigosIguais(nbsp, '12345')).verdadeiro();
  });

  teste('código vazio nunca é "igual" a outro vazio (não casa cadastro em branco)', () => {
    esperar(codigosIguais('', '')).falso();
    esperar(codigosIguais('  ', null)).falso();
  });

  teste('validação usa exatamente o valor normalizado (consulta = gravação)', () => {
    const digitado = '  mola 700   x ';
    const canonico = normalizarCodigo(digitado);
    esperar(canonico).igual('MOLA 700 X');
    esperar(normalizarCodigo(canonico)).igual(canonico);   // idempotente
  });
});

suite('Código da peça — detecção de duplicidade', () => {

  teste('1) código inédito não conflita → cadastro liberado', () => {
    esperar(acharConflito('99999', BANCO)).nulo();
    esperar(acharConflito('MOLA 700 Y', BANCO)).nulo();
  });

  teste('2) mesmo código em outra peça é bloqueado', () => {
    esperar(acharConflito('12345', BANCO)?.id).igual('p2');
  });

  teste('2/12) conflito é detectado ignorando caixa e espaços', () => {
    esperar(acharConflito(' 54321-a ', BANCO)?.id).igual('p1');
    esperar(acharConflito('mola   700 x', BANCO)?.id).igual('p3');
  });

  teste('3/14) editar a própria peça NÃO acusa duplicidade (id preservado)', () => {
    // o caso que quebrava: salvar uma peça existente sem mudar o código
    esperar(acharConflito('12345', BANCO, 'p2')).nulo();
    esperar(acharConflito(' 12345 ', BANCO, 'p2')).nulo();
    // mas continuar bloqueando o código de OUTRA peça
    esperar(acharConflito('54321-A', BANCO, 'p2')?.id).igual('p1');
  });

  teste('código vazio não conflita com nada (o erro é "obrigatório", não "duplicado")', () => {
    esperar(acharConflito('', BANCO)).nulo();
    esperar(acharConflito('   ', BANCO)).nulo();
  });

  teste('lista vazia ou ausente não quebra a checagem', () => {
    esperar(acharConflito('12345', [])).nulo();
    esperar(acharConflito('12345', null)).nulo();
    esperar(acharConflito('12345', [null, undefined])).nulo();
  });
});

suite('Código da peça — mensagem do usuário × detalhe técnico', () => {

  const TERMOS_TECNICOS = ['duplicate key', 'unique constraint', 'bib_pecas_codigo_uidx',
                           'PostgreSQL', '23505', 'PGRST'];

  teste('a mensagem exibida não contém termo técnico algum', () => {
    for (const t of TERMOS_TECNICOS) {
      esperar(MSG_CODIGO_DUPLICADO.toLowerCase().includes(t.toLowerCase()))
        .falso(`a mensagem do usuário não pode citar "${t}"`);
    }
    esperar(MSG_CODIGO_DUPLICADO).contem('Já existe uma peça cadastrada com este código');
  });

  teste('erro 23505 do banco é reconhecido como código duplicado', () => {
    const doBanco = {
      code: '23505',
      message: 'duplicate key value violates unique constraint "bib_pecas_codigo_uidx"',
      details: 'Key (lower(codigo))=(12345) already exists.'
    };
    esperar(ehErroCodigoDuplicado(doBanco)).verdadeiro();
  });

  teste('23505 de OUTRA restrição não vira "código duplicado"', () => {
    esperar(ehErroCodigoDuplicado({
      code: '23505',
      message: 'duplicate key value violates unique constraint "insp_relatorios_numero_uidx"',
      details: 'Key (numero)=(2026-001) already exists.'
    })).falso();
    esperar(ehErroCodigoDuplicado({ code: '42501', message: 'row-level security' })).falso();
    esperar(ehErroCodigoDuplicado(null)).falso();
  });

  teste('CodigoDuplicadoError leva a mensagem pronta e guarda o técnico à parte', () => {
    const causa = { code: '23505', message: 'duplicate key value violates unique constraint "bib_pecas_codigo_uidx"' };
    const err = new CodigoDuplicadoError('  abc-1 ', causa);
    esperar(err.message).igual(MSG_CODIGO_DUPLICADO);
    esperar(err.amigavel).verdadeiro();
    esperar(err.codigo).igual('ABC-1');
    esperar(err.tecnico).contem('duplicate key');
    esperar(ehErroCodigoDuplicado(err)).verdadeiro();     // reconhecido no catch da tela
  });

  teste('curingas do LIKE são escapados na busca do código', () => {
    esperar(escaparLike('50%_A')).igual('50\\%\\_A');
    esperar(escaparLike('AB')).igual('AB');
  });
});

/* ============================================== 2) COTAS (bib_metricas) === */
suite('Cotas — plano de gravação por diferença', () => {

  const existentes = [
    { id: 'm1', peca_id: 'p1', cota: 1, ordem: 1, nominal: 11, tol_min: 9, tol_max: 11, tipo_especificacao: 'TOLERANCIA', unidade: 'mm', quem_mede_id: 'q1', observacao: null },
    { id: 'm2', peca_id: 'p1', cota: 2, ordem: 2, nominal: 12, tol_min: 9, tol_max: 11, tipo_especificacao: 'TOLERANCIA', unidade: 'mm', quem_mede_id: 'q1', observacao: null }
  ];
  const doBanco = () => existentes.map(r => ({ ...r }));
  // linhas do formulário equivalentes às do banco (nada alterado)
  const iguais = () => [
    { id: 'm1', ...cota(1), peca_id: 'p1' },
    { id: 'm2', ...cota(2), peca_id: 'p1' }
  ];

  teste('7) peça nova com várias cotas: tudo INSERT, na ordem digitada', () => {
    const p = planejarSincronizacao([], [cota(1), cota(2), cota(3)]);
    esperar(p.inserir).tamanho(3);
    esperar(p.atualizar).tamanho(0);
    esperar(p.remover).tamanho(0);
    esperar(p.inserir.map(i => i.campos.ordem)).profundo([1, 2, 3]);
  });

  teste('salvar sem mexer em nada não gera requisição alguma', () => {
    const p = planejarSincronizacao(doBanco(), iguais());
    esperar(p.inserir).tamanho(0);
    esperar(p.atualizar).tamanho(0);
    esperar(p.remover).tamanho(0);
  });

  teste('4/14) acrescentar UMA cota insere só ela — as existentes ficam intactas', () => {
    const p = planejarSincronizacao(doBanco(), [...iguais(), cota(3)]);
    esperar(p.inserir).tamanho(1);
    esperar(p.inserir[0].campos.cota).igual(3);
    esperar(p.inserir[0].campos.ordem).igual(3);
    esperar(p.atualizar).tamanho(0);
    esperar(p.remover).tamanho(0);            // nada de apagar e reinserir
  });

  teste('5) alterar uma cota vira UPDATE do MESMO id', () => {
    const linhas = iguais();
    linhas[1].nominal = 99;
    const p = planejarSincronizacao(doBanco(), linhas);
    esperar(p.atualizar).tamanho(1);
    esperar(p.atualizar[0].id).igual('m2');
    esperar(p.atualizar[0].campos.nominal).igual(99);
    esperar(p.inserir).tamanho(0);
  });

  teste('6) remover uma cota do formulário apaga só ela', () => {
    const p = planejarSincronizacao(doBanco(), [iguais()[0]]);
    esperar(p.remover).profundo(['m2']);
    esperar(p.inserir).tamanho(0);
    esperar(p.atualizar).tamanho(0);
  });

  teste('campos de controle do formulário não vão para o banco', () => {
    const draft = cota(1);
    const p = planejarSincronizacao([], [{ ...draft, _draft: draft, _foco: true }]);
    esperar('id' in p.inserir[0].campos).falso();
    esperar('_draft' in p.inserir[0].campos).falso();
    esperar('_foco' in p.inserir[0].campos).falso();
    esperar(p.inserir[0].linha._draft).igual(draft);   // o rascunho segue acessível
  });

  teste('vazio × null não conta como alteração (evita UPDATE de toda linha)', () => {
    esperar(mudou({ observacao: null }, { observacao: '' })).falso();
    esperar(mudou({ tol_min: null }, { tol_min: null })).falso();
    esperar(mudou({ nominal: 11 }, { nominal: '11' })).falso();   // número × texto do input
    esperar(mudou({ observacao: null }, { observacao: 'x' })).verdadeiro();
  });
});

suite('Cotas — retomada depois de falha (nada é duplicado)', () => {

  /* Cenário exato do bug: a peça é criada, a gravação das cotas falha no meio e
     o usuário salva de novo. Só sobrevive se o id devolvido pelo INSERT voltar
     para o rascunho do formulário — é o que a tela faz em sincronizarMetricas. */
  teste('9/13) segunda tentativa não reinsere a cota que já gravou', () => {
    const rascunhos = [cota(1), cota(2)];
    const linhas = rascunhos.map(r => ({ ...r, _draft: r }));

    // 1ª tentativa: as duas são novas; a primeira grava, a segunda falha.
    const p1 = planejarSincronizacao([], linhas);
    esperar(p1.inserir).tamanho(2);
    const gravada = { id: 'm10', peca_id: 'p9', ...p1.inserir[0].campos };
    p1.inserir[0].linha._draft.id = gravada.id;          // write-back do id
    linhas[0].id = gravada.id;

    // 2ª tentativa: o banco já tem a cota 1; a cota 2 continua nova.
    const p2 = planejarSincronizacao([gravada], linhas);
    esperar(p2.inserir).tamanho(1);
    esperar(p2.inserir[0].campos.cota).igual(2);
    esperar(p2.atualizar).tamanho(0);                    // a cota 1 não mudou
    esperar(p2.remover).tamanho(0);                      // e NÃO é apagada
  });

  teste('8) salvar duas vezes seguidas produz o mesmo cadastro (idempotente)', () => {
    const linhas = [{ id: 'm1', ...cota(1) }, { id: 'm2', ...cota(2) }];
    const banco = linhas.map((l, i) => ({ ...l, peca_id: 'p1', ordem: i + 1 }));
    const a = planejarSincronizacao(banco, linhas);
    const b = planejarSincronizacao(banco, linhas);
    esperar(a.inserir.length + a.atualizar.length + a.remover.length).igual(0);
    esperar(b.inserir.length + b.atualizar.length + b.remover.length).igual(0);
  });

  teste('id órfão (cota apagada por outro usuário) vira INSERT, não erro', () => {
    const p = planejarSincronizacao([], [{ id: 'sumiu', ...cota(1) }]);
    esperar(p.inserir).tamanho(1);
    esperar('id' in p.inserir[0].campos).falso();
    esperar(p.remover).tamanho(0);
  });
});
