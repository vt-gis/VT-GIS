(function (global) {
  "use strict";

  var fmt = global.VTFormat;

  function latLngsToGeoJsonLine(latlngs) {
    return {
      type: "LineString",
      coordinates: latlngs.map(function (ll) {
        return [ll.lng, ll.lat];
      }),
    };
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

  function flattenLatLngs(latlngs, out) {
    if (!latlngs || !latlngs.length) return;
    var first = latlngs[0];
    if (first && (first.lat !== undefined || first instanceof L.LatLng)) {
      latlngs.forEach(function (ll) {
        out.push(L.latLng(ll));
      });
      return;
    }
    latlngs.forEach(function (part) {
      flattenLatLngs(part, out);
    });
  }

  function pixelDistance(map, a, b) {
    return map.latLngToContainerPoint(a).distanceTo(map.latLngToContainerPoint(b));
  }

  function formatAreaSqm(sqm) {
    return sqm.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " m²";
  }

  function bufferLayerStyle() {
    return {
      pane: "pane-topo-draw",
      color: "#b45309",
      weight: 1.5,
      fillColor: "#fbbf24",
      fillOpacity: 0.2,
      interactive: false,
    };
  }

  function formatMeters(meters) {
    return meters.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " m";
  }

  function forEachDrawableLayer(layer, fn) {
    if (layer instanceof L.LayerGroup) {
      layer.eachLayer(function (child) {
        forEachDrawableLayer(child, fn);
      });
      return;
    }
    fn(layer);
  }

  function DrawTools(map) {
    this._map = map;
    this._mode = null;
    this._points = [];
    this._tempLayer = L.layerGroup().addTo(map);
    this._drawnLayer = L.layerGroup().addTo(map);
    this._hintEl = null;
    this._pointCount = 0;
    this._clickHandler = this._onClick.bind(this);
    this._dblClickHandler = this._onDblClick.bind(this);
    this._moveHandler = this._onMove.bind(this);
    this._onModeChange = null;
    this._onPointAdded = null;
    this._pointConfirmHandler = null;
    this._lineConfirmHandler = null;
    this._pointsData = [];
    this._snapEnabled = false;
    this._snapTolerancePx = 14;
    this._snapLayer = L.layerGroup().addTo(map);
    this._singleClickTimer = null;
    this._pendingClickLatLng = null;
    this._history = [];

    if (!map.getPane("pane-topo-draw")) {
      map.createPane("pane-topo-draw");
      map.getPane("pane-topo-draw").style.zIndex = 450;
    }
  }

  DrawTools.prototype.setHintEl = function (el) {
    this._hintEl = el;
  };

  DrawTools.prototype._setHint = function (text) {
    if (!this._hintEl) return;
    this._hintEl.textContent = text || "";
    this._hintEl.hidden = !text;
  };

  DrawTools.prototype.activeMode = function () {
    return this._mode;
  };

  DrawTools.prototype.stop = function () {
    this._mode = null;
    this._points = [];
    this._tempLayer.clearLayers();
    this._snapLayer.clearLayers();
    clearTimeout(this._singleClickTimer);
    this._singleClickTimer = null;
    this._pendingClickLatLng = null;
    this._map.off("click", this._clickHandler);
    this._map.off("dblclick", this._dblClickHandler);
    this._map.off("mousemove", this._moveHandler);
    this._map.doubleClickZoom.enable();
    this._map.getContainer().classList.remove("map--drawing");
    this._setHint("");
    if (this._onModeChange) this._onModeChange(null);
  };

  DrawTools.prototype.setOnModeChange = function (fn) {
    this._onModeChange = fn;
  };

  DrawTools.prototype.setOnPointAdded = function (fn) {
    this._onPointAdded = fn;
  };

  DrawTools.prototype.setPointConfirmHandler = function (fn) {
    this._pointConfirmHandler = fn;
  };

  DrawTools.prototype.setLineConfirmHandler = function (fn) {
    this._lineConfirmHandler = fn;
  };

  DrawTools.prototype.getPointsData = function () {
    return this._pointsData.slice();
  };

  DrawTools.prototype.isSnapEnabled = function () {
    return this._snapEnabled;
  };

  DrawTools.prototype.setSnapEnabled = function (enabled) {
    this._snapEnabled = !!enabled;
    if (!this._snapEnabled) this._snapLayer.clearLayers();
    this._refreshDrawHint();
  };

  DrawTools.prototype.toggleSnap = function () {
    this.setSnapEnabled(!this._snapEnabled);
    return this._snapEnabled;
  };

  DrawTools.prototype._isSnapMode = function () {
    return this._mode === "line" || this._mode === "polygon";
  };

  DrawTools.prototype._refreshDrawHint = function () {
    if (this._mode === "line") {
      this._setHint(
        "Clique para vértices da linha · duplo clique para finalizar" +
          (this._snapEnabled ? " · aderência ativa" : "")
      );
      return;
    }
    if (this._mode === "polygon") {
      this._setHint(
        "Clique para vértices do polígono · duplo clique para fechar" +
          (this._snapEnabled ? " · aderência ativa" : "")
      );
    }
  };

  DrawTools.prototype._getSnapTargets = function () {
    var targets = [];
    var seen = {};

    function addTarget(latlng) {
      var ll = L.latLng(latlng);
      var key = ll.lat.toFixed(7) + "," + ll.lng.toFixed(7);
      if (seen[key]) return;
      seen[key] = true;
      targets.push(ll);
    }

    this._drawnLayer.eachLayer(function (layer) {
      forEachDrawableLayer(layer, function (drawLayer) {
        if (drawLayer instanceof L.CircleMarker) {
          addTarget(drawLayer.getLatLng());
          return;
        }
        if (drawLayer instanceof L.Polyline) {
          var latlngs = [];
          flattenLatLngs(drawLayer.getLatLngs(), latlngs);
          latlngs.forEach(addTarget);
        }
      });
    });

    this._points.forEach(addTarget);
    return targets;
  };

  DrawTools.prototype._snapLatLng = function (latlng) {
    if (!this._snapEnabled || !this._isSnapMode()) return L.latLng(latlng);

    var cursor = L.latLng(latlng);
    var targets = this._getSnapTargets();
    var best = null;
    var bestDist = this._snapTolerancePx + 1;

    targets.forEach(function (target) {
      var dist = pixelDistance(this._map, cursor, target);
      if (dist <= this._snapTolerancePx && dist < bestDist) {
        bestDist = dist;
        best = target;
      }
    }, this);

    return best || cursor;
  };

  DrawTools.prototype._updateSnapIndicator = function (snapped, original) {
    this._snapLayer.clearLayers();
    if (!this._snapEnabled || !this._isSnapMode()) return;
    if (!snapped || pixelDistance(this._map, snapped, original) > this._snapTolerancePx) return;

    L.circleMarker(snapped, {
      pane: "pane-topo-draw",
      radius: 7,
      color: "#dc2626",
      weight: 2,
      fillColor: "#dc2626",
      fillOpacity: 0.15,
      dashArray: "4 3",
    }).addTo(this._snapLayer);
  };

  DrawTools.prototype.clearAll = function () {
    clearTimeout(this._singleClickTimer);
    this._singleClickTimer = null;
    this._pendingClickLatLng = null;
    this._points = [];
    this._tempLayer.clearLayers();
    this._snapLayer.clearLayers();
    this._drawnLayer.clearLayers();
    this._history = [];
    this._pointCount = 0;
    this._pointsData = [];
  };

  DrawTools.prototype.canUndo = function () {
    return this._history.length > 0;
  };

  DrawTools.prototype.undo = function () {
    if (!this._history.length) return false;

    var item = this._history.pop();
    this._drawnLayer.removeLayer(item.layer);

    if (item.type === "point") {
      this._pointCount = Math.max(0, this._pointCount - 1);
      if (this._pointsData.length) this._pointsData.pop();
    }

    return true;
  };

  DrawTools.prototype._registerFeature = function (layer, type) {
    this._history.push({ layer: layer, type: type });
  };

  DrawTools.prototype._enable = function (mode, hint) {
    this._mode = mode;
    this._points = [];
    this._tempLayer.clearLayers();
    this._map.doubleClickZoom.disable();
    this._map.getContainer().classList.add("map--drawing");
    this._map.on("click", this._clickHandler);
    this._map.on("dblclick", this._dblClickHandler);
    this._map.on("mousemove", this._moveHandler);
    this._setHint(hint);
    if (this._onModeChange) this._onModeChange(mode);
  };

  DrawTools.prototype.startPoint = function () {
    this.stop();
    this._enable("point", "Clique no mapa ou informe x/y · preencha tipo, ordem e código");
  };

  DrawTools.prototype.startLine = function () {
    this.stop();
    this._enable("line");
    this._refreshDrawHint();
  };

  DrawTools.prototype.startPolygon = function () {
    this.stop();
    this._enable("polygon");
    this._refreshDrawHint();
  };

  DrawTools.prototype.addPointAt = function (lat, lng) {
    if (isNaN(lat) || isNaN(lng)) return false;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
    this._requestPointAdd(L.latLng(lat, lng));
    return true;
  };

  DrawTools.prototype._requestPointAdd = function (latlng) {
    var self = this;
    if (this._pointConfirmHandler) {
      var suggestedOrdem = this._pointCount + 1;
      this._pointConfirmHandler(latlng, suggestedOrdem).then(function (attrs) {
        if (attrs) self._addPointMarker(latlng, attrs);
      });
      return;
    }
    this._addPointMarker(latlng, {});
  };

  DrawTools.prototype._addPointMarker = function (latlng, attrs) {
    attrs = attrs || {};
    this._pointCount += 1;

    var group = L.layerGroup();
    this._drawnLayer.addLayer(group);
    this._populatePointGroup(group, latlng, attrs, this._pointCount);
    this._registerFeature(group, "point");

    this._pointsData.push({
      index: this._pointCount,
      lat: latlng.lat,
      lng: latlng.lng,
      tipo: attrs.tipo || null,
      ordem: attrs.ordem !== undefined ? attrs.ordem : null,
      codigo: attrs.codigo || null,
    });

    if (this._onPointAdded) this._onPointAdded(latlng);
  };

  DrawTools.prototype._onPointGroupClick = function (group, e) {
    L.DomEvent.stopPropagation(e);
    var self = this;
    if (!this._pointConfirmHandler || !group._vtLatLng) return;
    this._pointConfirmHandler(group._vtLatLng, null, group._vtAttrs || null).then(function (attrs) {
      if (attrs) self._updatePointGroup(group, attrs);
    });
  };

  DrawTools.prototype._populatePointGroup = function (group, latlng, attrs, index) {
    attrs = attrs || {};
    var center = L.latLng(latlng);
    if (!attrs.codigo) {
      attrs.codigo = "P" + (attrs.ordem || index);
    }

    group.clearLayers();

    if (attrs.bufferM && attrs.bufferM > 0) {
      group.addLayer(
        L.circle(center, Object.assign({}, bufferLayerStyle(), { radius: attrs.bufferM }))
      );
    }

    var popupHtml;
    if (global.VTPointAttrs && global.VTPointAttrs.buildPopupHtml) {
      popupHtml = global.VTPointAttrs.buildPopupHtml(index, attrs, center);
    } else {
      popupHtml =
        "<strong>Ponto " +
        index +
        "</strong><br>" +
        center.lat.toFixed(6) +
        "°, " +
        center.lng.toFixed(6) +
        "°";
    }

    var marker = L.circleMarker(center, {
      pane: "pane-topo-draw",
      radius: 6,
      color: "#fff",
      weight: 2,
      fillColor: "#d97706",
      fillOpacity: 1,
    });
    marker.bindPopup(popupHtml, { closeButton: false, autoPan: false, offset: [0, -8] });
    if (marker._openPopup) {
      marker.off("click", marker._openPopup, marker);
    }
    marker.on("click", this._onPointGroupClick.bind(this, group));
    marker.on("mouseover", function () {
      if (global.VTPointAttrs && global.VTPointAttrs.buildPopupHtml) {
        marker.setPopupContent(
          global.VTPointAttrs.buildPopupHtml(marker._vtIndex, marker._vtAttrs, marker.getLatLng())
        );
      }
      marker.openPopup();
    });
    marker.on("mouseout", function () {
      marker.closePopup();
    });
    marker.bindTooltip(attrs.codigo, {
      permanent: true,
      direction: "right",
      offset: [6, -6],
      className: "topo-point-label",
    });
    marker.on("popupopen", function () {
      if (global.VTPointAttrs && global.VTPointAttrs.buildPopupHtml) {
        marker.setPopupContent(
          global.VTPointAttrs.buildPopupHtml(marker._vtIndex, marker._vtAttrs, marker.getLatLng())
        );
      }
    });
    marker._vtAttrs = attrs;
    marker._vtIndex = index;
    group.addLayer(marker);

    group._vtLatLng = center;
    group._vtAttrs = attrs;
    group._vtIndex = index;
  };

  DrawTools.prototype._updatePointGroup = function (group, attrs) {
    if (!group || !group._vtLatLng) return;
    this._populatePointGroup(group, group._vtLatLng, attrs, group._vtIndex);

    for (var i = 0; i < this._pointsData.length; i += 1) {
      if (this._pointsData[i].index === group._vtIndex) {
        this._pointsData[i].tipo = attrs.tipo || null;
        this._pointsData[i].ordem = attrs.ordem !== undefined ? attrs.ordem : null;
        this._pointsData[i].codigo = attrs.codigo || null;
        break;
      }
    }
  };

  DrawTools.prototype._requestLineCommit = function (points) {
    var self = this;
    if (this._lineConfirmHandler) {
      return this._lineConfirmHandler(null).then(function (attrs) {
        if (attrs) {
          self._commitLine(points, attrs);
          return true;
        }
        return false;
      });
    }
    this._commitLine(points, {});
    return Promise.resolve(true);
  };

  DrawTools.prototype._onLineGroupClick = function (group, e) {
    L.DomEvent.stopPropagation(e);
    var self = this;
    if (!this._lineConfirmHandler || !group._vtLinePoints) return;
    this._lineConfirmHandler(group._vtLineAttrs || null).then(function (attrs) {
      if (attrs) self._updateLineGroup(group, attrs);
    });
  };

  DrawTools.prototype._populateLineGroup = function (group, points, attrs) {
    attrs = attrs || {};
    group.clearLayers();

    if (global.VTLineAttrs && attrs.bufferM && global.VTLineAttrs.buildLineBuffer) {
      var bufferRing = global.VTLineAttrs.buildLineBuffer(points, attrs.bufferM);
      if (bufferRing && bufferRing.length >= 3) {
        group.addLayer(L.polygon(bufferRing, bufferLayerStyle()));
      }
    }

    var layer = L.polyline(points, {
      pane: "pane-topo-draw",
      color: "#2563eb",
      weight: 3,
    });
    layer.on("click", this._onLineGroupClick.bind(this, group));
    group.addLayer(layer);

    if (global.VTLineAttrs && attrs.offsetM && attrs.offsetSide) {
      global.VTLineAttrs.buildOffsetLines(points, attrs.offsetM, attrs.offsetSide).forEach(function (off) {
        group.addLayer(
          L.polyline(off.latlngs, {
            pane: "pane-topo-draw",
            color: "#64748b",
            weight: 2,
            dashArray: "6 4",
            interactive: false,
          })
        );
      });
    }

    group._vtLinePoints = points.slice();
    group._vtLineAttrs = {
      tipo: attrs.tipo || "",
      offsetM: attrs.offsetM || null,
      offsetSide: attrs.offsetSide || null,
      bufferM: attrs.bufferM || null,
    };
  };

  DrawTools.prototype._updateLineGroup = function (group, attrs) {
    if (!group || !group._vtLinePoints) return;
    this._populateLineGroup(group, group._vtLinePoints, attrs);
  };

  DrawTools.prototype._commitLine = function (points, attrs) {
    var group = L.layerGroup();
    this._populateLineGroup(group, points, attrs || {});
    this._drawnLayer.addLayer(group);
    this._registerFeature(group, "line");
  };

  DrawTools.prototype._addPolygonLabels = function (group, points) {
    if (!points || points.length < 3 || !fmt) return;

    var area = fmt.geodesicArea(points);
    var cLat = 0;
    var cLng = 0;
    points.forEach(function (ll) {
      cLat += ll.lat;
      cLng += ll.lng;
    });
    var centroid = L.latLng(cLat / points.length, cLng / points.length);

    L.marker(centroid, {
      pane: "pane-topo-draw",
      icon: L.divIcon({
        className: "tool-label tool-label--area",
        html: formatAreaSqm(area),
        iconSize: null,
      }),
      interactive: false,
    }).addTo(group);

    for (var i = 0; i < points.length; i += 1) {
      var p1 = points[i];
      var p2 = points[(i + 1) % points.length];
      var mid = L.latLng((p1.lat + p2.lat) / 2, (p1.lng + p2.lng) / 2);
      L.marker(mid, {
        pane: "pane-topo-draw",
        icon: L.divIcon({
          className: "tool-label tool-label--measure",
          html: formatMeters(p1.distanceTo(p2)),
          iconSize: null,
        }),
        interactive: false,
      }).addTo(group);
    }
  };

  DrawTools.prototype._commitPolygon = function (points) {
    var group = L.layerGroup();
    var layer = L.polygon(points, {
      pane: "pane-topo-draw",
      color: "#2d6a4f",
      weight: 2,
      fillColor: "#40916c",
      fillOpacity: 0.35,
    });
    var area = fmt.geodesicArea(points);
    layer.bindPopup("<strong>Polígono</strong><br>" + fmt.formatArea(area));
    group.addLayer(layer);
    this._addPolygonLabels(group, points);
    this._drawnLayer.addLayer(group);
    this._registerFeature(group, "polygon");
  };

  DrawTools.prototype._onClick = function (e) {
    L.DomEvent.stopPropagation(e);

    if (this._mode === "point") {
      this._requestPointAdd(e.latlng);
      return;
    }

    var self = this;
    var latlng = this._snapLatLng(e.latlng);
    clearTimeout(this._singleClickTimer);
    this._pendingClickLatLng = latlng;

    this._singleClickTimer = setTimeout(function () {
      if (self._mode !== "line" && self._mode !== "polygon") return;
      self._points.push(self._pendingClickLatLng);
      self._pendingClickLatLng = null;
      self._snapLayer.clearLayers();
      self._redraw();
    }, 220);
  };

  DrawTools.prototype._onDblClick = function (e) {
    if (this._mode === "point") return;
    L.DomEvent.stopPropagation(e);
    L.DomEvent.preventDefault(e);

    clearTimeout(this._singleClickTimer);
    this._singleClickTimer = null;
    this._pendingClickLatLng = null;
    this._snapLayer.clearLayers();
    this._finish();
  };

  DrawTools.prototype._onMove = function (e) {
    if (this._mode === "point") return;

    var cursor = this._snapLatLng(e.latlng);
    this._updateSnapIndicator(cursor, e.latlng);

    if (this._points.length === 0) return;
    this._redraw(cursor);
  };

  DrawTools.prototype._redraw = function (cursor) {
    this._tempLayer.clearLayers();
    var pts = this._points.slice();
    if (cursor) pts.push(cursor);
    if (pts.length === 0) return;

    L.circleMarker(this._points[this._points.length - 1], {
      radius: 5,
      color: "#fff",
      weight: 2,
      fillColor: this._mode === "line" ? "#2563eb" : "#2d6a4f",
      fillOpacity: 1,
    }).addTo(this._tempLayer);

    if (this._mode === "line" && pts.length >= 2) {
      L.polyline(pts, { color: "#2563eb", weight: 3, dashArray: "6 4" }).addTo(this._tempLayer);
      return;
    }

    if (this._mode === "polygon" && pts.length >= 2) {
      L.polygon(pts, {
        color: "#2d6a4f",
        weight: 2,
        fillColor: "#40916c",
        fillOpacity: 0.35,
      }).addTo(this._tempLayer);
    }
  };

  DrawTools.prototype._finish = function () {
    var mode = this._mode;
    var points = this._points.slice();

    if (mode === "line" && points.length >= 2) {
      this._points = [];
      this._tempLayer.clearLayers();
      this._snapLayer.clearLayers();
      this._requestLineCommit(points);
      return;
    }

    this.stop();

    if (mode === "polygon" && points.length >= 3) {
      this._commitPolygon(points);
    }
  };

  global.VTDrawTools = DrawTools;
})(window);
