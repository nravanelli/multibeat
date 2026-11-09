import { startDashboard } from './src/app.js';
import markup from './src/view.js';

let mounted = null;

/** Mount one browser-local dashboard. No framework or build tools required. */
export async function mountHeartRateMonitor(container) {
  if (!(container instanceof HTMLElement)) throw new TypeError('Pass an HTML container element.');
  if (mounted) throw new Error('Only one heart rate dashboard may be mounted per page.');
  mounted = container;
  try {
    const root = container.shadowRoot || container.attachShadow({ mode: 'open' });
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = new URL('./styles.css', import.meta.url).href;
    const template = document.createElement('template');
    template.innerHTML = markup;
    root.replaceChildren(style, template.content.cloneNode(true));
    const controller = await startDashboard(root);
    let destroyed = false;
    return {
      recovery: controller.recovery,
      async destroy() {
        if (destroyed) return;
        destroyed = true;
        try { await controller.destroy(); }
        finally { root.replaceChildren(); mounted = null; }
      }
    };
  } catch (error) { mounted = null; throw error; }
}
