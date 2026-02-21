/**
 * ZoneWidget — self-contained embeddable widget (OSM/Leaflet + Draw)
 * - Export/import
 * - Modes: edit/view
 * - Limit zones, hides drawing toolbar when limit reached
 * - Click mini-card => focus on zone on main map
 */
(function (global) {
  const ZoneWidget = {
    async mount(target, userOptions = {}) {
      const el = (typeof target === "string") ? document.querySelector(target) : target;
      if (!el) throw new Error("ZoneWidget: target not found");

      // ==== OPTIONS (defaults)
      const options = {
        limit: 4,
        center: [43.238949, 76.889709],
        zoom: 12,
        mode: "edit", // "edit" | "view"
        height: 360,
        ...userOptions
      };

      // ==== Load deps (Leaflet + Draw) only once
      await ensureLeafletAndDraw();

      // ==== Unique scope for multi-instances
      const uid = "zw_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);

      // ==== State (NO persistence)
      const state = {
        mode: options.mode,
        zones: [] // { id, createdAt, geojson, center, zoom }
      };

      // ==== Render HTML
      el.innerHTML = buildHTML(uid, options.height);
      const root = el.querySelector(`#${uid}_root`);

      // ==== Inject CSS once per document
      injectCSSOnce();

      // ==== DOM refs
      const mapEl = root.querySelector(`#${uid}_map`);
      const gridEl = root.querySelector(`#${uid}_grid`);
      const hintEl = root.querySelector(`#${uid}_hint`);

      const editActions = root.querySelector(`#${uid}_editActions`);
      const viewActions = root.querySelector(`#${uid}_viewActions`);

      const btnExport = root.querySelector(`#${uid}_btnExport`);
      const btnClearAll = root.querySelector(`#${uid}_btnClearAll`);
      const fileImport = root.querySelector(`#${uid}_fileImport`);

      const btnToggleMode = root.querySelector(`#${uid}_btnToggleMode`);

      // ==== Map init
      const map = L.map(mapEl, { zoomControl: true }).setView(options.center, options.zoom);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors | A01L"
      }).addTo(map);

      map.attributionControl.setPrefix(false);

      const zonesLayer = new L.FeatureGroup();
      map.addLayer(zonesLayer);

      const drawn = new L.FeatureGroup();
      map.addLayer(drawn);

      const drawControl = new L.Control.Draw({
        position: "topleft",
        draw: {
          polygon: { allowIntersection: false, showArea: true },
          rectangle: true,
          circle: false,
          circlemarker: false,
          marker: false,
          polyline: false
        },
        edit: false
      });

      // ==== Helpers
      const makeId = () => "z_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);

      function fmtTime(ts) {
        const d = new Date(ts);
        const pad = (n) => String(n).padStart(2, "0");
        return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }

      function setHint(msg, warn = false) {
        hintEl.innerHTML = msg;
        hintEl.classList.toggle("warn", !!warn);
      }

      function safeBoundsFromGeo(geojson) {
        try {
          const layer = L.geoJSON(geojson);
          const b = layer.getBounds();
          if (b && b.isValid()) return b;
        } catch {}
        return null;
      }

      function focusZone(zone) {
        if (!zone) return;
        const b = safeBoundsFromGeo(zone.geojson);
        if (b) map.fitBounds(b, { padding: [30, 30] });
        else map.setView(zone.center, zone.zoom || 14);
      }

      function focusZoneById(id) {
        const zone = state.zones.find(z => z.id === id);
        if (zone) focusZone(zone);
      }

      // Render zones on main map (always)
      function renderZonesOnMain() {
        zonesLayer.clearLayers();
        drawn.clearLayers();

        state.zones.forEach((z) => {
          const style = () => ({ weight: 3, opacity: 1, fillOpacity: 0.15 });

          zonesLayer.addLayer(L.geoJSON(z.geojson, { style }));
          // editable copy (only matters in edit mode)
          drawn.addLayer(L.geoJSON(z.geojson, { style }));
        });
      }

      // Render mini grid
      function renderGrid() {
        gridEl.innerHTML = "";
        if (!state.zones.length) {
          gridEl.innerHTML = `<div class="zw-empty" style="grid-column:1/-1;">Пока пусто. Импортируйте JSON или создайте зону (в edit mode).</div>`;
          return;
        }

        state.zones.forEach((z, i) => {
          const card = document.createElement("div");
          card.className = "zw-card";
          card.setAttribute("data-zone", z.id);
          card.title = "Нажмите чтобы сфокусироваться на зоне";

          const miniId = `${uid}_mini_${z.id}`;

          const delBtn = (state.mode === "edit")
            ? `<button class="zw-del" type="button" data-del="${z.id}" title="Удалить">✕</button>`
            : `<span style="width:28px;"></span>`;

          card.innerHTML = `
            <div id="${miniId}" class="zw-mini"></div>
            <div class="zw-cardbar">
              <span class="zw-badge">#${i + 1}</span>
              <span class="zw-time" title="Дата">${fmtTime(z.createdAt)}</span>
              ${delBtn}
            </div>
          `;

          gridEl.appendChild(card);

          // mini map (non-interactive)
          const mini = L.map(miniId, {
            attributionControl: false,
            zoomControl: false,
            dragging: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            boxZoom: false,
            keyboard: false,
            tap: false,
            touchZoom: false
          }).setView(z.center, z.zoom);

          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(mini);

          const gj = L.geoJSON(z.geojson, { style: () => ({ weight: 3, opacity: 1, fillOpacity: 0.15 }) }).addTo(mini);
          try {
            const b = gj.getBounds();
            if (b.isValid()) mini.fitBounds(b, { padding: [10, 10] });
          } catch {}
        });
      }

      function applyDrawAvailability() {
        const limitReached = state.zones.length >= options.limit;
        const showDrawUI = (state.mode === "edit") && !limitReached;

        root.classList.toggle("zw-draw-hidden", !showDrawUI);

        if (state.mode === "edit" && limitReached) {
          setHint(`<div>Лимит зон достигнут! Максимум: <b>${options.limit}</b>. Удалите не нужную зону, чтобы добавить новую.</div> <div class="leaflet-control-attribution-show">Leaflet | © OpenStreetMap contributors | A01L</div>`, true);
        } else if (state.mode === "edit") {
          setHint(`<div>Рисуйте область (полигон/прямоугольник). Лимит: <b>${options.limit}</b>.</div> <div class="leaflet-control-attribution-show">Leaflet | © OpenStreetMap contributors | A01L</div>`, false);
        } else {
          setHint(`<div>Режим просмотра: перемещайте карту, масштабируйте, кликайте по мини-картам для фокуса.</div> <div class="leaflet-control-attribution-show">Leaflet | © OpenStreetMap contributors | A01L</div>`, false);
        }

        editActions.style.display = (state.mode === "edit") ? "flex" : "none";
        viewActions.style.display = (state.mode === "view") ? "flex" : "none";
      }

      function applyMode() {
        // remove draw control safely
        try { map.removeControl(drawControl); } catch {}
        if (state.mode === "edit") map.addControl(drawControl);

        renderZonesOnMain();
        renderGrid();
        applyDrawAvailability();
      }

      // ==== Draw create event
      map.on(L.Draw.Event.CREATED, (evt) => {
        if (state.mode !== "edit") return;
        if (state.zones.length >= options.limit) {
          applyDrawAvailability();
          return;
        }

        const layer = evt.layer;
        drawn.addLayer(layer);

        const geo = layer.toGeoJSON();
        const b = safeBoundsFromGeo(geo);
        const center = b ? [b.getCenter().lat, b.getCenter().lng] : [map.getCenter().lat, map.getCenter().lng];
        const zoom = Math.min(map.getZoom(), 17);

        state.zones.push({
          id: makeId(),
          createdAt: Date.now(),
          geojson: geo,
          center,
          zoom
        });

        applyMode();
        focusZone(state.zones[state.zones.length - 1]);
      });

      // ==== Grid click: delete/focus
      gridEl.addEventListener("click", (e) => {
        const del = e.target.closest("[data-del]");
        if (del) {
          if (state.mode !== "edit") return;
          const id = del.getAttribute("data-del");
          const idx = state.zones.findIndex(z => z.id === id);
          if (idx >= 0) state.zones.splice(idx, 1);
          applyMode();
          return;
        }
        const card = e.target.closest("[data-zone]");
        if (card) focusZoneById(card.getAttribute("data-zone"));
      });

      // ==== Export / Import (only in edit)
      btnExport.addEventListener("click", () => {
        if (state.mode !== "edit") return;
        const payload = {
          version: 1,
          exportedAt: new Date().toISOString(),
          meta: { limit: options.limit, center: options.center, zoom: options.zoom },
          zones: state.zones
        };
        downloadJson(`zones_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.json`, payload);
      });

      fileImport.addEventListener("change", async (e) => {
        if (state.mode !== "edit") { e.target.value = ""; return; }
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;

        try {
          const text = await file.text();
          const json = JSON.parse(text);
          const imported = normalizeImport(json, options.limit);

          state.zones = imported;
          applyMode();
          if (state.zones[0]) focusZone(state.zones[0]);
          setHint(`<div>Импорт выполнен. Загружено: <b>${state.zones.length}</b> / ${options.limit}.</div> <div class="leaflet-control-attribution-show">Leaflet | © OpenStreetMap contributors | A01L</div>`, false);
        } catch (err) {
          setHint(`Ошибка импорта: ${String(err.message || err)}`, true);
        }
      });

      btnClearAll.addEventListener("click", () => {
        if (state.mode !== "edit") return;
        state.zones = [];
        applyMode();
      });

      // ==== 5) test mode toggle
      btnToggleMode.addEventListener("click", () => {
        state.mode = (state.mode === "edit") ? "view" : "edit";
        applyMode();
      });

      // ==== Init
      applyMode();

      // ==== Public API for host apps
      return {
        setMode(newMode) {
          state.mode = (newMode === "view") ? "view" : "edit";
          applyMode();
        },
        setZones(zonesPayload) {
          state.zones = normalizeImport(zonesPayload, options.limit);
          applyMode();
        },
        getZones() {
          return JSON.parse(JSON.stringify(state.zones));
        },
        focus(id) { focusZoneById(id); }
      };
    }
  };

  // ============ Utilities (shared)
  function buildHTML(uid, height) {
    return `
      <div id="${uid}_root" class="zw-root">
        <div class="zw-map-wrap">
          <div class="zw-topbar">
            <div class="zw-title">Зоны на карте</div>

            <div class="zw-actions" id="${uid}_editActions">
              <button class="zw-btn" id="${uid}_btnExport" type="button">Export JSON</button>
              <label class="zw-btn zw-btn-file" title="Импорт JSON">
                Import JSON
                <input id="${uid}_fileImport" type="file" accept="application/json" hidden>
              </label>
              <button class="zw-btn" id="${uid}_btnClearAll" type="button">Очистить всё</button>
            </div>

            <div class="zw-actions" id="${uid}_viewActions" style="display:none;">
              <span class="zw-chip">View mode</span>
            </div>
          </div>

          <div id="${uid}_map" class="zw-map" style="height:${height}px;"></div>
          <div class="zw-hint" id="${uid}_hint"></div>
        </div>

        <div class="zw-grid-wrap">
          <div class="zw-grid-title">Сохранённые зоны</div>
          <div id="${uid}_grid" class="zw-grid"></div>
        </div>

        <div class="zw-footer">
          <button class="zw-btn zw-btn-wide" id="${uid}_btnToggleMode" type="button">
            Переключить режим (edit/view)
          </button>
        </div>
      </div>
    `;
  }

  function normalizeImport(payload, limit) {
    const raw = Array.isArray(payload) ? payload : payload?.zones;
    if (!Array.isArray(raw)) throw new Error("Неверный формат: ожидался массив zones или {zones:[]}");
    return raw.slice(0, limit).map((z) => {
      if (!z?.geojson) throw new Error("В записи нет geojson");
      return {
        id: z.id || ("z_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16)),
        createdAt: Number(z.createdAt) || Date.now(),
        geojson: z.geojson,
        center: Array.isArray(z.center) ? z.center : null,
        zoom: Number(z.zoom) || 14
      };
    }).map((z) => {
      // if center missing, try infer from bounds (when Leaflet available)
      if (z.center) return z;
      try {
        const b = L.geoJSON(z.geojson).getBounds();
        if (b && b.isValid()) z.center = [b.getCenter().lat, b.getCenter().lng];
      } catch {}
      if (!z.center) z.center = [43.238949, 76.889709];
      return z;
    });
  }

  function downloadJson(filename, dataObj) {
    const blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Load Leaflet + Draw from CDN once
  function ensureLeafletAndDraw() {
    return new Promise(async (resolve, reject) => {
      try {
        // Leaflet
        if (!global.L) {
          await loadCSSOnce("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "zw_leaflet_css");
          await loadScriptOnce("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "zw_leaflet_js");
        }
        // Draw
        const hasDraw = global.L && global.L.Control && global.L.Control.Draw;
        if (!hasDraw) {
          await loadCSSOnce("https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css", "zw_draw_css");
          await loadScriptOnce("https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js", "zw_draw_js");
        }
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  function loadCSSOnce(href, id) {
    return new Promise((resolve) => {
      if (document.getElementById(id)) return resolve();
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = href;
      link.onload = () => resolve();
      link.onerror = () => resolve(); // мягко
      document.head.appendChild(link);
    });
  }

  function loadScriptOnce(src, id) {
    return new Promise((resolve, reject) => {
      if (document.getElementById(id)) return resolve();
      const s = document.createElement("script");
      s.id = id;
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load: " + src));
      document.head.appendChild(s);
    });
  }

  function injectCSSOnce() {
    if (document.getElementById("zw_base_css")) return;
    const style = document.createElement("style");
    style.id = "zw_base_css";
    style.textContent = `
      .zw-root{ max-width:980px; margin:0 auto; padding:14px; font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; }
      .zw-map-wrap{ background:#efefef; border:1px solid #ddd; border-radius:14px; overflow:hidden; box-shadow:0 6px 24px rgba(0,0,0,.08); }
      .zw-topbar{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; background:#f7f7f7; border-bottom:1px solid #e0e0e0; flex-wrap:wrap; }
      .zw-title{ font-weight:700; letter-spacing:.2px; }
      .zw-actions{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
      .zw-btn{ border:1px solid #cfcfcf; background:#fff; padding:8px 10px; border-radius:10px; cursor:pointer; font-weight:600; user-select:none; }
      .zw-btn:hover{ filter:brightness(.98); }
      .zw-btn:disabled{ opacity:.55; cursor:not-allowed; }
      .zw-btn-file{ display:inline-flex; align-items:center; }
      .zw-chip{ display:inline-flex; align-items:center; border:1px solid #d9d9d9; background:#fff; padding:6px 10px; border-radius:999px; font-weight:700; font-size:12px; color:#444; }
      .zw-map{ background:#cfcfcf; }
      .zw-hint{ padding:10px 12px; font-size:13px; color:#555; background:#f7f7f7; border-top:1px solid #e0e0e0; justify-content: space-between; display: flex;}
      .zw-hint.warn{ color:#7a4b00; }
      .zw-grid-wrap{ margin-top:12px; background:#efefef; border:1px solid #ddd; border-radius:14px; padding:12px; }
      .zw-grid-title{ font-weight:700; margin-bottom:10px; }
      .zw-grid{ display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:10px; }
      .zw-card{ background:#fff; border:1px solid #e0e0e0; border-radius:12px; overflow:hidden; box-shadow:0 6px 18px rgba(0,0,0,.06); cursor:pointer; }
      .zw-mini{ height:120px; background:#d9d9d9; }
      .zw-cardbar{ display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 10px; font-size:12px; color:#444; border-top:1px solid #eee; }
      .zw-badge{ font-weight:700; background:#f2f2f2; border:1px solid #e6e6e6; padding:4px 8px; border-radius:999px; white-space:nowrap; }
      .zw-del{ border:1px solid #e6e6e6; background:#fff; padding:5px 8px; border-radius:10px; cursor:pointer; font-weight:900; line-height:1; }
      .zw-del:hover{ background:#fafafa; }
      .zw-empty{ color:#666; padding:10px 4px; }
      .zw-footer{ margin-top:12px; display:flex; justify-content:flex-end; }
      .zw-btn-wide{ width:100%; }
      .zw-draw-hidden .leaflet-draw{ display:none !important; }
      @media (max-width:920px){ .zw-grid{ grid-template-columns:repeat(2, minmax(0,1fr)); } }
      @media (max-width:520px){ .zw-grid{ grid-template-columns:1fr; } }
    `;
    document.head.appendChild(style);
  }

  // Expose
  global.ZoneWidget = ZoneWidget;
})(window);

function localizeLeafletDrawRU() {
if (!window.L || !L.drawLocal) return;

Object.assign(L.drawLocal.draw.toolbar.actions, {
    title: 'Отменить рисование',
    text: 'Отмена'
});

Object.assign(L.drawLocal.draw.toolbar.finish, {
    title: 'Завершить',
    text: 'Готово'
});

Object.assign(L.drawLocal.draw.toolbar.undo, {
    title: 'Удалить последнюю точку',
    text: 'Назад'
});

Object.assign(L.drawLocal.draw.toolbar.buttons, {
    polygon: 'Нарисовать область',
    rectangle: 'Выделить прямоугольником'
});

Object.assign(L.drawLocal.draw.handlers.polygon.tooltip, {
    start: 'Начните рисовать область',
    cont: 'Продолжайте рисовать',
    end: 'Нажмите первую точку для завершения'
});

Object.assign(L.drawLocal.draw.handlers.rectangle.tooltip, {
    start: 'Зажмите и выделите область'
});

Object.assign(L.drawLocal.draw.handlers.polygon, {
    error: 'Контур пересекается сам с собой!'
});

Object.assign(L.drawLocal.edit.toolbar.actions.save, {
    title: 'Сохранить изменения',
    text: 'Сохранить'
});

Object.assign(L.drawLocal.edit.toolbar.actions.cancel, {
    title: 'Отменить изменения',
    text: 'Отмена'
});

Object.assign(L.drawLocal.edit.toolbar.actions.clearAll, {
    title: 'Удалить всё',
    text: 'Удалить всё'
});

Object.assign(L.drawLocal.edit.toolbar.buttons, {
    edit: 'Редактировать зоны',
    editDisabled: 'Нет зон',
    remove: 'Удалить зоны',
    removeDisabled: 'Нет зон'
});

Object.assign(L.drawLocal.edit.handlers.edit.tooltip, {
    text: 'Перетаскивайте точки для изменения',
    subtext: 'Нажмите отмену чтобы откатить'
});

Object.assign(L.drawLocal.edit.handlers.remove.tooltip, {
    text: 'Нажмите на зону чтобы удалить'
});
}