(function (global) {
  "use strict";

  var ACCEPT =
    ".shp,.zip,.dwg,.dxf,.kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz";

  var jsZipPromise = null;

  function fileExtension(name) {
    var i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
  }

  function fileBaseName(name) {
    var base = name.replace(/\\/g, "/").split("/").pop() || name;
    var i = base.lastIndexOf(".");
    return i >= 0 ? base.slice(0, i) : base;
  }

  function readAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error("Não foi possível ler o arquivo."));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  function readAsText(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("Não foi possível ler o arquivo."));
      };
      reader.readAsText(file);
    });
  }

  function decodeUtf8(buffer) {
    return new TextDecoder("utf-8").decode(buffer);
  }

  function loadJSZip() {
    if (global.JSZip) {
      return Promise.resolve(global.JSZip);
    }
    if (!jsZipPromise) {
      jsZipPromise = import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm").then(function (mod) {
        return mod.default || mod;
      });
    }
    return jsZipPromise;
  }

  function isZipBuffer(buffer) {
    var u8 = new Uint8Array(buffer);
    return u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4b;
  }

  function isShpBuffer(buffer) {
    var u8 = new Uint8Array(buffer);
    return u8.length >= 4 && u8[0] === 0x00 && u8[1] === 0x00 && u8[2] === 0x27 && (u8[3] === 0x0a || u8[3] === 0x09);
  }

  function zipEntryBase(name) {
    var file = name.replace(/^.*\//, "");
    var dot = file.lastIndexOf(".");
    return dot >= 0 ? file.slice(0, dot).toLowerCase() : file.toLowerCase();
  }

  function wrapImportError(err) {
    var msg = err && err.message ? err.message : String(err || "");
    if (/^but-unzip~\d+/i.test(msg)) {
      throw new Error(
        "Arquivo compactado inválido ou incompleto. Para shapefile, envie um .zip contendo .shp, .dbf e .shx juntos."
      );
    }
    throw err;
  }

  function closeRing(ring) {
    if (!ring.length) return ring;
    var first = ring[0];
    var last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) return ring.slice();
    return ring.concat([[first[0], first[1]]]);
  }

  function ringArea(ring) {
    var area = 0;
    var i;
    for (i = 0; i < ring.length - 1; i += 1) {
      area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return Math.abs(area / 2);
  }

  function normalizeCoordsXY(coords) {
    if (!coords.length) {
      throw new Error("Arquivo sem coordenadas válidas.");
    }
    var x = coords[0][0];
    var y = coords[0][1];
    if (Math.abs(x) <= 180 && Math.abs(y) <= 90) {
      return coords.map(function (c) {
        return [c[0], c[1]];
      });
    }
    if (!global.proj4) {
      throw new Error("Coordenadas projetadas detectadas. Recarregue a página e tente novamente.");
    }
    var zones = ["EPSG:31982", "EPSG:31983", "EPSG:31984", "EPSG:31981"];
    var z;
    for (z = 0; z < zones.length; z += 1) {
      try {
        var test = global.proj4(zones[z], "EPSG:4326", [x, y]);
        if (test[1] > -36 && test[1] < 6 && test[0] > -76 && test[0] < -28) {
          return coords.map(function (c) {
            var p = global.proj4(zones[z], "EPSG:4326", [c[0], c[1]]);
            return [p[0], p[1]];
          });
        }
      } catch (err) {
        /* try next zone */
      }
    }
    return coords.map(function (c) {
      var p = global.proj4("EPSG:31982", "EPSG:4326", [c[0], c[1]]);
      return [p[0], p[1]];
    });
  }

  function toPolygonGeometry(ring) {
    var normalized = normalizeCoordsXY(ring);
    var closed = closeRing(normalized);
    if (closed.length < 4) {
      throw new Error("Polígono inválido — são necessários ao menos 3 vértices.");
    }
    return { type: "Polygon", coordinates: [closed] };
  }

  function pickBestPolygon(rings) {
    if (!rings.length) {
      throw new Error("Nenhum polígono encontrado no arquivo.");
    }
    var best = rings[0];
    var bestArea = ringArea(best);
    var i;
    for (i = 1; i < rings.length; i += 1) {
      var area = ringArea(rings[i]);
      if (area > bestArea) {
        best = rings[i];
        bestArea = area;
      }
    }
    return toPolygonGeometry(best);
  }

  function geojsonToGeometry(geojson) {
    var rings = [];

    function addFeature(feature) {
      if (!feature || !feature.geometry) return;
      var geom = feature.geometry;
      if (geom.type === "Polygon") {
        rings.push(geom.coordinates[0]);
      } else if (geom.type === "MultiPolygon") {
        geom.coordinates.forEach(function (poly) {
          rings.push(poly[0]);
        });
      } else if (geom.type === "LineString" && geom.coordinates.length >= 3) {
        rings.push(geom.coordinates);
      }
    }

    if (!geojson) return null;
    if (geojson.type === "FeatureCollection" && geojson.features) {
      geojson.features.forEach(addFeature);
    } else if (geojson.type === "Feature") {
      addFeature(geojson);
    } else if (geojson.type === "Polygon") {
      rings.push(geojson.coordinates[0]);
    } else if (geojson.type === "MultiPolygon") {
      geojson.coordinates.forEach(function (poly) {
        rings.push(poly[0]);
      });
    }

    return pickBestPolygon(rings);
  }

  function geometriesToGeojson(geoms) {
    var list = Array.isArray(geoms) ? geoms : [geoms];
    return {
      type: "FeatureCollection",
      features: list.map(function (g) {
        if (g && g.type === "Feature") return g;
        return { type: "Feature", geometry: g };
      }),
    };
  }

  function parseKmlCoordinates(text) {
    var parts = text.trim().split(/\s+/);
    var ring = [];
    var i;
    for (i = 0; i < parts.length; i += 1) {
      var chunk = parts[i].split(",");
      if (chunk.length < 2) continue;
      var lng = parseFloat(chunk[0]);
      var lat = parseFloat(chunk[1]);
      if (!isFinite(lng) || !isFinite(lat)) continue;
      ring.push([lng, lat]);
    }
    return ring;
  }

  function parseKmlText(text) {
    var doc = new DOMParser().parseFromString(text, "text/xml");
    if (doc.querySelector("parsererror")) {
      throw new Error("Arquivo KML inválido.");
    }
    var rings = [];
    doc.querySelectorAll("Polygon coordinates, LinearRing coordinates").forEach(function (node) {
      var ring = parseKmlCoordinates(node.textContent || "");
      if (ring.length >= 3) rings.push(ring);
    });
    if (!rings.length) {
      doc.querySelectorAll("LineString coordinates").forEach(function (node) {
        var ring = parseKmlCoordinates(node.textContent || "");
        if (ring.length >= 3) rings.push(ring);
      });
    }
    return pickBestPolygon(rings);
  }

  function parseKml(file) {
    return readAsText(file).then(parseKmlText);
  }

  function parseZipBuffer(buffer) {
    return loadJSZip().then(function (JSZip) {
      return JSZip.loadAsync(buffer).then(function (zip) {
        var names = Object.keys(zip.files).filter(function (name) {
          return !zip.files[name].dir;
        });
        var shpName = names.find(function (name) {
          return /\.shp$/i.test(name);
        });
        var kmlName = names.find(function (name) {
          return /\.kml$/i.test(name);
        });

        if (shpName) {
          if (!global.shp) {
            throw new Error("Biblioteca Shapefile não carregada.");
          }
          var shpBase = zipEntryBase(shpName);
          var dbfName = names.find(function (name) {
            return /\.dbf$/i.test(name) && zipEntryBase(name) === shpBase;
          });
          var prjName = names.find(function (name) {
            return /\.prj$/i.test(name) && zipEntryBase(name) === shpBase;
          });

          var jobs = [zip.files[shpName].async("arraybuffer")];
          jobs.push(dbfName ? zip.files[dbfName].async("arraybuffer") : Promise.resolve(null));
          jobs.push(prjName ? zip.files[prjName].async("text") : Promise.resolve(null));

          return Promise.all(jobs).then(function (parts) {
            var payload = { shp: parts[0] };
            if (parts[1]) payload.dbf = parts[1];
            if (parts[2]) payload.prj = parts[2];
            return global.shp(payload);
          }).then(geojsonToGeometry);
        }

        if (kmlName) {
          return zip.files[kmlName].async("text").then(parseKmlText);
        }

        throw new Error(
          "Arquivo ZIP/KMZ não contém shapefile (.shp) nem KML. Compacte .shp + .dbf + .shx ou use um KMZ válido."
        );
      });
    });
  }

  function parseRawShpBuffer(buffer) {
    if (!global.shp || !global.shp.parseShp) {
      throw new Error(
        "Arquivo .shp isolado não é suficiente. Compacte .shp, .dbf e .shx em um único .zip."
      );
    }
    var geoms = global.shp.parseShp(buffer);
    return geojsonToGeometry(geometriesToGeojson(geoms));
  }

  function entityToRing(entity) {
    if (!entity) return null;
    var verts = entity.vertices || entity.points || entity.controlPoints;
    if (!verts || verts.length < 3) return null;
    return verts.map(function (v) {
      return [v.x, v.y];
    });
  }

  function collectDxfRings(dxf) {
    var rings = [];
    (dxf.entities || []).forEach(function (ent) {
      if (ent.type === "LWPOLYLINE" && ent.vertices && ent.vertices.length >= 3) {
        var ring = ent.vertices.map(function (v) {
          return [v.x, v.y];
        });
        if (ent.shape || ent.closed) ring = closeRing(ring);
        if (ring.length >= 3) rings.push(ring);
      } else if (ent.type === "POLYLINE" && ent.vertices && ent.vertices.length >= 3) {
        var poly = ent.vertices.map(function (v) {
          return [v.x, v.y];
        });
        if (poly.length >= 3) rings.push(poly);
      }
    });
    return rings;
  }

  function parseDxfText(text) {
    var Parser = global.DxfParser;
    if (!Parser) {
      throw new Error("Biblioteca DXF não carregada.");
    }
    var parser = new Parser();
    var dxf = parser.parseSync(text);
    var rings = collectDxfRings(dxf);
    return pickBestPolygon(rings);
  }

  function parseDxf(file) {
    return readAsText(file).then(parseDxfText);
  }

  function collectDwgRings(db) {
    var rings = [];

    function walkEntities(entities) {
      if (!entities || !entities.length) return;
      entities.forEach(function (ent) {
        var type = String(ent.type || ent.entityType || "").toUpperCase();
        if (type.indexOf("LWPOLYLINE") >= 0 || type.indexOf("POLYLINE") >= 0) {
          var ring = entityToRing(ent);
          if (ring) rings.push(ring);
        }
      });
    }

    if (db.entities) walkEntities(db.entities);
    if (db.tables && db.tables.BLOCK_RECORD) {
      Object.keys(db.tables.BLOCK_RECORD).forEach(function (key) {
        var block = db.tables.BLOCK_RECORD[key];
        if (block && block.entities) walkEntities(block.entities);
      });
    }
    if (db.blocks) {
      Object.keys(db.blocks).forEach(function (key) {
        var block = db.blocks[key];
        if (block && block.entities) walkEntities(block.entities);
      });
    }

    return rings;
  }

  function parseDwgBuffer(buffer) {
    return import("https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.7.9/+esm").then(function (mod) {
      return mod.LibreDwg.create("https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.7.9/wasm/").then(function (libredwg) {
        var dwg = libredwg.dwg_read_data(new Uint8Array(buffer), mod.Dwg_File_Type.DWG);
        if (!dwg) {
          throw new Error("Não foi possível ler o arquivo DWG.");
        }
        var db = libredwg.convert(dwg);
        libredwg.dwg_free(dwg);
        var rings = collectDwgRings(db);
        return pickBestPolygon(rings);
      });
    });
  }

  function parseDwg(file) {
    return readAsArrayBuffer(file).then(parseDwgBuffer);
  }

  function parseBinaryBuffer(buffer, ext) {
    if (isZipBuffer(buffer)) {
      return parseZipBuffer(buffer);
    }
    if (isShpBuffer(buffer) || ext === "shp") {
      return parseRawShpBuffer(buffer);
    }
    if (ext === "dwg") {
      return parseDwgBuffer(buffer);
    }

    var head = decodeUtf8(buffer.slice(0, Math.min(buffer.byteLength, 256))).trim();
    if (head.indexOf("<?xml") === 0 || head.indexOf("<kml") >= 0) {
      return parseKmlText(decodeUtf8(buffer));
    }
    if (head.indexOf("SECTION") >= 0 || head.indexOf("0\nSECTION") === 0) {
      return parseDxfText(decodeUtf8(buffer));
    }

    throw new Error(
      "Formato não reconhecido. Use shapefile (.zip), DWG, DXF, KML ou KMZ."
    );
  }

  function parseFile(file) {
    if (!file) {
      return Promise.reject(new Error("Nenhum arquivo selecionado."));
    }

    var ext = fileExtension(file.name);
    var suggestedName = fileBaseName(file.name);
    var job;

    if (ext === "kml") job = parseKml(file);
    else if (ext === "dxf") job = parseDxf(file);
    else if (ext === "dwg") job = parseDwg(file);
    else if (ext === "kmz" || ext === "zip") {
      job = readAsArrayBuffer(file).then(parseZipBuffer);
    } else if (ext === "shp") {
      job = readAsArrayBuffer(file).then(parseRawShpBuffer);
    } else {
      job = readAsArrayBuffer(file).then(function (buffer) {
        return parseBinaryBuffer(buffer, ext);
      });
    }

    return job
      .then(function (geometry) {
        return { geometry: geometry, suggestedName: suggestedName };
      })
      .catch(wrapImportError);
  }

  global.VTPerimeterImport = {
    ACCEPT: ACCEPT,
    parseFile: parseFile,
  };
})(window);
