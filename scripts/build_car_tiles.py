import json
import math
import os
from collections import defaultdict

import ijson
from shapely.geometry import shape, mapping

BASE = os.path.join(os.path.dirname(__file__), "..", "geojason")
SRC = os.path.join(BASE, "CAR_SC.geojson")
OUT_DIR = os.path.join(BASE, "_web", "car_tiles")
TILE_SIZE = 0.25
TOLERANCE = 0.0001

KEEP_PROPS = [
    "cod_imovel",
    "municipio",
    "num_area",
    "mod_fiscal",
    "des_condic",
    "ind_status",
    "dat_atuali",
]


def tile_keys_for_bounds(minx, miny, maxx, maxy):
    keys = set()
    x = math.floor(minx / TILE_SIZE) * TILE_SIZE
    while x < maxx:
        y = math.floor(miny / TILE_SIZE) * TILE_SIZE
        while y < maxy:
            keys.add(f"{y:.2f}_{x:.2f}")
            y += TILE_SIZE
        x += TILE_SIZE
    return keys


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    for name in os.listdir(OUT_DIR):
        if name.endswith(".geojson"):
            os.remove(os.path.join(OUT_DIR, name))

    buckets = defaultdict(list)
    total = 0

    print("Processando CAR_SC.geojson (streaming)...")
    with open(SRC, "rb") as fh:
        for feat in ijson.items(fh, "features.item"):
            geom = shape(feat["geometry"]).simplify(TOLERANCE, preserve_topology=True)
            if geom.is_empty:
                continue

            props = {}
            for k in KEEP_PROPS:
                val = feat["properties"].get(k)
                if hasattr(val, "as_tuple"):
                    val = float(val)
                props[k] = val
            item = {
                "type": "Feature",
                "properties": props,
                "geometry": mapping(geom),
            }

            minx, miny, maxx, maxy = geom.bounds
            for key in tile_keys_for_bounds(minx, miny, maxx, maxy):
                buckets[key].append(item)

            total += 1
            if total % 25000 == 0:
                print(f"processados: {total}")

    manifest = []
    for key, features in sorted(buckets.items()):
        path = os.path.join(OUT_DIR, f"{key}.geojson")
        collection = {"type": "FeatureCollection", "features": features}
        with open(path, "w", encoding="utf-8") as out:
            json.dump(collection, out, ensure_ascii=False)
        manifest.append(key)

    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as out:
        json.dump(sorted(manifest), out)

    sizes = [os.path.getsize(os.path.join(OUT_DIR, f"{k}.geojson")) for k in manifest]
    print(f"features: {total}")
    print(f"concluido: {len(manifest)} tiles")
    print(f"tamanho max MB: {max(sizes)/1024/1024:.2f}")


if __name__ == "__main__":
    main()
