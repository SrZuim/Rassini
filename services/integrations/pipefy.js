/* ==========================================================================
   RNA One — Integração Pipefy (stub para fase 2)
   Cria cards no Pipefy a partir de Não Conformidades / Planos de Ação.
   A chamada real deve passar por uma Edge Function (não expor token no client).
   ========================================================================== */
const PIPEFY_GRAPHQL = 'https://api.pipefy.com/graphql';

export async function criarCardPipefy({ pipeId, token, titulo, campos = [] }) {
  if (!pipeId || !token) {
    console.warn('[Pipefy] pipeId/token ausentes — configure em configuracoes.pipefy.');
    return { ok: false, reason: 'config' };
  }
  const fields = campos.map(c => `{field_id:"${c.id}",field_value:"${c.valor}"}`).join(',');
  const query = `mutation { createCard(input:{pipe_id:${pipeId}, title:"${titulo}", fields_attributes:[${fields}]}) { card { id url } } }`;
  const res = await fetch(PIPEFY_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query })
  });
  return res.json();
}

/** Sincroniza uma NC crítica como card no Pipefy (recomendado via Edge Function). */
export async function sincronizarNC(nc, cfg) {
  return criarCardPipefy({
    ...cfg, titulo: `${nc.codigo} · ${nc.descricao?.slice(0, 60)}`,
    campos: [
      { id: 'severidade', valor: nc.severidade },
      { id: 'maquina', valor: nc.maquina },
      { id: 'responsavel', valor: nc.responsavel }
    ]
  });
}
