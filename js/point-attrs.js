(function (global) {
  "use strict";

  var TIPO_OPTIONS = [
    { value: "", label: "(NULL)" },
    { value: "Marco de concreto com chapa", label: "Marco de concreto com chapa" },
    { value: "Tipo P (ponto)", label: "Tipo P (ponto)" },
    { value: "Tipo V (virtual)", label: "Tipo V (virtual)" },
    { value: "Marco de concreto sem chapa", label: "Marco de concreto sem chapa" },
  ];

  var modal = null;
  var form = null;
  var selectTipo = null;
  var inputOrdem = null;
  var inputCodigo = null;
  var inputBuffer = null;
  var pendingResolve = null;
  var initialized = false;

  function populateTipoSelect() {
    if (!selectTipo) return;
    selectTipo.innerHTML = "";
    TIPO_OPTIONS.forEach(function (opt) {
      var el = document.createElement("option");
      el.value = opt.value;
      el.textContent = opt.label;
      selectTipo.appendChild(el);
    });
  }

  function resetForm(suggestedOrdem) {
    fillForm({
      tipo: "",
      ordem: suggestedOrdem || null,
      codigo: suggestedOrdem ? "P" + suggestedOrdem : "",
      bufferM: null,
    });
  }

  function fillForm(initialAttrs) {
    var attrs = initialAttrs || {};
    if (selectTipo) selectTipo.value = attrs.tipo || "";
    if (inputOrdem) {
      inputOrdem.value =
        attrs.ordem !== null && attrs.ordem !== undefined ? String(attrs.ordem) : "";
    }
    if (inputCodigo) {
      inputCodigo.value = attrs.codigo || "";
    }
    if (inputBuffer) {
      inputBuffer.value =
        attrs.bufferM !== null && attrs.bufferM !== undefined && attrs.bufferM > 0
          ? String(attrs.bufferM).replace(".", ",")
          : "";
    }
  }

  function parseBuffer(value) {
    if (global.VTLineAttrs && global.VTLineAttrs.parseDistanceM) {
      return global.VTLineAttrs.parseDistanceM(value);
    }
    var raw = (value || "").trim().replace(",", ".");
    if (!raw) return null;
    var n = parseFloat(raw);
    return isNaN(n) || n <= 0 ? null : n;
  }

  function closeModal(result) {
    if (modal) modal.hidden = true;
    if (pendingResolve) {
      pendingResolve(result);
      pendingResolve = null;
    }
  }

  function readForm() {
    var ordemRaw = inputOrdem ? inputOrdem.value.trim() : "";
    var ordem = ordemRaw ? parseInt(ordemRaw, 10) : null;
    var codigoRaw = inputCodigo ? inputCodigo.value.trim() : "";
    return {
      tipo: selectTipo ? selectTipo.value : "",
      ordem: ordem,
      codigo: codigoRaw || (ordem ? "P" + ordem : null),
      bufferM: parseBuffer(inputBuffer ? inputBuffer.value : ""),
    };
  }

  function init() {
    if (initialized) return;

    modal = document.getElementById("point-attrs-modal");
    form = document.getElementById("point-attrs-form");
    selectTipo = document.getElementById("point-attr-tipo");
    inputOrdem = document.getElementById("point-attr-ordem");
    inputCodigo = document.getElementById("point-attr-codigo");
    inputBuffer = document.getElementById("point-attr-buffer");

    var btnClose = document.getElementById("point-attrs-close");
    var btnCancel = document.getElementById("point-attrs-cancel");

    if (!modal || !form) return;

    populateTipoSelect();
    initialized = true;

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var attrs = readForm();
      if (attrs.ordem !== null && (isNaN(attrs.ordem) || attrs.ordem < 1)) {
        alert("Informe uma ordem numérica válida ou deixe em branco.");
        return;
      }
      closeModal(attrs);
    });

    if (btnCancel) {
      btnCancel.addEventListener("click", function () {
        closeModal(null);
      });
    }

    if (btnClose) {
      btnClose.addEventListener("click", function () {
        closeModal(null);
      });
    }

    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeModal(null);
    });
  }

  function prompt(latlng, suggestedOrdem, initialAttrs) {
    init();
    if (!modal) return Promise.resolve(null);

    if (pendingResolve) {
      closeModal(null);
    }

    if (initialAttrs) {
      fillForm(initialAttrs);
    } else {
      resetForm(suggestedOrdem);
    }
    modal.hidden = false;
    if (selectTipo) selectTipo.focus();

    return new Promise(function (resolve) {
      pendingResolve = resolve;
    });
  }

  function formatTipoLabel(tipo) {
    if (!tipo) return "(NULL)";
    return tipo;
  }

  function formatCoordsLine(latlng) {
    if (!global.VTCrs) {
      return latlng.lat.toFixed(6) + "°, " + latlng.lng.toFixed(6) + "°";
    }

    var code = global.VTCrs.getCode();
    var opt = global.VTCrs.getOption(code);
    var projected = global.VTCrs.toProjected(latlng.lng, latlng.lat, code);

    if (opt.type === "utm") {
      return (
        "E: " +
        global.VTCrs.formatAxis(projected.x, code, "x") +
        " · N: " +
        global.VTCrs.formatAxis(projected.y, code, "y")
      );
    }

    if (opt.format === "dms") {
      return (
        "Lon: " +
        global.VTCrs.formatAxis(projected.x, code, "x") +
        " · Lat: " +
        global.VTCrs.formatAxis(projected.y, code, "y")
      );
    }

    if (opt.format === "gmd") {
      return (
        "Lon: " +
        global.VTCrs.formatAxis(projected.x, code, "x") +
        " · Lat: " +
        global.VTCrs.formatAxis(projected.y, code, "y")
      );
    }

    return (
      "X: " +
      global.VTCrs.formatAxis(projected.x, code, "x") +
      " · Y: " +
      global.VTCrs.formatAxis(projected.y, code, "y")
    );
  }

  function buildPopupHtml(pointIndex, attrs, latlng) {
    var lines = [
      "<strong>Ponto " + pointIndex + "</strong>",
      "tipo: " + formatTipoLabel(attrs.tipo),
      "ordem: " + (attrs.ordem !== null && attrs.ordem !== undefined ? attrs.ordem : "NULL"),
      "codigo: " + (attrs.codigo || "NULL"),
      formatCoordsLine(latlng),
    ];
    if (attrs.bufferM) {
      lines.push(
        "buffer: " + attrs.bufferM.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " m"
      );
    }
    return lines.join("<br>");
  }

  global.VTPointAttrs = {
    TIPO_OPTIONS: TIPO_OPTIONS,
    init: init,
    prompt: prompt,
    buildPopupHtml: buildPopupHtml,
  };
})(window);
