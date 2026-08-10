(function (global) {
  "use strict";

  var TIPO_GROUPS = [
    {
      label: "Delimitação Física",
      options: [
        { value: "Muro", label: "Muro" },
        { value: "Cerca de Arame", label: "Cerca de Arame" },
        { value: "Cerca de Madeira ou Tapume", label: "Cerca de Madeira ou Tapume" },
        { value: "Cerca Viva", label: "Cerca Viva" },
        { value: "Cerca Mista", label: "Cerca Mista" },
        { value: "Portão", label: "Portão" },
        { value: "Alambrado", label: "Alambrado" },
        { value: "Limite não materializado", label: "Limite não materializado" },
        { value: "Confrontante", label: "Confrontante" },
        { value: "Misto", label: "Misto" },
        { value: "Outro", label: "Outro" },
      ],
    },
    {
      label: "Feições Artificiais",
      options: [
        { value: "Trecho de Energia", label: "Trecho de Energia" },
        { value: "Meio-fio", label: "Meio-fio" },
        { value: "Trecho ferroviário", label: "Trecho ferroviário" },
        { value: "Estrada não Pavimentada", label: "Estrada não Pavimentada" },
        { value: "Estrada Pavimentada", label: "Estrada Pavimentada" },
        { value: "Trecho duto", label: "Trecho duto" },
      ],
    },
    {
      label: "Feições Naturais",
      options: [{ value: "Trecho de drenagem", label: "Trecho de drenagem" }],
    },
  ];

  var TIPO_OPTIONS = [{ value: "", label: "(NULL)" }];
  TIPO_GROUPS.forEach(function (group) {
    group.options.forEach(function (opt) {
      TIPO_OPTIONS.push(opt);
    });
  });

  var modal = null;
  var form = null;
  var selectTipo = null;
  var inputOffset = null;
  var inputBuffer = null;
  var offsetSide = null;
  var pendingResolve = null;
  var initialized = false;

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function toDeg(rad) {
    return (rad * 180) / Math.PI;
  }

  function segmentBearing(p1, p2) {
    var lat1 = toRad(p1.lat);
    var lat2 = toRad(p2.lat);
    var dLng = toRad(p2.lng - p1.lng);
    var y = Math.sin(dLng) * Math.cos(lat2);
    var x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function averageBearing(b1, b2) {
    var x = Math.cos(toRad(b1)) + Math.cos(toRad(b2));
    var y = Math.sin(toRad(b1)) + Math.sin(toRad(b2));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function destinationPoint(latlng, bearingDeg, distanceM) {
    var R = 6378137;
    var lat1 = toRad(latlng.lat);
    var lng1 = toRad(latlng.lng);
    var br = toRad(bearingDeg);
    var lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distanceM / R) +
        Math.cos(lat1) * Math.sin(distanceM / R) * Math.cos(br)
    );
    var lng2 =
      lng1 +
      Math.atan2(
        Math.sin(br) * Math.sin(distanceM / R) * Math.cos(lat1),
        Math.cos(distanceM / R) - Math.sin(lat1) * Math.sin(lat2)
      );
    return L.latLng(toDeg(lat2), toDeg(lng2));
  }

  function vertexBearing(points, index) {
    if (points.length === 1) return 0;
    if (index === 0) return segmentBearing(points[0], points[1]);
    if (index === points.length - 1) {
      return segmentBearing(points[index - 1], points[index]);
    }
    return averageBearing(
      segmentBearing(points[index - 1], points[index]),
      segmentBearing(points[index], points[index + 1])
    );
  }

  function offsetPolylineSingle(points, distanceM, side) {
    var sign = side === "left" ? -1 : 1;
    return points.map(function (pt, index) {
      var track = vertexBearing(points, index);
      var perp = (track + sign * 90 + 360) % 360;
      return destinationPoint(pt, perp, distanceM);
    });
  }

  function buildOffsetLines(points, distanceM, side) {
    if (!distanceM || distanceM <= 0 || !side) return [];
    if (side === "both") {
      return [
        { side: "left", latlngs: offsetPolylineSingle(points, distanceM, "left") },
        { side: "right", latlngs: offsetPolylineSingle(points, distanceM, "right") },
      ];
    }
    return [{ side: side, latlngs: offsetPolylineSingle(points, distanceM, side) }];
  }

  function buildPointBuffer(latlng, radiusM, segments) {
    if (!latlng || !radiusM || radiusM <= 0) return null;
    var count = segments || 64;
    var ring = [];
    for (var i = 0; i < count; i += 1) {
      ring.push(destinationPoint(latlng, (360 / count) * i, radiusM));
    }
    return ring;
  }

  function buildLineBuffer(points, radiusM) {
    if (!points || points.length < 2 || !radiusM || radiusM <= 0) return null;
    var left = offsetPolylineSingle(points, radiusM, "left");
    var right = offsetPolylineSingle(points, radiusM, "right");
    return left.concat(right.reverse());
  }

  function getTipoLabel(value) {
    if (!value) return "(NULL)";
    var match = TIPO_OPTIONS.find(function (opt) {
      return opt.value === value;
    });
    return match ? match.label : value;
  }

  function parseOffset(value) {
    if (value === null || value === undefined) return null;
    var normalized = String(value).trim().replace(",", ".");
    if (!normalized) return null;
    var n = parseFloat(normalized);
    return isNaN(n) || n <= 0 ? null : n;
  }

  function setOffsetSide(side) {
    offsetSide = side || null;
    document.querySelectorAll("[data-offset-side]").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-offset-side") === side);
    });
  }

  function fillForm(initialAttrs) {
    var attrs = initialAttrs || {};
    if (selectTipo) selectTipo.value = attrs.tipo || "";
    if (inputOffset) {
      inputOffset.value =
        attrs.offsetM !== null && attrs.offsetM !== undefined && attrs.offsetM > 0
          ? String(attrs.offsetM).replace(".", ",")
          : "";
    }
    if (inputBuffer) {
      inputBuffer.value =
        attrs.bufferM !== null && attrs.bufferM !== undefined && attrs.bufferM > 0
          ? String(attrs.bufferM).replace(".", ",")
          : "";
    }
    setOffsetSide(attrs.offsetSide || null);
  }

  function resetForm(initialAttrs) {
    fillForm(initialAttrs);
  }

  function closeModal(result) {
    if (modal) modal.hidden = true;
    if (pendingResolve) {
      pendingResolve(result);
      pendingResolve = null;
    }
  }

  function readForm() {
    var offsetM = parseOffset(inputOffset ? inputOffset.value : "");
    var bufferM = parseOffset(inputBuffer ? inputBuffer.value : "");
    var side = offsetM ? offsetSide || "right" : null;
    return {
      tipo: selectTipo ? selectTipo.value : "",
      offsetM: offsetM,
      offsetSide: side,
      bufferM: bufferM,
    };
  }

  function populateTipoSelect() {
    if (!selectTipo) return;
    selectTipo.innerHTML = "";

    var nullOpt = document.createElement("option");
    nullOpt.value = "";
    nullOpt.textContent = "(NULL)";
    selectTipo.appendChild(nullOpt);

    TIPO_GROUPS.forEach(function (group) {
      var optgroup = document.createElement("optgroup");
      optgroup.label = group.label;
      group.options.forEach(function (opt) {
        var option = document.createElement("option");
        option.value = opt.value;
        option.textContent = opt.label;
        optgroup.appendChild(option);
      });
      selectTipo.appendChild(optgroup);
    });
  }

  function init() {
    if (initialized) return;

    modal = document.getElementById("line-attrs-modal");
    form = document.getElementById("line-attrs-form");
    selectTipo = document.getElementById("line-attr-tipo");
    inputOffset = document.getElementById("line-attr-offset");
    inputBuffer = document.getElementById("line-attr-buffer");

    var btnClose = document.getElementById("line-attrs-close");
    var btnCancel = document.getElementById("line-attrs-cancel");

    if (!modal || !form || !selectTipo) return;

    populateTipoSelect();

    document.querySelectorAll("[data-offset-side]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setOffsetSide(btn.getAttribute("data-offset-side"));
      });
    });

    initialized = true;

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var attrs = readForm();
      if (attrs.offsetM && !offsetSide) {
        setOffsetSide("right");
        attrs.offsetSide = "right";
      }
      closeModal(attrs);
    });

    if (btnCancel) btnCancel.addEventListener("click", function () { closeModal(null); });
    if (btnClose) btnClose.addEventListener("click", function () { closeModal(null); });
    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeModal(null);
    });
  }

  function prompt(initialAttrs) {
    init();
    if (!modal) return Promise.resolve(null);

    if (pendingResolve) closeModal(null);

    resetForm(initialAttrs);
    modal.hidden = false;
    if (selectTipo) selectTipo.focus();

    return new Promise(function (resolve) {
      pendingResolve = resolve;
    });
  }

  function buildPopupHtml(attrs, totalMeters) {
    attrs = attrs || {};
    var fmt = global.VTFormat;
    var lengthText = fmt
      ? fmt.formatDistance(totalMeters)
      : totalMeters.toFixed(1) + " m";
    var lines = [
      "<strong>Linha</strong>",
      "tipo: " + getTipoLabel(attrs.tipo),
      "comprimento: " + lengthText,
    ];
    if (attrs.offsetM) {
      lines.push(
        "offset: " +
          attrs.offsetM.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) +
          " m (" +
          (attrs.offsetSide === "both"
            ? "ambos"
            : attrs.offsetSide === "left"
              ? "esquerda"
              : "direita") +
          ")"
      );
    }
    if (attrs.bufferM) {
      lines.push(
        "buffer: " + attrs.bufferM.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " m"
      );
    }
    return lines.join("<br>");
  }

  global.VTLineAttrs = {
    TIPO_GROUPS: TIPO_GROUPS,
    TIPO_OPTIONS: TIPO_OPTIONS,
    init: init,
    prompt: prompt,
    buildOffsetLines: buildOffsetLines,
    buildPointBuffer: buildPointBuffer,
    buildLineBuffer: buildLineBuffer,
    parseDistanceM: parseOffset,
    buildPopupHtml: buildPopupHtml,
    getTipoLabel: getTipoLabel,
  };
})(window);
