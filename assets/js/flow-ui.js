/* ==========================================================================
   RNA One — UI compartilhada do Fluxo do Auditor (stepper + gating)
   ========================================================================== */

/** Renderiza o stepper do fluxo. `current` = etapa atual; `st` = estado do fluxo.
    Plantão é a etapa inicial obrigatória; Rotina, Checklist e Auditoria são
    atividades liberadas em paralelo assim que o plantão estiver ativo. */
export function stepper(st, current) {
  const steps = [
    { id:'plantao',   n:1, label:'Plantão',   sub:'Etapa inicial',          href:'checkin.html' },
    { id:'rotina',    n:2, label:'Rotina',    sub:'Obrigatória do dia',     href:'rotinas.html' },
    { id:'checklist', n:3, label:'Checklist', sub:'Por categoria',          href:'checklist.html' },
    { id:'auditoria', n:4, label:'Auditoria', sub:'Por peça',               href:'auditoria.html' }
  ];
  const done = {
    plantao:  Boolean(st.plantao),
    rotina:   Boolean(st.rotinaOk),
    checklist:Boolean(st.checklistOk),
    auditoria:false
  };
  // Com o plantão ativo, as três atividades ficam liberadas juntas (sem cadeado sequencial).
  const ativo = Boolean(st.plantao);
  const unlocked = {
    plantao:true,
    rotina:ativo,
    checklist:ativo,
    auditoria:ativo
  };
  return `<div class="rna-stepper mb-3">${steps.map(s => {
    const cls = [done[s.id] ? 'done' : '', s.id === current ? 'active' : '', !unlocked[s.id] ? 'locked' : ''].join(' ').trim();
    const inner = `<div class="rna-step ${cls}">
        <div class="rna-step__num">${done[s.id] ? '<i class="bi bi-check-lg"></i>' : s.n}</div>
        <div class="rna-step__txt"><b>${s.label}</b><small>${s.sub}</small></div>
      </div>`;
    return unlocked[s.id] ? `<a href="${s.href}" style="flex:1;text-decoration:none;color:inherit">${inner}</a>` : inner;
  }).join('')}</div>`;
}

/** Banner de bloqueio quando a etapa anterior não foi concluída. */
export function bloqueio(titulo, msg, voltarHref, voltarLabel) {
  return `<div class="rna-card"><div class="rna-card__body text-center" style="padding:38px 20px">
    <i class="bi bi-lock-fill" style="font-size:44px;color:var(--rna-gray-300)"></i>
    <h3 style="margin:14px 0 6px">${titulo}</h3>
    <p class="text-muted-2" style="max-width:460px;margin:0 auto 16px">${msg}</p>
    <a href="${voltarHref}" class="rna-btn rna-btn-primary rna-btn-lg"><i class="bi bi-arrow-left"></i> ${voltarLabel}</a>
  </div></div>`;
}
