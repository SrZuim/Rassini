/* ==========================================================================
   RNA One — BIBLIOTECA TÉCNICA: fluxo real de gravação da peça
   ---------------------------------------------------------------------------
   Exercita services/biblioteca.js DE VERDADE (inserirPeca / salvarRevisao /
   duplicar / conflitoDeCodigo) contra um banco em memória que IMITA o índice
   único `bib_pecas_codigo_uidx` (unicidade sobre lower(codigo)) — inclusive
   recusando com o erro 23505 do PostgreSQL.

   É o que prova a correção do sintoma relatado: acrescentar cotas a uma peça
   existente (UPDATE) e retomar um cadastro que falhou no meio não podem mais
   virar "duplicate key value violates unique constraint".

   O runner é síncrono, então os cenários rodam antes (top-level await) e os
   testes apenas conferem o que aconteceu.
   Rode com:  node tests/run-all.mjs
   ========================================================================== */
import { suite, teste, esperar } from './runner.mjs';
import { SUPABASE } from '../services/config.js';
import { db } from '../services/db.js';
import * as BIB from '../services/biblioteca.js';
import { MSG_CODIGO_DUPLICADO } from '../services/biblioteca-codigo.js';

/* ------------------------------------------------------------------ banco --
   Sem rede: `SUPABASE.enabled` desligado e os métodos de db.js trocados por um
   armazenamento em memória. `db` é um objeto exportado — as funções do serviço
   enxergam estas mesmas referências. */
const urlOriginal = SUPABASE.url;
SUPABASE.url = '';                                   // desliga o caminho remoto

const metodosOriginais = { list: db.list, get: db.get, insert: db.insert, update: db.update, remove: db.remove };
const store = {};
let seq = 0;
const chave = c => String(c ?? '').toLowerCase();     // MESMA regra do índice do banco

/** Erro idêntico ao que o PostgREST devolve ao violar o índice único. */
function erro23505(codigo) {
  const e = new Error('duplicate key value violates unique constraint "bib_pecas_codigo_uidx"');
  e.code = '23505';
  e.details = `Key (lower(codigo))=(${chave(codigo)}) already exists.`;
  return e;
}

db.list = async (tabela, { filter } = {}) => {
  let rows = (store[tabela] || []).map(r => ({ ...r }));
  if (filter) rows = rows.filter(r => Object.entries(filter).every(([k, v]) => r[k] === v));
  return rows;
};
db.get = async (tabela, id) => (store[tabela] || []).map(r => ({ ...r })).find(r => r.id === id) || null;
db.insert = async (tabela, row) => {
  store[tabela] = store[tabela] || [];
  if (tabela === 'bib_pecas' && store[tabela].some(r => chave(r.codigo) === chave(row.codigo))) {
    throw erro23505(row.codigo);                     // o índice do banco recusando
  }
  const rec = { id: `id${++seq}`, ...row };
  store[tabela].push(rec);
  return { ...rec };
};
db.update = async (tabela, id, patch) => {
  const i = (store[tabela] || []).findIndex(r => r.id === id);
  if (i < 0) return null;
  if (tabela === 'bib_pecas' && 'codigo' in patch
      && store[tabela].some(r => r.id !== id && chave(r.codigo) === chave(patch.codigo))) {
    throw erro23505(patch.codigo);
  }
  store[tabela][i] = { ...store[tabela][i], ...patch };
  return { ...store[tabela][i] };
};
db.remove = async (tabela, id) => { store[tabela] = (store[tabela] || []).filter(r => r.id !== id); return true; };

const USUARIO = { id: 'u1', nome: 'Teste' };
const novaPeca = (codigo, extra = {}) => ({
  codigo, nome: 'Mola de teste', cliente: 'Volvo', planta: 'Iracemápolis',
  tipos_inspecao: ['layout'], revisao: 1, revisao_cadastro: 1, ativo: true, ...extra
});
const pegar = async fn => { try { return { ok: await fn() }; } catch (e) { return { erro: e }; } };
const pecasNoBanco = () => (store.bib_pecas || []).length;

/* ============================================================== cenários === */
const r = {};

// 1) cadastro inédito
r.criada = await BIB.inserirPeca(novaPeca(' 12345-a '));

// 2) segunda peça com o MESMO código (variando caixa e espaço)
r.duplicada = await pegar(() => BIB.inserirPeca(novaPeca('12345-A')));
r.duplicadaMinuscula = await pegar(() => BIB.inserirPeca(novaPeca('  12345-a')));

// 3) editar a peça existente sem mexer no código (o caso do relato)
r.editada = await pegar(() => BIB.salvarRevisao(r.criada.id, {
  codigo: '12345-A', nome: 'Mola de teste', tipos_inspecao: ['layout', 'final']
}, USUARIO));

