(function (global) {
  "use strict";

  var TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
  var MAX_GRID = 140;
  var MAX_AREA_KM2 = 80;

  var HINTS = {
    points:
      "Gere a superfície a partir dos pontos cotados inseridos no desenho. Polilinhas entram como linhas obrigatórias.",
    terrain:
      "Curvas estimadas do modelo global de elevação (SRTM ~30 m) dentro de um perímetro — estudo preliminar, não substitui levantamento.",
    terrainDraw:
      "Desenhe o perímetro no mapa (clique nos vértices · Enter ou duplo clique para fechar).",
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function decodeTerrarium(r, g, b) {
    return r * 256 + g + b / 256 - 32768;
  }

  function latLngToTileFloat(lat, lng, zoom) {
    var n = Math.pow(2, zoom);
    var x = ((lng + 180) / 360) * n;
    var latRad = (lat * Math.PI) / 180;
    var y =
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
    return { x: x, y: y };
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("Falha ao obter elevação.")); };
      img.src = url;
    });
  }

  function fetchTerrariumTile(z, x, y) {
    var url = TERRARIUM_URL.replace("{z}", z).replace("{x}", x).replace("{y}", y);
    return loadImage(url).then(function (img) {
      var canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, 256, 256).data;
    });
  }

  function sampleElevation(pixelData, px, py) {
    var x = clamp(Math.round(px), 0, 255);
    var y = clamp(Math.round(py), 0, 255);
    var i = (y * 256 + x) * 4;
    return decodeTerrarium(pixelData[i], pixelData[i + 1], pixelData[i + 2]);
  }

  function sampleElevationBilinear(pixelData, px, py) {
    var x0 = clamp(Math.floor(px), 0, 254);
    var y0 = clamp(Math.floor(py), 0, 254);
    var fx = clamp(px - x0, 0, 1);
    var fy = clamp(py - y0, 0, 1);
    var e00 = sampleElevation(pixelData, x0, y0);
    var e10 = sampleElevation(pixelData, x0 + 1, y0);
    var e01 = sampleElevation(pixelData, x0, y0 + 1);
    var e11 = sampleElevation(pixelData, x0 + 1, y0 + 1);
    return e00 * (1 - fx) * (1 - fy) + e10 * fx * (1 - fy) + e01 * (1 - fx) * fy + e11 * fx * fy;
  }

  function elevationAtLatLng(tileCache, zoom, lat, lng) {
    var tf = latLngToTileFloat(lat, lng, zoom);
    var tx = Math.floor(tf.x);
    var ty = Math.floor(tf.y);
    var key = zoom + ":" + tx + ":" + ty;
    var pixelData = tileCache[key];
    if (!pixelData) return NaN;
    return sampleElevationBilinear(pixelData, (tf.x - tx) * 256, (tf.y - ty) * 256);
  }

  function pickZoom(bounds, cols, rows) {
    var north = bounds.getNorth();
    var south = bounds.getSouth();
    var east = bounds.getEast();
    var west = bounds.getWest();
    for (var z = 14; z >= 9; z -= 1) {
      var nw = latLngToTileFloat(north, west, z);
      var se = latLngToTileFloat(south, east, z);
      var tileW = Math.abs(se.x - nw.x);
      var tileH = Math.abs(se.y - nw.y);
      if (tileW * tileH > 36) continue;
      if ((tileW * 256) / cols < 1.5 || (tileH * 256) / rows < 1.5) continue;
      return z;
    }
    return 10;
  }

  function loadTilesForBounds(bounds, zoom) {
    var north = bounds.getNorth();
    var south = bounds.getSouth();
    var east = bounds.getEast();
    var west = bounds.getWest();
    var nw = latLngToTileFloat(north, west, zoom);
    var se = latLngToTileFloat(south, east, zoom);
    var minX = Math.floor(Math.min(nw.x, se.x));
    var maxX = Math.floor(Math.max(nw.x, se.x));
    var minY = Math.floor(Math.min(nw.y, se.y));
    var maxY = Math.floor(Math.max(nw.y, se.y));
    var tileCache = {};
    var jobs = [];
    for (var x = minX; x <= maxX; x += 1) {
      for (var y = minY; y <= maxY; y += 1) {
        (function (tileX, tileY) {
          jobs.push(
            fetchTerrariumTile(zoom, tileX, tileY).then(function (data) {
              tileCache[zoom + ":" + tileX + ":" + tileY] = data;
            })
          );
        })(x, y);
      }
    }
    return Promise.all(jobs).then(function () { return tileCache; });
  }

  function pointInPolygon(lat, lng, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var yi = ring[i].lat;
      var xi = ring[i].lng;
      var yj = ring[j].lat;
      var xj = ring[j].lng;
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function toLocalMeters(lat, lng, origin) {
    var R = 6378137;
    var x = ((lng - origin.lng) * Math.PI) / 180 * R * Math.cos((origin.lat * Math.PI) / 180);
    var y = ((lat - origin.lat) * Math.PI) / 180 * R;
    return { x: x, y: y };
  }

  function fromLocalMeters(x, y, origin) {
    var R = 6378137;
    var lat = origin.lat + (y / R) * (180 / Math.PI);
    var lng =
      origin.lng +
      (x / (R * Math.cos((origin.lat * Math.PI) / 180))) * (180 / Math.PI);
    return L.latLng(lat, lng);
  }

  function smoothGrid(values, cols, rows, passes) {
    if (!passes) return values;
    var src = values.slice();
    var dst = new Float64Array(src.length);
    for (var p = 0; p < passes; p += 1) {
      for (var row = 0; row < rows; row += 1) {
        for (var col = 0; col < cols; col += 1) {
          var center = src[row * cols + col];
          if (!isFinite(center)) {
            dst[row * cols + col] = center;
            continue;
          }
          var sum = 0;
          var count = 0;
          for (var dy = -1; dy <= 1; dy += 1) {
            for (var dx = -1; dx <= 1; dx += 1) {
              var rr = row + dy;
              var cc = col + dx;
              if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
              var v = src[rr * cols + cc];
              if (!isFinite(v)) continue;
              sum += v;
              count += 1;
            }
          }
          dst[row * cols + col] = count ? sum / count : center;
        }
      }
      var tmp = src;
      src = dst;
      dst = tmp;
    }
    return src;
  }

  function gridPointMetric(col, row, cols, rows, origin, widthM, heightM) {
    var minX = -widthM / 2;
    var minY = -heightM / 2;
    var x = minX + (col / Math.max(cols - 1, 1)) * widthM;
    var y = minY + ((rows - 1 - row) / Math.max(rows - 1, 1)) * heightM;
    return fromLocalMeters(x, y, origin);
  }

  function prepareGridForContours(values, interval) {
    var min = Infinity;
    var i;
    for (i = 0; i < values.length; i += 1) {
      if (isFinite(values[i]) && values[i] < min) min = values[i];
    }
    var fill = isFinite(min) ? min - interval * 10 : -99999;
    var filled = new Float64Array(values.length);
    for (i = 0; i < values.length; i += 1) {
      filled[i] = isFinite(values[i]) ? values[i] : fill;
    }
    return filled;
  }

  function traceContours(values, cols, rows, projectFn, interval) {
    var min = Infinity;
    var max = -Infinity;
    var i;
    for (i = 0; i < values.length; i += 1) {
      if (!isFinite(values[i])) continue;
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    var start = Math.ceil(min / interval) * interval;
    if (!isFinite(start) || start > max) return [];

    if (!global.d3 || typeof global.d3.contours !== "function") {
      return [];
    }

    var thresholds = [];
    for (var t = start; t <= max + interval * 0.001; t += interval) {
      thresholds.push(Math.round(t * 1000) / 1000);
    }

    var filled = prepareGridForContours(values, interval);
    var geoContours = global.d3
      .contours()
      .size([cols, rows])
      .thresholds(thresholds)(filled);

    return geoContours.map(function (contour) {
      var polylines = [];
      contour.coordinates.forEach(function (polygon) {
        polygon.forEach(function (ring) {
          if (!ring || ring.length < 2) return;
          polylines.push(
            ring.map(function (pt) {
              return projectFn(pt[0], pt[1]);
            })
          );
        });
      });
      return { level: contour.value, polylines: polylines };
    });
  }

  function buildHullEdgeSegments(triangles, xy) {
    var counts = {};
    var t;
    var e;
    for (t = 0; t < triangles.length; t += 3) {
      for (e = 0; e < 3; e += 1) {
        var a = triangles[t + e];
        var b = triangles[t + ((e + 1) % 3)];
        var key = a < b ? a + ":" + b : b + ":" + a;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    var segments = [];
    Object.keys(counts).forEach(function (key) {
      if (counts[key] !== 1) return;
      var parts = key.split(":");
      var ia = parseInt(parts[0], 10);
      var ib = parseInt(parts[1], 10);
      segments.push([
        [xy[ia][0], xy[ia][1]],
        [xy[ib][0], xy[ib][1]],
      ]);
    });
    return segments;
  }

  function polygonEdgeSegmentsLocal(polygon, origin) {
    var segments = [];
    var i;
    for (i = 0; i < polygon.length; i += 1) {
      var j = (i + 1) % polygon.length;
      var a = toLocalMeters(polygon[i].lat, polygon[i].lng, origin);
      var b = toLocalMeters(polygon[j].lat, polygon[j].lng, origin);
      segments.push([[a.x, a.y], [b.x, b.y]]);
    }
    return segments;
  }

  function distPointToSegment(px, py, ax, ay, bx, by) {
    var dx = bx - ax;
    var dy = by - ay;
    var len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) return Math.hypot(px - ax, py - ay);
    var t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function minDistToBoundary(px, py, boundarySegments) {
    var min = Infinity;
    var i;
    for (i = 0; i < boundarySegments.length; i += 1) {
      var seg = boundarySegments[i];
      var d = distPointToSegment(px, py, seg[0][0], seg[0][1], seg[1][0], seg[1][1]);
      if (d < min) min = d;
    }
    return min;
  }

  function pointInsideInset(px, py, boundarySegments, insetM) {
    return minDistToBoundary(px, py, boundarySegments) > insetM;
  }

  function buildHullEdgeKeys(triangles) {
    var counts = {};
    var t;
    var e;
    for (t = 0; t < triangles.length; t += 3) {
      for (e = 0; e < 3; e += 1) {
        var a = triangles[t + e];
        var b = triangles[t + ((e + 1) % 3)];
        var key = a < b ? a + ":" + b : b + ":" + a;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    var hull = {};
    Object.keys(counts).forEach(function (key) {
      if (counts[key] === 1) hull[key] = true;
    });
    return hull;
  }

  function triangleEdgeKey(i, j) {
    return i < j ? i + ":" + j : j + ":" + i;
  }

  function computeBoundaryInset(boundarySegments, interval, cellSizeM) {
    var total = 0;
    boundarySegments.forEach(function (seg) {
      total += Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]);
    });
    var avg = total / Math.max(boundarySegments.length, 1);
    var fromSize = clamp(avg * 0.15, 8, 28);
    var fromInterval = interval ? interval * 3 : 0;
    var fromCell = cellSizeM ? cellSizeM * 2.5 : 0;
    return Math.max(fromSize, fromInterval, fromCell, 8);
  }

  function pointInsideInsetRing(px, py, insetRing) {
    return pointInPolygonLocal(px, py, insetRing);
  }

  function clipSegmentToInsetRing(p1, p2, insetRing) {
    var inside1 = pointInsideInsetRing(p1[0], p1[1], insetRing);
    var inside2 = pointInsideInsetRing(p2[0], p2[1], insetRing);
    if (inside1 && inside2) return [[p1, p2]];
    if (!inside1 && !inside2) return [];

    var keepStart = inside1;
    var a = 0;
    var b = 1;
    var k;
    for (k = 0; k < 28; k += 1) {
      var m = (a + b) / 2;
      var pm = [p1[0] + m * (p2[0] - p1[0]), p1[1] + m * (p2[1] - p1[1])];
      if (pointInsideInsetRing(pm[0], pm[1], insetRing)) {
        if (keepStart) a = m;
        else b = m;
      } else if (keepStart) {
        b = m;
      } else {
        a = m;
      }
    }
    var edge = [p1[0] + a * (p2[0] - p1[0]), p1[1] + a * (p2[1] - p1[1])];
    if (Math.hypot(edge[0] - p1[0], edge[1] - p1[1]) < 0.35 && Math.hypot(edge[0] - p2[0], edge[1] - p2[1]) < 0.35) {
      return [];
    }
    if (keepStart) return [[p1, edge]];
    return [[edge, p2]];
  }

  function clipSegmentToInset(p1, p2, boundarySegments, insetM) {
    var inside1 = pointInsideInset(p1[0], p1[1], boundarySegments, insetM);
    var inside2 = pointInsideInset(p2[0], p2[1], boundarySegments, insetM);
    if (inside1 && inside2) return [[p1, p2]];
    if (!inside1 && !inside2) return [];

    var keepStart = inside1;
    var a = 0;
    var b = 1;
    var k;
    for (k = 0; k < 24; k += 1) {
      var m = (a + b) / 2;
      var pm = [p1[0] + m * (p2[0] - p1[0]), p1[1] + m * (p2[1] - p1[1])];
      if (pointInsideInset(pm[0], pm[1], boundarySegments, insetM)) {
        if (keepStart) a = m;
        else b = m;
      } else if (keepStart) {
        b = m;
      } else {
        a = m;
      }
    }
    var edge = [p1[0] + a * (p2[0] - p1[0]), p1[1] + a * (p2[1] - p1[1])];
    if (keepStart) return [[p1, edge]];
    return [[edge, p2]];
  }

  function clipSegmentsToInset(segments, boundarySegments, insetM) {
    var out = [];
    segments.forEach(function (seg) {
      var parts = clipSegmentToInset(seg[0], seg[1], boundarySegments, insetM);
      parts.forEach(function (part) {
        if (Math.hypot(part[1][0] - part[0][0], part[1][1] - part[0][1]) > 0.4) {
          out.push(part);
        }
      });
    });
    return out;
  }

  function clipPolylinesToInset(polylines, boundarySegments, insetM) {
    var segments = [];
    polylines.forEach(function (line) {
      var i;
      for (i = 0; i < line.length - 1; i += 1) {
        segments.push([line[i], line[i + 1]]);
      }
    });
    return mergeLocalSegments(clipSegmentsToInset(segments, boundarySegments, insetM));
  }

  function extractInteriorPolylines(polylines, boundarySegments, insetM) {
    var result = [];
    polylines.forEach(function (line) {
      if (line.length < 2) return;
      var current = [];
      var i;
      for (i = 0; i < line.length - 1; i += 1) {
        var parts = clipSegmentToInset(line[i], line[i + 1], boundarySegments, insetM);
        parts.forEach(function (part) {
          if (!current.length) {
            current.push(part[0].slice());
            current.push(part[1].slice());
            return;
          }
          if (localKey(current[current.length - 1]) === localKey(part[0])) {
            current.push(part[1].slice());
          } else {
            if (current.length >= 2) result.push(current.slice());
            current = [part[0].slice(), part[1].slice()];
          }
        });
      }
      if (current.length >= 2) result.push(current);
    });
    return result;
  }

  function pointOnBoundary(px, py, boundarySegments, tol) {
    var i;
    for (i = 0; i < boundarySegments.length; i += 1) {
      var seg = boundarySegments[i];
      if (distPointToSegment(px, py, seg[0][0], seg[0][1], seg[1][0], seg[1][1]) <= tol) {
        return true;
      }
    }
    return false;
  }

  function segmentOnBoundary(p1, p2, boundarySegments, tol) {
    return (
      pointOnBoundary(p1[0], p1[1], boundarySegments, tol) &&
      pointOnBoundary(p2[0], p2[1], boundarySegments, tol)
    );
  }

  function trimBoundaryPolylines(polylines, boundarySegments, tol) {
    var out = [];
    polylines.forEach(function (line) {
      if (line.length < 2) return;
      var start = 0;
      var end = line.length - 1;
      while (start < end && pointOnBoundary(line[start][0], line[start][1], boundarySegments, tol)) {
        start += 1;
      }
      while (end > start && pointOnBoundary(line[end][0], line[end][1], boundarySegments, tol)) {
        end -= 1;
      }
      if (end - start < 1) return;
      var trimmed = line.slice(start, end + 1);
      if (trimmed.length === 2 && segmentOnBoundary(trimmed[0], trimmed[1], boundarySegments, tol)) return;
      var allBoundary = trimmed.every(function (pt) {
        return pointOnBoundary(pt[0], pt[1], boundarySegments, tol);
      });
      if (allBoundary) return;
      out.push(trimmed);
    });
    return out;
  }

  function pointInPolygonLocal(x, y, ring) {
    var inside = false;
    var i;
    var j;
    for (i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i].x;
      var yi = ring[i].y;
      var xj = ring[j].x;
      var yj = ring[j].y;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function localRingFromLatLng(polygon, origin) {
    return polygon.map(function (ll) {
      var p = toLocalMeters(ll.lat, ll.lng, origin);
      return { x: p.x, y: p.y };
    });
  }

  function buildInsetRingLocal(ring, insetM) {
    var n = ring.length;
    if (n < 3 || insetM <= 0) return ring.slice();

    var area = 0;
    var i;
    for (i = 0; i < n; i += 1) {
      var j = (i + 1) % n;
      area += ring[i].x * ring[j].y - ring[j].x * ring[i].y;
    }
    var ccw = area >= 0;

    var out = [];
    for (i = 0; i < n; i += 1) {
      var prev = ring[(i + n - 1) % n];
      var curr = ring[i];
      var next = ring[(i + 1) % n];

      var e1x = curr.x - prev.x;
      var e1y = curr.y - prev.y;
      var l1 = Math.hypot(e1x, e1y) || 1;
      var n1x = (ccw ? e1y : -e1y) / l1;
      var n1y = (ccw ? -e1x : e1x) / l1;

      var e2x = next.x - curr.x;
      var e2y = next.y - curr.y;
      var l2 = Math.hypot(e2x, e2y) || 1;
      var n2x = (ccw ? e2y : -e2y) / l2;
      var n2y = (ccw ? -e2x : e2x) / l2;

      var bx = n1x + n2x;
      var by = n1y + n2y;
      var bl = Math.hypot(bx, by);
      if (bl < 1e-9) {
        bx = n1x;
        by = n1y;
      } else {
        bx /= bl;
        by /= bl;
      }

      var dot = bx * n1x + by * n1y;
      var miter = insetM / Math.max(dot, 0.25);
      miter = Math.min(miter, insetM * 4);
      out.push({ x: curr.x + bx * miter, y: curr.y + by * miter });
    }

    var cx = 0;
    var cy = 0;
    ring.forEach(function (p) {
      cx += p.x;
      cy += p.y;
    });
    cx /= n;
    cy /= n;
    if (!pointInPolygonLocal(cx, cy, out)) {
      var maxR = 0;
      ring.forEach(function (p) {
        var d = Math.hypot(p.x - cx, p.y - cy);
        if (d > maxR) maxR = d;
      });
      var scale = maxR > insetM ? Math.max(0.15, (maxR - insetM) / maxR) : 0.85;
      return ring.map(function (p) {
        return { x: cx + (p.x - cx) * scale, y: cy + (p.y - cy) * scale };
      });
    }
    return out;
  }

  function triangleTouchesHull(ia, ib, ic, hullEdges) {
    return (
      hullEdges[triangleEdgeKey(ia, ib)] ||
      hullEdges[triangleEdgeKey(ib, ic)] ||
      hullEdges[triangleEdgeKey(ic, ia)]
    );
  }

  function isBoundaryHuggingPolyline(line, boundarySegments, insetM) {
    if (line.length < 4) return false;
    var closed = localKey(line[0]) === localKey(line[line.length - 1]);
    var near = 0;
    var i;
    for (i = 0; i < line.length; i += 1) {
      if (minDistToBoundary(line[i][0], line[i][1], boundarySegments) < insetM * 1.25) {
        near += 1;
      }
    }
    if (near / line.length > 0.85) return true;
    if (!closed) return false;
    return near / line.length > 0.55;
  }

  function filterInteriorPolylines(polylines, insetRing, boundarySegments, insetM) {
    var result = [];
    polylines.forEach(function (line) {
      if (line.length < 2) return;
      if (boundarySegments && isBoundaryHuggingPolyline(line, boundarySegments, insetM)) return;
      var current = [];
      var i;
      for (i = 0; i < line.length - 1; i += 1) {
        var parts = clipSegmentToInsetRing(line[i], line[i + 1], insetRing);
        parts.forEach(function (part) {
          if (!current.length) {
            current.push(part[0].slice());
            current.push(part[1].slice());
            return;
          }
          if (localKey(current[current.length - 1]) === localKey(part[0])) {
            current.push(part[1].slice());
          } else {
            if (current.length >= 2) result.push(current.slice());
            current = [part[0].slice(), part[1].slice()];
          }
        });
      }
      if (current.length >= 2) result.push(current);
    });
    return result;
  }

  function filterContourPolylinesLatLng(polylines, insetRing, boundarySegments, origin, insetM) {
    var localLines = polylines.map(function (line) {
      return line.map(function (ll) {
        var local = toLocalMeters(ll.lat, ll.lng, origin);
        return [local.x, local.y];
      });
    });
    var interior = filterInteriorPolylines(localLines, insetRing, boundarySegments, insetM);
    return interior.map(function (line) {
      return line.map(function (pt) {
        return fromLocalMeters(pt[0], pt[1], origin);
      });
    });
  }

  function erodeValidGrid(values, cols, rows, passes) {
    var src = values;
    var p;
    var pass;
    for (pass = 0; pass < passes; pass += 1) {
      var dst = src.slice();
      var row;
      var col;
      for (row = 0; row < rows; row += 1) {
        for (col = 0; col < cols; col += 1) {
          var idx = row * cols + col;
          if (!isFinite(src[idx])) continue;
          var touchesVoid = false;
          var dy;
          var dx;
          for (dy = -1; dy <= 1; dy += 1) {
            for (dx = -1; dx <= 1; dx += 1) {
              if (dx === 0 && dy === 0) continue;
              var rr = row + dy;
              var cc = col + dx;
              if (rr < 0 || cc < 0 || rr >= rows || cc >= cols || !isFinite(src[rr * cols + cc])) {
                touchesVoid = true;
                break;
              }
            }
            if (touchesVoid) break;
          }
          if (touchesVoid) dst[idx] = NaN;
        }
      }
      src = dst;
    }
    return src;
  }

  function localKey(pt) {
    return pt[0].toFixed(2) + "|" + pt[1].toFixed(2);
  }

  function edgeCrossLocal(x1, y1, z1, x2, y2, z2, level) {
    if ((z1 - level) * (z2 - level) > 0) return null;
    if (Math.abs(z2 - z1) < 1e-9) return null;
    var t = clamp((level - z1) / (z2 - z1), 0, 1);
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  }

  function contourSegmentsInTriangle(ax, ay, az, bx, by, bz, cx, cy, cz, level, ia, ib, ic, hullEdges) {
    var verts = [
      { x: ax, y: ay, z: az },
      { x: bx, y: by, z: bz },
      { x: cx, y: cy, z: cz },
    ];
    var indices = [ia, ib, ic];
    var crossings = [];
    var i;
    for (i = 0; i < 3; i += 1) {
      var vi = indices[i];
      var vj = indices[(i + 1) % 3];
      var a = verts[i];
      var b = verts[(i + 1) % 3];
      var p = edgeCrossLocal(a.x, a.y, a.z, b.x, b.y, b.z, level);
      if (!p) continue;
      var key = triangleEdgeKey(vi, vj);
      var dup = false;
      var j;
      for (j = 0; j < crossings.length; j += 1) {
        if (localKey(p) === localKey(crossings[j].p)) {
          dup = true;
          break;
        }
      }
      if (!dup) crossings.push({ p: p, key: key });
    }
    if (crossings.length !== 2) return [];
    if (hullEdges[crossings[0].key] || hullEdges[crossings[1].key]) return [];
    return [[crossings[0].p, crossings[1].p]];
  }

  function mergeLocalSegments(segments) {
    if (!segments.length) return [];
    var used = new Array(segments.length);
    var polylines = [];
    var i;
    for (i = 0; i < segments.length; i += 1) used[i] = false;

    function extendChain(chain) {
      var extended = true;
      while (extended) {
        extended = false;
        var tail = chain[chain.length - 1];
        var head = chain[0];
        for (i = 0; i < segments.length; i += 1) {
          if (used[i]) continue;
          var seg = segments[i];
          if (localKey(seg[0]) === localKey(tail)) {
            chain.push(seg[1].slice());
            used[i] = true;
            extended = true;
            break;
          }
          if (localKey(seg[1]) === localKey(tail)) {
            chain.push(seg[0].slice());
            used[i] = true;
            extended = true;
            break;
          }
          if (localKey(seg[1]) === localKey(head)) {
            chain.unshift(seg[0].slice());
            used[i] = true;
            extended = true;
            break;
          }
          if (localKey(seg[0]) === localKey(head)) {
            chain.unshift(seg[1].slice());
            used[i] = true;
            extended = true;
            break;
          }
        }
      }
    }

    for (i = 0; i < segments.length; i += 1) {
      if (used[i]) continue;
      used[i] = true;
      var chain = [segments[i][0].slice(), segments[i][1].slice()];
      extendChain(chain);
      if (chain.length >= 2) polylines.push(chain);
    }
    return polylines;
  }

  function traceContoursFromTin(triangles, xy, zValues, origin, interval, hullEdges, boundaryRing) {
    var min = Math.min.apply(null, zValues);
    var max = Math.max.apply(null, zValues);
    var start = Math.ceil(min / interval) * interval;
    var result = [];
    if (!isFinite(start) || start > max) return result;

    var boundarySegments = [];
    var bi;
    for (bi = 0; bi < boundaryRing.length; bi += 1) {
      var bj = (bi + 1) % boundaryRing.length;
      boundarySegments.push([
        [boundaryRing[bi].x, boundaryRing[bi].y],
        [boundaryRing[bj].x, boundaryRing[bj].y],
      ]);
    }
    var insetM = computeBoundaryInset(boundarySegments, interval);
    var insetRing = buildInsetRingLocal(boundaryRing, insetM);
    var levelCount = Math.floor((max - start) / interval + 1.001);
    var li;
    for (li = 0; li < levelCount; li += 1) {
      var level = start + li * interval;
      var segments = [];
      var t;
      for (t = 0; t < triangles.length; t += 3) {
        var ia = triangles[t];
        var ib = triangles[t + 1];
        var ic = triangles[t + 2];
        if (triangleTouchesHull(ia, ib, ic, hullEdges)) continue;
        var triSegs = contourSegmentsInTriangle(
          xy[ia][0], xy[ia][1], zValues[ia],
          xy[ib][0], xy[ib][1], zValues[ib],
          xy[ic][0], xy[ic][1], zValues[ic],
          level,
          ia,
          ib,
          ic,
          hullEdges
        );
        triSegs.forEach(function (seg) {
          segments.push(seg);
        });
      }
      if (!segments.length) continue;
      var merged = mergeLocalSegments(segments);
      var interior = filterInteriorPolylines(merged, insetRing, boundarySegments, insetM);
      var polylines = interior.map(function (line) {
        return line.map(function (pt) {
          return fromLocalMeters(pt[0], pt[1], origin);
        });
      });
      if (polylines.length) result.push({ level: level, polylines: polylines });
    }
    return result;
  }

  function polylineLengthMeters(line) {
    var total = 0;
    for (var i = 1; i < line.length; i += 1) {
      total += line[i - 1].distanceTo(line[i]);
    }
    return total;
  }

  function isMasterLevel(level, masterInterval) {
    if (!masterInterval || masterInterval <= 0) return false;
    var ratio = level / masterInterval;
    return Math.abs(ratio - Math.round(ratio)) < 1e-4;
  }

  function computeGridFromMalha(bounds, malhaM) {
    var latMid = (bounds.getNorth() + bounds.getSouth()) / 2;
    var heightM = Math.abs(bounds.getNorth() - bounds.getSouth()) * 111320;
    var widthM =
      Math.abs(bounds.getEast() - bounds.getWest()) *
      111320 *
      Math.cos((latMid * Math.PI) / 180);
    var cols = clamp(Math.round(widthM / malhaM) + 1, 20, MAX_GRID);
    var rows = clamp(Math.round(heightM / malhaM) + 1, 20, MAX_GRID);
    return { cols: cols, rows: rows };
  }

  function geoJsonRingToLatLngs(geometry) {
    if (!geometry || !geometry.coordinates || !geometry.coordinates[0]) return null;
    return geometry.coordinates[0].map(function (c) {
      return L.latLng(c[1], c[0]);
    });
  }

  function drawContours(tool, contours, interval, masterInterval) {
    var masterStep = masterInterval || interval * 5;
    contours.forEach(function (contour) {
      var isIndex = isMasterLevel(contour.level, masterStep);
      var polylines = contour.polylines || [];
      var bestLine = null;
      var bestLen = 0;

      polylines.forEach(function (line) {
        if (line.length < 2) return;
        var len = polylineLengthMeters(line);
        if (len < 15) return;
        if (isIndex && len > bestLen) {
          bestLen = len;
          bestLine = line;
        }
        L.polyline(line, {
          color: isIndex ? "#8B5A2B" : "#C4A574",
          weight: isIndex ? 2 : 0.85,
          opacity: isIndex ? 0.92 : 0.62,
          interactive: false,
          smoothFactor: 2,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(tool._resultLayer);
      });

      if (isIndex && bestLine && bestLen >= 50) {
        var midIdx = Math.floor(bestLine.length / 2);
        var mid = bestLine[midIdx];
        L.marker(mid, {
          icon: L.divIcon({
            className: "contour-elev-label",
            html:
              '<span class="contour-elev-label__text">' +
              Math.round(contour.level) +
              " m</span>",
            iconSize: null,
          }),
          interactive: false,
        }).addTo(tool._resultLayer);
      }
    });
  }

  function collectDrawFeatures(drawTools) {
    var points = [];
    var lines = [];
    if (!drawTools || !drawTools._drawnLayer) return { points: points, lines: lines };
    drawTools._drawnLayer.eachLayer(function (layer) {
      if (layer._vtLatLng) {
        points.push({
          lat: layer._vtLatLng.lat,
          lng: layer._vtLatLng.lng,
          z: layer._vtAttrs && layer._vtAttrs.z !== undefined ? layer._vtAttrs.z : null,
        });
      }
      if (layer._vtLinePoints && layer._vtLinePoints.length >= 2) {
        lines.push(layer._vtLinePoints.slice());
      }
    });
    return { points: points, lines: lines };
  }

  function uniquePoints(points) {
    var seen = {};
    var out = [];
    points.forEach(function (pt) {
      var key = pt.lat.toFixed(6) + "," + pt.lng.toFixed(6);
      if (seen[key]) return;
      seen[key] = true;
      out.push(pt);
    });
    return out;
  }

  function buildDemGridMetric(bounds, polygon, tileCache, zoom, cols, rows) {
    var origin = bounds.getCenter();
    var latMid = origin.lat;
    var heightM = Math.abs(bounds.getNorth() - bounds.getSouth()) * 111320;
    var widthM =
      Math.abs(bounds.getEast() - bounds.getWest()) *
      111320 *
      Math.cos((latMid * Math.PI) / 180);
    var minX = -widthM / 2;
    var minY = -heightM / 2;
    var values = new Float64Array(cols * rows);
    var min = Infinity;
    var max = -Infinity;
    var row;
    var col;
    for (row = 0; row < rows; row += 1) {
      for (col = 0; col < cols; col += 1) {
        var x = minX + (col / Math.max(cols - 1, 1)) * widthM;
        var y = minY + ((rows - 1 - row) / Math.max(rows - 1, 1)) * heightM;
        var ll = fromLocalMeters(x, y, origin);
        if (!pointInPolygon(ll.lat, ll.lng, polygon)) {
          values[row * cols + col] = NaN;
          continue;
        }
        var elev = elevationAtLatLng(tileCache, zoom, ll.lat, ll.lng);
        values[row * cols + col] = elev;
        if (isFinite(elev)) {
          if (elev < min) min = elev;
          if (elev > max) max = elev;
        }
      }
    }
    return {
      values: values,
      min: min,
      max: max,
      origin: origin,
      widthM: widthM,
      heightM: heightM,
    };
  }

  function ContourTool(map, drawTools, hintEl) {
    this._map = map;
    this._drawTools = drawTools;
    this._hintEl = hintEl;
    this._resultLayer = L.layerGroup().addTo(map);
    this._tinLayer = L.layerGroup().addTo(map);
    this._previewLayer = L.layerGroup().addTo(map);
    this._terrainPolygon = null;
    this._drawingPolygon = false;
    this._polyPoints = [];
    this._clickTimer = null;
    this._onClick = this._handleMapClick.bind(this);
    this._onDblClick = this._handleMapDblClick.bind(this);
    this._onMove = this._handleMapMove.bind(this);
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onTerrainPolygonReady = null;
  }

  ContourTool.prototype.setTerrainPolygon = function (polygon, showPreview) {
    this._terrainPolygon = polygon && polygon.length >= 3 ? polygon.slice() : null;
    this._previewLayer.clearLayers();
    if (showPreview && this._terrainPolygon) {
      L.polygon(this._terrainPolygon, {
        color: "#2d6a4f",
        weight: 2,
        fillColor: "#2d6a4f",
        fillOpacity: 0.1,
        interactive: false,
      }).addTo(this._previewLayer);
    }
  };

  ContourTool.prototype.setOnTerrainPolygonReady = function (callback) {
    this._onTerrainPolygonReady = callback || null;
  };

  ContourTool.prototype._finishPolygonDraw = function () {
    if (this._polyPoints.length < 3) return;
    this._terrainPolygon = this._polyPoints.slice();
    this.stopPolygonDraw();
    L.polygon(this._terrainPolygon, {
      color: "#2d6a4f",
      weight: 2,
      fillColor: "#2d6a4f",
      fillOpacity: 0.1,
      interactive: false,
    }).addTo(this._previewLayer);
    if (this._onTerrainPolygonReady) this._onTerrainPolygonReady(this._terrainPolygon);
  };

  ContourTool.prototype._setHint = function (text) {
    if (!this._hintEl) return;
    this._hintEl.textContent = text || "";
    this._hintEl.hidden = !text;
  };

  ContourTool.prototype.clear = function () {
    this._resultLayer.clearLayers();
    this._tinLayer.clearLayers();
  };

  ContourTool.prototype.clearTerrain = function () {
    this._terrainPolygon = null;
    this._previewLayer.clearLayers();
  };

  ContourTool.prototype.stopPolygonDraw = function () {
    if (!this._drawingPolygon) return;
    this._drawingPolygon = false;
    this._polyPoints = [];
    clearTimeout(this._clickTimer);
    this._clickTimer = null;
    this._map.off("click", this._onClick);
    this._map.off("dblclick", this._onDblClick);
    this._map.off("mousemove", this._onMove);
    document.removeEventListener("keydown", this._onKeyDown);
    this._map.doubleClickZoom.enable();
    this._map.getContainer().classList.remove("map--drawing");
    this._setHint("");
  };

  ContourTool.prototype.startPolygonDraw = function () {
    this.stopPolygonDraw();
    this._drawingPolygon = true;
    this._polyPoints = [];
    this._previewLayer.clearLayers();
    this._terrainPolygon = null;
    this._map.doubleClickZoom.disable();
    this._map.getContainer().classList.add("map--drawing");
    this._map.on("click", this._onClick);
    this._map.on("dblclick", this._onDblClick);
    this._map.on("mousemove", this._onMove);
    document.addEventListener("keydown", this._onKeyDown);
    this._setHint(HINTS.terrainDraw);
  };

  ContourTool.prototype._refreshPreview = function (cursor) {
    this._previewLayer.clearLayers();
    if (!this._polyPoints.length) return;
    var pts = this._polyPoints.slice();
    if (cursor) pts.push(cursor);
    if (pts.length >= 2) {
      L.polyline(pts, { color: "#2d6a4f", weight: 2, dashArray: "5 4" }).addTo(this._previewLayer);
    }
    pts.forEach(function (ll) {
      L.circleMarker(ll, { radius: 4, color: "#2d6a4f", weight: 2, fillColor: "#fff", fillOpacity: 1 }).addTo(
        this._previewLayer
      );
    }, this);
  };

  ContourTool.prototype._handleMapClick = function (e) {
    var self = this;
    if (!this._drawingPolygon) return;
    L.DomEvent.stop(e);
    if (this._clickTimer) clearTimeout(this._clickTimer);
    this._clickTimer = setTimeout(function () {
      self._clickTimer = null;
      self._polyPoints.push(e.latlng);
      self._refreshPreview();
    }, 220);
  };

  ContourTool.prototype._handleMapDblClick = function (e) {
    if (!this._drawingPolygon) return;
    L.DomEvent.stop(e);
    clearTimeout(this._clickTimer);
    this._clickTimer = null;
    this._finishPolygonDraw();
  };

  ContourTool.prototype._handleKeyDown = function (e) {
    if (!this._drawingPolygon) return;
    if (e.key === "Enter") {
      e.preventDefault();
      this._finishPolygonDraw();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.stopPolygonDraw();
      if (this._onTerrainPolygonReady) this._onTerrainPolygonReady(null);
    }
  };

  ContourTool.prototype._handleMapMove = function (e) {
    if (!this._drawingPolygon || !this._polyPoints.length) return;
    this._refreshPreview(e.latlng);
  };

  ContourTool.prototype.getCotadosCount = function () {
    var data = collectDrawFeatures(this._drawTools);
    return uniquePoints(data.points).filter(function (pt) {
      return pt.z !== null && pt.z !== undefined && !isNaN(pt.z);
    }).length;
  };

  ContourTool.prototype.generateFromPoints = function (options) {
    var self = this;
    var interval = options.interval || 10;
    var data = collectDrawFeatures(this._drawTools);
    var points = uniquePoints(data.points).filter(function (pt) {
      return pt.z !== null && pt.z !== undefined && !isNaN(pt.z);
    });

    if (points.length < 3) {
      return Promise.reject(
        new Error("Insira ao menos 3 pontos cotados no desenho antes de criar a superfície.")
      );
    }

    var bounds = L.latLngBounds(points.map(function (p) { return [p.lat, p.lng]; })).pad(0.08);
    var origin = bounds.getCenter();
    var DelaunayLib = (global.d3 && global.d3.Delaunay) || global.Delaunay;
    if (!DelaunayLib) {
      return Promise.reject(new Error("Biblioteca de triangulação não carregada."));
    }

    var xy = [];
    var zValues = [];
    points.forEach(function (pt) {
      var local = toLocalMeters(pt.lat, pt.lng, origin);
      xy.push([local.x, local.y]);
      zValues.push(pt.z);
    });

    var delaunay = DelaunayLib.from(xy);
    self.clear();

    var triangles = delaunay.triangles;
    for (var t = 0; t < triangles.length; t += 3) {
      var ia = triangles[t];
      var ib = triangles[t + 1];
      var ic = triangles[t + 2];
      L.polygon(
        [
          fromLocalMeters(xy[ia][0], xy[ia][1], origin),
          fromLocalMeters(xy[ib][0], xy[ib][1], origin),
          fromLocalMeters(xy[ic][0], xy[ic][1], origin),
        ],
        { color: "#94a3b8", weight: 0.5, fillColor: "#cbd5e1", fillOpacity: 0.08, interactive: false }
      ).addTo(self._tinLayer);
    }

    var hullEdges = buildHullEdgeKeys(triangles);
    var hullRing = [];
    if (delaunay.hull && delaunay.hull.length >= 3) {
      var hi;
      for (hi = 0; hi < delaunay.hull.length; hi += 1) {
        var hidx = delaunay.hull[hi];
        hullRing.push({ x: xy[hidx][0], y: xy[hidx][1] });
      }
    } else {
      var hullSegments = buildHullEdgeSegments(triangles, xy);
      hullSegments.forEach(function (seg) {
        hullRing.push({ x: seg[0][0], y: seg[0][1] });
      });
    }
    var contours = traceContoursFromTin(triangles, xy, zValues, origin, interval, hullEdges, hullRing);
    drawContours(self, contours, interval);

    return Promise.resolve({
      contours: contours.length,
      points: points.length,
      min: Math.min.apply(null, zValues),
      max: Math.max.apply(null, zValues),
    });
  };

  ContourTool.prototype.generateFromTerrain = function (options) {
    var self = this;
    var interval = options.interval || 1;
    var masterInterval = options.masterInterval || 5;
    var malhaM = Math.max(options.gridSize || 10, 5);
    var smoothPasses = 3;

    if (!this._terrainPolygon || this._terrainPolygon.length < 3) {
      return Promise.reject(new Error("Escolha ou desenhe um perímetro antes de gerar as curvas estimadas."));
    }

    var bounds = L.latLngBounds(this._terrainPolygon);
    var latMid = (bounds.getNorth() + bounds.getSouth()) / 2;
    var km2 =
      Math.abs(bounds.getNorth() - bounds.getSouth()) *
      111.32 *
      Math.abs(bounds.getEast() - bounds.getWest()) *
      111.32 *
      Math.cos((latMid * Math.PI) / 180);
    if (km2 > MAX_AREA_KM2) {
      return Promise.reject(new Error("Perímetro muito grande. Desenhe uma área menor."));
    }

    var gridDims = computeGridFromMalha(bounds, malhaM);
    var cols = gridDims.cols;
    var rows = gridDims.rows;
    var zoom = pickZoom(bounds, cols, rows);

    self.clear();
    self._tinLayer.clearLayers();

    return loadTilesForBounds(bounds, zoom).then(function (tileCache) {
      var grid = buildDemGridMetric(bounds, self._terrainPolygon, tileCache, zoom, cols, rows);
      var boundaryRing = localRingFromLatLng(self._terrainPolygon, grid.origin);
      var boundarySegments = polygonEdgeSegmentsLocal(self._terrainPolygon, grid.origin);
      var cellSizeM = Math.min(grid.widthM / Math.max(cols - 1, 1), grid.heightM / Math.max(rows - 1, 1));
      var insetM = computeBoundaryInset(boundarySegments, interval, cellSizeM);
      var erodePasses = Math.max(4, Math.ceil(insetM / cellSizeM) + 3);
      var eroded = erodeValidGrid(grid.values, cols, rows, erodePasses);
      var gridValues = smoothGrid(eroded, cols, rows, smoothPasses);
      var projectFn = function (col, row) {
        return gridPointMetric(col, row, cols, rows, grid.origin, grid.widthM, grid.heightM);
      };
      var contours = traceContours(gridValues, cols, rows, projectFn, interval);
      var insetRing = buildInsetRingLocal(boundaryRing, insetM);
      contours = contours.map(function (contour) {
        return {
          level: contour.level,
          polylines: filterContourPolylinesLatLng(
            contour.polylines,
            insetRing,
            boundarySegments,
            grid.origin,
            insetM
          ),
        };
      });
      drawContours(self, contours, interval, masterInterval);
      self.clearTerrain();
      return {
        contours: contours.length,
        min: grid.min,
        max: grid.max,
      };
    });
  };

  function init(options) {
    options = options || {};
    var map = options.map;
    var drawTools = options.drawTools;
    var hintEl = options.hintEl || document.getElementById("tool-hint");
    var bar = document.getElementById("contour-draw-bar");
    var barClose = document.getElementById("contour-draw-close");
    var btnPoints = document.getElementById("contour-mode-points");
    var btnTerrain = document.getElementById("contour-mode-terrain");
    var btnRun = document.getElementById("contour-run");
    var btnClear = document.getElementById("contour-clear");
    var inputInterval = document.getElementById("contour-interval");
    var selectSmooth = document.getElementById("contour-smoothing");
    var barHint = document.getElementById("contour-bar-hint");
    var accordionStatus = document.getElementById("contour-bar-status");
    var accordionClose = document.getElementById("contour-bar-status-close");
    var terrainModal = document.getElementById("terrain-contour-modal");
    var terrainClose = document.getElementById("terrain-contour-close");
    var terrainCancel = document.getElementById("terrain-contour-cancel");
    var terrainGenerate = document.getElementById("terrain-contour-generate");
    var terrainDraw = document.getElementById("terrain-contour-draw");
    var terrainPerimeter = document.getElementById("terrain-contour-perimeter");
    var terrainPerimeterWarn = document.getElementById("terrain-contour-perimeter-warn");
    var terrainGrid = document.getElementById("terrain-contour-grid");
    var terrainInterval = document.getElementById("terrain-contour-interval");
    var terrainMaster = document.getElementById("terrain-contour-master");

    if (!map || !drawTools || !bar) return null;

    var tool = new ContourTool(map, drawTools, hintEl);
    var perimeterSource = "";

    function getServiceGeometry() {
      if (window.VTServicoPage && window.VTServicoPage.getServiceGeometry) {
        return window.VTServicoPage.getServiceGeometry();
      }
      return null;
    }

    function refreshPerimeterSelect() {
      if (!terrainPerimeter) return;
      var geometry = getServiceGeometry();
      var current = terrainPerimeter.value;
      terrainPerimeter.innerHTML = '<option value="">Escolha o perímetro…</option>';
      if (geometry && geometry.coordinates) {
        var opt = document.createElement("option");
        opt.value = "service";
        opt.textContent = "Perímetro do serviço";
        terrainPerimeter.appendChild(opt);
      }
      if (current && terrainPerimeter.querySelector('option[value="' + current + '"]')) {
        terrainPerimeter.value = current;
      }
      if (terrainPerimeterWarn) {
        terrainPerimeterWarn.hidden = !!(geometry && geometry.coordinates);
      }
    }

    function setModePoints() {
      if (btnPoints) btnPoints.classList.add("is-active");
      if (btnTerrain) btnTerrain.classList.remove("is-active");
      if (barHint) barHint.textContent = HINTS.points;
      if (btnRun) btnRun.textContent = "Criar superfície";
      tool.stopPolygonDraw();
    }

    function showTerrainModal() {
      if (!terrainModal) return;
      refreshPerimeterSelect();
      perimeterSource = "";
      if (terrainPerimeter) terrainPerimeter.value = "";
      tool.clearTerrain();
      terrainModal.hidden = false;
    }

    function hideTerrainModal() {
      if (!terrainModal) return;
      terrainModal.hidden = true;
      tool.stopPolygonDraw();
      tool.clearTerrain();
      perimeterSource = "";
    }

    function applySelectedPerimeter() {
      if (!terrainPerimeter || terrainPerimeter.value !== "service") {
        if (perimeterSource === "service") {
          tool.clearTerrain();
          perimeterSource = "";
        }
        return;
      }
      var ring = geoJsonRingToLatLngs(getServiceGeometry());
      if (!ring || ring.length < 3) return;
      tool.setTerrainPolygon(ring, true);
      perimeterSource = "service";
    }

    function getTerrainOptions() {
      return {
        gridSize: parseFloat(String(terrainGrid ? terrainGrid.value : "10").replace(",", ".")),
        interval: parseFloat(String(terrainInterval ? terrainInterval.value : "1").replace(",", ".")),
        masterInterval: parseFloat(String(terrainMaster ? terrainMaster.value : "5").replace(",", ".")),
      };
    }

    tool.setOnTerrainPolygonReady(function () {
      if (terrainModal) terrainModal.hidden = false;
      if (terrainPerimeter) terrainPerimeter.value = "";
      perimeterSource = "drawn";
    });

    function showBar() {
      bar.hidden = false;
      if (accordionStatus) accordionStatus.hidden = false;
      setModePoints();
    }

    function hideBar() {
      bar.hidden = true;
      if (accordionStatus) accordionStatus.hidden = true;
      hideTerrainModal();
      tool.stopPolygonDraw();
      tool.clearTerrain();
    }

    function getPointOptions() {
      var interval = parseFloat(String(inputInterval ? inputInterval.value : "10").replace(",", "."));
      return {
        interval: interval,
        smoothing: selectSmooth ? selectSmooth.value : "medium",
      };
    }

    if (btnPoints) {
      btnPoints.addEventListener("click", setModePoints);
    }

    if (btnTerrain) {
      btnTerrain.addEventListener("click", showTerrainModal);
    }

    if (btnRun) {
      btnRun.addEventListener("click", function () {
        var opts = getPointOptions();
        if (!opts.interval || opts.interval <= 0) return;
        btnRun.disabled = true;
        tool
          .generateFromPoints(opts)
          .catch(function (err) {
            alert(err && err.message ? err.message : "Falha ao gerar curvas.");
          })
          .finally(function () {
            btnRun.disabled = false;
          });
      });
    }

    if (btnClear) {
      btnClear.addEventListener("click", function () {
        tool.clear();
        tool.clearTerrain();
      });
    }

    if (terrainPerimeter) {
      terrainPerimeter.addEventListener("change", function () {
        applySelectedPerimeter();
      });
    }

    if (terrainDraw) {
      terrainDraw.addEventListener("click", function () {
        if (terrainModal) terrainModal.hidden = true;
        if (terrainPerimeter) terrainPerimeter.value = "";
        perimeterSource = "";
        tool.clearTerrain();
        tool.startPolygonDraw();
      });
    }

    if (terrainGenerate) {
      terrainGenerate.addEventListener("click", function () {
        var opts = getTerrainOptions();
        if (!opts.gridSize || opts.gridSize <= 0) {
          alert("Informe a malha (m) válida.");
          return;
        }
        if (!opts.interval || opts.interval <= 0) {
          alert("Informe a equidistância das curvas (m) válida.");
          return;
        }
        if (!opts.masterInterval || opts.masterInterval <= 0) {
          alert("Informe a equidistância das curvas mestras (m) válida.");
          return;
        }
        if (!tool._terrainPolygon || tool._terrainPolygon.length < 3) {
          alert("Escolha ou desenhe um perímetro antes de gerar as curvas estimadas.");
          return;
        }
        terrainGenerate.disabled = true;
        tool
          .generateFromTerrain(opts)
          .then(function () {
            hideTerrainModal();
          })
          .catch(function (err) {
            alert(err && err.message ? err.message : "Falha ao gerar curvas.");
          })
          .finally(function () {
            terrainGenerate.disabled = false;
          });
      });
    }

    function onTerrainModalDismiss() {
      hideTerrainModal();
    }

    if (terrainClose) terrainClose.addEventListener("click", onTerrainModalDismiss);
    if (terrainCancel) terrainCancel.addEventListener("click", onTerrainModalDismiss);
    if (terrainModal) {
      terrainModal.addEventListener("click", function (e) {
        if (e.target === terrainModal) onTerrainModalDismiss();
      });
    }

    if (barClose) barClose.addEventListener("click", hideBar);
    if (accordionClose) accordionClose.addEventListener("click", hideBar);

    return {
      tool: tool,
      showBar: showBar,
      hideBar: hideBar,
    };
  }

  global.VTContourTool = {
    init: init,
  };
})(window);
