(function (global) {
  "use strict";

  var UTM_CODES = {
    22: "EPSG:31982",
    23: "EPSG:31983",
    24: "EPSG:31984",
  };

  function fmtNumber(value, decimals) {
    return Number(value).toLocaleString("pt-BR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function normalizeRing(geometry) {
    if (!geometry || !geometry.coordinates || !geometry.coordinates[0]) return [];
    var ring = geometry.coordinates[0].slice();
    if (ring.length > 1) {
      var first = ring[0];
      var last = ring[ring.length - 1];
      if (first[0] === last[0] && first[1] === last[1]) ring.pop();
    }
    return ring;
  }

  function utmCodeForRing(ring) {
    if (!ring.length) return "EPSG:31982";
    var sumLng = 0;
    ring.forEach(function (c) {
      sumLng += c[0];
    });
    var zone = Math.floor((sumLng / ring.length + 180) / 6) + 1;
    if (zone < 22) zone = 22;
    if (zone > 24) zone = 24;
    return UTM_CODES[zone] || "EPSG:31982";
  }

  function utmZoneFromCode(code) {
    if (code === "EPSG:31983") return 23;
    if (code === "EPSG:31984") return 24;
    return 22;
  }

  function toUtmVertices(ring, utmCode) {
    if (!global.VTCrs) return [];
    return ring.map(function (c) {
      var p = global.VTCrs.toProjected(c[0], c[1], utmCode);
      return { e: p.x, n: p.y };
    });
  }

  function segmentMetrics(a, b) {
    var de = b.e - a.e;
    var dn = b.n - a.n;
    var dist = Math.sqrt(de * de + dn * dn);
    var azDeg = (Math.atan2(de, dn) * 180) / Math.PI;
    if (azDeg < 0) azDeg += 360;
    return { dist: dist, azDeg: azDeg };
  }

  function formatAzimuth(deg) {
    var d = Math.floor(deg);
    var minFloat = (deg - d) * 60;
    var m = Math.floor(minFloat);
    var s = (minFloat - m) * 60;
    return d + "°" + String(m).padStart(2, "0") + "'" + fmtNumber(s, 2) + '"';
  }

  function polygonArea(verts) {
    var area = 0;
    var i;
    for (i = 0; i < verts.length; i += 1) {
      var j = (i + 1) % verts.length;
      area += verts[i].e * verts[j].n - verts[j].e * verts[i].n;
    }
    return Math.abs(area / 2);
  }

  function polygonPerimeter(verts) {
    var total = 0;
    var i;
    for (i = 0; i < verts.length; i += 1) {
      var j = (i + 1) % verts.length;
      total += segmentMetrics(verts[i], verts[j]).dist;
    }
    return total;
  }

  function buildNarrative(verts) {
    var n = verts.length;
    if (n < 3) return "";

    var parts = [];
    var firstSeg = segmentMetrics(verts[0], verts[1]);
    parts.push(
      "Inicia-se a descrição deste perímetro no vértice 1, de coordenadas N: " +
        fmtNumber(verts[0].n, 3) +
        " m e E: " +
        fmtNumber(verts[0].e, 3) +
        " m, confrontando nesse trecho com —, segue com azimute " +
        formatAzimuth(firstSeg.azDeg) +
        " e distância " +
        fmtNumber(firstSeg.dist, 2) +
        "m até o vértice 2"
    );

    var i;
    for (i = 1; i < n - 1; i += 1) {
      var seg = segmentMetrics(verts[i], verts[i + 1]);
      parts.push(
        "Deste vértice, confrontando nesse trecho com —, segue com azimute " +
          formatAzimuth(seg.azDeg) +
          " e distância " +
          fmtNumber(seg.dist, 2) +
          "m até o vértice " +
          (i + 2)
      );
    }

    var lastSeg = segmentMetrics(verts[n - 1], verts[0]);
    parts.push(
      "Deste vértice, confrontando nesse trecho com —, segue com azimute " +
        formatAzimuth(lastSeg.azDeg) +
        " e distância " +
        fmtNumber(lastSeg.dist, 2) +
        "m até o vértice 1, encerrando este perímetro."
    );

    return parts.join("; ") + ".";
  }

  function generateDescriptiveMemorial(geometry) {
    var ring = normalizeRing(geometry);
    if (ring.length < 3) {
      return {
        text: "",
        error: "O imóvel precisa de pelo menos 3 vértices para gerar o memorial.",
      };
    }

    if (!global.VTCrs) {
      return { text: "", error: "Projeção UTM indisponível." };
    }

    var utmCode = utmCodeForRing(ring);
    var zone = utmZoneFromCode(utmCode);
    var verts = toUtmVertices(ring, utmCode);
    var area = polygonArea(verts);
    var perimeter = polygonPerimeter(verts);
    var narrative = buildNarrative(verts);
    var disclaimer =
      "Todas as coordenadas aqui descritas estão georreferenciadas ao Sistema Geodésico Brasileiro e encontram-se representadas no Sistema UTM, tendo como datum o SIRGAS 2000. Todos os azimutes e distâncias foram calculados no plano de projeção UTM, Fuso " +
      zone +
      " Sul.";

    var text =
      "ÁREA = " +
      fmtNumber(area, 2) +
      " m²\n" +
      "PERÍMETRO = " +
      fmtNumber(perimeter, 2) +
      " m\n\n" +
      narrative +
      "\n\n" +
      disclaimer;

    return { text: text, utmZone: zone, error: null };
  }

  function getUtmZone(geometry) {
    var ring = normalizeRing(geometry);
    if (!ring.length) return 22;
    return utmZoneFromCode(utmCodeForRing(ring));
  }

  global.VTMemorial = {
    generateDescriptiveMemorial: generateDescriptiveMemorial,
    getUtmZone: getUtmZone,
    countWords: function (text) {
      var trimmed = String(text || "").trim();
      if (!trimmed) return 0;
      return trimmed.split(/\s+/).length;
    },
  };
})(window);
