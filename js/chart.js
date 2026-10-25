// Line chart of travel time through the day, drawn as plain SVG.
// series: [{ id, name, color, values: [seconds | null] }] aligned with `times`.
import { niceStep, formatClock, escapeHtml } from './logic.js';

const SVG = 'http://www.w3.org/2000/svg';
const HEIGHT = 210;
const M = { top: 22, right: 10, bottom: 24, left: 34 };

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes();
const fmtMin = (sec) => (sec == null ? 'No route' : `${Math.round(sec / 60)} min`);

export function renderDayChart(container, { times, series, yCapSec, now }) {
  container.innerHTML = '';
  const width = container.clientWidth || 360;
  const plotW = width - M.left - M.right;
  const plotH = HEIGHT - M.top - M.bottom;

  // y axis in minutes; very long waits (e.g. at night) are cut off at the top and shown in the tooltip
  const allMin = series.flatMap((s) => s.values).filter((v) => v != null).map((v) => v / 60);
  const capMin = yCapSec ? yCapSec / 60 : Infinity;
  const dataMax = Math.min(Math.max(...allMin), capMin);
  const step = niceStep(dataMax);
  const yMax = Math.ceil(dataMax / step) * step || step;
  const x = (min) => M.left + (min / (24 * 60)) * plotW;
  const y = (sec) => M.top + plotH - (Math.min(sec / 60, yMax) / yMax) * plotH;

  // legend: always shown, text in text colour, identity from the swatch
  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  legend.innerHTML = series.map((s) =>
    `<span><i style="background:${s.color}"></i>${escapeHtml(s.name)}</span>`).join('');
  container.append(legend);

  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  container.append(wrap);

  const svg = el('svg', {
    width, height: HEIGHT, viewBox: `0 0 ${width} ${HEIGHT}`, class: 'chart',
    tabindex: '0', role: 'img',
    'aria-label': 'Travel time through the day. Use the left and right arrow keys to read values.',
  });
  wrap.append(svg);

  // grid + y labels
  for (let v = 0; v <= yMax; v += step) {
    const yy = M.top + plotH - (v / yMax) * plotH;
    svg.append(el('line', { x1: M.left, x2: width - M.right, y1: yy, y2: yy, class: 'grid' }));
    const t = el('text', { x: M.left - 6, y: yy + 4, class: 'tick', 'text-anchor': 'end' });
    t.textContent = v;
    svg.append(t);
  }
  const unit = el('text', { x: M.left - 6, y: 10, class: 'tick', 'text-anchor': 'end' });
  unit.textContent = 'min';
  svg.append(unit);

  // x labels every 6 hours
  for (let h = 0; h <= 24; h += 6) {
    const anchor = h === 0 ? 'start' : h === 24 ? 'end' : 'middle';
    const t = el('text', { x: x(h * 60), y: HEIGHT - 6, class: 'tick', 'text-anchor': anchor });
    t.textContent = `${String(h).padStart(2, '0')}:00`;
    svg.append(t);
  }

  // "now" marker when the chart shows today
  if (now) {
    const nx = x(minutesOfDay(now));
    svg.append(el('line', { x1: nx, x2: nx, y1: M.top, y2: M.top + plotH, class: 'now-line' }));
    const t = el('text', { x: nx + 4, y: M.top + 10, class: 'tick' });
    t.textContent = 'now';
    svg.append(t);
  }

  // series lines; null values break the line
  const xs = times.map((t) => x(minutesOfDay(t)));
  for (const s of series) {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${xs[i].toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    svg.append(el('path', { d, class: 'series', stroke: s.color }));
  }

  // hover layer: crosshair snaps to the nearest time slot
  const cross = el('line', { y1: M.top, y2: M.top + plotH, class: 'crosshair', visibility: 'hidden' });
  const dots = series.map((s) => el('circle', { r: 4, fill: s.color, class: 'dot', visibility: 'hidden' }));
  svg.append(cross, ...dots);
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  wrap.append(tip);

  let active = -1;
  const show = (i) => {
    active = Math.max(0, Math.min(times.length - 1, i));
    const cx = xs[active];
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    series.forEach((s, k) => {
      const v = s.values[active];
      dots[k].setAttribute('visibility', v == null ? 'hidden' : 'visible');
      if (v != null) { dots[k].setAttribute('cx', cx); dots[k].setAttribute('cy', y(v)); }
    });
    const best = Math.min(...series.map((s) => s.values[active] ?? Infinity));
    tip.innerHTML = `<strong>Leave ${formatClock(times[active])}</strong>` + series.map((s) => {
      const v = s.values[active];
      const isBest = v != null && v === best;
      return `<div class="${isBest ? 'best' : ''}"><i style="background:${s.color}"></i>${escapeHtml(s.name)}<span>${fmtMin(v)}</span></div>`;
    }).join('');
    tip.hidden = false;
    // beside the crosshair, on the side with more room
    const tipW = tip.offsetWidth;
    tip.style.left = `${cx < width / 2 ? cx + 12 : cx - 12 - tipW}px`;
  };
  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    dots.forEach((dot) => dot.setAttribute('visibility', 'hidden'));
    tip.hidden = true;
  };

  svg.addEventListener('pointermove', (e) => {
    const rect = svg.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let nearest = 0;
    xs.forEach((cx, i) => { if (Math.abs(cx - px) < Math.abs(xs[nearest] - px)) nearest = i; });
    show(nearest);
  });
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { show(active + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { show(active < 0 ? 0 : active - 1); e.preventDefault(); }
    if (e.key === 'Escape') hide();
  });

  // table view of the same numbers
  const table = document.createElement('details');
  table.className = 'chart-table';
  table.innerHTML = `<summary>Show as table</summary>
    <table>
      <thead><tr><th>Leave</th>${series.map((s) => `<th>${escapeHtml(s.name)}</th>`).join('')}</tr></thead>
      <tbody>${times.map((t, i) => `<tr><td>${formatClock(t)}</td>${series.map((s) =>
        `<td>${fmtMin(s.values[i])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
  container.append(table);
}
