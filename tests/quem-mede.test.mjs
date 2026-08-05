/* ==========================================================================
   RNA One — CONTROLE DE MEDIÇÃO POR CARGO (services/quem-mede.js)
   Cobre os 7 testes obrigatórios da correção "responsável × cargo" e a
   normalização (acento/caixa/pontuação/aliases legados) que a sustenta.
   Rode com:  node tests/run-all.mjs
   ========================================================================== */
import { suite, teste, esperar } from './runner.mjs';
import {
  canUserMeasure, usuarioPodeMedirCaracteristica, motivoBloqueioMedicao,
  normalizarQuemMede, normalizarCargo, cargoDoUsuario, obterCargoResponsavel,
  cargosAutorizados, quemMedePreenchido, diagnosticoMedicao, rotuloCargoUsuario,
  QUEM_MEDE, QUEM_MEDE_PARA_CARGO
} from '../services/quem-mede.js';

/* Perfis como o sistema realmente os monta (auth.js): a fonte oficial do cargo é
   `role`; `area` pode vir null — e isso NÃO pode bloquear ninguém. */
const auditor       = { id: 'u1', nome: 'Auditor',     role: 'auditor',             area: null };
const recebimento   = { id: 'u2', nome: 'Recebimento', role: 'auditor_recebimento', area: null };
const engProcessos  = { id: 'u3', nome: 'Processos',   role: 'eng_processos',       area: null };
const laboratorio   = { id: 'u4', nome: 'Laboratório', role: 'laboratorio',         area: null };
const admin         = { id: 'u5', nome: 'Admin',       role: 'admin',               area: 'Qualidade' };
const supervisor    = { id: 'u6', nome: 'Supervisor',  role: 'supervisor',          area: 'Qualidade' };
const visitante     = { id: 'u7', nome: 'Visitante',   role: 'visitante',           area: null };

const carac = quemMede => ({ id: 'c1', cota: 1, caracteristica: 'Comprimento', quem_mede: quemMede });

/* ======================================================= TESTES OBRIGATÓRIOS */
suite('Quem Mede × cargo — testes obrigatórios', () => {

  teste('1) Quem mede "G. Qualidade" + usuário Auditor → LIBERADO', () => {
    esperar(canUserMeasure('G. Qualidade', auditor)).verdadeiro();
    esperar(usuarioPodeMedirCaracteristica(auditor, carac('G. Qualidade'))).verdadeiro();
    esperar(motivoBloqueioMedicao(auditor, carac('G. Qualidade'))).nulo();
  });

  teste('2) Quem mede "Recebimento de Materiais" + Auditor → BLOQUEADO', () => {
    esperar(canUserMeasure('Recebimento de Materiais', auditor)).falso();
    esperar(motivoBloqueioMedicao(auditor, carac('Recebimento de Materiais')).tipo).igual('cargo_incorreto');
  });

  teste('3) "Recebimento de Materiais" + Auditor de Recebimento → LIBERADO', () => {
    esperar(canUserMeasure('Recebimento de Materiais', recebimento)).verdadeiro();
  });

  teste('4) "Eng. Processos" + Eng. Processos → LIBERADO', () => {
    esperar(canUserMeasure('Eng. Processos', engProcessos)).verdadeiro();
  });

  teste('5) "Laboratório" + Laboratório → LIBERADO', () => {
    esperar(canUserMeasure('Laboratório', laboratorio)).verdadeiro();
  });

  teste('6) Quem mede null → "Sem responsável" (e não "bloqueado por cargo")', () => {
    esperar(quemMedePreenchido(null)).falso();
    esperar(quemMedePreenchido(undefined)).falso();
    esperar(quemMedePreenchido('   ')).falso();
    esperar(motivoBloqueioMedicao(auditor, carac(null)).tipo).igual('sem_responsavel');
    esperar(motivoBloqueioMedicao(auditor, carac('')).tipo).igual('sem_responsavel');
  });

  teste('7) Perfil com cargo Auditor e ÁREA NULL mede "G. Qualidade"', () => {
    const perfil = { id: 'u9', nome: 'Thais', role: 'auditor', area: null, planta: null, status: 'aprovado' };
    esperar(canUserMeasure('G. Qualidade', perfil)).verdadeiro();
    esperar(cargoDoUsuario(perfil)).igual('auditor');
  });
});

