import uPlot from '../vendor/uplot/uPlot.esm.js';

/** Prepare plot-only arrays, inserting gaps without changing recorded values. */
export function chartData(history, now, windowMs) {
  const points = history.filter(p => p.at >= now - windowMs && p.at <= now && Number.isFinite(p.value)).slice().sort((a, b) => a.at - b.at);
  const x = [], y = [];
  for (const point of points) {
    const last = x.at(-1);
    if (point.at === last) { y[y.length - 1] = point.value; continue; }
    if (last != null && point.at - last > 5000) { x.push((last + point.at) / 2); y.push(null); }
    x.push(point.at); y.push(point.value);
  }
  return [x, y];
}

export function liveRange(now, windowMs, zoomMs = windowMs) {
  const width = Math.min(windowMs, Math.max(1000, zoomMs ?? windowMs));
  return { min: now - width, max: now };
}

function ageLabel(value, now) {
  const seconds = Math.max(0, (now - value) / 1000);
  return seconds < 0.5 ? 'Now' : seconds >= 60 ? `${+(seconds / 60).toFixed(1)} min ago` : `${+seconds.toFixed(1)}s ago`;
}

/** One bounded chart per visible host; teardown includes observers and events. */
export class TrendCharts {
  constructor() { this.entries = new Map(); }
  notify(entry) {
    entry.host.dispatchEvent(new CustomEvent('chartviewchange', { detail: { live: true, windowMs: entry.zoomMs ?? entry.windowMs } }));
  }
  draw(host, history, { now, windowMs = 60000, detailed = false, simulated = false, metric = 'hr' }) {
    const key = `${windowMs}:${detailed}:${simulated}:${metric}`;
    let entry = this.entries.get(host);
    if (entry && entry.key !== key) { this.destroy(host); entry = null; }
    if (!entry) {
      if (host.clientWidth < 1) return;
      entry = { host, key, history, now, windowMs, detailed, metric, simulated, zoomMs: null, closed: false };
      this.entries.set(host, entry);
      const unit = metric === 'rr' ? 'ms' : 'bpm';
      const label = metric === 'rr' ? 'RR interval' : 'Heart rate';
      const options = {
        width: Math.max(1, Math.floor(host.clientWidth)),
        height: Math.max(36, host.clientHeight - (detailed ? 32 : 0)),
        padding: detailed ? [12, 16, 0, 0] : [3, 2, 3, 2],
        legend: { show: detailed },
        cursor: { show: detailed, drag: { x: false, y: false, setScale: false }, bind: { dblclick: () => null } },
        select: { show: false },
        scales: { x: { time: false, auto: false }, y: { range: (u, min, max) => {
          const pad = metric === 'rr' ? 20 : 8;
          return [Math.max(0, (min ?? (metric === 'rr' ? 600 : 40)) - pad), (max ?? (metric === 'rr' ? 1200 : 140)) + pad];
        } } },
        series: [
          { label: 'Time', value: (u, value) => value == null ? '—' : ageLabel(value, entry.now) },
          { label, stroke: simulated ? '#9676ad' : metric === 'rr' ? '#397da3' : '#167462', width: detailed ? 2 : 1.5,
            spanGaps: false, value: (u, value) => value == null ? '—' : `${+value.toFixed(metric === 'rr' ? 1 : 0)} ${unit}`,
            points: { show: (u, i, lo, hi) => hi - lo < 20, size: detailed ? 5 : 3 } }
        ],
        axes: detailed ? [
          { stroke: '#647874', size: 42, space: 100, grid: { show: false },
            incrs: [1000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000],
            splits: (u, i, min, max, incr) => {
              const values = [];
              if (!(incr > 0)) return values;
              for (let x = entry.now - Math.floor((entry.now - min) / incr) * incr; x <= max + 0.01; x += incr) values.push(x);
              return values;
            }, values: (u, values) => values.map(value => ageLabel(value, entry.now)) },
          { stroke: '#647874', size: 58, space: 45, label: unit, labelSize: 18, grid: { stroke: '#e2e9e3', width: 1 } }
        ] : [{ show: false }, { show: false }]
      };
      entry.chart = new uPlot(options, [[], []], host);
      entry.resize = new ResizeObserver(() => {
        if (!entry.closed && host.clientWidth > 0) entry.chart.setSize({
          width: Math.floor(host.clientWidth), height: Math.max(36, host.clientHeight - (detailed ? 32 : 0))
        });
      });
      entry.resize.observe(host);
      if (detailed) {
        entry.keydown = event => {
          if (event.target !== host) return;
          if (['+', '=', '-', 'Home'].includes(event.key)) event.preventDefault();
          if (event.key === '+' || event.key === '=') this.zoom(host, 0.5);
          if (event.key === '-') this.zoom(host, 2);
          if (event.key === 'Home') this.reset(host);
        };
        host.addEventListener('keydown', entry.keydown);
      }
      this.notify(entry);
    }
    Object.assign(entry, { history, now });
    const data = chartData(history, now, windowMs);
    const range = liveRange(now, windowMs, entry.zoomMs);
    entry.chart.batch(() => {
      entry.chart.setData(data, false);
      entry.chart.setScale('x', range);
      entry.chart.setScale('y', { min: null, max: null });
    });
    host.dataset.empty = String(!data[0].some((x, i) => data[1][i] != null && x >= range.min && x <= range.max));
  }
  zoom(host, factor) {
    const entry = this.entries.get(host);
    if (!entry) return;
    entry.zoomMs = Math.min(entry.windowMs, Math.max(1000, (entry.zoomMs ?? entry.windowMs) * factor));
    this.draw(host, entry.history, entry); this.notify(entry);
  }
  reset(host) {
    const entry = this.entries.get(host);
    if (!entry) return;
    entry.zoomMs = null;
    this.draw(host, entry.history, entry);
    this.notify(entry);
  }
  destroy(host) {
    const entry = this.entries.get(host);
    if (!entry) return;
    entry.closed = true; entry.resize.disconnect();
    if (entry.keydown) host.removeEventListener('keydown', entry.keydown);
    entry.chart.destroy(); this.entries.delete(host);
  }
  destroyAll() {
    for (const host of this.entries.keys()) this.destroy(host);
  }
}
