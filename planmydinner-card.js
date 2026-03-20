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

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatDateFull(iso) {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function formatDateShort(iso) {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString('it-IT', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

/** Returns [Mon…Sun] ISO strings for the week containing the given date */
function weekOf(iso) {
  const ref = new Date((iso || todayISO()) + 'T12:00:00');
  const dow = ref.getDay();
  const mon = new Date(ref);
  mon.setDate(ref.getDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
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
    this._selectedDate = todayISO();
    // Popup state
    this._popup = null;   // { date, mealType, loading, options, applying, error }
    // Profiles cache
    this._profiles = null;
  }

  static getStubConfig() { return { title: 'Plan My Dinner' }; }

  setConfig(config) {
    this._config = {
      title: 'Plan My Dinner',
      show_week: true,
      show_shopping: true,
      show_actions: true,
      compact: false,
      web_url: '',   // override the web_ui sensor — e.g. "https://planmydinner.example.com"
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

  _weekData() {
    // { "2026-03-16": ["pranzo: Pasta al tonno", "cena: Pollo arrosto"] }
    return this._findSensor('week')?.attributes?.days || {};
  }

  _mealsForDate(iso) {
    const day = this._weekData()[iso] || [];
    const pranzo = (day.find(s => s.startsWith('pranzo:')) || '').replace('pranzo:', '').trim() || null;
    const cena   = (day.find(s => s.startsWith('cena:'))   || '').replace('cena:',   '').trim() || null;
    return { pranzo, cena };
  }

  _shoppingCount() {
    const s = this._findSensor('shopping');
    return s ? parseInt(s.state, 10) || 0 : null;
  }

  _shoppingCategories() {
    return this._findSensor('shopping')?.attributes?.items_by_category || {};
  }

  _pantryCount() {
    const s = this._findSensor('pantry');
    return s ? parseInt(s.state, 10) || 0 : null;
  }

  _webUrl() {
    // 1. Config override takes priority (supports external URLs with auth, e.g. CF Zero Trust)
    if (this._config?.web_url) return this._config.web_url.replace(/\/$/, '');
    // 2. HA HTTP proxy — always accessible through HA's external URL, requires HA auth
    return window.location.origin + '/api/planmydinner';
  }

  // ── API helpers ────────────────────────────────────────────────────────────

  _fetchOpts() {
    // Include credentials so Cloudflare Zero Trust cookies are sent cross-origin
    return { credentials: 'include' };
  }

  _apiFetch(url, opts = {}) {
    // Use hass.fetchWithAuth for HA-relative URLs (adds bearer token — required for HA proxy)
    if (this._hass && url.startsWith(window.location.origin + '/api/')) {
      return this._hass.fetchWithAuth(url, opts);
    }
    return fetch(url, { ...this._fetchOpts(), ...opts });
  }

  async _getProfiles() {
    if (this._profiles) return this._profiles;

    // Prefer reading profile IDs from the week sensor attributes (no browser→backend call needed)
    const weekSensor = this._findSensor('week');
    const pA = weekSensor?.attributes?.profile_id_A;
    const pB = weekSensor?.attributes?.profile_id_B;
    if (pA) {
      this._profiles = [{ id: pA }, ...(pB ? [{ id: pB }] : [])];
      return this._profiles;
    }

    // Fallback: fetch directly from backend
    const base = this._webUrl();
    if (!base) return [];
    try {
      const r = await this._apiFetch(`${base}/profiles/`);
      if (!r.ok) return [];
      this._profiles = await r.json();
    } catch {
      return [];
    }
    return this._profiles || [];
  }

  async _openPopup(date, mealType) {
    const base = this._webUrl();
    if (!base) {
      alert('Configura web_url nella card (es. https://planmydinner.example.com)');
      return;
    }
    this._popup = { date, mealType, loading: true, options: [], applying: false, error: null };
    this._render();

    try {
      const profiles = await this._getProfiles();
      if (profiles.length < 1) throw new Error('Nessun profilo trovato. Verifica che web_url sia raggiungibile.');
      const pA = profiles[0].id;
      const pB = profiles[1]?.id || '';
      const params = new URLSearchParams({ profile_id_A: pA, profile_id_B: pB, meal_type: mealType, current_date: date });
      const r = await this._apiFetch(`${base}/planner/change-recipe?${params}`, { method: 'POST' });
      if (!r.ok) throw new Error(`Errore API ${r.status}: ${await r.text().then(t => t.slice(0,120))}`);
      const options = await r.json();
      this._popup = { date, mealType, loading: false, options, applying: false, error: null, pA, pB };
    } catch (e) {
      const msg = e.name === 'TypeError'
        ? `Impossibile raggiungere ${base}. Verifica web_url e che il server sia accessibile.`
        : e.message;
      this._popup = { date, mealType, loading: false, options: [], applying: false, error: msg, pA: '', pB: '' };
    }
    this._render();
  }

  async _applyOption(recipeId) {
    if (!this._popup || this._popup.applying) return;
    const { date, mealType, pA, pB } = this._popup;
    const base = this._webUrl();
    this._popup = { ...this._popup, applying: true, error: null };
    this._render();
    try {
      const params = new URLSearchParams({ profile_id_A: pA, profile_id_B: pB, meal_type: mealType, current_date: date, recipe_id: recipeId });
      const r = await this._apiFetch(`${base}/planner/apply-recipe-option?${params}`, { method: 'POST' });
      if (!r.ok) throw new Error(`Errore API ${r.status}`);
      this._popup = null;
      // Force HA coordinator refresh via service call (best effort)
      try { await this._hass.callService('homeassistant', 'update_entity', { entity_id: 'sensor.plan_my_dinner_week' }); } catch {}
    } catch (e) {
      this._popup = { ...this._popup, applying: false, error: e.message };
    }
    this._render();
  }

  // ── Generate actions ───────────────────────────────────────────────────────

  async _callService(service) {
    if (!this._hass || this._generating) return;
    this._generating = true;
    this._render();
    try { await this._hass.callService('planmydinner', service, {}); }
    catch (e) { console.error('[planmydinner-card]', e); }
    finally { this._generating = false; this._render(); }
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  _navDay(delta) {
    this._selectedDate = addDays(this._selectedDate, delta);
    this._render();
  }

  _selectDay(iso) {
    this._selectedDate = iso;
    this._render();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  _render() {
    const cfg = this._config;
    const today = todayISO();
    const sel = this._selectedDate;
    const webUrl = this._webUrl();
    const days = weekOf(sel);
    const weekData = this._weekData();
    const { pranzo, cena } = this._mealsForDate(sel);

    const shoppingCount = this._shoppingCount();
    const pantryCount   = this._pantryCount();
    const shopCats      = this._shoppingCategories();
    const allShopItems  = Object.values(shopCats).flat().slice(0, 5);

    // ── Week strip ────────────────────────────────────────────────────────
    let weekStripHTML = '';
    if (!cfg.compact && cfg.show_week !== false) {
      const dots = days.map((iso, i) => {
        const hasPlan = Array.isArray(weekData[iso]) && weekData[iso].length > 0;
        const isToday = iso === today;
        const isSel   = iso === sel;
        const isPast  = iso < today;
        let dotCls;
        if (isToday && isSel) dotCls = 'dot dot-today dot-selected';
        else if (isToday) dotCls = 'dot dot-today';
        else if (isSel)   dotCls = 'dot dot-selected';
        else if (hasPlan && isPast) dotCls = 'dot dot-past';
        else if (hasPlan) dotCls = 'dot dot-ok';
        else dotCls = 'dot dot-empty';
        return `<div class="week-day" data-iso="${iso}">
          <span class="day-label ${isSel ? 'day-sel' : ''}">${DAY_LABELS[i]}</span>
          <span class="${dotCls}"></span>
        </div>`;
      }).join('');
      weekStripHTML = `
        <hr class="divider" />
        <div class="week-strip">${dots}</div>`;
    }

    // ── Shopping ──────────────────────────────────────────────────────────
    let shoppingHTML = '';
    if (!cfg.compact && cfg.show_shopping !== false && shoppingCount !== null) {
      const more = shoppingCount > 5 ? `<li class="shop-more">+${shoppingCount - 5} altri…</li>` : '';
      const itemsList = allShopItems.length
        ? `<ul class="shop-preview">${allShopItems.map(i =>
            `<li><span>${i.name}</span><span class="shop-qty">${i.quantity}${i.unit || 'g'}</span></li>`
          ).join('')}${more}</ul>` : '';
      shoppingHTML = `
        <hr class="divider" />
        <div class="badges">
          <span class="badge badge-shop">🛒 ${shoppingCount} articoli</span>
          ${pantryCount !== null ? `<span class="badge badge-pantry">🥫 ${pantryCount} in dispensa</span>` : ''}
        </div>${itemsList}`;
    }

    // ── Actions ───────────────────────────────────────────────────────────
    let actionsHTML = '';
    if (!cfg.compact && cfg.show_actions !== false) {
      const dis = this._generating ? 'disabled' : '';
      actionsHTML = `
        <hr class="divider" />
        <div class="actions">
          <button class="btn btn-algo" ${dis} id="btn-gen">
            ${this._generating ? '⏳ Generando…' : '⟳ Genera'}
          </button>
          <button class="btn btn-ai" ${dis} id="btn-ai">
            ${this._generating ? '⏳ Generando…' : '🤖 AI'}
          </button>
        </div>`;
    }

    // ── Popup ─────────────────────────────────────────────────────────────
    let popupHTML = '';
    if (this._popup) {
      const p = this._popup;
      const mealLabel = p.mealType === 'pranzo' ? '☀️ Pranzo' : '🌙 Cena';
      let body;
      if (p.loading) {
        body = `<div class="popup-loading">⏳ Caricamento alternative…</div>`;
      } else if (p.error) {
        body = `<div class="popup-error">${p.error}</div>`;
      } else if (!p.options.length) {
        body = `<div class="popup-empty">Nessuna alternativa trovata.</div>`;
      } else {
        body = `<ul class="option-list">
          ${p.options.map(o => `
            <li class="option-item ${p.applying ? 'applying' : ''}" data-id="${o.recipe_id}">
              <div class="option-name">${o.name}</div>
              <div class="option-meta">${o.total_time_minutes}min · ${o.difficulty}</div>
            </li>`).join('')}
        </ul>
        ${p.applying ? `<div class="popup-loading">⏳ Applicando…</div>` : ''}`;
      }
      popupHTML = `
        <div class="popup-overlay" id="popup-overlay">
          <div class="popup">
            <div class="popup-header">
              <span>${mealLabel} — ${formatDateShort(p.date)}</span>
              <button class="popup-close" id="popup-close">✕</button>
            </div>
            <div class="popup-title">Scegli una ricetta alternativa</div>
            ${body}
          </div>
        </div>`;
    }

    // ── Meal card (clickable) ─────────────────────────────────────────────
    const mealCard = (icon, label, name, mealType) => `
      <div class="meal-card ${webUrl ? 'meal-clickable' : ''}" data-meal="${mealType}">
        <div class="meal-row">
          <span class="meal-icon">${icon}</span>
          <div class="meal-info">
            <span class="meal-label">${label}</span>
            <span class="meal-name ${name ? '' : 'meal-empty'}">${name || 'Nessun piano'}</span>
          </div>
          ${webUrl && name ? `<span class="meal-change-hint">↺</span>` : ''}
        </div>
      </div>`;

    // ── Full HTML ─────────────────────────────────────────────────────────
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { overflow: hidden; }
        .card-content { padding: 16px; }

        /* Header */
        .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        .card-title { font-size: 1.05em; font-weight: 700; color: var(--primary-text-color); }
        .header-link {
          font-size: 0.8em; color: var(--accent-color, #03a9f4);
          text-decoration: none; font-weight: 600;
          padding: 4px 10px; border-radius: 12px; border: 1px solid currentColor;
        }
        .header-link:hover { opacity: .75; }

        /* Day navigator */
        .day-nav {
          display: flex; align-items: center; gap: 6px; margin-bottom: 12px;
        }
        .nav-btn {
          background: var(--secondary-background-color, #f5f5f5);
          border: 1px solid var(--divider-color, #ddd);
          border-radius: 8px; padding: 4px 10px; cursor: pointer; font-size: 1em;
          color: var(--primary-text-color); flex-shrink: 0;
        }
        .nav-btn:hover { background: var(--divider-color, #e0e0e0); }
        .day-label-full {
          flex: 1; text-align: center;
          font-size: 0.82em; font-weight: 700; text-transform: capitalize;
          color: var(--primary-text-color);
        }
        .day-today-badge {
          font-size: 0.7em; font-weight: 600;
          background: var(--accent-color, #03a9f4); color: #fff;
          padding: 2px 7px; border-radius: 10px; margin-left: 4px;
          vertical-align: middle;
        }

        /* Meal cards */
        .meal-card { border-radius: 8px; margin-bottom: 8px; }
        .meal-card.meal-clickable {
          cursor: pointer;
          transition: background .15s;
          padding: 6px 8px; margin: 0 -8px 8px;
          border-radius: 8px;
        }
        .meal-card.meal-clickable:hover { background: var(--secondary-background-color, #f5f5f5); }
        .meal-row { display: flex; align-items: center; gap: 10px; }
        .meal-icon { font-size: 1.25em; flex-shrink: 0; }
        .meal-info { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .meal-label {
          font-size: 0.7em; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.06em; color: var(--secondary-text-color);
        }
        .meal-name {
          font-size: 0.9em; color: var(--primary-text-color);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .meal-empty { color: var(--disabled-text-color, #aaa); font-style: italic; }
        .meal-change-hint {
          font-size: 1em; color: var(--secondary-text-color); flex-shrink: 0; opacity: .5;
        }
        .meal-card.meal-clickable:hover .meal-change-hint { opacity: 1; color: var(--accent-color, #03a9f4); }

        /* Divider */
        .divider { border: none; border-top: 1px solid var(--divider-color, #e0e0e0); margin: 10px 0; }

        /* Week strip */
        .week-strip { display: flex; justify-content: space-between; }
        .week-day { display: flex; flex-direction: column; align-items: center; gap: 5px; flex: 1; cursor: pointer; padding: 4px 0; border-radius: 6px; }
        .week-day:hover { background: var(--secondary-background-color, #f5f5f5); }
        .day-label { font-size: 0.68em; color: var(--secondary-text-color); font-weight: 500; }
        .day-sel { color: var(--accent-color, #03a9f4); font-weight: 700; }
        .dot { width: 10px; height: 10px; border-radius: 50%; }
        .dot-ok       { background: var(--success-color, #4caf50); }
        .dot-today    { background: var(--accent-color, #03a9f4); }
        .dot-selected { outline: 2px solid var(--accent-color, #03a9f4); outline-offset: 2px; }
        .dot-past     { background: var(--secondary-text-color, #9e9e9e); opacity: .45; }
        .dot-empty    { background: transparent; border: 1.5px solid var(--divider-color, #ccc); }

        /* Badges */
        .badges { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
        .badge { font-size: 0.78em; font-weight: 600; padding: 3px 10px; border-radius: 12px; white-space: nowrap; }
        .badge-shop   { background: var(--info-color, #039be5); color: #fff; }
        .badge-pantry { background: var(--success-color, #4caf50); color: #fff; }

        /* Shopping preview */
        .shop-preview { margin: 0; padding: 0; list-style: none; font-size: 0.82em; color: var(--primary-text-color); }
        .shop-preview li { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid var(--divider-color, #eee); }
        .shop-preview li:last-child { border-bottom: none; }
        .shop-qty { color: var(--secondary-text-color); }
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

        /* Popup */
        .popup-overlay {
          position: fixed; inset: 0; z-index: 9999;
          background: rgba(0,0,0,.45);
          display: flex; align-items: flex-end; justify-content: center;
        }
        @media (min-width: 500px) {
          .popup-overlay { align-items: center; }
        }
        .popup {
          background: var(--card-background-color, #fff);
          border-radius: 16px 16px 0 0;
          width: 100%; max-width: 480px; max-height: 75vh;
          overflow-y: auto;
          padding: 20px;
          box-shadow: 0 -4px 24px rgba(0,0,0,.2);
        }
        @media (min-width: 500px) {
          .popup { border-radius: 16px; }
        }
        .popup-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 4px;
          font-size: 0.8em; font-weight: 700; text-transform: uppercase;
          letter-spacing: .06em; color: var(--secondary-text-color);
        }
        .popup-close {
          background: none; border: none; cursor: pointer; font-size: 1.1em;
          color: var(--secondary-text-color); padding: 0; line-height: 1;
        }
        .popup-title {
          font-size: 1em; font-weight: 600; color: var(--primary-text-color);
          margin-bottom: 14px;
        }
        .popup-loading, .popup-empty {
          text-align: center; color: var(--secondary-text-color);
          font-size: 0.9em; padding: 20px 0;
        }
        .popup-error {
          color: var(--error-color, #c92a2a); font-size: 0.88em;
          background: var(--error-color-background, #fff5f5);
          border-radius: 8px; padding: 10px 14px; margin-bottom: 8px;
        }
        .option-list { list-style: none; margin: 0; padding: 0; }
        .option-item {
          display: flex; justify-content: space-between; align-items: center;
          padding: 12px 14px; margin-bottom: 6px;
          border: 1px solid var(--divider-color, #e0e0e0);
          border-radius: 10px; cursor: pointer;
          transition: background .15s, border-color .15s;
        }
        .option-item:hover:not(.applying) {
          background: color-mix(in srgb, var(--accent-color, #03a9f4) 8%, transparent);
          border-color: var(--accent-color, #03a9f4);
        }
        .option-item.applying { opacity: .5; cursor: not-allowed; pointer-events: none; }
        .option-name { font-size: 0.92em; font-weight: 600; color: var(--primary-text-color); }
        .option-meta { font-size: 0.78em; color: var(--secondary-text-color); margin-top: 2px; }
      </style>

      <ha-card>
        <div class="card-content">
          <!-- Header -->
          <div class="header">
            <div class="card-title">🍽️ ${cfg.title}</div>
            ${webUrl ? `<a class="header-link" href="${webUrl}/ui/" target="_blank">↗ Apri UI</a>` : ''}
          </div>

          <!-- Day navigator -->
          <div class="day-nav">
            <button class="nav-btn" id="nav-prev">‹</button>
            <span class="day-label-full">
              ${formatDateFull(sel)}
              ${sel === today ? '<span class="day-today-badge">oggi</span>' : ''}
            </span>
            <button class="nav-btn" id="nav-next">›</button>
          </div>

          <!-- Meals for selected day -->
          ${mealCard('☀️', 'Pranzo', pranzo, 'pranzo')}
          ${mealCard('🌙', 'Cena', cena, 'cena')}

          ${weekStripHTML}
          ${shoppingHTML}
          ${actionsHTML}
        </div>
      </ha-card>

      ${popupHTML}
    `;

    // ── Bind events ───────────────────────────────────────────────────────
    this.shadowRoot.getElementById('nav-prev')?.addEventListener('click', () => this._navDay(-1));
    this.shadowRoot.getElementById('nav-next')?.addEventListener('click', () => this._navDay(1));

    // Week strip dots
    this.shadowRoot.querySelectorAll('.week-day[data-iso]').forEach(el => {
      el.addEventListener('click', () => this._selectDay(el.dataset.iso));
    });

    // Meal cards — open popup
    if (webUrl) {
      this.shadowRoot.querySelectorAll('.meal-card[data-meal]').forEach(el => {
        el.addEventListener('click', () => {
          const mt = el.dataset.meal;
          const meals = this._mealsForDate(this._selectedDate);
          if (!meals[mt]) return; // no plan for this slot
          this._openPopup(this._selectedDate, mt);
        });
      });
    }

    // Popup close
    this.shadowRoot.getElementById('popup-overlay')?.addEventListener('click', e => {
      if (e.target.id === 'popup-overlay') { this._popup = null; this._render(); }
    });
    this.shadowRoot.getElementById('popup-close')?.addEventListener('click', () => {
      this._popup = null; this._render();
    });

    // Option items
    this.shadowRoot.querySelectorAll('.option-item[data-id]').forEach(el => {
      el.addEventListener('click', () => this._applyOption(el.dataset.id));
    });

    // Generate buttons
    this.shadowRoot.getElementById('btn-gen')?.addEventListener('click', () => this._callService('generate_week'));
    this.shadowRoot.getElementById('btn-ai')?.addEventListener('click',  () => this._callService('generate_week_ai'));
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

// ── Card Editor ───────────────────────────────────────────────────────────────

class PlanMyDinnerCardEditor extends HTMLElement {
  setConfig(config) { this._config = config; this._render(); }

  _render() {
    const c = this._config || {};
    const toggle = (label, key, def = true) => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <input data-key="${key}" type="checkbox" ${(c[key] ?? def) ? 'checked' : ''}
               style="width:16px;height:16px;cursor:pointer" />
        <label style="font-size:14px;cursor:pointer">${label}</label>
      </div>`;
    const field = (label, key, placeholder = '') => `
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;color:#666">${label}</label>
        <input data-key="${key}" type="text" value="${c[key] ?? ''}" placeholder="${placeholder}"
               style="width:100%;padding:7px 10px;border:1px solid #ccc;border-radius:6px;font-size:14px;box-sizing:border-box" />
      </div>`;
    this.innerHTML = `
      <div style="padding:16px">
        ${field('Titolo', 'title', 'Plan My Dinner')}
        ${field('URL Web UI (opzionale)', 'web_url', 'https://planmydinner.example.com')}
        <div style="font-size:11px;color:#888;margin-top:-8px;margin-bottom:12px">
          Lascia vuoto per usare il sensore HA. Imposta l'URL completo per accessi esterni o Cloudflare Zero Trust.
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
  description: 'Navigazione giornaliera, cambio ricetta, lista spesa. Azioni: genera piano, AI, apri UI.',
  preview: false,
  documentationURL: 'https://github.com/rikyru/planmydinner-card',
});
