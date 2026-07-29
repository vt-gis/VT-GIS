(function () {
  "use strict";

  var SC_CENTER = [-27.25, -50.95];
  var DEFAULT_ZOOM = 7;
  var CAR_MIN_ZOOM = 12;
  var CAR_TILE_SIZE = 0.25;
  var CAR_MAX_TILES = 6;

  var basemaps = [
    {
      id: "osm",
      label: "OpenStreetMap",
      layer: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }),
    },
    {
      id: "satellite",
      label: "Satélite",
      layer: L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          maxZoom: 19,
          attribution:
            "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
        }
      ),
    },
    {
      id: "topo",
      label: "Topográfico",
      layer: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
        maxZoom: 17,
        subdomains: ["a", "b", "c"],
        attribution:
          'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, ' +
          '<a href="http://viewfinderpanoramas.org">SRTM</a> | ' +
          'Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
      }),
    },
  ];

  var overlayLayers = [
    {
      id: "municipios",
      label: "Municípios SC",
      url: "geojason/_web/Municipios_SC.geojson",
      pane: "pane-municipios",
      style: {
        color: "#2d6a4f",
        weight: 2,
        opacity: 0.95,
        fill: false,
      },
      activeStyle: {
        color: "#1b4332",
        weight: 3,
        fill: false,
      },
      popup: function (props) {
        return (
          "<h3>" + (props.NM_MUN || "Município") + "</h3>" +
          popupRow("Região", props.NM_RGI) +
          popupRow("Área", formatArea(props.AREA_KM2, "km²")) +
          popupRow("Código IBGE", props.CD_MUN)
        );
      },
    },
    {
      id: "car",
      label: "CAR SC",
      tiled: true,
      minZoom: CAR_MIN_ZOOM,
      pane: "pane-car",
      style: {
        color: "#bc6c25",
        weight: 1,
        opacity: 0.9,
        fillColor: "#dda15e",
        fillOpacity: 0.35,
      },
      activeStyle: {
        color: "#9c4a0f",
        weight: 2,
        fillOpacity: 0.55,
      },
      popup: function (props) {
        return (
          "<h3>Área do Imóvel</h3>" +
          popupRow("Município", props.municipio) +
          popupRow("Área", formatArea(props.num_area, "ha")) +
          popupRow("Módulo fiscal", props.mod_fiscal) +
          popupRow("Condição", props.des_condic) +
          popupRow("Status", props.ind_status) +
          popupRow("Atualização", props.dat_atuali)
        );
      },
    },
  ];

  function popupRow(label, value) {
    if (value === null || value === undefined || value === "") return "";
    return (
      '<div class="popup-row"><span>' +
      label +
      '</span><span>' +
      value +
      "</span></div>"
    );
  }

  function formatArea(value, unit) {
    if (value === null || value === undefined || value === "") return "";
    var num = Number(value);
    if (isNaN(num)) return value + " " + unit;
    return num.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " " + unit;
  }

  var BasemapControl = L.Control.extend({
    options: { position: "topright" },

    onAdd: function () {
      var container = L.DomUtil.create("div", "basemap-control");
      var label = L.DomUtil.create("span", "basemap-control__label", container);
      label.textContent = "Mapa";

      var select = L.DomUtil.create("select", "basemap-control__select", container);

      basemaps.forEach(function (basemap) {
        var option = L.DomUtil.create("option", "", select);
        option.value = basemap.id;
        option.textContent = basemap.label;
      });

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(select, "change", this._onChange, this);

      this._select = select;
      return container;
    },

    _onChange: function () {
      var id = this._select.value;
      var basemap = basemaps.find(function (b) {
        return b.id === id;
      });
      if (basemap) {
        this._map._setBasemap(basemap);
      }
    },

    setValue: function (id) {
      this._select.value = id;
    },
  });

  var LayersControl = L.Control.extend({
    options: { position: "topright" },

    onAdd: function () {
      var container = L.DomUtil.create("div", "layers-control");
      var title = L.DomUtil.create("div", "layers-control__title", container);
      title.textContent = "Camadas";

      overlayLayers.forEach(function (layer) {
        var item = L.DomUtil.create("label", "layers-control__item", container);
        var input = L.DomUtil.create("input", "", item);
        input.type = "checkbox";
        input.value = layer.id;

        if (isFileProtocol() && layer.id === "car") {
          input.disabled = true;
          item.classList.add("is-disabled");
          item.title = "CAR SC requer o servidor local. Execute iniciar.bat.";
        }

        L.DomEvent.on(input, "change", function () {
          if (input.checked) {
            overlayLayers.forEach(function (other) {
              if (other.id === layer.id) return;
              var otherUi = layerUi[other.id];
              if (otherUi && otherUi.checkbox.checked) {
                otherUi.checkbox.checked = false;
                map._setLayerVisible(other.id, false);
              }
            });
          }
          map._setLayerVisible(layer.id, input.checked);
        });
        L.DomEvent.on(input, "click", L.DomEvent.stopPropagation);

        item.appendChild(document.createTextNode(layer.label));
        layerUi[layer.id] = { checkbox: input, item: item };
      });

      statusEl = L.DomUtil.create("div", "layers-control__status", container);
      statusEl.hidden = true;

      var hint = L.DomUtil.create("div", "layers-control__hint", container);
      hint.textContent = isFileProtocol()
        ? "CAR SC: execute iniciar.bat · zoom " + CAR_MIN_ZOOM + "+"
        : "Uma camada por vez · CAR zoom " + CAR_MIN_ZOOM + "+";

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
      return container;
    },
  });

  var CoordsControl = L.Control.extend({
    options: { position: "bottomleft" },

    onAdd: function () {
      this._container = L.DomUtil.create("div", "coords-control");
      this._container.innerHTML = "—";
      return this._container;
    },

    update: function (lat, lng, zoom) {
      this._container.innerHTML =
        "<strong>" +
        lat.toFixed(4) +
        "°S, " +
        Math.abs(lng).toFixed(4) +
        "°W</strong> · Zoom " +
        zoom;
    },
  });

  var map = L.map("map", {
    center: SC_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: true,
    preferCanvas: true,
  });

  map.createPane("pane-municipios");
  map.createPane("pane-car");
  map.getPane("pane-municipios").style.zIndex = 420;
  map.getPane("pane-car").style.zIndex = 430;

  var activeBasemap = null;
  var basemapControl = new BasemapControl();
  var coordsControl = new CoordsControl();
  var layerState = {};
  var carManifest = null;
  var carTileLayers = {};
  var carLoading = {};
  var carSyncToken = 0;
  var layerUi = {};
  var statusEl = null;

  function isFileProtocol() {
    return window.location.protocol === "file:";
  }

  function setLayerStatus(message, type) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = "layers-control__status layers-control__status--" + type;
    statusEl.hidden = !message;
  }

  function setLayerLoading(id, loading) {
    var ui = layerUi[id];
    if (!ui) return;
    ui.item.classList.toggle("is-loading", loading);
  }

  overlayLayers.forEach(function (config) {
    layerState[config.id] = {
      config: config,
      visible: false,
      group: L.layerGroup().addTo(map),
      loaded: false,
    };
  });

  function bindFeatureEvents(featureLayer, config) {
    if (config.tiled) {
      featureLayer.on("click", function (e) {
        if (!config.popup) return;
        e.target
          .bindPopup(config.popup(e.target.feature.properties), {
            maxWidth: 280,
          })
          .openPopup();
      });
      return;
    }

    featureLayer.on({
      mouseover: function (e) {
        e.target.setStyle(cloneStyle(config.activeStyle));
      },
      mouseout: function (e) {
        e.target.setStyle(cloneStyle(config.style));
      },
      click: function (e) {
        if (!config.popup) return;
        e.target
          .bindPopup(config.popup(e.target.feature.properties), {
            maxWidth: 280,
          })
          .openPopup();
      },
    });
  }

  function cloneStyle(style) {
    return {
      color: style.color,
      weight: style.weight,
      opacity: style.opacity,
      fill: style.fill,
      fillColor: style.fillColor,
      fillOpacity: style.fillOpacity,
    };
  }

  function releaseMunicipiosLayer() {
    var state = layerState.municipios;
    if (!state.geoLayer) return;
    state.group.clearLayers();
    state.geoLayer.remove();
    state.geoLayer = null;
    state.loaded = false;
  }

  function addGeoJsonToMap(id, data) {
    var state = layerState[id];
    var config = state.config;
    var layer = L.geoJSON(data, {
      pane: config.pane,
      smoothFactor: 0,
      style: function () {
        return cloneStyle(config.style);
      },
      onEachFeature: function (feature, featureLayer) {
        bindFeatureEvents(featureLayer, config);
      },
    });
    state.geoLayer = layer;
    state.loaded = true;
    if (state.visible) {
      state.group.addLayer(layer);
    }
  }

  function loadGeoJsonLayer(id) {
    var state = layerState[id];
    var config = state.config;

    if (state.loaded) {
      if (state.geoLayer && state.visible) {
        state.group.addLayer(state.geoLayer);
      }
      return;
    }

    if (state.loading) return;
    state.loading = true;
    setLayerLoading(id, true);
    setLayerStatus("Carregando " + config.label + "...", "info");

    fetch(config.url)
      .then(function (res) {
        if (!res.ok) throw new Error("Falha ao carregar " + config.label);
        return res.json();
      })
      .then(function (data) {
        addGeoJsonToMap(id, data);
        setLayerStatus(config.label + " carregada.", "info");
      })
      .catch(function (err) {
        console.error(err);
        state.visible = false;
        layerUi[id].checkbox.checked = false;
        setLayerStatus(
          "Erro ao carregar " + config.label + ". Execute iniciar.bat.",
          "error"
        );
      })
      .finally(function () {
        state.loading = false;
        setLayerLoading(id, false);
      });
  }

  function formatTileKey(y, x) {
    return y.toFixed(2) + "_" + x.toFixed(2);
  }

  function tileCenterDistance(key, center) {
    var parts = key.split("_");
    var lat = parseFloat(parts[0]) + CAR_TILE_SIZE / 2;
    var lng = parseFloat(parts[1]) + CAR_TILE_SIZE / 2;
    return center.distanceTo([lat, lng]);
  }

  function pruneCarTileCache(neededKeys) {
    Object.keys(carTileLayers).forEach(function (key) {
      if (neededKeys.indexOf(key) !== -1) return;
      layerState.car.group.removeLayer(carTileLayers[key]);
      carTileLayers[key].remove();
      delete carTileLayers[key];
    });
  }

  function loadCarTilesSequential(keys) {
    var chain = Promise.resolve();
    keys.forEach(function (key) {
      chain = chain.then(function () {
        return loadCarTile(key);
      });
    });
    return chain;
  }

  function visibleTileKeys(bounds) {
    var keys = [];
    var y0 = Math.floor(bounds.getSouth() / CAR_TILE_SIZE);
    var y1 = Math.ceil(bounds.getNorth() / CAR_TILE_SIZE);
    var x0 = Math.floor(bounds.getWest() / CAR_TILE_SIZE);
    var x1 = Math.ceil(bounds.getEast() / CAR_TILE_SIZE);

    for (var yi = y0; yi < y1; yi += 1) {
      for (var xi = x0; xi < x1; xi += 1) {
        keys.push(formatTileKey(yi * CAR_TILE_SIZE, xi * CAR_TILE_SIZE));
      }
    }

    if (keys.length > CAR_MAX_TILES) {
      var center = map.getCenter();
      keys.sort(function (a, b) {
        return tileCenterDistance(a, center) - tileCenterDistance(b, center);
      });
      keys = keys.slice(0, CAR_MAX_TILES);
    }

    return keys;
  }

  function loadCarManifest() {
    if (carManifest) return Promise.resolve(carManifest);

    return fetch("geojason/_web/car_tiles/manifest.json")
      .then(function (res) {
        if (!res.ok) throw new Error("Manifesto CAR indisponível");
        return res.json();
      })
      .then(function (data) {
        carManifest = data;
        return data;
      });
  }

  function loadCarTile(key) {
    var state = layerState.car;
    var config = state.config;

    if (!carManifest || carManifest.indexOf(key) === -1) {
      return Promise.resolve(null);
    }

    if (carTileLayers[key]) {
      return Promise.resolve(carTileLayers[key]);
    }

    if (carLoading[key]) {
      return carLoading[key];
    }

    carLoading[key] = fetch("geojason/_web/car_tiles/" + key + ".geojson")
      .then(function (res) {
        if (!res.ok) throw new Error("Tile " + key + " (" + res.status + ")");
        return res.json();
      })
      .then(function (data) {
        var layer = L.geoJSON(data, {
          pane: config.pane,
          smoothFactor: 0,
          style: function () {
            return cloneStyle(config.style);
          },
          onEachFeature: function (feature, featureLayer) {
            bindFeatureEvents(featureLayer, config);
          },
        });
        carTileLayers[key] = layer;
        return layer;
      })
      .catch(function (err) {
        console.error("CAR tile", key, err);
        return null;
      })
      .finally(function () {
        delete carLoading[key];
      });

    return carLoading[key];
  }

  function syncCarTiles() {
    var state = layerState.car;
    if (!state.visible || map.getZoom() < CAR_MIN_ZOOM) return;

    var syncToken = ++carSyncToken;
    setLayerLoading("car", true);
    setLayerStatus("Carregando CAR SC (aguarde)...", "info");

    loadCarManifest()
      .then(function () {
        if (syncToken !== carSyncToken || !state.visible) return;

        var bounds = map.getBounds();
        var needed = visibleTileKeys(bounds).filter(function (key) {
          return carManifest.indexOf(key) !== -1;
        });

        return loadCarTilesSequential(needed).then(function () {
          if (syncToken !== carSyncToken || !state.visible) return;

          pruneCarTileCache(needed);
          state.group.clearLayers();

          needed.forEach(function (key) {
            if (carTileLayers[key]) {
              state.group.addLayer(carTileLayers[key]);
            }
          });

          var loadedCount = needed.filter(function (key) {
            return !!carTileLayers[key];
          }).length;

          if (loadedCount === 0 && needed.length > 0) {
            setLayerStatus("CAR SC: falha ao carregar os tiles desta área.", "error");
          } else if (loadedCount === 0) {
            setLayerStatus("CAR SC: nenhum dado nesta área.", "warn");
          } else {
            setLayerStatus("CAR SC: " + loadedCount + " área(s) carregada(s).", "info");
          }
        });
      })
      .catch(function (err) {
        console.error(err);
        setLayerStatus("Erro ao iniciar CAR SC.", "error");
      })
      .finally(function () {
        setLayerLoading("car", false);
      });
  }

  function destroyCarTiles() {
    Object.keys(carTileLayers).forEach(function (key) {
      layerState.car.group.removeLayer(carTileLayers[key]);
      carTileLayers[key].remove();
    });
    carTileLayers = {};
  }

  function unloadCarTiles() {
    carSyncToken += 1;
    carLoading = {};
    destroyCarTiles();
  }

  map._setLayerVisible = function (id, visible) {
    var state = layerState[id];
    state.visible = visible;

    if (!visible) {
      state.group.clearLayers();
      if (id === "car") {
        unloadCarTiles();
      } else if (id === "municipios") {
        releaseMunicipiosLayer();
      }
      return;
    }

    if (id === "municipios") {
      if (layerState.car.visible) {
        layerUi.car.checkbox.checked = false;
        map._setLayerVisible("car", false);
      }
      if (!state.loaded) {
        loadGeoJsonLayer(id);
      } else if (state.geoLayer) {
        state.group.addLayer(state.geoLayer);
      }
      return;
    }

    if (id === "car") {
      if (layerState.municipios.visible) {
        layerUi.municipios.checkbox.checked = false;
        map._setLayerVisible("municipios", false);
      }

      if (isFileProtocol()) {
        return;
      }

      if (map.getZoom() < CAR_MIN_ZOOM) {
        map.setZoom(CAR_MIN_ZOOM);
        map.once("zoomend", syncCarTiles);
        return;
      }
      syncCarTiles();
    }
  };

  map._setBasemap = function (basemap) {
    if (activeBasemap) {
      map.removeLayer(activeBasemap.layer);
    }
    activeBasemap = basemap;
    basemap.layer.addTo(map);
    basemapControl.setValue(basemap.id);
  };

  function updateCoords() {
    var center = map.getCenter();
    coordsControl.update(center.lat, center.lng, map.getZoom());
  }

  map.on("move", updateCoords);
  map.on("zoomend", function () {
    updateCoords();
    syncCarTiles();
  });
  map.on("moveend", syncCarTiles);

  map.addControl(basemapControl);
  map.addControl(new LayersControl());
  map.addControl(
    L.control.scale({ imperial: false, metric: true, position: "bottomleft" })
  );
  map.addControl(coordsControl);

  map._setBasemap(basemaps[0]);
  updateCoords();
})();
