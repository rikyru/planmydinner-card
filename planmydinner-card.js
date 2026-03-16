/**
 * Plan My Dinner — Lovelace Custom Card
 * https://github.com/rikyru/planmydinner-card
 *
 * Config options:
 *   type: custom:planmydinner-card
 *   title: "Plan My Dinner"   # optional
 *   show_week: true            # week strip (default true)
 *   show_shopping: true        # shopping + pantry counts (default true)
 *   show_actions: true         # action buttons (default true)
 *   compact: false             # compact mode — meals only (default false)
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** Returns [Mon, Tue, ..., Sun] ISO strings for the week containing today */
function weekDaysForToday() {
  const ref = new Date();
  const dow = ref.getDay(); // 0=Sun
  const monday = new Date(ref);
  monday.setDate(ref.getDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

const DAY_LABELS = ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do'];

// ── Card ─────────────────────────────────────────────────────────────────────

class PlanMyDinnerCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._generating = false;
  }

  static getStubConfig() {
    return { title: 'Plan My Dinner' };
  }

  setConfig(config) {
    this._config = {
      title: 'Plan My Dinner',
      show_week: true,
      show_shopping: true,
      show_actions: true,
      compact: false,
      ...config,
    };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  // ── Sensor helpers ─────────────────────────────────────────────────────────

  _findSensor(suffix) {
    if (!this._hass) return null;
    const key = Object.keys(this._hass.states).find(
      id => id.startsWith('sensor.plan_my_dinner_') && id.endsWith(suffix)
    );
    return key ? this._hass.states[key] : null;
  }

  _todayMeals() {
    const s = this._findSensor('today');
    return s?.attributes?.meals || null; // { pranzo: [...], cena: [...] }
  }

  _weekDays() {
    const s = this._findSensor('week');
    return s?.attributes?.days || null; // { "2026-03-16": ["pranzo: ...", "cena: ..."] }
  }

  _shoppingCount() {
    const s = this._findSensor('shopping');
    return s ? parseInt(s.state, 10) || 0 : null;
  }

  _shoppingCategories() {
    const s = this._findSensor('shopping');
    return s?.attributes?.items_by_category || {};
  }

  _pantryCount() {
    const s = this._findSensor('pantry');
    return s ? parseInt(s.state, 10) || 0 : null;
  }

  _webUrl() {
    const s = this._findSensor('web_ui');
    return s ? s.state : null;
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async _callService(service) {
    if (!this._hass || this._generating) return;
    this._generating = true;
    this._render();
    try {
      await this._hass.callService('planmydinner', service, {});
    } catch (e) {
      console.error('[planmydinner-card] callService error:', e);
    } finally {
      this._generating = false;
      this._render();
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  _render() {
    const cfg = this._config;
    const meals = this._todayMeals();
    const today = todayISO();
    const webUrl = this._webUrl();
    const shoppingCount = this._shoppingCount();
    const pantryCount = this._pantryCount();
    const weekData = this._weekDays();
    const days = weekDaysForToday();

    const pranzo = (meals?.pranzo || []).filter(Boolean).join(', ') || null;
    const cena   = (meals?.cena   || []).filter(Boolean).join(', ') || null;

    // Shopping preview — up to 5 items across all categories
    const shopCats = this._shoppingCategories();
    const allShopItems = Object.values(shopCats).flat().slice(0, 5);

    // ── Week strip ────────────────────────────────────────────────────────
    let weekStripHTML = '';
    if (!cfg.compact && cfg.show_week !== false) {
      const dots = days.map((iso, i) => {
        const hasPlan = Array.isArray(weekData?.[iso]) && weekData[iso].length > 0;
        const isToday = iso === today;
        const isPast  = iso < today;
        let cls;
        if (isToday) cls = 'dot dot-today';
        else if (hasPlan && isPast) cls = 'dot dot-past';
        else if (hasPlan) cls = 'dot dot-ok';
        else cls = 'dot dot-empty';
        const tip = weekData?.[iso]?.join(' / ') || iso;
        return `<div class="week-day">
          <span class="day-label ${isToday ? 'day-today' : ''}">${DAY_LABELS[i]}</span>
          <span class="${cls}" title="${tip}"></span>
        </div>`;
      }).join('');
      weekStripHTML = `
        <hr class="divider" />
        <div class="section-title">Settimana</div>
        <div class="week-strip">${dots}</div>`;
    }

    // ── Shopping ──────────────────────────────────────────────────────────
    let shoppingHTML = '';
    if (!cfg.compact && cfg.show_shopping !== false && shoppingCount !== null) {
      const more = shoppingCount > 5 ? `<li class="shop-more">+${shoppingCount - 5} altri…</li>` : '';
      const itemsList = allShopItems.length
        ? `<ul class="shop-preview">${allShopItems.map(i =>
            `<li><span>${i.name}</span><span class="shop-qty">${i.quantity}${i.unit || 'g'}</span></li>`
          ).join('')}${more}</ul>`
        : '';
      shoppingHTML = `
        <hr class="divider" />
        <div class="badges">
          <span class="badge badge-shop">🛒 ${shoppingCount} articoli</span>
          ${pantryCount !== null ? `<span class="badge badge-pantry">🥫 ${pantryCount} in dispensa</span>` : ''}
        </div>
        ${itemsList}`;
    }

    // ── Actions ───────────────────────────────────────────────────────────
    let actionsHTML = '';
    if (!cfg.compact && cfg.show_actions !== false) {
      const dis = this._generating ? 'disabled' : '';
      const genLabel = this._generating ? '⏳ Generando…' : '⟳ Genera';
      const aiLabel  = this._generating ? '⏳ Generando…' : '🤖 AI';
      actionsHTML = `
        <hr class="divider" />
        <div class="actions">
          <button class="btn btn-algo" ${dis} id="btn-generate">${genLabel}</button>
          <button class="btn btn-ai"   ${dis} id="btn-generate-ai">${aiLabel}</button>
          ${webUrl ? `<a class="btn btn-open" href="${webUrl}/ui/" target="_blank">↗ Apri UI</a>` : ''}
        </div>`;
    }

    // ── Meal row helper ───────────────────────────────────────────────────
    const mealRow = (icon, label, name) => `
      <div class="meal-row">
        <span class="meal-icon">${icon}</span>
        <div class="meal-info">
          <span class="meal-label">${label}</span>
          <span class="meal-name ${name ? '' : 'meal-empty'}">${name || 'Nessun piano'}</span>
        </div>
      </div>`;

    // ── Full render ───────────────────────────────────────────────────────
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { overflow: hidden; }
        .card-content { padding: 16px; }

        /* Header */
        .header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 14px;
        }
        .card-title {
          font-size: 1.05em; font-weight: 700;
          color: var(--primary-text-color);
          display: flex; align-items: center; gap: 6px;
        }
        .header-link {
          font-size: 0.8em; color: var(--accent-color, #03a9f4);
          text-decoration: none; font-weight: 600;
          padding: 4px 10px; border-radius: 12px;
          border: 1px solid currentColor;
        }
        .header-link:hover { opacity: .75; }

        /* Date */
        .date-label {
          font-size: 0.75em; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.07em; color: var(--secondary-text-color);
          margin-bottom: 12px;
        }

        /* Meals */
        .meal-row {
          display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px;
        }
        .meal-icon { font-size: 1.25em; line-height: 1.4; flex-shrink: 0; }
        .meal-info { display: flex; flex-direction: column; gap: 1px; }
        .meal-label {
          font-size: 0.7em; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.06em; color: var(--secondary-text-color);
        }
        .meal-name { font-size: 0.9em; color: var(--primary-text-color); line-height: 1.35; }
        .meal-empty { color: var(--disabled-text-color, #aaa); font-style: italic; }

        /* Divider */
        .divider {
          border: none; border-top: 1px solid var(--divider-color, #e0e0e0); margin: 12px 0;
        }

        /* Week strip */
        .section-title {
          font-size: 0.7em; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.07em; color: var(--secondary-text-color); margin-bottom: 8px;
        }
        .week-strip {
          display: flex; justify-content: space-between; align-items: center;
        }
        .week-day { display: flex; flex-direction: column; align-items: center; gap: 5px; flex: 1; }
        .day-label { font-size: 0.68em; color: var(--secondary-text-color); font-weight: 500; }
        .day-today { color: var(--accent-color, #03a9f4); font-weight: 700; }
        .dot { width: 10px; height: 10px; border-radius: 50%; display: block; }
        .dot-ok    { background: var(--success-color, #4caf50); }
        .dot-today { background: var(--accent-color, #03a9f4);
                     box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color, #03a9f4) 25%, transparent); }
        .dot-past  { background: var(--secondary-text-color, #9e9e9e); opacity: .45; }
        .dot-empty { background: transparent; border: 1.5px solid var(--divider-color, #ccc); }

        /* Badges */
        .badges { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
        .badge {
          font-size: 0.78em; font-weight: 600; padding: 3px 10px;
          border-radius: 12px; white-space: nowrap;
        }
        .badge-shop   { background: var(--info-color, #039be5); color: #fff; }
        .badge-pantry { background: var(--success-color, #4caf50); color: #fff; }

        /* Shopping preview */
        .shop-preview {
          margin: 0; padding: 0; list-style: none;
          font-size: 0.82em; color: var(--primary-text-color);
        }
        .shop-preview li {
          display: flex; justify-content: space-between;
          padding: 3px 0; border-bottom: 1px solid var(--divider-color, #eee);
        }
        .shop-preview li:last-child { border-bottom: none; }
        .shop-qty { color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
        .shop-more { color: var(--secondary-text-color); font-style: italic; }

        /* Actions */
        .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .btn {
          font-size: 0.82em; font-weight: 600; padding: 7px 14px;
          border-radius: 8px; border: none; cursor: pointer;
          text-decoration: none; display: inline-flex; align-items: center;
          transition: opacity .15s;
        }
        .btn:hover:not([disabled]) { opacity: .82; }
        .btn[disabled] { opacity: .5; cursor: not-allowed; }
        .btn-algo { background: var(--primary-color, #4263eb); color: #fff; }
        .btn-ai   { background: linear-gradient(135deg, #1971c2, #0ca678); color: #fff; }
        .btn-open {
          background: var(--secondary-background-color, #f5f5f5);
          color: var(--primary-text-color);
          border: 1px solid var(--divider-color, #ccc);
        }
      </style>

      <ha-card>
        <div class="card-content">
          <div class="header">
            <div class="card-title">🍽️ ${cfg.title}</div>
            ${webUrl ? `<a class="header-link" href="${webUrl}/ui/" target="_blank">Apri UI ↗</a>` : ''}
          </div>

          <div class="date-label">Oggi — ${formatDateLabel(today)}</div>
          ${mealRow('☀️', 'Pranzo', pranzo)}
          ${mealRow('🌙', 'Cena', cena)}

          ${weekStripHTML}
          ${shoppingHTML}
          ${actionsHTML}
        </div>
      </ha-card>
    `;

    const btnGen = this.shadowRoot.getElementById('btn-generate');
    const btnAI  = this.shadowRoot.getElementById('btn-generate-ai');
    if (btnGen) btnGen.addEventListener('click', () => this._callService('generate_week'));
    if (btnAI)  btnAI.addEventListener('click',  () => this._callService('generate_week_ai'));
  }

  getCardSize() {
    const cfg = this._config || {};
    if (cfg.compact) return 2;
    let size = 3;
    if (cfg.show_week !== false) size += 1;
    if (cfg.show_shopping !== false) size += 1;
    if (cfg.show_actions !== false) size += 1;
    return size;
  }
}

// ── Card Editor (visual editor support) ──────────────────────────────────────

class PlanMyDinnerCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  _render() {
    const c = this._config || {};
    const toggle = (label, key, def = true) => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <input data-key="${key}" type="checkbox" ${(c[key] ?? def) ? 'checked' : ''}
               style="width:16px;height:16px;cursor:pointer" />
        <label style="font-size:14px;cursor:pointer">${label}</label>
      </div>`;

    this.innerHTML = `
      <div style="padding:16px">
        <div style="margin-bottom:12px">
          <label style="display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;color:#666">Titolo</label>
          <input data-key="title" type="text" value="${c.title ?? 'Plan My Dinner'}"
                 style="width:100%;padding:7px 10px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box" />
        </div>
        ${toggle('Mostra strip settimanale', 'show_week')}
        ${toggle('Mostra lista spesa e dispensa', 'show_shopping')}
        ${toggle('Mostra pulsanti azione', 'show_actions')}
        ${toggle('Modalità compatta (solo pasti)', 'compact', false)}
      </div>`;

    this.querySelectorAll('[data-key]').forEach(el => {
      el.addEventListener('change', () => {
        const upd = { ...this._config };
        upd[el.dataset.key] = el.type === 'checkbox' ? el.checked : el.value;
        this._config = upd;
        this.dispatchEvent(new CustomEvent('config-changed', {
          detail: { config: upd }, bubbles: true, composed: true,
        }));
      });
    });
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

customElements.define('planmydinner-card', PlanMyDinnerCard);
customElements.define('planmydinner-card-editor', PlanMyDinnerCardEditor);

PlanMyDinnerCard.getConfigElement = () => document.createElement('planmydinner-card-editor');

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'planmydinner-card',
  name: 'Plan My Dinner Card',
  description: 'Mostra i pasti del giorno, strip settimanale, lista spesa. Azioni: genera piano, AI, apri UI.',
  preview: false,
  documentationURL: 'https://github.com/rikyru/planmydinner-card',
});
