/* ==========================================================================
   RNA One — Fonte única dos filtros da Consulta Dimensional
   Centraliza Cliente / Part Number / Auditor / Revisões reaproveitando os
   dados que JÁ existem na plataforma (nenhuma tabela ou integração nova):
     • bib_clientes + bib_pecas  — Biblioteca Técnica (cliente, PN, revisão)
     • insp_relatorios           — relatórios já emitidos (dados legados)
     • usuarios                  — cadastro de login (perfil auditor)
   Toda leitura passa pela camada db.js (modo demo ou Supabase, sem alteração).
   ========================================================================== */
import { db } from './db.js';

export const normTexto = s => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/* Padroniza revisão para comparação: "01" ≡ "1" ≡ "Rev. 01" ≡ "REV01".
   Não altera o dado gravado — só a chave de comparação/deduplicação. */
export function normRevisao(v) {
  const s = String(v ?? '').trim().replace(/^rev\.?\s*/i, '');
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : normTexto(s);
}
/* Rótulo de exibição da revisão: numérica → 2 dígitos ("01"); demais como veio. */
export function fmtRevisao(v) {
  const s = String(v ?? '').trim().replace(/^rev\.?\s*/i, '');
  return /^\d+$/.test(s) ? String(parseInt(s, 10)).padStart(2, '0') : String(v).trim();
}

/** Carrega as fontes dos filtros: { clientes:[nome], pns:[{codigo,clientes,revisoes}], auditores:[nome] }. */
export async function fontesConsultaDimensional() {
  const [pecas, rels, usuarios, catClientes] = await Promise.all([
    db.list('bib_pecas').catch(() => []),
    db.list('insp_relatorios').catch(() => []),
    db.list('usuarios').catch(() => []),
    db.list('bib_clientes').catch(() => [])
  ]);
  const pecasAtivas = pecas.filter(p => p.ativo !== false);

  /* clientes: catálogo + peças + relatórios — sem duplicados, ordem alfabética */
  const cliMap = new Map();
  const addCli = nome => { const n = String(nome || '').trim(); if (n && !cliMap.has(normTexto(n))) cliMap.set(normTexto(n), n); };
  catClientes.filter(c => c.ativo !== false).forEach(c => addCli(c.nome));
  pecasAtivas.forEach(p => addCli(p.cliente));
  rels.forEach(r => addCli(r.cliente));
  const clientes = [...cliMap.values()].sort((a, b) => normTexto(a).localeCompare(normTexto(b)));

  /* part numbers: código + clientes relacionados + revisões conhecidas */
  const pnMap = new Map();
  const addPN = (codigo, cliente, revisao) => {
    const cod = String(codigo || '').trim(); if (!cod) return;
    const k = normTexto(cod);
    if (!pnMap.has(k)) pnMap.set(k, { codigo: cod, clientes: new Set(), revisoes: new Map() });
    const e = pnMap.get(k);
    const cli = String(cliente || '').trim();
    if (cli) e.clientes.add(normTexto(cli));
    const rv = String(revisao ?? '').trim();
    if (rv !== '' && !e.revisoes.has(normRevisao(rv))) e.revisoes.set(normRevisao(rv), rv);
  };
  pecasAtivas.forEach(p => addPN(p.codigo, p.cliente, p.revisao_desenho));
  rels.forEach(r => addPN(r.peca_codigo, r.cliente, r.revisao_desenho));
  const pns = [...pnMap.values()].sort((a, b) => normTexto(a.codigo).localeCompare(normTexto(b.codigo), 'pt-BR', { numeric: true }));

  /* auditores: usuários com perfil auditor ativos/aprovados + autores dos
     relatórios existentes (garante consulta mesmo sem acesso à lista de usuários).
     Nunca expõe e-mail, senha, token ou outros dados sensíveis — só o nome. */
  const audMap = new Map();
  const addAud = nome => { const n = String(nome || '').trim(); if (n && !audMap.has(normTexto(n))) audMap.set(normTexto(n), n); };
  usuarios
    .filter(u => String(u.role || '').toLowerCase() === 'auditor')
    .filter(u => u.ativo !== false && !['pendente', 'recusado', 'bloqueado'].includes(String(u.status || '').toLowerCase()))
    .forEach(u => addAud(u.nome));
  rels.filter(r => !r.auditor_perfil || String(r.auditor_perfil).toLowerCase() === 'auditor')
    .forEach(r => addAud(r.auditor_nome));
  const auditores = [...audMap.values()].sort((a, b) => normTexto(a).localeCompare(normTexto(b)));

  return { clientes, pns, auditores };
}

/** Códigos de PN de um cliente ('' = todos os clientes). */
export function pnsDoCliente(fontes, cliente) {
  const alvo = normTexto(cliente);
  const lista = alvo ? fontes.pns.filter(p => p.clientes.has(alvo)) : fontes.pns;
  return lista.map(p => p.codigo);
}

/** Revisões de um PN ('' = união de todas) → [{value: valor gravado, label:"Rev NN"}]. */
export function revisoesDoPN(fontes, codigo) {
  const alvo = normTexto(codigo);
  const fonte = alvo ? fontes.pns.filter(p => normTexto(p.codigo) === alvo) : fontes.pns;
  const m = new Map();
  fonte.forEach(p => p.revisoes.forEach((raw, k) => { if (!m.has(k)) m.set(k, raw); }));
  return [...m.entries()]
    .map(([, raw]) => ({ value: raw, label: 'Rev ' + fmtRevisao(raw) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true }));
}
