/* ==========================================================================
   RNA One — Blocos compartilhados do Relatório Dimensional
   ---------------------------------------------------------------------------
   O relatório é impresso por DUAS telas:
     • consulta-dimensional.js        → o registro OFICIAL de medição;
     • rel-dimensionais-producao.js   → o documento de APOIO OPERACIONAL
                                        ("Rel. Dimensionais de Produção").

   Requisito: as duas devem ter exatamente os mesmos campos, títulos, ordem e
   formatação. Enquanto cada tela tinha a sua própria cópia destes blocos, elas
   divergiam em silêncio — a Inspeção Após Pintura, por exemplo, existia só no
   oficial, e a de produção saía sem a seção inteira.

   Este módulo é a FONTE ÚNICA desses blocos. Uma correção de layout aqui vale
   para o relatório oficial e para o de produção no mesmo instante; não há como
   um dos dois ficar para trás.

   O que NÃO vem para cá: os blocos com semântica própria de cada tela (marca
   d'água, selo, aviso de documento de apoio, colunas "ajustado"). A identidade
   visual dos dois documentos precisa continuar distinta — misturá-la seria o
   defeito oposto, um relatório de produção que se passa por oficial.
   ========================================================================== */
import * as INSP from '../../services/inspecao.js';

/** Escape de texto livre (conteúdo e atributos). */
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Célula rótulo/valor da grade de identificação. `v` pode conter HTML. */
export const cell = (l, v) => `<div class="insp-rep-cell"><span class="insp-info-l">${l}</span><span class="insp-info-v">${(v === 0 || v) ? v : '—'}</span></div>`;

/** Etiqueta de resultado de uma característica/medição. */
export function resultadoTag(resultado, visual) {
  if (resultado === 'reprovado') return '<span class="rep-tag rep-crit">✗ Reprovado</span>';
  if (resultado === 'aprovado') return visual === 'atencao'
    ? '<span class="rep-tag rep-warn" title="Valor no limite ou próximo dele — aprovado, com atenção.">▲ Aprovado com atenção</span>'
    : '<span class="rep-tag rep-ok">✓ Aprovado</span>';
  if (resultado === 'registrado') return '<span class="rep-tag">Registrado — Referência</span>';
  return '—';
}

/* Seção "Inspeção Após Pintura" do relatório/PDF: características visuais (cota,
   característica, quadrante, referência, especificação visual), resultados
   OK/NOK, observações, nome do Relatório de Pintura anexado e resultado final da
   inspeção visual. Não aparece quando a peça não tem características visuais
   (relatórios antigos continuam idênticos).

   `caracteristicas` já vem derivada (INSP.derivarResultados), então `c.visual` e
   `c._visual` estão preenchidos tanto na visão oficial quanto na de produção. */
export function inspecaoAposPinturaHtml(caracteristicas, resumo) {
  const visuais = (caracteristicas || []).filter(c => c.visual);
  if (!visuais.length) return '';
  const v = resumo?.inspecaoVisual || {};
  const res = v.resultado || INSP.resultadoVisual(visuais);
  const resLabel = res === 'aprovado' ? 'APROVADO' : res === 'reprovado' ? 'REPROVADO' : res === 'pendente' ? 'EM PREENCHIMENTO' : '—';
  const pint = v.relatorioPintura || null;   // vem de resumo.inspecaoVisual (resumoRelatorio)
  return `<div class="insp-rep-section"><div class="insp-rep-sec-t">Inspeção Após Pintura</div>
    <div class="insp-table-wrap"><table class="insp-mtable insp-rep-table"><thead><tr>
      <th>Cota</th><th>Característica</th><th>Quadrante</th><th>Ref.</th><th>Especificação visual</th><th>Resultado</th><th>Obs.</th>
    </tr></thead><tbody>
      ${visuais.map(c => `<tr>
        <td>${esc(c.cota ?? '—')}</td><td>${esc(c.caracteristica || '—')}</td><td>${esc(c.quadrante || '—')}</td>
        <td class="cell-sub">${esc(c.referencia || '—')}</td><td class="cell-sub">${esc(c.observacao_tec || '—')}</td>
        <td>${resultadoTag(c.resultado, c._visual)}</td><td class="cell-sub">${esc(c.observacao || '—')}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="insp-rep-grid mt-2">
      ${/* Na consulta o anexo precisa ser ABRÍVEL, não só nomeado: é aqui que os
            outros usuários (qualidade, cliente interno) buscam o documento. No
            PDF impresso o link vira apenas o texto do nome. */''}
      ${cell('Relatório de Pintura anexado', pint
        ? (pint.url ? `<a href="${esc(pint.url)}" target="_blank" rel="noopener">${esc(pint.nome)}</a>` : esc(pint.nome))
        : '—')}
      ${cell('Resultado da inspeção visual', resLabel)}
    </div></div>`;
}
