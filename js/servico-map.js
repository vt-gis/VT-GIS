(function () {
  "use strict";

  var SC_CENTER = [-27.25, -50.95];
  var DEFAULT_ZOOM = 7;

  var basemaps = {
    osm: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }),
    satellite: L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxZoom: 19,
        attribution:
          "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
      }
    ),
  };

  var mapEl = document.getElementById("map");
  if (!mapEl) return;

  var map = L.map("map", {
    center: SC_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: false,
  });

  var activeBasemap = basemaps.osm;
  activeBasemap.addTo(map);

  var coordsControl = L.control({ position: "bottomleft" });
  coordsControl.onAdd = function () {
    var div = L.DomUtil.create("div", "coords-control");
    div.innerHTML = "<span>—</span>";
    coordsControl._el = div;
    return div;
  };

  var cursorLatLng = L.latLng(SC_CENTER[0], SC_CENTER[1]);
  var drawCrsMode = false;

  coordsControl.update = function (lat, lng, zoom) {
    if (!coordsControl._el) return;
    if (drawCrsMode && window.VTCrs) {
      coordsControl._el.innerHTML = window.VTCrs.formatStatusLine(
        lng,
        lat,
        window.VTCrs.getCode(),
        zoom
      );
      return;
    }
    coordsControl._el.innerHTML = window.VTCrs
      ? window.VTCrs.formatLegacyLine(lat, lng, zoom)
      : "<strong>—</strong> · Zoom " + zoom;
  };

  function updateCoords() {
    coordsControl.update(cursorLatLng.lat, cursorLatLng.lng, map.getZoom());
  }

  map.on("move", updateCoords);
  map.on("zoomend", updateCoords);
  map.on("mousemove", function (e) {
    cursorLatLng = e.latlng;
    updateCoords();
  });

  map.addControl(
    L.control.scale({ imperial: false, metric: true, position: "bottomleft" })
  );
  map.addControl(coordsControl);
  updateCoords();

  var btnZoomIn = document.getElementById("zoom-in");
  var btnZoomOut = document.getElementById("zoom-out");
  if (btnZoomIn) btnZoomIn.addEventListener("click", function () { map.zoomIn(); });
  if (btnZoomOut) btnZoomOut.addEventListener("click", function () { map.zoomOut(); });

  document.querySelectorAll(".servico-basemap__btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var id = btn.getAttribute("data-basemap");
      if (!basemaps[id] || activeBasemap === basemaps[id]) return;
      map.removeLayer(activeBasemap);
      activeBasemap = basemaps[id];
      activeBasemap.addTo(map);
      document.querySelectorAll(".servico-basemap__btn").forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
      });
    });
  });

  var btnLayers = document.getElementById("tool-layers");
  var layersPopover = document.getElementById("layers-popover");
  var layersPanel = document.getElementById("layers-panel");

  if (window.VTInitMapLayers && layersPanel) {
    window.VTInitMapLayers(map, layersPanel);
  }

  if (btnLayers && layersPopover) {
    btnLayers.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = layersPopover.hidden;
      layersPopover.hidden = !open;
      btnLayers.classList.toggle("is-active", !layersPopover.hidden);
    });

    layersPopover.addEventListener("click", function (e) {
      e.stopPropagation();
    });

    document.addEventListener("click", function () {
      layersPopover.hidden = true;
      btnLayers.classList.remove("is-active");
    });
  }

  var mapTools = null;
  var drawTools = null;
  var activeMapToolBtn = null;
  var activeTopoToolBtn = null;
  var toolHint = document.getElementById("tool-hint");

  function setActiveMapTool(btn) {
    if (activeMapToolBtn) activeMapToolBtn.classList.remove("is-active");
    activeMapToolBtn = btn;
    if (btn) btn.classList.add("is-active");
  }

  function setActiveTopoTool(btn) {
    document.querySelectorAll(".topo-draw-bar__btn[data-topo-tool]").forEach(function (b) {
      b.classList.remove("is-active");
    });
    activeTopoToolBtn = btn;
    if (btn) btn.classList.add("is-active");
  }

  function stopMapTools() {
    if (mapTools) mapTools.stop();
    setActiveMapTool(null);
  }

  function stopTopoTools() {
    if (drawTools) drawTools.stop();
    setActiveTopoTool(null);
    hideVectorPanel();
  }

  function hideVectorPanel() {
    var panel = document.getElementById("topo-vector-panel");
    if (panel) panel.hidden = true;
  }

  function showVectorPanel() {
    var panel = document.getElementById("topo-vector-panel");
    if (panel) panel.hidden = false;
  }

  function parseCoord(value) {
    if (window.VTCrs) return window.VTCrs.parseNumber(value);
    if (value === null || value === undefined) return NaN;
    var normalized = String(value).trim().replace(/\s+/g, "").replace(",", ".");
    if (!normalized) return NaN;
    return parseFloat(normalized);
  }

  function formatProjected(x, y, code) {
    if (window.VTCrs) {
      return {
        x: window.VTCrs.formatAxis(x, code, "x"),
        y: window.VTCrs.formatAxis(y, code, "y"),
      };
    }
    return { x: String(x), y: String(y) };
  }

  function updateVectorPanelCrsUi(code) {
    var hint = document.getElementById("topo-vector-hint");
    var inputX = document.getElementById("vec-x");
    var inputY = document.getElementById("vec-y");
    if (!window.VTCrs) return;

    if (hint) hint.textContent = window.VTCrs.getHint(code);
    var placeholders = window.VTCrs.getPlaceholders(code);
    if (inputX) inputX.placeholder = placeholders.x;
    if (inputY) inputY.placeholder = placeholders.y;

    var opt = window.VTCrs.getOption(code);
    if (inputX) inputX.setAttribute("aria-label", opt.xLabel);
    if (inputY) inputY.setAttribute("aria-label", opt.yLabel);
  }

  function initDrawCrs() {
    var select = document.getElementById("topo-draw-crs");
    if (!window.VTCrs || !select) return;

    window.VTCrs.populateSelect(select);
    select.value = window.VTCrs.getCode();
    updateVectorPanelCrsUi(window.VTCrs.getCode());

    select.addEventListener("change", function () {
      window.VTCrs.setCode(select.value);
    });

    window.VTCrs.onChange(function (code) {
      select.value = code;
      updateVectorPanelCrsUi(code);
      updateCoords();
      if (drawTools && drawTools.activeMode() === "point") {
        refreshVectorFields(cursorLatLng);
      }
    });
  }

  function setDrawCrsMode(enabled) {
    drawCrsMode = enabled;
    updateCoords();
  }

  function refreshVectorFields(latlng) {
    var inputX = document.getElementById("vec-x");
    var inputY = document.getElementById("vec-y");
    var locks = refreshVectorFields._locks;
    if (!inputX || !inputY || !window.VTCrs || !locks) return;

    var projected = window.VTCrs.toProjected(latlng.lng, latlng.lat);
    var formatted = formatProjected(projected.x, projected.y, window.VTCrs.getCode());
    if (!locks.x) inputX.value = formatted.x;
    if (!locks.y) inputY.value = formatted.y;
  }

  function initVectorPanel(tools) {
    var panel = document.getElementById("topo-vector-panel");
    var inputX = document.getElementById("vec-x");
    var inputY = document.getElementById("vec-y");
    var btnAdd = document.getElementById("vec-add-point");
    var btnClose = document.getElementById("topo-vector-close");
    var locks = { x: false, y: false };
    refreshVectorFields._locks = locks;

    if (!panel || !inputX || !inputY || !btnAdd) return;

    function syncCoords(latlng) {
      refreshVectorFields(latlng);
    }

    document.querySelectorAll(".topo-vector-row__lock").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-lock");
        if (!key) return;
        locks[key] = !locks[key];
        btn.classList.toggle("is-locked", locks[key]);
      });
    });

    btnAdd.addEventListener("click", function () {
      if (tools.activeMode() !== "point") {
        alert("Selecione a ferramenta Ponto na barra de desenho.");
        return;
      }

      if (!window.VTCrs) return;

      var code = window.VTCrs.getCode();
      var xVal = inputX.value;
      var yVal = inputY.value;

      if (!xVal.trim() || !yVal.trim()) {
        alert("Informe coordenadas x e y válidas no SRC selecionado.");
        return;
      }

      if (!window.VTCrs.isValidInput(xVal, yVal, code)) {
        alert("Coordenadas fora do intervalo válido para o SRC selecionado.");
        return;
      }

      var wgs = window.VTCrs.toWgs84(xVal, yVal, code);
      if (!tools.addPointAt(wgs.lat, wgs.lng)) {
        alert("Não foi possível incluir o ponto com essas coordenadas.");
        return;
      }

      var projected = window.VTCrs.toProjected(wgs.lng, wgs.lat, code);
      var formatted = formatProjected(projected.x, projected.y, code);
      if (!locks.x) inputX.value = formatted.x;
      if (!locks.y) inputY.value = formatted.y;
    });

    if (btnClose) {
      btnClose.addEventListener("click", hideVectorPanel);
    }

    tools.setOnModeChange(function (mode) {
      if (mode === "point") {
        showVectorPanel();
        if (!inputX.value && !inputY.value) {
          syncCoords(cursorLatLng);
        }
      } else {
        hideVectorPanel();
      }
    });

    tools.setOnPointAdded(function (latlng) {
      syncCoords(latlng);
    });

    map.on("mousemove", function (e) {
      if (tools.activeMode() !== "point") return;
      syncCoords(e.latlng);
    });
  }

  function stopAllTools() {
    stopMapTools();
    stopTopoTools();
  }

  function formatAreaSqm(sqm) {
    return sqm.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " m²";
  }

  function formatMeters(meters) {
    return meters.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " m";
  }

  function ringToLatLngs(ring) {
    if (!ring || !ring.length) return [];
    var latlngs = ring.map(function (c) {
      return L.latLng(c[1], c[0]);
    });
    if (latlngs.length > 1) {
      var first = latlngs[0];
      var last = latlngs[latlngs.length - 1];
      if (first.lat === last.lat && first.lng === last.lng) {
        latlngs.pop();
      }
    }
    return latlngs;
  }

  function addPolygonLabels(group, latlngs) {
    if (!latlngs.length || latlngs.length < 3 || !window.VTFormat) return;

    var fmt = window.VTFormat;
    var area = fmt.geodesicArea(latlngs);
    var cLat = 0;
    var cLng = 0;
    latlngs.forEach(function (ll) {
      cLat += ll.lat;
      cLng += ll.lng;
    });
    var centroid = L.latLng(cLat / latlngs.length, cLng / latlngs.length);

    L.marker(centroid, {
      icon: L.divIcon({
        className: "tool-label tool-label--area",
        html: formatAreaSqm(area),
        iconSize: null,
      }),
      interactive: false,
    }).addTo(group);

    for (var i = 0; i < latlngs.length; i += 1) {
      var p1 = latlngs[i];
      var p2 = latlngs[(i + 1) % latlngs.length];
      var mid = L.latLng((p1.lat + p2.lat) / 2, (p1.lng + p2.lng) / 2);
      L.marker(mid, {
        icon: L.divIcon({
          className: "tool-label tool-label--measure",
          html: formatMeters(p1.distanceTo(p2)),
          iconSize: null,
        }),
        interactive: false,
      }).addTo(group);
    }
  }

  if (window.VTMapTools) {
    mapTools = new window.VTMapTools(map);
    mapTools.setHintEl(toolHint);

    var btnMeasure = document.getElementById("tool-measure");
    var btnDrawArea = document.getElementById("tool-draw-area");

    if (btnMeasure) {
      btnMeasure.addEventListener("click", function () {
        if (mapTools.activeMode() === "measure") {
          stopMapTools();
          return;
        }
        stopTopoTools();
        setActiveMapTool(btnMeasure);
        mapTools.startMeasure();
      });
    }

    if (btnDrawArea) {
      btnDrawArea.addEventListener("click", function () {
        if (mapTools.activeMode() === "area") {
          stopMapTools();
          return;
        }
        stopTopoTools();
        setActiveMapTool(btnDrawArea);
        mapTools.startDrawArea(function (geometry) {
          if (window.VTServicoPage && window.VTServicoPage.saveGeometry) {
            window.VTServicoPage.saveGeometry(geometry);
          }
          setActiveMapTool(null);
        });
      });
    }

    var btnClearArea = document.getElementById("tool-clear-area");
    if (btnClearArea) {
      btnClearArea.addEventListener("click", function () {
        stopMapTools();
        if (mapTools) mapTools.clearFinished();
        if (window.VTServicoPage && window.VTServicoPage.saveGeometry) {
          window.VTServicoPage.saveGeometry(null);
        }
      });
    }
  }

  if (window.VTDrawTools) {
    drawTools = new window.VTDrawTools(map);
    drawTools.setHintEl(toolHint);

    var topoBar = document.getElementById("topo-draw-bar");
    var topoClose = document.getElementById("topo-draw-close");
    var topoStop = document.getElementById("topo-draw-stop");

    document.querySelectorAll(".topo-draw-bar__btn[data-topo-tool]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var tool = btn.getAttribute("data-topo-tool");
        stopMapTools();

        if (drawTools.activeMode() === tool) {
          stopTopoTools();
          return;
        }

        setActiveTopoTool(btn);
        if (tool === "point") drawTools.startPoint();
        if (tool === "line") drawTools.startLine();
        if (tool === "polygon") drawTools.startPolygon();
      });
    });

    if (topoStop) {
      topoStop.addEventListener("click", function () {
        stopTopoTools();
      });
    }

    var btnSnap = document.getElementById("topo-draw-snap");
    if (btnSnap) {
      btnSnap.addEventListener("click", function () {
        var enabled = drawTools.toggleSnap();
        btnSnap.classList.toggle("is-active", enabled);
        btnSnap.setAttribute("aria-pressed", enabled ? "true" : "false");
      });
    }

    var btnUndo = document.getElementById("topo-draw-undo");
    if (btnUndo) {
      btnUndo.addEventListener("click", function () {
        drawTools.undo();
      });
    }

    var btnClear = document.getElementById("topo-draw-clear");
    if (btnClear) {
      btnClear.addEventListener("click", function () {
        if (window.confirm("Apagar todo o desenho do mapa?")) {
          drawTools.clearAll();
        }
      });
    }

    if (topoClose) {
      topoClose.addEventListener("click", function () {
        stopTopoTools();
        if (topoBar) topoBar.hidden = true;
        setDrawCrsMode(false);
      });
    }

    initVectorPanel(drawTools);

    if (window.VTPointAttrs) {
      window.VTPointAttrs.init();
      drawTools.setPointConfirmHandler(function (latlng, suggestedOrdem, initialAttrs) {
        return window.VTPointAttrs.prompt(latlng, suggestedOrdem, initialAttrs);
      });
    }

    if (window.VTLineAttrs) {
      window.VTLineAttrs.init();
      drawTools.setLineConfirmHandler(function (initialAttrs) {
        return window.VTLineAttrs.prompt(initialAttrs);
      });
    }

    initDrawCrs();
  }

  var contourApi = null;
  if (window.VTContourTool && drawTools) {
    contourApi = window.VTContourTool.init({
      map: map,
      drawTools: drawTools,
    });
  }

  window.VTServicoMap = {
    map: map,
    drawTools: drawTools,
    stopMapTools: stopMapTools,
    stopTopoTools: stopTopoTools,
    stopAllTools: stopAllTools,
    showContourBar: function () {
      if (contourApi && contourApi.showBar) contourApi.showBar();
    },
    hideContourBar: function () {
      if (contourApi && contourApi.hideBar) contourApi.hideBar();
    },
    showContourToolPanel: function () {
      if (contourApi && contourApi.showBar) contourApi.showBar();
    },
    hideContourToolPanel: function () {
      if (contourApi && contourApi.hideBar) contourApi.hideBar();
    },
    showTopoDrawBar: function () {
      var bar = document.getElementById("topo-draw-bar");
      if (contourApi && contourApi.hideBar) contourApi.hideBar();
      if (bar) bar.hidden = false;
      setDrawCrsMode(true);
    },
    hideTopoDrawBar: function () {
      var bar = document.getElementById("topo-draw-bar");
      stopTopoTools();
      if (bar) bar.hidden = true;
      setDrawCrsMode(false);
    },
    fitGeometry: function (geometry) {
      if (!geometry || !geometry.coordinates) return;
      var ring = geometry.coordinates[0].map(function (c) {
        return [c[1], c[0]];
      });
      if (ring.length > 2) {
        map.fitBounds(ring, { padding: [40, 40], maxZoom: 16 });
      }
    },
    showGeometry: function (geometry) {
      if (!geometry || !geometry.coordinates) return null;
      var latlngs = ringToLatLngs(geometry.coordinates[0]);
      if (latlngs.length < 3) return null;

      var group = L.layerGroup().addTo(map);
      L.polygon(latlngs, {
        color: "#1d4ed8",
        weight: 2,
        fillColor: "#3b82f6",
        fillOpacity: 0.3,
      }).addTo(group);
      addPolygonLabels(group, latlngs);
      return group;
    },
    startDrawArea: function (callback) {
      if (!mapTools) return;
      stopTopoTools();
      if (contourApi && contourApi.hideBar) contourApi.hideBar();
      setActiveMapTool(document.getElementById("tool-draw-area"));
      mapTools.startDrawArea(function (geometry) {
        setActiveMapTool(null);
        if (callback) callback(geometry);
      });
    },
  };
})();
