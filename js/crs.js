(function (global) {
  "use strict";

  if (typeof proj4 === "undefined") {
    global.VTCrs = null;
    return;
  }

  var WGS84 = "EPSG:4326";

  var DEFINITIONS = {
    "EPSG:4326": "+proj=longlat +datum=WGS84 +no_defs +type=crs",
    "EPSG:4674": "+proj=longlat +ellps=GRS80 +no_defs +type=crs",
    "EPSG:31982":
      "+proj=utm +zone=22 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
    "EPSG:31983":
      "+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
    "EPSG:31984":
      "+proj=utm +zone=24 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
  };

  Object.keys(DEFINITIONS).forEach(function (code) {
    proj4.defs(code, DEFINITIONS[code]);
  });

  var OPTIONS = [
    { code: "EPSG:4674", epsg: "EPSG:4674", group: "sirgas", label: "Graus Decimais", shortLabel: "Graus Decimais", type: "geo", format: "dd", xLabel: "Longitude", yLabel: "Latitude" },
    { code: "EPSG:4674:dms", epsg: "EPSG:4674", group: "sirgas", label: "Graus, Minutos e Segundos", shortLabel: "GMS", type: "geo", format: "dms", xLabel: "Longitude", yLabel: "Latitude" },
    { code: "EPSG:4674:gmd", epsg: "EPSG:4674", group: "sirgas", label: "Graus, Minutos e Decimais", shortLabel: "Graus, Min. Dec.", type: "geo", format: "gmd", xLabel: "Longitude", yLabel: "Latitude" },
    { code: "EPSG:4326", epsg: "EPSG:4326", group: "wgs", label: "Graus Decimais", shortLabel: "Graus Decimais", type: "geo", format: "dd", xLabel: "Longitude", yLabel: "Latitude" },
    { code: "EPSG:4326:dms", epsg: "EPSG:4326", group: "wgs", label: "Graus, Minutos e Segundos", shortLabel: "GMS", type: "geo", format: "dms", xLabel: "Longitude", yLabel: "Latitude" },
    { code: "EPSG:4326:gmd", epsg: "EPSG:4326", group: "wgs", label: "Graus, Minutos e Decimais", shortLabel: "Graus, Min. Dec.", type: "geo", format: "gmd", xLabel: "Longitude", yLabel: "Latitude" },
    { code: "EPSG:31982", epsg: "EPSG:31982", group: "utm", label: "UTM 22S", shortLabel: "UTM 22S", type: "utm", format: "utm", xLabel: "E (Leste)", yLabel: "N (Norte)" },
    { code: "EPSG:31983", epsg: "EPSG:31983", group: "utm", label: "UTM 23S", shortLabel: "UTM 23S", type: "utm", format: "utm", xLabel: "E (Leste)", yLabel: "N (Norte)" },
    { code: "EPSG:31984", epsg: "EPSG:31984", group: "utm", label: "UTM 24S", shortLabel: "UTM 24S", type: "utm", format: "utm", xLabel: "E (Leste)", yLabel: "N (Norte)" },
  ];

  var GROUP_LABELS = {
    sirgas: "SIRGAS 2000",
    wgs: "WGS 84",
    utm: "UTM (SIRGAS 2000)",
  };

  var optionByCode = {};
  OPTIONS.forEach(function (opt) {
    optionByCode[opt.code] = opt;
  });

  var currentCode = "EPSG:4674";
  var onChangeListeners = [];

  function getOption(code) {
    return optionByCode[code] || optionByCode["EPSG:4674"];
  }

  function formatNumber(value, decimals) {
    return value.toFixed(decimals).replace(".", ",");
  }

  function parseNumber(value) {
    if (value === null || value === undefined) return NaN;
    var normalized = String(value).trim().replace(/\s+/g, "").replace(",", ".");
    if (!normalized) return NaN;
    return parseFloat(normalized);
  }

  function hemisphereLetter(value, isLat) {
    if (isLat) return value >= 0 ? "N" : "S";
    return value >= 0 ? "E" : "W";
  }

  function applyHemisphere(decimal, hemi, isLat) {
    if (!hemi) return decimal;
    var h = hemi.toUpperCase();
    if (isLat) {
      if (h === "S" && decimal > 0) return -decimal;
      if (h === "N" && decimal < 0) return Math.abs(decimal);
    } else {
      if ((h === "W" || h === "O") && decimal > 0) return -decimal;
      if (h === "E" && decimal < 0) return Math.abs(decimal);
    }
    return decimal;
  }

  function decimalToDms(decimal, isLat) {
    var abs = Math.abs(decimal);
    var deg = Math.floor(abs);
    var minFloat = (abs - deg) * 60;
    var min = Math.floor(minFloat);
    var sec = (minFloat - min) * 60;
    return (
      deg +
      "°" +
      String(min).padStart(2, "0") +
      "'" +
      formatNumber(sec, 2) +
      '" ' +
      hemisphereLetter(decimal, isLat)
    );
  }

  function decimalToGmd(decimal, isLat) {
    var abs = Math.abs(decimal);
    var deg = Math.floor(abs);
    var minDec = (abs - deg) * 60;
    return deg + "°" + formatNumber(minDec, 5) + "' " + hemisphereLetter(decimal, isLat);
  }

  function parseDms(value, isLat) {
    var raw = String(value).trim();
    if (!raw) return NaN;

    var hemiMatch = raw.match(/([NnSsEeWwLlOo])\.?\s*$/);
    var hemi = hemiMatch ? hemiMatch[1] : null;
    var body = hemiMatch ? raw.slice(0, hemiMatch.index).trim() : raw;

    if (body.indexOf("°") === -1 && body.indexOf("'") === -1 && body.indexOf('"') === -1) {
      var asNumber = parseNumber(body);
      if (!isNaN(asNumber)) return applyHemisphere(asNumber, hemi, isLat);
    }

    var parts = body
      .replace(/[°º'"′″]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map(function (part) {
        return parseNumber(part);
      });

    if (!parts.length || parts.some(isNaN)) return NaN;

    var deg = parts[0];
    var min = parts[1] || 0;
    var sec = parts[2] || 0;
    var decimal = Math.abs(deg) + min / 60 + sec / 3600;
    if (deg < 0) decimal = -decimal;
    return applyHemisphere(decimal, hemi, isLat);
  }

  function parseGmd(value, isLat) {
    var raw = String(value).trim();
    if (!raw) return NaN;

    var hemiMatch = raw.match(/([NnSsEeWwLlOo])\.?\s*$/);
    var hemi = hemiMatch ? hemiMatch[1] : null;
    var body = hemiMatch ? raw.slice(0, hemiMatch.index).trim() : raw;

    var match = body.match(/^(-?\d+(?:[.,]\d+)?)\s*[°º]?\s*(\d+(?:[.,]\d+)?)?/);
    if (!match) {
      var asNumber = parseNumber(body);
      if (!isNaN(asNumber)) return applyHemisphere(asNumber, hemi, isLat);
      return NaN;
    }

    var deg = parseNumber(match[1]);
    var minDec = parseNumber(match[2] || "0");
    if (isNaN(deg) || isNaN(minDec)) return NaN;

    var decimal = Math.abs(deg) + minDec / 60;
    if (deg < 0) decimal = -decimal;
    return applyHemisphere(decimal, hemi, isLat);
  }

  function parseAxisValue(value, code, axis) {
    var opt = getOption(code);
    var isLat = axis === "y";

    if (opt.type === "utm") return parseNumber(value);

    if (opt.format === "dms") return parseDms(value, isLat);
    if (opt.format === "gmd") return parseGmd(value, isLat);
    return parseNumber(value);
  }

  function toProjected(lng, lat, code) {
    var opt = getOption(code || currentCode);
    if (opt.type === "utm") {
      var out = proj4(WGS84, opt.epsg, [lng, lat]);
      return { x: out[0], y: out[1] };
    }
    return { x: lng, y: lat };
  }

  function toWgs84(x, y, code) {
    var opt = getOption(code || currentCode);

    if (opt.type === "utm") {
      var nx = typeof x === "string" ? parseNumber(x) : x;
      var ny = typeof y === "string" ? parseNumber(y) : y;
      var out = proj4(opt.epsg, WGS84, [nx, ny]);
      return { lng: out[0], lat: out[1] };
    }

    return {
      lng: parseAxisValue(x, opt.code, "x"),
      lat: parseAxisValue(y, opt.code, "y"),
    };
  }

  function formatAxis(value, code, axis) {
    var opt = getOption(code);
    var isLat = axis === "y";

    if (opt.type === "utm") return formatNumber(value, 2);
    if (opt.format === "dms") return decimalToDms(value, isLat);
    if (opt.format === "gmd") return decimalToGmd(value, isLat);
    return formatNumber(value, 6);
  }

  function formatStatusLine(lng, lat, code, zoom) {
    var opt = getOption(code);
    var coords = toProjected(lng, lat, code);

    if (opt.type === "utm") {
      return (
        "<strong>E: " +
        formatAxis(coords.x, code, "x") +
        " · N: " +
        formatAxis(coords.y, code, "y") +
        "</strong> · " +
        opt.label +
        " · Zoom " +
        zoom
      );
    }

    if (opt.format === "dms") {
      return (
        "<strong>Lon: " +
        formatAxis(coords.x, code, "x") +
        " · Lat: " +
        formatAxis(coords.y, code, "y") +
        "</strong> · GMS · Zoom " +
        zoom
      );
    }

    if (opt.format === "gmd") {
      return (
        "<strong>Lon: " +
        formatAxis(coords.x, code, "x") +
        " · Lat: " +
        formatAxis(coords.y, code, "y") +
        "</strong> · Graus, Min. Dec. · Zoom " +
        zoom
      );
    }

    return (
      "<strong>X: " +
      formatAxis(coords.x, code, "x") +
      " · Y: " +
      formatAxis(coords.y, code, "y") +
      "</strong> · Graus Decimais · Zoom " +
      zoom
    );
  }

  function formatLegacyLine(lat, lng, zoom) {
    var latDir = lat >= 0 ? "N" : "S";
    var lngDir = lng >= 0 ? "E" : "W";
    return (
      "<strong>" +
      Math.abs(lat).toFixed(4) +
      "°" +
      latDir +
      ", " +
      Math.abs(lng).toFixed(4) +
      "°" +
      lngDir +
      "</strong> · Zoom " +
      zoom
    );
  }

  function getHint(code) {
    var opt = getOption(code);
    if (opt.type === "utm") {
      return "x = " + opt.xLabel.toLowerCase() + " (m) · y = " + opt.yLabel.toLowerCase() + " (m)";
    }
    if (opt.format === "dms") {
      return "x/y em GMS · ex.: 48°26'21,87\" W · 27°52'40,54\" S";
    }
    if (opt.format === "gmd") {
      return "x/y em graus e minutos decimais · ex.: 48°26,36275' W · 27°52,67568' S";
    }
    return "x = " + opt.xLabel.toLowerCase() + " · y = " + opt.yLabel.toLowerCase() + " (graus decimais)";
  }

  function getPlaceholders(code) {
    var opt = getOption(code);
    if (opt.type === "utm") {
      return { x: "698707,76", y: "9891010,84" };
    }
    if (opt.format === "dms") {
      return { x: "48°26'21,87\" W", y: "27°52'40,54\" S" };
    }
    if (opt.format === "gmd") {
      return { x: "48°26,36275' W", y: "27°52,67568' S" };
    }
    return { x: "-50,950000", y: "-27,250000" };
  }

  function isValidCoords(lng, lat) {
    return !isNaN(lng) && !isNaN(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
  }

  function isValidInput(x, y, code) {
    var opt = getOption(code);
    if (opt.type === "utm") {
      var nx = parseNumber(x);
      var ny = parseNumber(y);
      return !isNaN(nx) && !isNaN(ny) && nx >= 100000 && nx <= 900000 && ny >= 0 && ny <= 10000000;
    }
    var wgs = toWgs84(x, y, code);
    return isValidCoords(wgs.lng, wgs.lat);
  }

  function setCode(code) {
    if (!optionByCode[code] || code === currentCode) return;
    currentCode = code;
    onChangeListeners.forEach(function (fn) {
      fn(currentCode);
    });
  }

  function onChange(fn) {
    if (typeof fn === "function") onChangeListeners.push(fn);
  }

  function populateSelect(selectEl) {
    if (!selectEl) return;
    selectEl.innerHTML = "";

    ["sirgas", "wgs", "utm"].forEach(function (groupKey) {
      var group = document.createElement("optgroup");
      group.label = GROUP_LABELS[groupKey];

      OPTIONS.filter(function (opt) {
        return opt.group === groupKey;
      }).forEach(function (opt) {
        var option = document.createElement("option");
        option.value = opt.code;
        if (opt.group === "utm") {
          option.textContent = opt.label + " (" + opt.epsg.replace("EPSG:", "") + ")";
        } else {
          option.textContent = opt.label + " (" + opt.epsg.replace("EPSG:", "") + ")";
        }
        group.appendChild(option);
      });

      selectEl.appendChild(group);
    });
  }

  global.VTCrs = {
    WGS84: WGS84,
    OPTIONS: OPTIONS,
    getCode: function () {
      return currentCode;
    },
    setCode: setCode,
    onChange: onChange,
    getOption: getOption,
    parseNumber: parseNumber,
    parseAxisValue: parseAxisValue,
    formatAxis: formatAxis,
    toProjected: toProjected,
    toWgs84: toWgs84,
    formatStatusLine: formatStatusLine,
    formatLegacyLine: formatLegacyLine,
    getHint: getHint,
    getPlaceholders: getPlaceholders,
    isValidInput: isValidInput,
    isValidCoords: isValidCoords,
    populateSelect: populateSelect,
  };
})(window);
