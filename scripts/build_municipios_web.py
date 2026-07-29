import json
import os

import geopandas as gpd

BASE = os.path.join(os.path.dirname(__file__), "..", "geojason")
SRC = os.path.join(BASE, "Municipios_SC.geojson")
OUT = os.path.join(BASE, "_web", "Municipios_SC.geojson")

os.makedirs(os.path.dirname(OUT), exist_ok=True)

gdf = gpd.read_file(SRC)
gdf["geometry"] = gdf.geometry.simplify(0.0003, preserve_topology=True)
gdf.to_file(OUT, driver="GeoJSON")
print("ok", OUT, os.path.getsize(OUT))
