/*!
 * ZoneWidgetRender v1.0.0
 * View-only map renderer for ZoneWidget-exported JSON (Leaflet + OSM)
 * Usage:
 *   ZoneMapViewer.mount({ el: "#map", jsonUrl: "/zones.json" })
 *   ZoneMapViewer.mount({ el: "mapId", data: exportedJsonObject })
 */
(function (global) {
  "use strict";

  const DEFAULTS = {
    center: [43.238949, 76.889709], // Алматы
    zoom: 12,
    fitToZones: true,
    padding: [30, 30],
    tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    tileMaxZoom: 19,
    attributionText: "Leaflet | © OpenStreetMap contributors | A01L",
    // стиль зон
    zoneStyle: { weight: 3, opacity: 1, fillOpacity: 0.15 }
  };

  // ----- Public API
  const ZoneMapViewer = {
    /**
     * mount
     * @param {Object} cfg
     * @param {string|HTMLElement} cfg.el   - selector "#id" / "id" / DOM element
     * @param {string} [cfg.jsonUrl]        - URL to JSON
     * @param {Object|Array} [cfg.data]     - JSON object or zones array
     * @param {Object} [cfg.options]        - overrides
     * @returns {Promise<{map:any, setData:Function, destroy:Function}>}
     */
    async mount(cfg) {
      const el = resolveEl(cfg && cfg.el);
      if (!el) throw new Error("ZoneMapViewer: target element not found");

      const options = { ...DEFAULTS, ...(cfg.options || {}) };

      // ensure element fills parent
      ensureFillParent(el);

      // load Leaflet
      await ensureLeaflet();

      // create map
      const map = L.map(el, { zoomControl: true }).setView(options.center, options.zoom);

      L.tileLayer(options.tileUrl, {
        maxZoom: options.tileMaxZoom,
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(map);

      // attribution (custom)
      try {
        map.attributionControl.setPrefix(false);
        if (options.attributionText) map.attributionControl.addAttribution(options.attributionText);
      } catch (_) {}

      const fg = L.featureGroup().addTo(map);

      // renderer
      const setData = (payload) => {
        fg.clearLayers();
        const zones = normalizeZones(payload);

        zones.forEach((z) => {
          if (!z || !z.geojson) return;
          try {
            const layer = L.geoJSON(z.geojson, {
              style: () => options.zoneStyle
            });
            fg.addLayer(layer);
          } catch (_) {}
        });

        // fit
        if (options.fitToZones) {
          try {
            const b = fg.getBounds();
            if (b && b.isValid()) map.fitBounds(b, { padding: options.padding });
          } catch (_) {}
        }
      };

      // initial data
      if (cfg.data) {
        setData(cfg.data);
      } else if (cfg.jsonUrl) {
        const json = await fetchJson(cfg.jsonUrl);
        setData(json);
      } else {
        // no data: just an empty map
      }

      // handle resize nicely if parent resizes later
      const ro = new ResizeObserver(() => {
        try { map.invalidateSize(); } catch (_) {}
      });
      ro.observe(el);

      return {
        map,
        setData,
        destroy() {
          try { ro.disconnect(); } catch (_) {}
          try { map.remove(); } catch (_) {}
        }
      };
    }
  };

  // ----- Helpers
  function resolveEl(el) {
    if (!el) return null;
    if (el instanceof HTMLElement) return el;
    if (typeof el === "string") {
      const s = el.trim();
      if (s.startsWith("#")) return document.querySelector(s);
      // allow raw id
      const byId = document.getElementById(s);
      if (byId) return byId;
      return document.querySelector(s);
    }
    return null;
  }

  function ensureFillParent(el) {
    // Important: parent must have explicit height (e.g. 400px or 100vh)
    // We set the map container to fill the parent.
    const style = el.style;
    if (!style.width) style.width = "100%";
    if (!style.height) style.height = "100%";
    if (!style.minHeight) style.minHeight = "240px"; // safety default
    if (!style.display) style.display = "block";
  }

  function normalizeZones(payload) {
    // Accept:
    // - { zones: [...] }
    // - [...] (zones array)
    // - { version, exportedAt, zones: [...] } (ZoneWidget export)
    const zones = Array.isArray(payload)
      ? payload
      : (payload && Array.isArray(payload.zones) ? payload.zones : []);

    // Normalize minimal shape: must contain geojson
    return zones.map((z) => ({
      id: z.id || null,
      createdAt: z.createdAt || null,
      geojson: z.geojson || null
    }));
  }

  async function fetchJson(url) {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`ZoneMapViewer: failed to fetch JSON (${res.status})`);
    return await res.json();
  }

  // ----- Leaflet loader (CDN) - loaded once
  async function ensureLeaflet() {
    if (global.L && global.L.map) return;

    await loadCSSOnce("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "zmw_leaflet_css");
    await loadScriptOnce("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "zmw_leaflet_js");

    if (!(global.L && global.L.map)) {
      throw new Error("ZoneMapViewer: Leaflet failed to load");
    }
  }

  function loadCSSOnce(href, id) {
    return new Promise((resolve) => {
      if (document.getElementById(id)) return resolve();
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = href;
      link.onload = () => resolve();
      link.onerror = () => resolve(); // soft-fail
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
      s.onerror = () => reject(new Error("ZoneMapViewer: failed to load " + src));
      document.head.appendChild(s);
    });
  }

  // export global
  global.ZoneMapViewer = ZoneMapViewer;

})(window);