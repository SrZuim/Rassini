/* ==========================================================================
   RNA One — Executa toda a suíte de testes
   Uso:  node tests/run-all.mjs
   Saída ≠ 0 quando algum teste falha (pronto para CI).
   ========================================================================== */
import { relatorio } from './runner.mjs';

await import('./fechamento/calculos.test.mjs');
await import('./fechamento/importacao.test.mjs');
await import('./fechamento/clientes.test.mjs');
await import('./fechamento/permissoes.test.mjs');
await import('./fechamento/pendencias.test.mjs');
await import('./fechamento/apresentacao.test.mjs');
await import('./quem-mede.test.mjs');

process.exit(relatorio());