/* ==================================================== NORMALIZAÇÃO / ALIASES */
suite('Quem Mede — normalização e aliases legados', () => {

  teste('rótulos oficiais mapeiam para os 4 cargos', () => {
    esperar(QUEM_MEDE_PARA_CARGO[QUEM_MEDE.QUALIDADE]).igual('auditor');
    esperar(QUEM_MEDE_PARA_CARGO[QUEM_MEDE.RECEBIMENTO]).igual('auditor_recebimento');
    esperar(QUEM_MEDE_PARA_CARGO[QUEM_MEDE.PROCESSOS]).igual('eng_processos');
    esperar(QUEM_MEDE_PARA_CARGO[QUEM_MEDE.LABORATORIO]).igual('laboratorio');
  });

  teste('aliases da Qualidade resolvem para o cargo auditor', () => {
    for (const v of ['G. Qualidade', 'G Qualidade', 'g. qualidade', '  G.  QUALIDADE  ',
                     'Gestão da Qualidade', 'Gestao da Qualidade', 'Gerência da Qualidade',
                     'Garantia da Qualidade', 'Qualidade', 'Auditor']) {
      esperar(obterCargoResponsavel(v)).igual('auditor', `"${v}" deveria mapear para auditor`);
      esperar(canUserMeasure(v, auditor)).verdadeiro(`Auditor deveria medir "${v}"`);
    }
  });

  teste('acento e pontuação não alteram a decisão', () => {
    esperar(obterCargoResponsavel('Laboratorio')).igual('laboratorio');
    esperar(obterCargoResponsavel('LABORATÓRIO')).igual('laboratorio');
    esperar(obterCargoResponsavel('Eng Processos')).igual('eng_processos');
    esperar(obterCargoResponsavel('eng. processos')).igual('eng_processos');
    esperar(obterCargoResponsavel('Engenharia de Processos')).igual('eng_processos');
    esperar(obterCargoResponsavel('recebimento')).igual('auditor_recebimento');
  });

  teste('valor fora da lista oficial NÃO vira "sem responsável"', () => {
    esperar(obterCargoResponsavel('Metrologia')).nulo();
    const m = motivoBloqueioMedicao(auditor, carac('Metrologia'));
    esperar(m.tipo).igual('responsavel_desconhecido');
    esperar(m.msg).contem('Metrologia');
  });

  teste('cargo legado/rótulo é normalizado para o id canônico', () => {
    esperar(normalizarCargo('Auditor')).igual('auditor');
    esperar(normalizarCargo('administrador')).igual('admin');
    esperar(normalizarCargo('Auditor de Recebimento')).igual('auditor_recebimento');
    esperar(normalizarCargo('Eng. Processos')).igual('eng_processos');
    esperar(normalizarCargo('Laboratório')).igual('laboratorio');
    esperar(normalizarCargo('')).igual('');
    esperar(normalizarCargo(null)).igual('');
  });

  teste('normalizarQuemMede devolve o rótulo canônico exibível', () => {
    esperar(normalizarQuemMede('g qualidade')).igual('G. Qualidade');
    esperar(normalizarQuemMede('LABORATORIO')).igual('Laboratório');
    esperar(normalizarQuemMede('')).igual('');
    esperar(normalizarQuemMede('Metrologia')).igual('');
  });

  teste('cargosAutorizados lista o cargo da área (e vazio quando não mapeia)', () => {
    esperar(cargosAutorizados('G. Qualidade')).profundo(['auditor']);
    esperar(cargosAutorizados('Metrologia')).profundo([]);
    esperar(cargosAutorizados(null)).profundo([]);
  });
});