// 4) cadastro parcial retomado: a peça já existe e o formulário salva de novo
//    em modo EDIÇÃO (nunca mais um segundo INSERT do mesmo código)
r.retomada = await pegar(() => BIB.salvarRevisao(r.criada.id, {
  codigo: '  12345-A  ', nome: 'Mola de teste (2ª tentativa)', tipos_inspecao: ['layout']
}, USUARIO));

// 5) tentar dar a uma peça o código de OUTRA continua bloqueado
r.outraPeca = await BIB.inserirPeca(novaPeca('99999'));
r.roubandoCodigo = await pegar(() => BIB.salvarRevisao(r.outraPeca.id, { codigo: '12345-a' }, USUARIO));

// 6) código vazio / só espaços
r.vazio = await pegar(() => BIB.inserirPeca(novaPeca('')));
r.soEspacos = await pegar(() => BIB.inserirPeca(novaPeca('    ')));

// 7) duplicar duas vezes (mesma peça) — códigos de cópia livres
r.copia1 = await BIB.duplicar(r.criada.id, USUARIO);
r.copia2 = await BIB.duplicar(r.criada.id, USUARIO);

// 8) checagem prévia cega (RLS escondendo a linha): o banco recusa e o serviço
//    traduz. Simulado ignorando a consulta prévia e indo direto ao insert.
const listaReal = db.list;
db.list = async (tabela, opts) => (tabela === 'bib_pecas' ? [] : listaReal(tabela, opts));
r.escondida = await pegar(() => BIB.inserirPeca(novaPeca('12345-A')));
db.list = listaReal;

const totalFinal = pecasNoBanco();

// devolve db.js e a config ao estado original (outros testes no mesmo processo)
Object.assign(db, metodosOriginais);
SUPABASE.url = urlOriginal;

/* ================================================================ testes === */
suite('Peça — cadastro, edição e unicidade do código (fluxo real do serviço)', () => {

  teste('1) peça com código inédito é criada com o código NORMALIZADO', () => {
    esperar(r.criada.id).naoNulo();
    esperar(r.criada.codigo).igual('12345-A');       // entrou como " 12345-a "
  });

  teste('2) segunda peça com o mesmo código é recusada com mensagem do usuário', () => {
    esperar(r.duplicada.ok).nulo();
    esperar(r.duplicada.erro.message).igual(MSG_CODIGO_DUPLICADO);
    esperar(r.duplicada.erro.amigavel).verdadeiro();
  });

  teste('2/12) caixa e espaço não driblam a unicidade', () => {
    esperar(r.duplicadaMinuscula.erro.message).igual(MSG_CODIGO_DUPLICADO);
  });

  teste('3/14) editar a peça existente NÃO acusa duplicidade e mantém o id', () => {
    esperar(r.editada.erro).nulo(r.editada.erro?.message || '');
    esperar(r.editada.ok.id).igual(r.criada.id);
    esperar(r.editada.ok.codigo).igual('12345-A');
    esperar(r.editada.ok.revisao).igual(2);          // virou revisão, não novo cadastro
  });

  teste('5/9) retomar um cadastro parcial ATUALIZA a mesma peça (sem novo INSERT)', () => {
    esperar(r.retomada.erro).nulo(r.retomada.erro?.message || '');
    esperar(r.retomada.ok.id).igual(r.criada.id);
    esperar(r.retomada.ok.nome).igual('Mola de teste (2ª tentativa)');
  });

  teste('usar o código de OUTRA peça continua bloqueado', () => {
    esperar(r.roubandoCodigo.ok).nulo();
    esperar(r.roubandoCodigo.erro.message).igual(MSG_CODIGO_DUPLICADO);
  });

  teste('10) código vazio ou só com espaços é recusado antes de gravar', () => {
    esperar(r.vazio.erro.message).igual('O código da peça é obrigatório.');
    esperar(r.soEspacos.erro.message).igual('O código da peça é obrigatório.');
  });

  teste('duplicar duas vezes gera -COPIA e -COPIA-2 (não repete o código)', () => {
    esperar(r.copia1.codigo).igual('12345-A-COPIA');
    esperar(r.copia2.codigo).igual('12345-A-COPIA-2');
  });

  teste('erro do banco (checagem prévia cega) vira mensagem do usuário, não 23505', () => {
    esperar(r.escondida.ok).nulo();
    esperar(r.escondida.erro.message).igual(MSG_CODIGO_DUPLICADO);
    esperar(r.escondida.erro.message.includes('duplicate key')).falso();
    esperar(r.escondida.erro.tecnico).contem('duplicate key');   // só para o console
  });

  teste('13) nada foi duplicado: 4 peças no fim (2 cadastros + 2 cópias)', () => {
    esperar(totalFinal).igual(4);
    const codigos = (store.bib_pecas || []).map(p => p.codigo).sort();
    esperar(codigos).profundo(['12345-A', '12345-A-COPIA', '12345-A-COPIA-2', '99999']);
  });
});
