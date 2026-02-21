# ZoneWidget

Самодостаточный embeddable-виджет для работы с зонами на карте на базе **Leaflet + OpenStreetMap + Leaflet.Draw**.

В репозитории есть два независимых JS-модуля:

- **`zw-editor.js`** — интерактивный редактор зон (создание/импорт/экспорт/удаление + mini-карточки + режимы `edit/view`).
- **`zw-render.js`** — лёгкий viewer для отображения уже сохранённых зон (read-only).

---

## Что умеет библиотека

### 1) `ZoneWidget` (редактор)

Редактор монтируется в контейнер и возвращает API-объект для управления состоянием.

Основные возможности:

- Рисование зон на основной карте.
- Ограничение максимального количества зон (`limit`).
- Экспорт JSON (`version`, `exportedAt`, `meta`, `zones`).
- Импорт JSON (массив `zones` или объект `{ zones: [] }`).
- Переключение режимов:
  - `edit` — можно рисовать/удалять/импортировать/экспортировать.
  - `view` — только просмотр и фокус по mini-картам.
- Сетка mini-карт сохранённых зон под основной картой.
- Публичный API: `setMode`, `setZones`, `getZones`, `focus`.

### 2) `ZoneMapViewer` (рендер)

Viewer нужен, когда редактирование не требуется — только показ зон:

- Принимает данные напрямую (`data`) или загружает по URL (`jsonUrl`).
- Отрисовывает `geojson` зоны.
- Может автоматически подгонять масштаб под все зоны (`fitToZones`).
- Возвращает API: `map`, `setData`, `destroy`.

---

## Режимы рисования в `zw-editor.js`

Конфигурация Draw-контрола в текущей реализации:

```js
draw: {
  polygon: { allowIntersection: false, showArea: true },
  rectangle: true,
  circle: false,
  circlemarker: false,
  marker: false,
  polyline: false
}
```

### Что это означает

- ✅ **Polygon** включён, причём:
  - `allowIntersection: false` — нельзя замкнуть самопересекающийся контур;
  - `showArea: true` — Leaflet.Draw показывает площадь при рисовании.
- ✅ **Rectangle** включён.
- ❌ **Circle**, **CircleMarker**, **Marker**, **Polyline** выключены.

Итого: в редакторе можно создавать только **полигоны** и **прямоугольники**.

---

## Быстрый старт

### Вариант A: редактор зон

```html
<div id="zones-widget"></div>
<script src="zw-editor.js"></script>
<script>
(async () => {
  const api = await ZoneWidget.mount("#zones-widget", {
    limit: 4,
    center: [43.238949, 76.889709],
    zoom: 12,
    mode: "edit",
    height: 360
  });

  // Опционально: русификация подсказок Leaflet.Draw
  localizeLeafletDrawRU();

  // api.setMode("view");
  // api.setZones(dataFromServer);
})();
</script>
```

### Вариант B: read-only рендер

```html
<div style="height:400px;">
  <div id="zoneMap"></div>
</div>
<script src="zw-render.js"></script>
<script>
ZoneMapViewer.mount({
  el: "zoneMap",
  jsonUrl: "exported_zones.json",
  options: {
    fitToZones: true,
    attributionText: "Leaflet | JCS"
  }
});
</script>
```

---

## Публичный API

### `ZoneWidget.mount(target, options)`

- `target`: CSS-селектор или DOM-элемент.
- `options`:
  - `limit` (number, default `4`) — лимит зон;
  - `center` (`[lat, lng]`) — стартовый центр карты;
  - `zoom` (number) — стартовый зум;
  - `mode` (`"edit" | "view"`) — стартовый режим;
  - `height` (number) — высота основной карты в пикселях.

Возвращает Promise с API:

- `setMode("edit" | "view")`
- `setZones(payload)`
- `getZones()`
- `focus(id)`

### `ZoneMapViewer.mount(cfg)`

- `cfg.el` — селектор, id или DOM-элемент контейнера карты.
- `cfg.jsonUrl` — URL с JSON.
- `cfg.data` — JSON-объект или массив зон.
- `cfg.options` — тонкая настройка:
  - `center`, `zoom`
  - `fitToZones`
  - `padding`
  - `tileUrl`, `tileMaxZoom`
  - `attributionText`
  - `zoneStyle`

Возвращает Promise с API:

- `map`
- `setData(payload)`
- `destroy()`

---

## Формат данных зон

Типичный экспорт из редактора:

```json
{
  "version": 1,
  "exportedAt": "2025-01-01T10:00:00.000Z",
  "meta": {
    "limit": 4,
    "center": [43.238949, 76.889709],
    "zoom": 12
  },
  "zones": [
    {
      "id": "z_...",
      "createdAt": 1735725600000,
      "geojson": { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [] }, "properties": {} },
      "center": [43.23, 76.88],
      "zoom": 14
    }
  ]
}
```

`zw-render.js` понимает как полный объект `{ zones: [...] }`, так и просто массив зон `[...]`.

---

## Структура репозитория

```text
ZoneWidget/
├── README.md                 # Документация
├── LICENSE                   # Лицензия
├── zw-editor.js              # Основной редактор зон (ZoneWidget)
├── zw-render.js              # Read-only рендер зон (ZoneMapViewer)
├── example-zw-editor.html    # Пример подключения редактора
├── example-zw-render.html    # Пример подключения рендера
└── exported_zones.json       # Пример JSON-данных зон
```

---

## Примечания

- Скрипты самостоятельно подтягивают Leaflet и Leaflet.Draw из CDN (один раз на документ).
- Для корректного отображения карты контейнеру нужно задавать высоту.
- В `example-zw-editor.html` есть пример скрытия стандартного attribution-блока Leaflet и вывода собственного текста.
