(function (global) {
  "use strict";

  var SECTIONS = {
    dados: {
      title: "Dados",
      desc: "Pontos, arquivos e documentos de entrada do serviço.",
    },
    desenho: {
      title: "Desenho",
      desc: "Polilinhas, alinhamentos, interseções, cotas, curvas de nível e anotações sobre os pontos.",
    },
    limites: {
      title: "Limites",
      desc: "Perímetros do imóvel (glebas/parcelas). Cada um tem seu nome, seus vértices e sua área.",
    },
    entregas: {
      title: "Entregas",
      desc: "Plantas, memoriais, cartas e exportações do serviço.",
    },
  };

  function getServiceIdFromUrl() {
    var params = new URLSearchParams(window.location.search);
    return params.get("id");
  }

  function sortedServices(store) {
    return store.getServices().slice().sort(function (a, b) {
      return new Date(a.createdAt) - new Date(b.createdAt);
    });
  }

  function init() {
    var store = global.VTStore;
    var serviceId = getServiceIdFromUrl();
    var service = serviceId ? store.getServiceById(serviceId) : null;

    if (!service) {
      var list = sortedServices(store);
      if (list.length) {
        window.location.replace("servico.html?id=" + encodeURIComponent(list[list.length - 1].id));
      } else {
        window.location.replace("index.html");
      }
      return;
    }

    var client = store.getClientById(service.clientId);
    var serviceLayer = null;

    var elCode = document.getElementById("service-code");
    var elName = document.getElementById("service-name");
    var elClient = document.getElementById("service-client");
    var elSectionTitle = document.getElementById("section-title");
    var elSectionDesc = document.getElementById("section-desc");
    var selectClient = document.getElementById("toolbar-client");
    var selectService = document.getElementById("toolbar-service");
    var railItems = document.querySelectorAll(".servico-rail__item");

    elCode.textContent = store.getServiceCode(service.id);
    elName.textContent = service.name;
    elClient.textContent = client ? client.name : "—";

    function populateToolbar() {
      var clients = store.getClients();
      var currentClient = service.clientId;

      selectClient.innerHTML = "";
      clients.forEach(function (c) {
        var opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.name;
        if (c.id === currentClient) opt.selected = true;
        selectClient.appendChild(opt);
      });

      selectService.innerHTML = "";
      sortedServices(store).forEach(function (s) {
        if (s.clientId !== currentClient) return;
        var opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = store.getServiceCode(s.id) + " · " + s.name;
        if (s.id === service.id) opt.selected = true;
        selectService.appendChild(opt);
      });
    }

    var refreshEntregasState = null;

    function showSection(sectionId) {
      var info = SECTIONS[sectionId] || SECTIONS.dados;
      elSectionTitle.textContent = info.title;
      elSectionDesc.textContent = info.desc;

      Object.keys(SECTIONS).forEach(function (key) {
        var panel = document.getElementById("section-" + key);
        if (panel) panel.hidden = key !== sectionId;
      });

      railItems.forEach(function (btn) {
        btn.classList.toggle("is-active", btn.getAttribute("data-section") === sectionId);
      });

      if (sectionId === "entregas" && refreshEntregasState) {
        refreshEntregasState();
      }
    }

    function renderGeometry() {
      var mapApi = global.VTServicoMap;
      if (!mapApi) return;
      if (serviceLayer) {
        mapApi.map.removeLayer(serviceLayer);
        serviceLayer = null;
      }
      var perimeters = store.getPerimeters(service.id);
      if (perimeters.length) return;
      if (service.geometry) {
        serviceLayer = mapApi.showGeometry(service.geometry);
        mapApi.fitGeometry(service.geometry);
      }
    }

    function polygonAreaHa(geometry) {
      if (!geometry || !geometry.coordinates || !geometry.coordinates[0]) return 0;
      var ring = geometry.coordinates[0];
      if (ring.length < 3) return 0;
      var origin = { lat: ring[0][1], lng: ring[0][0] };
      var R = 6378137;
      var pts = ring.map(function (c) {
        var lat = c[1];
        var lng = c[0];
        return {
          x: ((lng - origin.lng) * Math.PI) / 180 * R * Math.cos((origin.lat * Math.PI) / 180),
          y: ((lat - origin.lat) * Math.PI) / 180 * R,
        };
      });
      var area = 0;
      var i;
      for (i = 0; i < pts.length; i += 1) {
        var j = (i + 1) % pts.length;
        area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
      }
      return Math.abs(area / 2);
    }

    function initLimitesPerimeters(serviceRef) {
      var emptyEl = document.getElementById("perimeter-empty");
      var listEl = document.getElementById("perimeter-list");
      var newBtn = document.getElementById("perimeter-new-btn");
      var newMenu = document.getElementById("perimeter-new-menu");
      var fileInput = document.getElementById("perimeter-file-input");
      var visBtn = document.getElementById("perimeter-toggle-visible");
      var mapApi = global.VTServicoMap;

      if (!emptyEl || !listEl || !newBtn || !mapApi) return;

      var perimeterLayerGroup = L.layerGroup().addTo(mapApi.map);
      var mapVisible = true;
      var drawing = false;
      var importing = false;

      function escapeHtml(text) {
        return String(text || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function closeNewMenu() {
        if (!newMenu) return;
        newMenu.hidden = true;
        newBtn.setAttribute("aria-expanded", "false");
      }

      function openNewMenu() {
        if (!newMenu) return;
        newMenu.hidden = false;
        newBtn.setAttribute("aria-expanded", "true");
      }

      function toggleNewMenu() {
        if (newMenu && newMenu.hidden) openNewMenu();
        else closeNewMenu();
      }

      function savePerimeter(geometry, suggestedName) {
        if (!geometry) return;
        var defaultName = suggestedName || defaultPerimeterName();
        var name = window.prompt("Nome do perímetro:", defaultName);
        if (name === null) return;

        store.addPerimeter(serviceRef.id, {
          name: name.trim() || defaultName,
          geometry: geometry,
          visible: true,
        });
        serviceRef.geometry = store.getServiceById(serviceRef.id).geometry;
        renderList();
        mapApi.fitGeometry(geometry);
      }

      function vertexCount(geometry) {
        if (!geometry || !geometry.coordinates || !geometry.coordinates[0]) return 0;
        var ring = geometry.coordinates[0];
        if (ring.length > 1) {
          var first = ring[0];
          var last = ring[ring.length - 1];
          if (first[0] === last[0] && first[1] === last[1]) return ring.length - 1;
        }
        return ring.length;
      }

      function ringToLatLngs(ring) {
        return ring.map(function (c) {
          return L.latLng(c[1], c[0]);
        });
      }

      function renderPerimetersOnMap() {
        perimeterLayerGroup.clearLayers();
        if (!mapVisible) return;

        store.getPerimeters(serviceRef.id).forEach(function (per) {
          if (!per.visible || !per.geometry || !per.geometry.coordinates) return;
          var latlngs = ringToLatLngs(per.geometry.coordinates[0]);
          if (latlngs.length < 3) return;
          L.polygon(latlngs, {
            color: "#2d6a4f",
            weight: 2,
            fillColor: "#2d6a4f",
            fillOpacity: 0.12,
            interactive: false,
          }).addTo(perimeterLayerGroup);
        });
      }

      function renderList() {
        var perimeters = store.getPerimeters(serviceRef.id);
        if (!perimeters.length) {
          emptyEl.hidden = false;
          listEl.hidden = true;
          listEl.innerHTML = "";
          renderPerimetersOnMap();
          if (refreshEntregasState) refreshEntregasState();
          return;
        }

        emptyEl.hidden = true;
        listEl.hidden = false;
        listEl.innerHTML = perimeters
          .map(function (per) {
            var verts = vertexCount(per.geometry);
            var area = polygonAreaHa(per.geometry);
            return (
              '<div class="perimeter-item" data-id="' +
              escapeHtml(per.id) +
              '">' +
              '<div class="perimeter-item__info">' +
              '<span class="perimeter-item__name">' +
              escapeHtml(per.name) +
              "</span>" +
              '<span class="perimeter-item__meta">' +
              verts +
              " vértice(s)" +
              (area > 0 ? " · " + area.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " m²" : "") +
              "</span>" +
              "</div>" +
              '<div class="perimeter-item__actions">' +
              '<button type="button" class="perimeter-item__zoom" data-id="' +
              escapeHtml(per.id) +
              '" title="Zoom no perímetro" aria-label="Zoom no perímetro">' +
              '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
              "</button>" +
              '<button type="button" class="perimeter-item__remove" data-id="' +
              escapeHtml(per.id) +
              '" title="Excluir perímetro" aria-label="Excluir perímetro">&times;</button>' +
              "</div></div>"
            );
          })
          .join("");

        listEl.querySelectorAll(".perimeter-item__remove").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var id = btn.getAttribute("data-id");
            if (!confirm("Excluir este perímetro?")) return;
            store.deletePerimeter(serviceRef.id, id);
            serviceRef.geometry = store.getServiceById(serviceRef.id).geometry;
            renderList();
          });
        });

        listEl.querySelectorAll(".perimeter-item__zoom").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var id = btn.getAttribute("data-id");
            var per = store.getPerimeters(serviceRef.id).find(function (p) {
              return p.id === id;
            });
            if (per && per.geometry) mapApi.fitGeometry(per.geometry);
          });
        });

        renderPerimetersOnMap();
        if (refreshEntregasState) refreshEntregasState();
      }

      function defaultPerimeterName() {
        var count = store.getPerimeters(serviceRef.id).length;
        return "Perímetro " + (count + 1);
      }

      function finishDraw(geometry) {
        drawing = false;
        newBtn.disabled = false;
        savePerimeter(geometry, defaultPerimeterName());
      }

      function startDrawPerimeter() {
        if (drawing || importing) return;
        closeNewMenu();
        drawing = true;
        newBtn.disabled = true;
        mapApi.stopAllTools();
        if (mapApi.hideTopoDrawBar) mapApi.hideTopoDrawBar();
        if (mapApi.hideContourBar) mapApi.hideContourBar();

        if (mapApi.startDrawArea) {
          mapApi.startDrawArea(finishDraw);
        } else {
          drawing = false;
          newBtn.disabled = false;
          alert("Ferramenta de desenho indisponível.");
        }
      }

      function startImportPerimeter() {
        if (drawing || importing || !fileInput) return;
        closeNewMenu();
        fileInput.value = "";
        fileInput.click();
      }

      function handleImportFile() {
        var file = fileInput && fileInput.files && fileInput.files[0];
        if (!file) return;
        if (!global.VTPerimeterImport || !global.VTPerimeterImport.parseFile) {
          alert("Importação de arquivos indisponível.");
          return;
        }

        importing = true;
        newBtn.disabled = true;
        global.VTPerimeterImport.parseFile(file)
          .then(function (result) {
            savePerimeter(result.geometry, result.suggestedName);
          })
          .catch(function (err) {
            alert(err && err.message ? err.message : "Falha ao importar o arquivo.");
          })
          .finally(function () {
            importing = false;
            newBtn.disabled = false;
            if (fileInput) fileInput.value = "";
          });
      }

      newBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (drawing || importing) return;
        toggleNewMenu();
      });

      if (newMenu) {
        newMenu.querySelectorAll("[data-perimeter-action]").forEach(function (btn) {
          btn.addEventListener("click", function (e) {
            e.stopPropagation();
            var action = btn.getAttribute("data-perimeter-action");
            if (action === "draw") startDrawPerimeter();
            else if (action === "import") startImportPerimeter();
          });
        });
      }

      if (fileInput) {
        fileInput.addEventListener("change", handleImportFile);
      }

      document.addEventListener("click", function (e) {
        if (!newMenu || newMenu.hidden) return;
        if (newBtn.contains(e.target) || newMenu.contains(e.target)) return;
        closeNewMenu();
      });

      if (visBtn) {
        visBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          mapVisible = !mapVisible;
          visBtn.classList.toggle("is-on", mapVisible);
          visBtn.setAttribute("aria-pressed", mapVisible ? "true" : "false");
          renderPerimetersOnMap();
        });
      }

      renderList();
    }

    function initCarimboConfigModal() {
      var CARIMBO_KEY = "vt_gis_carimbo_config";
      var modal = document.getElementById("carimbo-config-modal");
      var closeBtn = document.getElementById("carimbo-config-close");
      var tabBtns = document.querySelectorAll("[data-carimbo-tab]");
      var empEmpty = document.getElementById("carimbo-empresas-empty");
      var empList = document.getElementById("carimbo-empresas-list");
      var respEmpty = document.getElementById("carimbo-responsaveis-empty");
      var respList = document.getElementById("carimbo-responsaveis-list");
      var selEmpresa = document.getElementById("entregas-carimbo-empresa");
      var selResponsavel = document.getElementById("entregas-carimbo-responsavel");
      var definidoEl = document.getElementById("entregas-carimbo-definido");
      var contaEmpresa = document.getElementById("carimbo-conta-empresa");
      var contaResponsavel = document.getElementById("carimbo-conta-responsavel");
      var logoInput = document.getElementById("carimbo-empresa-logo");
      var logoName = document.getElementById("carimbo-empresa-logo-name");
      var empFormTitle = document.getElementById("carimbo-empresa-form-title");
      var empSubmit = document.getElementById("carimbo-empresa-submit");
      var respFormTitle = document.getElementById("carimbo-resp-form-title");
      var respSubmit = document.getElementById("carimbo-resp-submit");
      var editingEmpresaId = "";
      var editingResponsavelId = "";

      var ICON_EDIT =
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
      var ICON_DELETE =
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

      if (!modal) return { open: function () {} };

      function loadConfig() {
        try {
          var raw = localStorage.getItem(CARIMBO_KEY);
          if (raw) {
            var data = JSON.parse(raw);
            return {
              companies: data.companies || [],
              responsaveis: data.responsaveis || [],
              defaultEmpresaId: data.defaultEmpresaId || "",
              defaultResponsavelId: data.defaultResponsavelId || "",
            };
          }
        } catch (e) {}
        return { companies: [], responsaveis: [], defaultEmpresaId: "", defaultResponsavelId: "" };
      }

      function saveConfig(config) {
        localStorage.setItem(CARIMBO_KEY, JSON.stringify(config));
      }

      function nextId(prefix) {
        return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      }

      function switchTab(tabId) {
        tabBtns.forEach(function (btn) {
          var active = btn.getAttribute("data-carimbo-tab") === tabId;
          btn.classList.toggle("is-active", active);
          btn.setAttribute("aria-selected", active ? "true" : "false");
        });
        ["empresas", "responsaveis", "conta"].forEach(function (id) {
          var panel = document.getElementById("carimbo-tab-" + id);
          if (panel) panel.hidden = id !== tabId;
        });
      }

      function fillSelect(selectEl, items, labelKey, defaultId, emptyLabel) {
        if (!selectEl) return;
        var current = selectEl.value;
        selectEl.innerHTML = "";
        var optDefault = document.createElement("option");
        optDefault.value = "";
        optDefault.textContent = emptyLabel;
        selectEl.appendChild(optDefault);
        items.forEach(function (item) {
          var opt = document.createElement("option");
          opt.value = item.id;
          opt.textContent = item[labelKey];
          selectEl.appendChild(opt);
        });
        if (current && selectEl.querySelector('option[value="' + current + '"]')) {
          selectEl.value = current;
        } else if (defaultId && selectEl.querySelector('option[value="' + defaultId + '"]')) {
          selectEl.value = defaultId;
        }
      }

      function companySubtitle(c) {
        var cnpj = c.cnpj || "—";
        var crea = c.crea || "—";
        var loc = [c.cidade, c.uf].filter(Boolean).join(" ");
        return cnpj + " · " + crea + " · " + (loc || "—");
      }

      function renderCompanyItem(c) {
        var logoHtml = c.logo
          ? '<img src="' + escapeHtml(c.logo) + '" alt="">'
          : "sem<br>logo";
        var badge = c.isDefault ? '<span class="carimbo-config-list__badge">Padrão</span>' : "";
        return (
          '<div class="carimbo-config-list__item" data-carimbo-emp-id="' +
          escapeHtml(c.id) +
          '">' +
          '<div class="carimbo-config-list__logo">' +
          logoHtml +
          "</div>" +
          '<div class="carimbo-config-list__body">' +
          '<div class="carimbo-config-list__head">' +
          '<span class="carimbo-config-list__name">' +
          escapeHtml(c.razaoSocial) +
          "</span>" +
          badge +
          "</div>" +
          '<div class="carimbo-config-list__meta">' +
          escapeHtml(companySubtitle(c)) +
          "</div>" +
          "</div>" +
          '<div class="carimbo-config-list__actions">' +
          '<button type="button" class="carimbo-config-list__action" data-carimbo-emp-edit aria-label="Editar empresa">' +
          ICON_EDIT +
          "</button>" +
          '<button type="button" class="carimbo-config-list__action carimbo-config-list__action--danger" data-carimbo-emp-delete aria-label="Excluir empresa">' +
          ICON_DELETE +
          "</button>" +
          "</div>" +
          "</div>"
        );
      }

      function responsavelSubtitle(r) {
        var parts = [r.titulo, r.crea, r.celular, r.credenciamentoIncra].filter(function (p) {
          return !!p;
        });
        return parts.length ? parts.join(" · ") : "—";
      }

      function renderResponsavelItem(r) {
        var badge = r.isDefault ? '<span class="carimbo-config-list__badge">Padrão</span>' : "";
        return (
          '<div class="carimbo-config-list__item carimbo-config-list__item--resp" data-carimbo-resp-id="' +
          escapeHtml(r.id) +
          '">' +
          '<div class="carimbo-config-list__body">' +
          '<div class="carimbo-config-list__head">' +
          '<span class="carimbo-config-list__name">' +
          escapeHtml(r.nome) +
          "</span>" +
          badge +
          "</div>" +
          '<div class="carimbo-config-list__meta">' +
          escapeHtml(responsavelSubtitle(r)) +
          "</div>" +
          "</div>" +
          '<div class="carimbo-config-list__actions">' +
          '<button type="button" class="carimbo-config-list__action" data-carimbo-resp-edit aria-label="Editar responsável">' +
          ICON_EDIT +
          "</button>" +
          '<button type="button" class="carimbo-config-list__action carimbo-config-list__action--danger" data-carimbo-resp-delete aria-label="Excluir responsável">' +
          ICON_DELETE +
          "</button>" +
          "</div>" +
          "</div>"
        );
      }

      function refreshCarimboDefinido(config) {
        if (!definidoEl) return;
        config = config || loadConfig();
        var empresaOk = (selEmpresa && selEmpresa.value) || config.defaultEmpresaId;
        var responsavelOk = (selResponsavel && selResponsavel.value) || config.defaultResponsavelId;
        definidoEl.hidden = !(empresaOk && responsavelOk);
      }

      function renderLists(config) {
        if (empEmpty && empList) {
          var hasEmp = config.companies.length > 0;
          empEmpty.hidden = hasEmp;
          empList.hidden = !hasEmp;
          if (hasEmp) {
            empList.innerHTML = config.companies.map(renderCompanyItem).join("");
          }
        }

        if (respEmpty && respList) {
          var hasResp = config.responsaveis.length > 0;
          respEmpty.hidden = hasResp;
          respList.hidden = !hasResp;
          if (hasResp) {
            respList.innerHTML = config.responsaveis.map(renderResponsavelItem).join("");
          }
        }

        fillSelect(selEmpresa, config.companies, "razaoSocial", "", "— Padrão da conta —");
        fillSelect(selResponsavel, config.responsaveis, "nome", "", "— Padrão da conta —");
        fillSelect(contaEmpresa, config.companies, "razaoSocial", config.defaultEmpresaId, "— Nenhuma —");
        fillSelect(contaResponsavel, config.responsaveis, "nome", config.defaultResponsavelId, "— Nenhum —");
        refreshCarimboDefinido(config);
      }

      function escapeHtml(str) {
        return String(str)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function setEmpresaFormMode(mode) {
        if (empFormTitle) {
          empFormTitle.textContent = mode === "edit" ? "Editar empresa" : "Nova empresa";
        }
        if (empSubmit) {
          empSubmit.textContent = mode === "edit" ? "Salvar empresa" : "Cadastrar empresa";
        }
      }

      function resetEmpresaForm() {
        editingEmpresaId = "";
        document.getElementById("carimbo-empresa-razao").value = "";
        document.getElementById("carimbo-empresa-cnpj").value = "";
        document.getElementById("carimbo-empresa-crea").value = "";
        document.getElementById("carimbo-empresa-endereco").value = "";
        document.getElementById("carimbo-empresa-cidade").value = "";
        document.getElementById("carimbo-empresa-uf").value = "";
        document.getElementById("carimbo-empresa-telefone").value = "";
        document.getElementById("carimbo-empresa-padrao").checked = false;
        if (logoInput) logoInput.value = "";
        if (logoName) logoName.textContent = "Nenhum arquivo escolhido";
        setEmpresaFormMode("new");
      }

      function fillEmpresaForm(company) {
        editingEmpresaId = company.id;
        document.getElementById("carimbo-empresa-razao").value = company.razaoSocial || "";
        document.getElementById("carimbo-empresa-cnpj").value = company.cnpj || "";
        document.getElementById("carimbo-empresa-crea").value = company.crea || "";
        document.getElementById("carimbo-empresa-endereco").value = company.endereco || "";
        document.getElementById("carimbo-empresa-cidade").value = company.cidade || "";
        document.getElementById("carimbo-empresa-uf").value = company.uf || "";
        document.getElementById("carimbo-empresa-telefone").value = company.telefone || "";
        document.getElementById("carimbo-empresa-padrao").checked = !!company.isDefault;
        if (logoInput) logoInput.value = "";
        if (logoName) {
          logoName.textContent = company.logo ? "Logo cadastrado (escolha outro para substituir)" : "Nenhum arquivo escolhido";
        }
        setEmpresaFormMode("edit");
        var formEl = empFormTitle && empFormTitle.closest(".carimbo-config-form");
        if (formEl && formEl.scrollIntoView) {
          formEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }

      function deleteEmpresa(id) {
        var config = loadConfig();
        var company = config.companies.find(function (c) {
          return c.id === id;
        });
        if (!company) return;
        if (!window.confirm('Excluir a empresa "' + company.razaoSocial + '"?')) return;
        config.companies = config.companies.filter(function (c) {
          return c.id !== id;
        });
        if (config.defaultEmpresaId === id) config.defaultEmpresaId = "";
        saveConfig(config);
        if (editingEmpresaId === id) resetEmpresaForm();
        renderLists(config);
      }

      function setRespFormMode(mode) {
        if (respFormTitle) {
          respFormTitle.textContent = mode === "edit" ? "Editar responsável técnico" : "Novo responsável técnico";
        }
        if (respSubmit) {
          respSubmit.textContent = mode === "edit" ? "Salvar responsável" : "Cadastrar responsável";
        }
      }

      function resetRespForm() {
        editingResponsavelId = "";
        document.getElementById("carimbo-resp-nome").value = "";
        document.getElementById("carimbo-resp-titulo").value = "";
        document.getElementById("carimbo-resp-crea").value = "";
        document.getElementById("carimbo-resp-celular").value = "";
        document.getElementById("carimbo-resp-incra").value = "";
        document.getElementById("carimbo-resp-padrao").checked = false;
        setRespFormMode("new");
      }

      function fillRespForm(resp) {
        editingResponsavelId = resp.id;
        document.getElementById("carimbo-resp-nome").value = resp.nome || "";
        document.getElementById("carimbo-resp-titulo").value = resp.titulo || "";
        document.getElementById("carimbo-resp-crea").value = resp.crea || "";
        document.getElementById("carimbo-resp-celular").value = resp.celular || "";
        document.getElementById("carimbo-resp-incra").value = resp.credenciamentoIncra || "";
        document.getElementById("carimbo-resp-padrao").checked = !!resp.isDefault;
        setRespFormMode("edit");
        var formEl = respFormTitle && respFormTitle.closest(".carimbo-config-form");
        if (formEl && formEl.scrollIntoView) {
          formEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }

      function deleteResponsavel(id) {
        var config = loadConfig();
        var resp = config.responsaveis.find(function (r) {
          return r.id === id;
        });
        if (!resp) return;
        if (!window.confirm('Excluir o responsável "' + resp.nome + '"?')) return;
        config.responsaveis = config.responsaveis.filter(function (r) {
          return r.id !== id;
        });
        if (config.defaultResponsavelId === id) config.defaultResponsavelId = "";
        saveConfig(config);
        if (editingResponsavelId === id) resetRespForm();
        renderLists(config);
      }

      function openModal() {
        var config = loadConfig();
        resetEmpresaForm();
        resetRespForm();
        renderLists(config);
        switchTab("empresas");
        modal.hidden = false;
      }

      function closeModal() {
        modal.hidden = true;
      }

      tabBtns.forEach(function (btn) {
        btn.addEventListener("click", function () {
          switchTab(btn.getAttribute("data-carimbo-tab"));
        });
      });

      if (closeBtn) closeBtn.addEventListener("click", closeModal);

      modal.addEventListener("click", function (e) {
        if (e.target === modal) closeModal();
      });

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !modal.hidden) closeModal();
      });

      if (empList) {
        empList.addEventListener("click", function (e) {
          var item = e.target.closest("[data-carimbo-emp-id]");
          if (!item) return;
          var id = item.getAttribute("data-carimbo-emp-id");
          if (e.target.closest("[data-carimbo-emp-edit]")) {
            var config = loadConfig();
            var company = config.companies.find(function (c) {
              return c.id === id;
            });
            if (company) fillEmpresaForm(company);
            return;
          }
          if (e.target.closest("[data-carimbo-emp-delete]")) {
            deleteEmpresa(id);
          }
        });
      }

      if (respList) {
        respList.addEventListener("click", function (e) {
          var item = e.target.closest("[data-carimbo-resp-id]");
          if (!item) return;
          var id = item.getAttribute("data-carimbo-resp-id");
          if (e.target.closest("[data-carimbo-resp-edit]")) {
            var config = loadConfig();
            var resp = config.responsaveis.find(function (r) {
              return r.id === id;
            });
            if (resp) fillRespForm(resp);
            return;
          }
          if (e.target.closest("[data-carimbo-resp-delete]")) {
            deleteResponsavel(id);
          }
        });
      }

      if (logoInput && logoName) {
        logoInput.addEventListener("change", function () {
          var file = logoInput.files && logoInput.files[0];
          logoName.textContent = file ? file.name : "Nenhum arquivo escolhido";
        });
      }

      if (empSubmit) {
        empSubmit.addEventListener("click", function () {
          var razao = document.getElementById("carimbo-empresa-razao").value.trim();
          if (!razao) {
            document.getElementById("carimbo-empresa-razao").focus();
            return;
          }

          var file = logoInput && logoInput.files && logoInput.files[0];
          var maxLogo = 10 * 1024 * 1024;

          function persist(logoDataUrl) {
            var config = loadConfig();
            var isDefault = document.getElementById("carimbo-empresa-padrao").checked;
            if (isDefault) {
              config.companies.forEach(function (c) {
                c.isDefault = false;
              });
            }

            var fields = {
              razaoSocial: razao,
              cnpj: document.getElementById("carimbo-empresa-cnpj").value.trim(),
              crea: document.getElementById("carimbo-empresa-crea").value.trim(),
              endereco: document.getElementById("carimbo-empresa-endereco").value.trim(),
              cidade: document.getElementById("carimbo-empresa-cidade").value.trim(),
              uf: document.getElementById("carimbo-empresa-uf").value.trim().toUpperCase(),
              telefone: document.getElementById("carimbo-empresa-telefone").value.trim(),
              isDefault: isDefault,
            };

            if (editingEmpresaId) {
              var existing = config.companies.find(function (c) {
                return c.id === editingEmpresaId;
              });
              if (existing) {
                Object.assign(existing, fields);
                if (logoDataUrl !== null) existing.logo = logoDataUrl;
                if (isDefault) config.defaultEmpresaId = existing.id;
                else if (config.defaultEmpresaId === existing.id) config.defaultEmpresaId = "";
              }
            } else {
              var company = Object.assign(
                {
                  id: nextId("emp"),
                  logo: logoDataUrl || "",
                },
                fields
              );
              config.companies.push(company);
              if (isDefault) config.defaultEmpresaId = company.id;
            }

            saveConfig(config);
            renderLists(config);
            resetEmpresaForm();
          }

          if (file) {
            if (file.size > maxLogo) {
              alert("O logo deve ter no máximo 10 MB.");
              return;
            }
            var reader = new FileReader();
            reader.onload = function () {
              persist(reader.result);
            };
            reader.readAsDataURL(file);
          } else if (editingEmpresaId) {
            persist(null);
          } else {
            persist("");
          }
        });
      }

      if (respSubmit) {
        respSubmit.addEventListener("click", function () {
          var nome = document.getElementById("carimbo-resp-nome").value.trim();
          if (!nome) {
            document.getElementById("carimbo-resp-nome").focus();
            return;
          }
          var config = loadConfig();
          var isDefault = document.getElementById("carimbo-resp-padrao").checked;
          if (isDefault) {
            config.responsaveis.forEach(function (r) {
              r.isDefault = false;
            });
          }

          var fields = {
            nome: nome,
            titulo: document.getElementById("carimbo-resp-titulo").value.trim(),
            crea: document.getElementById("carimbo-resp-crea").value.trim(),
            celular: document.getElementById("carimbo-resp-celular").value.trim(),
            credenciamentoIncra: document.getElementById("carimbo-resp-incra").value.trim().toUpperCase(),
            isDefault: isDefault,
          };

          if (editingResponsavelId) {
            var existing = config.responsaveis.find(function (r) {
              return r.id === editingResponsavelId;
            });
            if (existing) {
              Object.assign(existing, fields);
              if (isDefault) config.defaultResponsavelId = existing.id;
              else if (config.defaultResponsavelId === existing.id) config.defaultResponsavelId = "";
            }
          } else {
            var resp = Object.assign({ id: nextId("resp") }, fields);
            config.responsaveis.push(resp);
            if (isDefault) config.defaultResponsavelId = resp.id;
          }

          saveConfig(config);
          renderLists(config);
          resetRespForm();
        });
      }

      if (contaEmpresa) {
        contaEmpresa.addEventListener("change", function () {
          var config = loadConfig();
          config.defaultEmpresaId = contaEmpresa.value;
          config.companies.forEach(function (c) {
            c.isDefault = c.id === config.defaultEmpresaId;
          });
          saveConfig(config);
          renderLists(config);
        });
      }

      if (contaResponsavel) {
        contaResponsavel.addEventListener("change", function () {
          var config = loadConfig();
          config.defaultResponsavelId = contaResponsavel.value;
          config.responsaveis.forEach(function (r) {
            r.isDefault = r.id === config.defaultResponsavelId;
          });
          saveConfig(config);
          renderLists(config);
        });
      }

      if (selEmpresa) {
        selEmpresa.addEventListener("change", function () {
          refreshCarimboDefinido();
        });
      }

      if (selResponsavel) {
        selResponsavel.addEventListener("change", function () {
          refreshCarimboDefinido();
        });
      }

      renderLists(loadConfig());

      return { open: openModal };
    }

    function initMemoriaisDocumentos(serviceRef) {
      var emptyEl = document.getElementById("entregas-memoriais-empty");
      var listEl = document.getElementById("entregas-memoriais-list");
      var badgeEl = document.getElementById("entregas-badge-memoriais");

      function escapeHtml(text) {
        return String(text || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function memorialBtn(label, iconSvg, action) {
        return (
          '<button type="button" class="entregas-memorial-btn" data-memorial-action="' +
          action +
          '">' +
          iconSvg +
          "<span>" +
          escapeHtml(label) +
          "</span></button>"
        );
      }

      var iconEditMemorial =
        '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
      var iconNotas =
        '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 6h8M8 10h8M8 14h5"/></svg>';
      var iconAssinam =
        '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3"/><path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>';
      var iconPreview =
        '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="2.5"/></svg>';
      var iconDocMemorial =
        '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 4h9l3 3v13H6z"/><path d="M15 4v4h4"/></svg>';
      var iconPlanilha =
        '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9h16M4 14h16M9 4v16"/></svg>';
      var iconCartas =
        '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M3 8l9 6 9-6"/></svg>';
      var iconKml =
        '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M2 12h20M12 4a14 14 0 0 1 0 16M12 4a14 14 0 0 0 0 16"/></svg>';

      function renderMemorialCard(per) {
        return (
          '<div class="entregas-memorial-card" data-perimeter-id="' +
          escapeHtml(per.id) +
          '">' +
          '<h4 class="entregas-memorial-card__title">' +
          escapeHtml(per.name) +
          "</h4>" +
          '<div class="entregas-memorial-actions">' +
          '<span class="entregas-memorial-actions__label">Editar</span>' +
          '<div class="entregas-memorial-actions__row">' +
          memorialBtn("Memorial", iconEditMemorial, "edit-memorial") +
          memorialBtn("Notas", iconNotas, "edit-notas") +
          memorialBtn("Assinam.", iconAssinam, "edit-assinam") +
          memorialBtn("Preview", iconPreview, "edit-preview") +
          "</div>" +
          '<span class="entregas-memorial-actions__label">Baixar</span>' +
          '<div class="entregas-memorial-actions__row">' +
          memorialBtn("Memorial", iconDocMemorial, "dl-memorial") +
          memorialBtn("Planilha", iconPlanilha, "dl-planilha") +
          memorialBtn("Cartas", iconCartas, "dl-cartas") +
          memorialBtn("KML", iconKml, "dl-kml") +
          "</div>" +
          "</div></div>"
        );
      }

      function refresh() {
        var perimeters = store.getPerimeters(serviceRef.id);
        if (badgeEl) {
          badgeEl.textContent = String(perimeters.length);
          badgeEl.hidden = perimeters.length === 0;
        }
        if (!emptyEl || !listEl) return;
        if (!perimeters.length) {
          emptyEl.hidden = false;
          listEl.hidden = true;
          listEl.innerHTML = "";
          return;
        }
        emptyEl.hidden = true;
        listEl.hidden = false;
        listEl.innerHTML = perimeters.map(renderMemorialCard).join("");
      }

      var memorialEditor = initMemorialEditor(serviceRef);
      var notasEditor = initNotasEditor(serviceRef);

      if (listEl) {
        listEl.addEventListener("click", function (e) {
          var actionBtn = e.target.closest("[data-memorial-action]");
          if (!actionBtn) return;
          var card = actionBtn.closest("[data-perimeter-id]");
          if (!card) return;
          var perimeterId = card.getAttribute("data-perimeter-id");
          var action = actionBtn.getAttribute("data-memorial-action");
          if (action === "edit-memorial") memorialEditor.open(perimeterId);
          if (action === "edit-notas") notasEditor.open(perimeterId);
        });
      }

      return refresh;
    }

    function initMemorialEditor(serviceRef) {
      var modal = document.getElementById("memorial-editor-modal");
      var closeBtn = document.getElementById("memorial-editor-close");
      var cancelBtn = document.getElementById("memorial-editor-cancel");
      var applyBtn = document.getElementById("memorial-editor-apply");
      var regenBtn = document.getElementById("memorial-editor-regen");
      var textEl = document.getElementById("memorial-editor-text");
      var statsEl = document.getElementById("memorial-editor-stats");
      var activePerimeterId = "";
      var autoText = "";

      if (!modal || !textEl) return { open: function () {} };

      function updateStats() {
        if (!statsEl) return;
        var text = textEl.value || "";
        var words = global.VTMemorial ? global.VTMemorial.countWords(text) : 0;
        statsEl.textContent = text.length + " caracteres · " + words + " palavras";
      }

      function closeModal() {
        modal.hidden = true;
        activePerimeterId = "";
        autoText = "";
      }

      function generateAuto(geometry) {
        if (!global.VTMemorial) return { text: "", error: "Gerador de memorial indisponível." };
        return global.VTMemorial.generateDescriptiveMemorial(geometry);
      }

      function looksLikeAutoMemorial(text) {
        return /^ÁREA\s*=\s*[\d.,]+\s*m²\s*\nPERÍMETRO\s*=/i.test(String(text || "").trim());
      }

      function resolveMemorialText(perimeter, generatedText) {
        var saved = (perimeter.memorialText || "").trim();
        if (perimeter.memorialCustom && saved) return perimeter.memorialText;
        if (saved && saved !== generatedText.trim() && !looksLikeAutoMemorial(saved)) {
          return perimeter.memorialText;
        }
        if (saved) {
          store.updatePerimeter(serviceRef.id, perimeter.id, {
            memorialText: "",
            memorialCustom: false,
          });
        }
        return generatedText;
      }

      function open(perimeterId) {
        var perimeters = store.getPerimeters(serviceRef.id);
        var perimeter = perimeters.find(function (p) {
          return p.id === perimeterId;
        });
        if (!perimeter || !perimeter.geometry) {
          alert("Imóvel sem geometria cadastrada.");
          return;
        }

        var generated = generateAuto(perimeter.geometry);
        if (generated.error) {
          alert(generated.error);
          return;
        }

        activePerimeterId = perimeterId;
        autoText = generated.text;
        textEl.value = resolveMemorialText(perimeter, autoText);
        updateStats();
        modal.hidden = false;
        textEl.focus();
      }

      if (closeBtn) closeBtn.addEventListener("click", closeModal);
      if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

      modal.addEventListener("click", function (e) {
        if (e.target === modal) closeModal();
      });

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !modal.hidden) closeModal();
      });

      textEl.addEventListener("input", updateStats);

      if (regenBtn) {
        regenBtn.addEventListener("click", function () {
          if (!activePerimeterId) return;
          var perimeter = store.getPerimeters(serviceRef.id).find(function (p) {
            return p.id === activePerimeterId;
          });
          if (!perimeter || !perimeter.geometry) return;
          var generated = generateAuto(perimeter.geometry);
          if (generated.error) {
            alert(generated.error);
            return;
          }
          autoText = generated.text;
          textEl.value = autoText;
          updateStats();
        });
      }

      if (applyBtn) {
        applyBtn.addEventListener("click", function () {
          if (!activePerimeterId) return;
          var value = textEl.value.trim();
          if (!value || value === autoText.trim()) {
            store.updatePerimeter(serviceRef.id, activePerimeterId, {
              memorialText: "",
              memorialCustom: false,
            });
          } else {
            store.updatePerimeter(serviceRef.id, activePerimeterId, {
              memorialText: value,
              memorialCustom: true,
            });
          }
          closeModal();
        });
      }

      return { open: open };
    }

    function initNotasEditor(serviceRef) {
      var modal = document.getElementById("notas-gerais-modal");
      var closeBtn = document.getElementById("notas-gerais-close");
      var cancelBtn = document.getElementById("notas-gerais-cancel");
      var applyBtn = document.getElementById("notas-gerais-apply");
      var restoreBtn = document.getElementById("notas-gerais-restore");
      var addBtn = document.getElementById("notas-gerais-add");
      var listEl = document.getElementById("notas-gerais-list");
      var activePerimeterId = "";
      var draftNotes = [];
      var defaultNotes = [];

      var ICON_DELETE =
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

      if (!modal || !listEl) return { open: function () {} };

      function utmMeridianLabel(zone) {
        var meridian = Math.abs(zone * 6 - 183);
        return meridian + "ºW";
      }

      function buildDefaultNotes(geometry) {
        var zone = global.VTMemorial ? global.VTMemorial.getUtmZone(geometry) : 22;
        return [
          "Dimensões cotadas em metros, salvo indicação contrária.",
          "Este documento está georreferenciado em projeção plana UTM (Universal Transversa de Mercator), Datum SIRGAS 2000, Meridiano Central: " +
            utmMeridianLabel(zone) +
            "; Zona " +
            zone +
            " e ao Datum Vertical de altitude ortométrica dos mareógrafos situados em Imbituba-SC.",
          'Equipamentos utilizados: Estação Total — precisão angular = 7"; Sistema GPS L1/L2 e RTK; Computadores e softwares.',
          "Documentos de referência: INCRA 2013 — Manual Técnico de Posicionamento; NBR 13.133 — Execução de Levantamentos Topográficos; IBGE 2008 — Recomendações para Levantamentos Relativos Estáticos — GPS.",
          "Este documento é de propriedade da empresa executante, e não pode ser reproduzido ou usado para qualquer finalidade diferente daquela para qual está sendo fornecido.",
        ];
      }

      function renderList() {
        listEl.innerHTML = draftNotes
          .map(function (note, index) {
            return (
              '<div class="notas-gerais-item">' +
              '<span class="notas-gerais-item__num">' +
              (index + 1) +
              ".</span>" +
              '<textarea class="notas-gerais-item__text" rows="2" data-nota-index="' +
              index +
              '"></textarea>' +
              '<button type="button" class="notas-gerais-item__delete" data-nota-delete="' +
              index +
              '" aria-label="Remover nota">' +
              ICON_DELETE +
              "</button>" +
              "</div>"
            );
          })
          .join("");

        listEl.querySelectorAll(".notas-gerais-item__text").forEach(function (field) {
          var idx = parseInt(field.getAttribute("data-nota-index"), 10);
          if (!isNaN(idx)) field.value = draftNotes[idx] || "";
          field.addEventListener("input", function () {
            if (!isNaN(idx)) draftNotes[idx] = field.value;
          });
        });

        listEl.querySelectorAll("[data-nota-delete]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var idx = parseInt(btn.getAttribute("data-nota-delete"), 10);
            if (isNaN(idx)) return;
            draftNotes.splice(idx, 1);
            renderList();
          });
        });
      }

      function closeModal() {
        modal.hidden = true;
        activePerimeterId = "";
        draftNotes = [];
        defaultNotes = [];
      }

      function open(perimeterId) {
        var perimeter = store.getPerimeters(serviceRef.id).find(function (p) {
          return p.id === perimeterId;
        });
        if (!perimeter) return;

        activePerimeterId = perimeterId;
        defaultNotes = buildDefaultNotes(perimeter.geometry);
        var saved = Array.isArray(perimeter.generalNotes) ? perimeter.generalNotes : [];
        draftNotes = saved.length ? saved.slice() : defaultNotes.slice();
        renderList();
        modal.hidden = false;
      }

      if (closeBtn) closeBtn.addEventListener("click", closeModal);
      if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

      modal.addEventListener("click", function (e) {
        if (e.target === modal) closeModal();
      });

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !modal.hidden) closeModal();
      });

      if (addBtn) {
        addBtn.addEventListener("click", function () {
          draftNotes.push("");
          renderList();
          var fields = listEl.querySelectorAll(".notas-gerais-item__text");
          var last = fields[fields.length - 1];
          if (last) last.focus();
        });
      }

      if (restoreBtn) {
        restoreBtn.addEventListener("click", function () {
          if (!activePerimeterId) return;
          var perimeter = store.getPerimeters(serviceRef.id).find(function (p) {
            return p.id === activePerimeterId;
          });
          defaultNotes = buildDefaultNotes(perimeter && perimeter.geometry);
          draftNotes = defaultNotes.slice();
          renderList();
        });
      }

      if (applyBtn) {
        applyBtn.addEventListener("click", function () {
          if (!activePerimeterId) return;
          listEl.querySelectorAll(".notas-gerais-item__text").forEach(function (field) {
            var idx = parseInt(field.getAttribute("data-nota-index"), 10);
            if (!isNaN(idx)) draftNotes[idx] = field.value;
          });
          var notes = draftNotes.map(function (n) {
            return String(n || "").trim();
          }).filter(Boolean);
          store.updatePerimeter(serviceRef.id, activePerimeterId, { generalNotes: notes });
          closeModal();
        });
      }

      return { open: open };
    }

    function initEntregas(serviceRef) {
      var noPerEl = document.getElementById("entregas-no-perimeter");
      var goLimites = document.getElementById("entregas-go-limites");
      var manageCarimbo = document.getElementById("entregas-carimbo-manage");
      var carimboConfig = initCarimboConfigModal();
      var refreshMemoriais = initMemoriaisDocumentos(serviceRef);

      function refresh() {
        if (noPerEl) {
          noPerEl.hidden = store.getPerimeters(serviceRef.id).length > 0;
        }
        refreshMemoriais();
      }

      if (goLimites) {
        goLimites.addEventListener("click", function () {
          showSection("limites");
        });
      }

      if (manageCarimbo) {
        manageCarimbo.addEventListener("click", function () {
          carimboConfig.open();
        });
      }

      refreshEntregasState = refresh;
      refresh();
    }

    function initPointGroupImport() {
      var fileInput = document.getElementById("point-group-file");
      var fileLabel = document.getElementById("point-group-file-label");
      var nameInput = document.getElementById("point-group-name");
      var fusoInput = document.getElementById("point-group-fuso");
      var btnCancel = document.getElementById("point-group-cancel");
      var btnImport = document.getElementById("point-group-import");
      var listEl = document.getElementById("point-group-list");

      if (!fileInput || !btnImport) return;

      function resetForm() {
        fileInput.value = "";
        nameInput.value = "";
        fusoInput.value = "";
        fileLabel.textContent = "Selecionar arquivo (.txt, .csv)";
      }

      function renderList(groups) {
        if (!listEl) return;
        if (!groups.length) {
          listEl.hidden = true;
          listEl.innerHTML = "";
          return;
        }
        listEl.hidden = false;
        listEl.innerHTML = groups
          .map(function (g) {
            return (
              '<div class="point-group-item">' +
              "<strong>" + escapeHtml(g.name) + "</strong>" +
              '<div class="point-group-item__meta">' +
              g.pointCount +
              " ponto(s)" +
              (g.fuso ? " · Fuso " + escapeHtml(g.fuso) : "") +
              "</div></div>"
            );
          })
          .join("");
      }

      function escapeHtml(text) {
        return String(text || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function countPoints(text) {
        var lines = text.split(/\r?\n/);
        var count = 0;
        lines.forEach(function (line) {
          var trimmed = line.trim();
          if (!trimmed || trimmed.charAt(0) === "#") return;
          if (/^[a-zA-Z_]/i.test(trimmed.split(/[,;\s]/)[0]) && trimmed.indexOf(",") === -1) return;
          count += 1;
        });
        return count;
      }

      fileInput.addEventListener("change", function () {
        if (fileInput.files && fileInput.files[0]) {
          fileLabel.textContent = fileInput.files[0].name;
        } else {
          fileLabel.textContent = "Selecionar arquivo (.txt, .csv)";
        }
      });

      btnCancel.addEventListener("click", resetForm);

      btnImport.addEventListener("click", function () {
        var name = nameInput.value.trim();
        var fuso = fusoInput.value.trim();
        var file = fileInput.files && fileInput.files[0];

        if (!name) {
          alert("Informe o nome do grupo.");
          nameInput.focus();
          return;
        }
        if (!file) {
          alert("Selecione um arquivo .txt ou .csv.");
          return;
        }

        var reader = new FileReader();
        reader.onload = function () {
          var pointCount = countPoints(String(reader.result || ""));
          if (pointCount === 0) {
            alert("Nenhum ponto válido encontrado no arquivo.");
            return;
          }

          var groups = listEl._groups || [];
          groups.push({ name: name, fuso: fuso, pointCount: pointCount, fileName: file.name });
          listEl._groups = groups;
          renderList(groups);
          resetForm();
        };
        reader.onerror = function () {
          alert("Não foi possível ler o arquivo.");
        };
        reader.readAsText(file);
      });
    }

    function initDocuments(serviceId) {
      var toggleBtn = document.getElementById("doc-attach-toggle");
      var formEl = document.getElementById("doc-attach-form");
      var fileInput = document.getElementById("doc-attach-file");
      var fileLabel = document.getElementById("doc-file-label");
      var nameInput = document.getElementById("doc-attach-name");
      var btnCancel = document.getElementById("doc-attach-cancel");
      var btnSubmit = document.getElementById("doc-attach-submit");
      var listEl = document.getElementById("doc-list");
      var MAX_SIZE = 5 * 1024 * 1024;
      var pendingFile = null;

      if (!toggleBtn || !formEl || !fileInput || !listEl) return;

      function escapeHtml(text) {
        return String(text || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }

      function formatSize(bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
      }

      function resetForm() {
        pendingFile = null;
        fileInput.value = "";
        nameInput.value = "";
        fileLabel.textContent = "Selecionar arquivo (PDF, Word, imagem…)";
      }

      function closeForm() {
        resetForm();
        formEl.hidden = true;
        toggleBtn.hidden = false;
      }

      function openForm() {
        resetForm();
        toggleBtn.hidden = true;
        formEl.hidden = false;
      }

      function renderList() {
        var docs = store.getDocuments(serviceId);
        listEl.innerHTML = docs
          .map(function (doc) {
            return (
              '<div class="doc-item" data-id="' +
              escapeHtml(doc.id) +
              '">' +
              '<div class="doc-item__info">' +
              '<span class="doc-item__name">' +
              escapeHtml(doc.name) +
              "</span>" +
              '<span class="doc-item__meta">' +
              formatSize(doc.size) +
              "</span>" +
              "</div>" +
              '<button type="button" class="doc-item__remove" data-id="' +
              escapeHtml(doc.id) +
              '">Excluir</button>' +
              "</div>"
            );
          })
          .join("");

        listEl.querySelectorAll(".doc-item__remove").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var docId = btn.getAttribute("data-id");
            if (confirm("Excluir este documento?")) {
              store.deleteDocument(serviceId, docId);
              renderList();
            }
          });
        });
      }

      toggleBtn.addEventListener("click", openForm);
      btnCancel.addEventListener("click", closeForm);

      fileInput.addEventListener("change", function () {
        var file = fileInput.files && fileInput.files[0];
        pendingFile = file || null;
        if (file) {
          fileLabel.textContent = file.name;
          if (!nameInput.value.trim()) {
            nameInput.placeholder = "Nome (opcional — usa o nome do arquivo)";
          }
        } else {
          fileLabel.textContent = "Selecionar arquivo (PDF, Word, imagem…)";
        }
      });

      btnSubmit.addEventListener("click", function () {
        if (!pendingFile) {
          alert("Selecione um arquivo para anexar.");
          return;
        }
        if (pendingFile.size > MAX_SIZE) {
          alert('O arquivo "' + pendingFile.name + '" excede o limite de 5 MB.');
          return;
        }

        var docName = nameInput.value.trim() || pendingFile.name;
        var file = pendingFile;

        var reader = new FileReader();
        reader.onload = function () {
          var result = String(reader.result || "");
          var base64 = result.indexOf(",") >= 0 ? result.split(",")[1] : result;
          store.addDocument(serviceId, {
            name: docName,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
            data: base64,
          });
          renderList();
          closeForm();
        };
        reader.onerror = function () {
          alert('Não foi possível anexar "' + file.name + '".');
        };
        reader.readAsDataURL(file);
      });

      renderList();
    }

    function initDrawToolsBar() {
      var btn = document.getElementById("open-draw-tools");
      if (!btn) return;

      btn.addEventListener("click", function () {
        var mapApi = global.VTServicoMap;
        if (!mapApi) return;
        mapApi.stopMapTools();
        if (mapApi.hideContourBar) mapApi.hideContourBar();
        mapApi.showTopoDrawBar();
      });
    }

    function initContourToolsBar() {
      var btn = document.getElementById("open-contour-tools");
      if (!btn) return;

      btn.addEventListener("click", function () {
        var mapApi = global.VTServicoMap;
        if (!mapApi) return;
        mapApi.stopMapTools();
        mapApi.stopTopoTools();
        if (mapApi.hideTopoDrawBar) mapApi.hideTopoDrawBar();
        if (mapApi.showContourBar) mapApi.showContourBar();
      });
    }

    function initSigefSearch(serviceRef) {
      var btn = document.getElementById("sigef-search-btn");
      var statusEl = document.getElementById("sigef-search-status");

      if (!btn || !statusEl) return;

      btn.addEventListener("click", function () {
        var hasGeometry = !!(serviceRef.geometry && serviceRef.geometry.coordinates);
        var hasPointGroups = !!(
          document.getElementById("point-group-list") &&
          document.getElementById("point-group-list")._groups &&
          document.getElementById("point-group-list")._groups.length
        );

        if (!hasGeometry && !hasPointGroups) {
          statusEl.textContent =
            "Carregue um perímetro, grupo de pontos ou polilinha antes de buscar áreas certificadas.";
          statusEl.hidden = false;
          return;
        }

        statusEl.textContent = "Buscando áreas certificadas ao redor da área carregada...";
        statusEl.hidden = false;
      });
    }

    populateToolbar();
    renderGeometry();
    initPointGroupImport();
    initSigefSearch(service);
    initDocuments(service.id);
    initDrawToolsBar();
    initContourToolsBar();
    initLimitesPerimeters(service);
    initEntregas(service);

    railItems.forEach(function (btn) {
      btn.addEventListener("click", function () {
        showSection(btn.getAttribute("data-section"));
      });
    });

    selectClient.addEventListener("change", function () {
      var clientId = selectClient.value;
      var first = sortedServices(store).find(function (s) {
        return s.clientId === clientId;
      });
      if (first) {
        window.location.href = "servico.html?id=" + encodeURIComponent(first.id);
      }
    });

    selectService.addEventListener("change", function () {
      if (selectService.value) {
        window.location.href = "servico.html?id=" + encodeURIComponent(selectService.value);
      }
    });

    global.VTServicoPage = {
      saveGeometry: function (geometry) {
        store.updateServiceGeometry(service.id, geometry);
        service.geometry = geometry;
        renderGeometry();
      },
      getServiceGeometry: function () {
        var perimeters = store.getPerimeters(service.id);
        if (perimeters.length && perimeters[0].geometry) return perimeters[0].geometry;
        return service.geometry || null;
      },
      getPerimeters: function () {
        return store.getPerimeters(service.id);
      },
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window);
