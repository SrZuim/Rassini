/* ==========================================================================
   RNA One — Runner de testes mínimo (sem dependências)
   ---------------------------------------------------------------------------
   O projeto é 100% estático e não tem package.json nem node_modules — instalar
   um framework de teste só para isto adicionaria uma árvore de dependências a
   um repositório que hoje não tem nenhuma. Este runner cobre o necessário:
   agrupamento, asserções com mensagem útil e código de saída ≠ 0 na falha
   (para CI). Rode com:  node tests/run-all.mjs
   ========================================================================== */

const estado = { suite: null, passou: 0, falhou: 0, falhas: [], total: 0 };

export function suite(nome, fn) {
  estado.suite = nome;
  console.log(`\n\x1b[1m${nome}\x1b[0m`);
  fn();
  estado.suite = null;
}

export function teste(nome, fn) {
  estado.total++;
  try {
    fn();
    estado.passou++;
    console.log(`  \x1b[32m✓\x1b[0m ${nome}`);
  } catch (e) {
    estado.falhou++;
    estado.falhas.push({ suite: estado.suite, nome, erro: e });
    console.log(`  \x1b[31m✕\x1b[0m ${nome}`);
    console.log(`    \x1b[31m${e.message}\x1b[0m`);
  }
}

function falhar(msg, esperado, recebido) {
  const e = new Error(`${msg}\n      esperado: ${fmt(esperado)}\n      recebido: ${fmt(recebido)}`);
  e.esperado = esperado; e.recebido = recebido;
  throw e;
}
const fmt = v => typeof v === 'object' ? JSON.stringify(v) : String(v);

export const esperar = (recebido) => ({
  igual(esperado, msg = 'valores diferentes') {
    if (recebido !== esperado) falhar(msg, esperado, recebido);
  },
  proximo(esperado, casas = 6, msg = 'valor numérico fora da tolerância') {
    if (recebido == null || esperado == null) falhar(msg, esperado, recebido);
    if (Math.abs(recebido - esperado) > Math.pow(10, -casas)) falhar(msg, esperado, recebido);
  },
  nulo(msg = 'esperava null') {
    if (recebido !== null && recebido !== undefined) falhar(msg, null, recebido);
  },
  naoNulo(msg = 'esperava um valor') {
    if (recebido === null || recebido === undefined) falhar(msg, 'algo', recebido);
  },
  verdadeiro(msg = 'esperava verdadeiro') {
    if (recebido !== true) falhar(msg, true, recebido);
  },
  falso(msg = 'esperava falso') {
    if (recebido !== false) falhar(msg, false, recebido);
  },
  contem(trecho, msg = 'texto não contém o trecho') {
    if (!String(recebido).includes(trecho)) falhar(msg, `…${trecho}…`, recebido);
  },
  tamanho(n, msg = 'tamanho diferente') {
    if (!recebido || recebido.length !== n) falhar(msg, n, recebido?.length);
  },
  profundo(esperado, msg = 'estrutura diferente') {
    const a = JSON.stringify(recebido), b = JSON.stringify(esperado);
    if (a !== b) falhar(msg, b, a);
  },
  lanca(msg = 'esperava uma exceção') {
    let lancou = false;
    try { recebido(); } catch { lancou = true; }
    if (!lancou) falhar(msg, 'exceção', 'nenhuma');
  }
});

export function relatorio() {
  console.log('\n' + '─'.repeat(64));
  if (estado.falhou === 0) {
    console.log(`\x1b[32m\x1b[1m✓ ${estado.passou}/${estado.total} testes passaram\x1b[0m`);
  } else {
    console.log(`\x1b[31m\x1b[1m✕ ${estado.falhou} de ${estado.total} testes falharam\x1b[0m`);
    for (const f of estado.falhas) console.log(`  · [${f.suite}] ${f.nome}`);
  }
  console.log('─'.repeat(64));
  return estado.falhou === 0 ? 0 : 1;
}
