(function (global) {
  "use strict";

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function initCrm(map, tools) {
    var store = global.VTStore;
    var fmt = global.VTFormat;

    var filterClient = document.getElementById("filter-client");
    var filterService = document.getElementById("filter-service");
    var btnNew = document.getElementById("btn-new-service");
    var btnMeasure = document.getElementById("tool-measure");
    var btnDrawArea = document.getElementById("tool-draw-area");
    var searchInput = document.getElementById("map-search");
    var toolHint = document.getElementById("tool-hint");
    var modal = document.getElementById("service-modal");
    var modalForm = document.getElementById("service-form");
    var serviceNameInput = document.getElementById("service-name");
    var clientDocInput = document.getElementById("client-doc");
    var clientNameInput = document.getElementById("client-name");
    var modalClose = document.getElementById("modal-close");
    var modalCancel = document.getElementById("modal-cancel");

    var servicesLayer = L.layerGroup().addTo(map);
    map.createPane("pane-services");
    map.getPane("pane-services").style.zIndex = 440;

    var pendingService = null;
    var activeToolBtn = null;

    tools.setHintEl(toolHint);

    function setActiveTool(btn) {
      if (activeToolBtn) activeToolBtn.classList.remove("is-active");
      activeToolBtn = btn;
      if (btn) btn.classList.add("is-active");
    }

    function refreshFilters(preselect) {
      var clients = store.getClients();
      var selectedClient = preselect && preselect.clientId !== undefined
        ? preselect.clientId
        : filterClient.value;
      var selectedService = preselect && preselect.serviceId !== undefined
        ? preselect.serviceId
        : filterService.value;

      filterClient.innerHTML = '<option value="">Todos os clientes</option>';
      clients.forEach(function (c) {
        var opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.name;
        filterClient.appendChild(opt);
      });
      filterClient.value = selectedClient || "";

      var services = store.getServices().slice().sort(function (a, b) {
        return a.name.localeCompare(b.name, "pt-BR");
      });

      filterService.innerHTML = '<option value="">Todos os serviços</option>';
      if (selectedClient) {
        services.forEach(function (s) {
          if (s.clientId !== selectedClient) return;
          var opt = document.createElement("option");
          opt.value = s.id;
          opt.textContent = s.name;
          filterService.appendChild(opt);
        });
      }

      if (
        selectedClient &&
        selectedService &&
        filterService.querySelector('option[value="' + selectedService + '"]')
      ) {
        filterService.value = selectedService;
      } else {
        filterService.value = "";
      }
    }

    function clientName(clientId) {
      var client = store.getClients().find(function (c) {
        return c.id === clientId;
      });
      return client ? client.name : "—";
    }

    function servicePopup(service) {
      var areaText = "";
      if (service.geometry && service.geometry.coordinates) {
        var ring = service.geometry.coordinates[0].map(function (c) {
          return L.latLng(c[1], c[0]);
        });
        if (ring.length > 2) {
          areaText = fmt.formatArea(fmt.geodesicArea(ring));
        }
      }
      return (
        "<h3>" + escapeHtml(service.name) + "</h3>" +
        '<div class="popup-row"><span>Cliente</span><span>' + escapeHtml(clientName(service.clientId)) + "</span></div>" +
        '<div class="popup-row"><span>Serviço</span><span>' + escapeHtml(service.type) + "</span></div>" +
        (areaText ? '<div class="popup-row"><span>Área</span><span>' + areaText + "</span></div>" : "") +
        (service.notes ? '<div class="popup-row"><span>Obs.</span><span>' + escapeHtml(service.notes) + "</span></div>" : "") +
        '<button type="button" class="popup-delete" data-id="' + service.id + '">Excluir</button>'
      );
    }

    function renderServices() {
      servicesLayer.clearLayers();
      var clientFilter = filterClient.value;
      var serviceFilter = filterService.value;

      store.getServices().forEach(function (service) {
        if (clientFilter && service.clientId !== clientFilter) return;
        if (serviceFilter && service.id !== serviceFilter) return;
        if (!service.geometry) return;

        var layer = L.geoJSON(service.geometry, {
          pane: "pane-services",
          style: {
            color: "#1d4ed8",
            weight: 2,
            fillColor: "#3b82f6",
            fillOpacity: 0.3,
          },
        });

        layer.eachLayer(function (featureLayer) {
          featureLayer.bindPopup(servicePopup(service));
          featureLayer.on("popupopen", function (e) {
            var btn = e.popup.getElement().querySelector(".popup-delete");
            if (!btn) return;
            btn.onclick = function () {
              if (confirm("Excluir este serviço?")) {
                store.deleteService(service.id);
                map.closePopup();
                renderServices();
                refreshFilters();
              }
            };
          });
        });

        servicesLayer.addLayer(layer);
      });
    }

    function openModal() {
      modalForm.reset();
      pendingService = null;
      modal.hidden = false;
    }

    function closeModal() {
      modal.hidden = true;
      pendingService = null;
    }

    function startServiceDraw(service) {
      pendingService = service;
      closeModal();
      setActiveTool(btnDrawArea);
      tools.startDrawArea(function (geometry) {
        store.updateServiceGeometry(service.id, geometry);
        pendingService = null;
        setActiveTool(null);
        renderServices();
      });
    }

    filterClient.addEventListener("change", function () {
      refreshFilters({ clientId: filterClient.value, serviceId: "" });
      renderServices();
    });
    filterService.addEventListener("change", function () {
      var serviceId = filterService.value;
      if (!serviceId) {
        renderServices();
        return;
      }

      try {
        sessionStorage.setItem(
          "vt_gis_last_filter",
          JSON.stringify({ clientId: filterClient.value, serviceId: serviceId })
        );
      } catch (err) {
        /* ignore */
      }

      var baseEl = document.querySelector("base");
      var base = baseEl ? baseEl.href : "./";
      window.location.href = base + "servico.html?id=" + encodeURIComponent(serviceId);
    });

    btnNew.addEventListener("click", function () {
      tools.stop();
      setActiveTool(null);
      openModal();
    });

    modalClose.addEventListener("click", closeModal);
    modalCancel.addEventListener("click", closeModal);
    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeModal();
    });

    modalForm.addEventListener("submit", function (e) {
      e.preventDefault();

      var serviceName = serviceNameInput.value.trim();
      var clientNameValue = clientNameInput.value.trim();
      var cpfCnpj = clientDocInput.value.trim();

      if (!serviceName) {
        alert("Informe o nome do serviço.");
        return;
      }
      if (!clientNameValue) {
        alert("Informe o nome do cliente.");
        return;
      }

      var client = store.findClientByName(clientNameValue);
      if (!client) {
        client = store.addClient(clientNameValue, cpfCnpj);
      }
      if (!client) {
        alert("Não foi possível cadastrar o cliente.");
        return;
      }

      var service = store.addService({
        clientId: client.id,
        type: "Outro",
        name: serviceName,
        geometry: null,
      });

      try {
        sessionStorage.setItem(
          "vt_gis_last_filter",
          JSON.stringify({ clientId: client.id, serviceId: service.id })
        );
      } catch (err) {
        /* ignore */
      }

      refreshFilters({ clientId: client.id, serviceId: service.id });
      var baseEl = document.querySelector("base");
      var base = baseEl ? baseEl.href : "./";
      window.location.href = base + "servico.html?id=" + encodeURIComponent(service.id);
    });

    btnMeasure.addEventListener("click", function () {
      if (tools.activeMode() === "measure") {
        tools.stop();
        setActiveTool(null);
        return;
      }
      setActiveTool(btnMeasure);
      tools.startMeasure();
    });

    btnDrawArea.addEventListener("click", function () {
      if (tools.activeMode() === "area" && !pendingService) {
        tools.stop();
        setActiveTool(null);
        return;
      }
      setActiveTool(btnDrawArea);
      tools.startDrawArea(null);
    });

    if (searchInput) {
      searchInput.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        var q = searchInput.value.trim();
        if (!q) return;

        var coordMatch = q.match(/(-?\d+[.,]?\d*)\s*[,;\s]\s*(-?\d+[.,]?\d*)/);
        if (coordMatch) {
          var lat = parseFloat(coordMatch[1].replace(",", "."));
          var lng = parseFloat(coordMatch[2].replace(",", "."));
          if (!isNaN(lat) && !isNaN(lng)) {
            map.setView([lat, lng], 15);
            return;
          }
        }

        var term = q.toLowerCase();
        var match = store.getServices().find(function (s) {
          return (
            (s.name && s.name.toLowerCase().indexOf(term) !== -1) ||
            (s.type && s.type.toLowerCase().indexOf(term) !== -1) ||
            clientName(s.clientId).toLowerCase().indexOf(term) !== -1
          );
        });

        if (match && match.geometry && match.geometry.coordinates) {
          var ring = match.geometry.coordinates[0].map(function (c) {
            return [c[1], c[0]];
          });
          map.fitBounds(ring, { padding: [40, 40], maxZoom: 16 });
          return;
        }

        alert("Nenhum resultado encontrado para: " + q);
      });
    }

    var savedFilter = null;
    try {
      savedFilter = JSON.parse(sessionStorage.getItem("vt_gis_last_filter"));
      if (savedFilter && !savedFilter.clientId) {
        savedFilter = null;
      }
    } catch (err) {
      savedFilter = null;
    }

    refreshFilters(savedFilter);
    renderServices();
  }

  global.VTInitCrm = initCrm;
})(window);