/* ============================================ RESOLUÇÃO DO CARGO DO USUÁRIO */
suite('Cargo do usuário — fonte oficial e tolerâncias', () => {

  teste('role é a fonte oficial e vence os demais campos', () => {
    esperar(cargoDoUsuario({ role: 'auditor', cargo: 'laboratorio' })).igual('auditor');
  });

  teste('perfil sem role cai para cargo/perfil antes de olhar a área', () => {
    esperar(cargoDoUsuario({ cargo: 'Auditor' })).igual('auditor');
    esperar(cargoDoUsuario({ perfil: 'administrador' })).igual('admin');
  });

  teste('área é ÚLTIMO recurso — nunca requisito', () => {
    esperar(cargoDoUsuario({ role: null, cargo: null, area: 'G. Qualidade' })).igual('auditor');
    esperar(cargoDoUsuario({ role: 'auditor', area: null })).igual('auditor');
    esperar(cargoDoUsuario({})).igual('');
  });

  teste('perfil ainda não carregado bloqueia com motivo próprio (não "cargo errado")', () => {
    esperar(canUserMeasure('G. Qualidade', null)).falso();
    esperar(canUserMeasure('G. Qualidade', {})).falso();
    esperar(motivoBloqueioMedicao({}, carac('G. Qualidade')).tipo).igual('sem_cargo');
  });

  teste('aceita o role solto como string (compatibilidade)', () => {
    esperar(canUserMeasure('G. Qualidade', 'auditor')).verdadeiro();
    esperar(canUserMeasure('Laboratório', 'auditor')).falso();
  });

  teste('rótulo do cargo do usuário para mensagens', () => {
    esperar(rotuloCargoUsuario(auditor)).igual('Auditor');
    esperar(rotuloCargoUsuario({})).igual('sem cargo definido');
  });
});

/* ========================================================= PERFIS ESPECIAIS */
suite('Quem Mede — perfis especiais e matriz completa', () => {

  teste('admin mede qualquer área, inclusive sem responsável', () => {
    esperar(canUserMeasure('G. Qualidade', admin)).verdadeiro();
    esperar(canUserMeasure('Laboratório', admin)).verdadeiro();
    esperar(canUserMeasure(null, admin)).verdadeiro();
    esperar(canUserMeasure('Metrologia', admin)).verdadeiro();
  });

  teste('supervisor não mede (SUPERVISOR_PODE_MEDIR = false) e visitante nunca', () => {
    esperar(canUserMeasure('G. Qualidade', supervisor)).falso();
    esperar(motivoBloqueioMedicao(supervisor, carac('G. Qualidade')).tipo).igual('supervisor');
    esperar(canUserMeasure('G. Qualidade', visitante)).falso();
    esperar(motivoBloqueioMedicao(visitante, carac('G. Qualidade')).tipo).igual('visitante');
  });

  teste('matriz 4 cargos × 4 áreas: só a diagonal libera', () => {
    const pares = [
      [auditor,      QUEM_MEDE.QUALIDADE],
      [recebimento,  QUEM_MEDE.RECEBIMENTO],
      [engProcessos, QUEM_MEDE.PROCESSOS],
      [laboratorio,  QUEM_MEDE.LABORATORIO]
    ];
    for (const [user, propria] of pares) {
      for (const [, area] of pares) {
        const esperado = area === propria;
        esperar(canUserMeasure(area, user)).igual(esperado,
          `${user.role} × ${area} deveria ser ${esperado ? 'liberado' : 'bloqueado'}`);
      }
    }
  });

  teste('diagnóstico expõe entrada, normalização e decisão', () => {
    const d = diagnosticoMedicao(auditor, carac('  g. QUALIDADE '));
    esperar(d.areaNormalizada).igual('G. Qualidade');
    esperar(d.normalizedRole).igual('auditor');
    esperar(d.userArea).nulo();
    esperar(d.canMeasure).verdadeiro();
    esperar(d.allowedRoles).profundo(['auditor']);
    esperar(d.motivo).nulo();
  });
});
