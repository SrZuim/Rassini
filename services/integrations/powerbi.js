/* ==========================================================================
   RNA One — Integração Power BI (stub para fase 2)
   Uso: import { embedPowerBI } from './integrations/powerbi.js'
        embedPowerBI(containerEl, { reportId, embedUrl, token })
   Requer o SDK powerbi-client (CDN) e um token gerado no backend.
   ========================================================================== */
export async function embedPowerBI(container, { embedUrl, token, reportId } = {}) {
  if (!embedUrl || !token) {
    container.innerHTML = '<div class="empty-state"><i class="bi bi-bar-chart-line"></i>' +
      '<div>Configure reportId, embedUrl e token em configuracoes.powerbi para exibir o relatório.</div></div>';
    return null;
  }
  // Carrega o SDK sob demanda
  if (!window['powerbi-client']) {
    await import('https://cdn.jsdelivr.net/npm/powerbi-client@2.23.1/dist/powerbi.min.js');
  }
  const models = window['powerbi-client'].models;
  const config = {
    type: 'report', id: reportId, embedUrl, accessToken: token,
    tokenType: models.TokenType.Embed,
    settings: { panes: { filters: { visible: false }, pageNavigation: { visible: true } } }
  };
  return window.powerbi.embed(container, config);
}
