/* ==========================================================================
   §13/§14 — CLASSIFICAÇÃO DOS ERROS DO VERIFICADOR DE ESTRUTURA

   O defeito corrigido: qualquer falha ao consultar uma tabela fm_* virava
   "Estrutura do módulo ausente no banco". Isso mandava o administrador rodar
   de novo uma migration já aplicada quando o problema real era RLS, sessão
   expirada ou queda de rede.

   Estes testes travam a regra: cada família de erro tem UM veredito, e
   permissão negada NUNCA pode ser lida como tabela ausente.
   ========================================================================== */
import { suite, teste, esperar } from '../runner.mjs';
import { classificarErro, DIAG, TABELAS_OBRIGATORIAS } from '../../services/fechamento/fm-core.js';

/* Erros como o PostgREST/supabase-js realmente os entrega. */
const erro = (o) => Object.assign(new Error(o.message || ''), o);

suite('§13 — tabela realmente ausente', () => {
  teste('42P01 (relation does not exist) → estrutura ausente', () => {
    esperar(classificarErro(erro({ code: '42P01', message: 'relation "public.fm_metas" does not exist' })))
      .igual(DIAG.SEM_ESTRUTURA);
  });

  teste('PGRST205 (could not find the table) → estrutura ausente', () => {
    esperar(classificarErro(erro({
      code: 'PGRST205',
      message: "Could not find the table 'public.fm_competencias' in the schema cache"
    }))).igual(DIAG.SEM_ESTRUTURA);
  });

  teste('PGRST202 (função/RPC ausente) → estrutura ausente', () => {
    esperar(classificarErro(erro({
      code: 'PGRST202',
      message: 'Could not find the function public.fm_check_structure'
    }))).igual(DIAG.SEM_ESTRUTURA);
  });
});

suite('§13 — acesso negado NÃO é tabela ausente', () => {
  teste('42501 → sem permissão', () => {
    esperar(classificarErro(erro({ code: '42501', message: 'permission denied for table fm_metas' })))
      .igual(DIAG.SEM_PERMISSAO);
  });

  teste('violação de RLS → sem permissão', () => {
    esperar(classificarErro(erro({
      code: '42501',
      message: 'new row violates row-level security policy for table "fm_ocorrencias"'
    }))).igual(DIAG.SEM_PERMISSAO);
  });

  teste('403 → sem permissão', () => {
    esperar(classificarErro(erro({ status: 403, message: 'Forbidden' }))).igual(DIAG.SEM_PERMISSAO);
  });

  teste('a exceção de fm_check_structure chega como acesso negado', () => {
    esperar(classificarErro(erro({
      code: '42501',
      message: 'Acesso não autorizado. Esta área está disponível exclusivamente para administradores.'
    }))).igual(DIAG.SEM_PERMISSAO);
  });
});

suite('§13 — sessão, rede e cache', () => {
  teste('JWT expirado → sessão', () => {
    esperar(classificarErro(erro({ code: 'PGRST301', message: 'JWT expired' }))).igual(DIAG.SESSAO);
  });

  teste('401 → sessão', () => {
    esperar(classificarErro(erro({ status: 401, message: 'Invalid token' }))).igual(DIAG.SESSAO);
  });

  teste('Failed to fetch → conexão', () => {
    const e = new TypeError('Failed to fetch');
    esperar(classificarErro(e)).igual(DIAG.CONEXAO);
  });

  teste('NetworkError → conexão', () => {
    esperar(classificarErro(erro({ message: 'NetworkError when attempting to fetch resource.' })))
      .igual(DIAG.CONEXAO);
  });

  teste('PGRST204 (coluna fora do cache) → cache desatualizado', () => {
    esperar(classificarErro(erro({
      code: 'PGRST204',
      message: "Could not find the 'quadrante' column of 'fm_metas' in the schema cache"
    }))).igual(DIAG.CACHE);
  });

  teste('erro sem paralelo conhecido não é classificado como ausência', () => {
    const t = classificarErro(erro({ code: '22P02', message: 'invalid input syntax for type integer' }));
    esperar(t).igual(DIAG.DESCONHECIDO);
    esperar(t === DIAG.SEM_ESTRUTURA).falso();
  });

  teste('ausência de erro é OK', () => {
    esperar(classificarErro(null)).igual(DIAG.OK);
  });
});

suite('§10 — tabelas exigidas pelo módulo', () => {
  teste('as 9 tabelas do requisito são as verificadas', () => {
    esperar(TABELAS_OBRIGATORIAS).profundo([
      'fm_competencias', 'fm_reclamacoes', 'fm_ocorrencias', 'fm_producao',
      'fm_fornecimento', 'fm_criterios', 'fm_metas', 'fm_pendencias', 'fm_memoria'
    ]);
  });
});
