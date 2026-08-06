/* ==========================================================================
   RNA One — Cotas/especificações da peça: plano de sincronização
   ---------------------------------------------------------------------------
   Decide, POR DIFERENÇA, o que inserir, atualizar e remover em `bib_metricas`
   ao salvar uma peça. Ficou aqui (puro, sem banco e sem DOM) por dois motivos:

   1) É a regra que impede a duplicação das cotas. O modelo antigo — apagar
      todas e reinserir — custava (1 + N + N) round-trips e, se falhasse no
      meio, perdia as cotas já apagadas.
   2) É testável sem navegador. "Nenhuma cota foi duplicada" e "o id da peça
      permanece o mesmo" são afirmações que precisam de teste, não de inspeção
      visual (ver tests/biblioteca-codigo.test.mjs).

   A chave do diff é o `id` da linha: só existe em cota que JÁ está no banco.
   Por isso, quem executa o plano precisa gravar o id devolvido pelo INSERT de
   volta no rascunho do formulário — sem isso, um segundo "Salvar" (depois de
   uma falha em qualquer etapa posterior) trataria a mesma cota como nova.
   ========================================================================== */

/* Campos de controle do formulário nunca vão para o banco: `id` é a chave do
   diff e qualquer chave iniciada por "_" é rascunho da tela. */
function camposGravaveis(linha, ordem) {
  const campos = {};
  for (const [k, v] of Object.entries(linha)) {
    if (k === 'id' || k.startsWith('_')) continue;
    campos[k] = v;
  }
  campos.ordem = ordem;
  return campos;
}

/* Compara só os campos que serão gravados: o registro do banco traz colunas
   extras (created_at, etc.) que não devem contar como alteração.
   `''` e `null` são o MESMO "vazio" aqui — o formulário devolve string vazia
   onde o banco guarda null, e tratá-los como diferentes faria toda linha
   parecer alterada, anulando o ganho do diff. */
export function mudou(atual, campos) {
  const vazio = v => v == null || v === '';
  return Object.keys(campos).some(k => {
    const a = atual[k], b = campos[k];
    if (vazio(a) && vazio(b)) return false;
    if (vazio(a) !== vazio(b)) return true;
    if (typeof a === 'number' || typeof b === 'number') return Number(a) !== Number(b);
    return JSON.stringify(a) !== JSON.stringify(b);
  });
}

/**
 * Plano de gravação das cotas.
 * @param existentes linhas de `bib_metricas` já no banco para a peça
 * @param linhas     linhas do formulário (com `id` quando já persistidas)
 * @returns {{inserir:Array<{linha,campos}>, atualizar:Array<{id,linha,campos}>, remover:string[]}}
 *
 * Regras (nesta ordem):
 *  • linha COM id conhecido e alterada  → UPDATE (mantém o mesmo registro);
 *  • linha COM id conhecido e inalterada→ nada (zero requisições);
 *  • linha SEM id (ou com id que sumiu do banco) → INSERT;
 *  • linha do banco que não aparece mais no formulário → DELETE (remoção
 *    consciente do usuário — é a única origem de exclusão).
 */
export function planejarSincronizacao(existentes = [], linhas = []) {
  const porId = new Map((existentes || []).map(r => [r.id, r]));
  const mantidos = new Set();
  const inserir = [], atualizar = [];

  (linhas || []).forEach((linha, i) => {
    const campos = camposGravaveis(linha, i + 1);
    const atual = linha.id ? porId.get(linha.id) : null;
    if (!atual) { inserir.push({ linha, campos }); return; }
    mantidos.add(linha.id);
    if (mudou(atual, campos)) atualizar.push({ id: linha.id, linha, campos });
  });

  const remover = (existentes || []).filter(r => !mantidos.has(r.id)).map(r => r.id);
  return { inserir, atualizar, remover };
}
