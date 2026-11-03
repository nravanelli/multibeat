export const MAX_TREND_MS = 30 * 60 * 1000;

/** Keep a bounded, one-point-per-second display history; recording keeps every sample. */
export function appendTrend(history, at, bpm) {
  const last = history.at(-1);
  const point = { at, bpm };
  if (last && Math.floor(last.at / 1000) === Math.floor(at / 1000)) history[history.length - 1] = point;
  else history.push(point);
  while (history.length && history[0].at < at - MAX_TREND_MS) history.shift();
}

export function trendModel(history, now, windowMs) {
  const points = history.filter(p => p.at >= now - windowMs && p.at <= now);
  const min = points.length ? Math.max(0, Math.floor(Math.min(...points.map(p => p.bpm)) - 8)) : 40;
  const max = points.length ? Math.ceil(Math.max(...points.map(p => p.bpm)) + 8) : 140;
  const segments = [];
  let previous;
  for (const point of points) {
    if (!previous || point.at - previous.at > 5000) segments.push([]);
    segments.at(-1).push({ x: 1 - (now - point.at) / windowMs, y: (point.bpm - min) / (max - min), ...point });
    previous = point;
  }
  return { min, max, segments, count: points.length };
}

export function drawTrend(canvas, history, { now, windowMs = 60000, detailed = false, simulated = false }) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width, height = canvas.height;
  const padding = detailed ? { left: 52, right: 18, top: 24, bottom: 36 } : { left: 2, right: 2, top: 6, bottom: 6 };
  const plotWidth = width - padding.left - padding.right, plotHeight = height - padding.top - padding.bottom;
  const model = trendModel(history, now, windowMs);
  ctx.clearRect(0, 0, width, height);
  ctx.font = '12px sans-serif';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 2; i++) {
    const y = padding.top + plotHeight * i / 2;
    ctx.strokeStyle = '#e2e9e3'; ctx.beginPath(); ctx.moveTo(padding.left, y); ctx.lineTo(width - padding.right, y); ctx.stroke();
    if (detailed) {
      ctx.fillStyle = '#647874'; ctx.textAlign = 'right'; ctx.fillText(String(Math.round(model.max - (model.max - model.min) * i / 2)), padding.left - 9, y + 4);
    }
  }
  if (detailed) {
    ctx.textAlign = 'left'; ctx.fillText('bpm', 10, 14);
    for (let i = 0; i <= 4; i++) {
      const ago = windowMs * (1 - i / 4) / 1000;
      const label = ago === 0 ? 'Now' : ago >= 60 ? `${+(ago / 60).toFixed(1)} min ago` : `${ago}s ago`;
      ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
      ctx.fillText(label, padding.left + plotWidth * i / 4, height - 10);
    }
  }
  ctx.strokeStyle = simulated ? '#9676ad' : '#358065'; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = detailed ? 2.5 : 2;
  for (const segment of model.segments) {
    ctx.beginPath();
    segment.forEach((point, i) => {
      const x = padding.left + plotWidth * point.x, y = padding.top + plotHeight * (1 - point.y);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    if (segment.length === 1) {
      const point = segment[0]; ctx.beginPath();
      ctx.arc(padding.left + plotWidth * point.x, padding.top + plotHeight * (1 - point.y), 2.5, 0, Math.PI * 2); ctx.fill();
    }
  }
  if (!model.count && detailed) {
    ctx.fillStyle = '#647874'; ctx.textAlign = 'center'; ctx.fillText('No readings in this time window', padding.left + plotWidth / 2, padding.top + plotHeight / 2);
  }
}
