/* ==========================================================================
   RNA One — Fábrica de gráficos (Chart.js) com tema Rassini
   ========================================================================== */

export const PALETTE = {
  yellow: '#F4C20D', graphite: '#1b1d21', steel: '#3a3f45', gray: '#6b7178',
  green: '#22a85a', red: '#e23b3b', orange: '#ff7a00', blue: '#2f74d0', info: '#2f74d0',
  grid: 'rgba(27,29,33,.06)'
};

function baseOpts(extra = {}) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { font: { family: 'Inter, sans-serif', size: 12 }, color: PALETTE.steel, usePointStyle: true, pointStyle: 'rectRounded', padding: 14 } },
      tooltip: { backgroundColor: PALETTE.graphite, padding: 11, cornerRadius: 8, titleFont: { weight: '600' }, bodyFont: { size: 12 } }
    },
    ...extra
  };
}
const axes = {
  scales: {
    x: { grid: { display: false }, ticks: { color: PALETTE.gray, font: { size: 11 } } },
    y: { grid: { color: PALETTE.grid }, ticks: { color: PALETTE.gray, font: { size: 11 } }, beginAtZero: true }
  }
};

const registry = {};
function make(id, cfg) {
  const ctx = document.getElementById(id);
  if (!ctx) return null;
  if (registry[id]) registry[id].destroy();
  registry[id] = new Chart(ctx, cfg);
  return registry[id];
}

export const charts = {
  line(id, labels, datasets, opts = {}) {
    return make(id, { type: 'line', data: { labels, datasets: datasets.map(d => ({ tension: .38, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, fill: true, ...d })) }, options: { ...baseOpts(opts), ...axes } });
  },
  bar(id, labels, datasets, opts = {}) {
    return make(id, { type: 'bar', data: { labels, datasets: datasets.map(d => ({ borderRadius: 7, borderSkipped: false, maxBarThickness: 38, ...d })) }, options: { ...baseOpts(opts), ...axes } });
  },
  hbar(id, labels, datasets, opts = {}) {
    return make(id, { type: 'bar', data: { labels, datasets: datasets.map(d => ({ borderRadius: 7, maxBarThickness: 22, ...d })) }, options: { ...baseOpts({ indexAxis: 'y', ...opts }), scales: { x: { grid: { color: PALETTE.grid }, beginAtZero: true, ticks: { color: PALETTE.gray } }, y: { grid: { display: false }, ticks: { color: PALETTE.steel, font: { size: 11.5 } } } } } });
  },
  doughnut(id, labels, data, colors, opts = {}) {
    return make(id, { type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 3, borderColor: '#fff' }] }, options: { ...baseOpts({ cutout: '68%', ...opts }) } });
  },
  radar(id, labels, datasets, opts = {}) {
    return make(id, { type: 'radar', data: { labels, datasets }, options: { ...baseOpts(opts), scales: { r: { grid: { color: PALETTE.grid }, angleLines: { color: PALETTE.grid }, pointLabels: { color: PALETTE.steel, font: { size: 11 } }, ticks: { display: false }, beginAtZero: true } } } });
  },
  fade(color, ctx) {
    const c = ctx?.chart?.ctx; if (!c) return color + '22';
    const g = c.createLinearGradient(0, 0, 0, 220);
    g.addColorStop(0, color + '44'); g.addColorStop(1, color + '02');
    return g;
  }
};
