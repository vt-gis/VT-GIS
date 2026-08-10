(function (global) {
  "use strict";

  var STORAGE_KEY = "vt_gis_data_v1";

  var SERVICE_TYPES = [
    "Georreferenciamento",
    "CAR",
    "Laudo técnico",
    "Regularização",
    "Outro",
  ];

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { clients: [], services: [] };
      var data = JSON.parse(raw);
      return {
        clients: Array.isArray(data.clients) ? data.clients : [],
        services: Array.isArray(data.services) ? data.services : [],
      };
    } catch (err) {
      console.error("VT GIS store", err);
      return { clients: [], services: [] };
    }
  }

  function save(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  var store = {
    SERVICE_TYPES: SERVICE_TYPES,

    getClients: function () {
      return load().clients.slice().sort(function (a, b) {
        return a.name.localeCompare(b.name, "pt-BR");
      });
    },

    getServices: function () {
      return load().services.slice();
    },

    getServiceById: function (serviceId) {
      return load().services.find(function (s) {
        return s.id === serviceId;
      }) || null;
    },

    getClientById: function (clientId) {
      return load().clients.find(function (c) {
        return c.id === clientId;
      }) || null;
    },

    getServiceCode: function (serviceId) {
      var services = load().services.slice().sort(function (a, b) {
        return new Date(a.createdAt) - new Date(b.createdAt);
      });
      var index = services.findIndex(function (s) {
        return s.id === serviceId;
      });
      if (index < 0) return "SRV-0000";
      return "SRV-" + String(index + 1).padStart(4, "0");
    },

    addClient: function (name, cpfCnpj) {
      var trimmed = (name || "").trim();
      if (!trimmed) return null;
      var data = load();
      var client = {
        id: uid("cli"),
        name: trimmed,
        cpfCnpj: (cpfCnpj || "").trim(),
        createdAt: new Date().toISOString(),
      };
      data.clients.push(client);
      save(data);
      return client;
    },

    findClientByName: function (name) {
      var normalized = (name || "").trim().toLowerCase();
      if (!normalized) return null;
      return load().clients.find(function (c) {
        return c.name.toLowerCase() === normalized;
      }) || null;
    },

    addService: function (payload) {
      var data = load();
      var service = {
        id: uid("srv"),
        clientId: payload.clientId,
        type: payload.type || "Outro",
        name: (payload.name || "").trim() || "Serviço",
        notes: (payload.notes || "").trim(),
        geometry: payload.geometry || null,
        documents: [],
        createdAt: new Date().toISOString(),
      };
      data.services.push(service);
      save(data);
      return service;
    },

    updateServiceGeometry: function (serviceId, geometry) {
      var data = load();
      var service = data.services.find(function (s) {
        return s.id === serviceId;
      });
      if (!service) return null;
      service.geometry = geometry;
      save(data);
      return service;
    },

    getPerimeters: function (serviceId) {
      var data = load();
      var service = data.services.find(function (s) {
        return s.id === serviceId;
      });
      if (!service) return [];
      if (!Array.isArray(service.perimeters)) service.perimeters = [];
      if (!service.perimeters.length && service.geometry && service.geometry.coordinates) {
        service.perimeters.push({
          id: uid("per"),
          name: "Perímetro principal",
          geometry: service.geometry,
          visible: true,
          createdAt: new Date().toISOString(),
        });
        save(data);
      }
      return service.perimeters.slice();
    },

    addPerimeter: function (serviceId, payload) {
      var data = load();
      var service = data.services.find(function (s) {
        return s.id === serviceId;
      });
      if (!service) return null;
      if (!Array.isArray(service.perimeters)) service.perimeters = [];

      var perimeter = {
        id: uid("per"),
        name: (payload.name || "").trim() || "Perímetro",
        geometry: payload.geometry || null,
        visible: payload.visible !== false,
        createdAt: new Date().toISOString(),
      };
      service.perimeters.push(perimeter);
      if (service.perimeters.length === 1 && perimeter.geometry) {
        service.geometry = perimeter.geometry;
      }
      save(data);
      return perimeter;
    },

    updatePerimeter: function (serviceId, perimeterId, updates) {
      var data = load();
      var service = data.services.find(function (s) {
        return s.id === serviceId;
      });
      if (!service || !Array.isArray(service.perimeters)) return null;
      var perimeter = service.perimeters.find(function (p) {
        return p.id === perimeterId;
      });
      if (!perimeter) return null;
      if (updates.name !== undefined) perimeter.name = (updates.name || "").trim() || perimeter.name;
      if (updates.visible !== undefined) perimeter.visible = !!updates.visible;
      if (updates.geometry !== undefined) perimeter.geometry = updates.geometry;
      if (updates.memorialText !== undefined) {
        perimeter.memorialText = updates.memorialText;
        perimeter.memorialCustom = updates.memorialCustom !== undefined ? !!updates.memorialCustom : !!updates.memorialText;
      }
      if (updates.memorialCustom !== undefined) perimeter.memorialCustom = !!updates.memorialCustom;
      if (updates.generalNotes !== undefined) {
        perimeter.generalNotes = Array.isArray(updates.generalNotes) ? updates.generalNotes : [];
      }
      if (service.perimeters[0] && service.perimeters[0].id === perimeterId && perimeter.geometry) {
        service.geometry = perimeter.geometry;
      }
      save(data);
      return perimeter;
    },

    deletePerimeter: function (serviceId, perimeterId) {
      var data = load();
      var service = data.services.find(function (s) {
        return s.id === serviceId;
      });
      if (!service || !Array.isArray(service.perimeters)) return false;
      var before = service.perimeters.length;
      service.perimeters = service.perimeters.filter(function (p) {
        return p.id !== perimeterId;
      });
      if (service.perimeters.length === before) return false;
      service.geometry =
        service.perimeters.length && service.perimeters[0].geometry ? service.perimeters[0].geometry : null;
      save(data);
      return true;
    },

    deleteService: function (serviceId) {
      var data = load();
      data.services = data.services.filter(function (s) {
        return s.id !== serviceId;
      });
      save(data);
    },

    getDocuments: function (serviceId) {
      var service = load().services.find(function (s) {
        return s.id === serviceId;
      });
      if (!service) return [];
      if (!Array.isArray(service.documents)) service.documents = [];
      return service.documents.slice();
    },

    addDocument: function (serviceId, payload) {
      var data = load();
      var service = data.services.find(function (s) {
        return s.id === serviceId;
      });
      if (!service) return null;
      if (!Array.isArray(service.documents)) service.documents = [];

      var doc = {
        id: uid("doc"),
        name: (payload.name || "").trim() || "Documento",
        mimeType: payload.mimeType || "application/octet-stream",
        size: payload.size || 0,
        data: payload.data || "",
        createdAt: new Date().toISOString(),
      };
      service.documents.push(doc);
      save(data);
      return doc;
    },

    deleteDocument: function (serviceId, documentId) {
      var data = load();
      var service = data.services.find(function (s) {
        return s.id === serviceId;
      });
      if (!service || !Array.isArray(service.documents)) return false;
      var before = service.documents.length;
      service.documents = service.documents.filter(function (d) {
        return d.id !== documentId;
      });
      if (service.documents.length === before) return false;
      save(data);
      return true;
    },
  };

  global.VTStore = store;
})(window);
