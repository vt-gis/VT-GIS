(function (global) {
  "use strict";

  function formatDistance(meters) {
    if (meters >= 1000) {
      return (meters / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " km";
    }
    return meters.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " m";
  }

  function formatArea(sqm) {
    var ha = sqm / 10000;
    if (ha >= 1) {
      return ha.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " ha";
    }
    return sqm.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + " m²";
  }

  function geodesicArea(latlngs) {
    if (latlngs.length < 3) return 0;
    var R = 6378137;
    var total = 0;
    var len = latlngs.length;
    for (var i = 0; i < len; i += 1) {
      var p1 = latlngs[i];
      var p2 = latlngs[(i + 1) % len];
      var lat1 = (p1.lat * Math.PI) / 180;
      var lat2 = (p2.lat * Math.PI) / 180;
      var dLng = ((p2.lng - p1.lng) * Math.PI) / 180;
      total += dLng * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    return Math.abs((total * R * R) / 2);
  }

  function latLngsToGeoJsonPolygon(latlngs) {
    var ring = latlngs.map(function (ll) {
      return [ll.lng, ll.lat];
    });
    if (ring.length > 0) {
      var first = ring[0];
      var last = ring[ring.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        ring.push([first[0], first[1]]);
      }
    }
    return { type: "Polygon", coordinates: [ring] };
  }

  function MapTools(map) {
    this._map = map;
    this._mode = null;
    this._points = [];
    this._tempLayer = L.layerGroup().addTo(map);
    this._hintEl = null;
    this._onComplete = null;
    this._clickHandler = this._onClick.bind(this);
    this._dblClickHandler = this._onDblClick.bind(this);
    this._moveHandler = this._onMove.bind(this);
    this._singleClickTimer = null;
    this._pendingClickLatLng = null;
  }

  MapTools.prototype.setHintEl = function (el) {
    this._hintEl = el;
  };

  MapTools.prototype._setHint = function (text) {
    if (!this._hintEl) return;
    this._hintEl.textContent = text || "";
    this._hintEl.hidden = !text;
  };

  MapTools.prototype.activeMode = function () {
    return this._mode;
  };

  MapTools.prototype.stop = function () {
    this._mode = null;
    this._points = [];
    this._tempLayer.clearLayers();
    this._onComplete = null;
    clearTimeout(this._singleClickTimer);
    this._singleClickTimer = null;
    this._pendingClickLatLng = null;
    this._map.off("click", this._clickHandler);
    this._map.off("dblclick", this._dblClickHandler);
    this._map.off("mousemove", this._moveHandler);
    this._map.doubleClickZoom.enable();
    this._map.getContainer().classList.remove("map--drawing");
    this._setHint("");
  };

  MapTools.prototype._enable = function (mode, hint) {
    this._mode = mode;
    this._map.doubleClickZoom.disable();
    this._map.getContainer().classList.add("map--drawing");
    this._map.on("click", this._clickHandler);
    this._map.on("dblclick", this._dblClickHandler);
    this._map.on("mousemove", this._moveHandler);
    this._setHint(hint);
  };

  MapTools.prototype.startMeasure = function () {
    this.stop();
    this._enable("measure", "Clique para marcar pontos · duplo clique para finalizar");
  };

  MapTools.prototype.startDrawArea = function (onComplete) {
    this.stop();
    this._onComplete = onComplete || null;
    this._enable(
      "area",
      onComplete
        ? "Desenhe a área do serviço · duplo clique para fechar"
        : "Desenhe um polígono · duplo clique para fechar"
    );
  };

  MapTools.prototype._onClick = function (e) {
    L.DomEvent.stopPropagation(e);

    if (this._mode === "area") {
      var self = this;
      var latlng = e.latlng;
      clearTimeout(this._singleClickTimer);
      this._pendingClickLatLng = latlng;

      this._singleClickTimer = setTimeout(function () {
        if (self._mode !== "area") return;
        self._points.push(self._pendingClickLatLng);
        self._pendingClickLatLng = null;
        self._redraw();
      }, 220);
      return;
    }

    this._points.push(e.latlng);
    this._redraw();
  };

  MapTools.prototype._onDblClick = function (e) {
    L.DomEvent.stopPropagation(e);
    L.DomEvent.preventDefault(e);

    if (this._mode === "area") {
      clearTimeout(this._singleClickTimer);
      this._singleClickTimer = null;
      this._pendingClickLatLng = null;
      this._finish();
      return;
    }

    if (this._points.length > 0) {
      this._points.pop();
    }
    this._finish();
  };

  MapTools.prototype._onMove = function (e) {
    if (this._points.length === 0) return;
    this._redraw(e.latlng);
  };

  MapTools.prototype._redraw = function (cursor) {
    this._tempLayer.clearLayers();
    var pts = this._points.slice();
    if (cursor) pts.push(cursor);

    if (pts.length === 0) return;

    L.circleMarker(this._points[this._points.length - 1], {
      radius: 5,
      color: "#fff",
      weight: 2,
      fillColor: this._mode === "measure" ? "#2563eb" : "#2d6a4f",
      fillOpacity: 1,
    }).addTo(this._tempLayer);

    if (this._mode === "measure") {
      if (pts.length >= 2) {
        L.polyline(pts, { color: "#2563eb", weight: 3, dashArray: "6 4" }).addTo(this._tempLayer);
        var total = 0;
        for (var i = 1; i < pts.length; i += 1) {
          total += pts[i - 1].distanceTo(pts[i]);
        }
        var label = formatDistance(total);
        L.marker(pts[pts.length - 1], {
          icon: L.divIcon({
            className: "tool-label tool-label--measure",
            html: label,
            iconSize: null,
          }),
          interactive: false,
        }).addTo(this._tempLayer);
      }
      return;
    }

    if (pts.length >= 2) {
      L.polygon(pts, {
        color: "#2d6a4f",
        weight: 2,
        fillColor: "#40916c",
        fillOpacity: 0.35,
      }).addTo(this._tempLayer);
    }
    if (pts.length >= 3) {
      var area = geodesicArea(pts);
      L.marker(pts[pts.length - 1], {
        icon: L.divIcon({
          className: "tool-label tool-label--area",
          html: formatArea(area),
          iconSize: null,
        }),
        interactive: false,
      }).addTo(this._tempLayer);
    }
  };

  MapTools.prototype._finish = function () {
    var mode = this._mode;
    var points = this._points.slice();
    var callback = this._onComplete;
    this.stop();

    if (mode === "measure" && points.length >= 2) {
      var total = 0;
      for (var i = 1; i < points.length; i += 1) {
        total += points[i - 1].distanceTo(points[i]);
      }
      var layer = L.polyline(points, { color: "#2563eb", weight: 3 });
      layer.addTo(this._map);
      layer.bindPopup("<strong>Distância:</strong> " + formatDistance(total));
      this._tempLayer.addLayer(layer);
      return;
    }

    if (mode === "area" && points.length >= 3) {
      var geometry = latLngsToGeoJsonPolygon(points);
      if (callback) {
        callback(geometry);
        return;
      }
      var area = geodesicArea(points);
      var poly = L.polygon(points, {
        color: "#2d6a4f",
        weight: 2,
        fillColor: "#40916c",
        fillOpacity: 0.35,
      });
      poly.addTo(this._map);
      poly.bindPopup("<strong>Área:</strong> " + formatArea(area));
      this._tempLayer.addLayer(poly);
    }
  };

  MapTools.prototype.clearFinished = function () {
    this._tempLayer.clearLayers();
  };

  global.VTMapTools = MapTools;
  global.VTFormat = { formatDistance: formatDistance, formatArea: formatArea, geodesicArea: geodesicArea };
})(window);
