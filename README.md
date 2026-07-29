# VT GIS — WebGIS

Mapa web de Santa Catarina com basemaps, limites municipais e camadas do CAR (Cadastro Ambiental Rural).

**Acesso online:** [https://vt-gis.github.io/VT-GIS/](https://vt-gis.github.io/VT-GIS/)

## Camadas

| Camada | Descrição |
|--------|-----------|
| Municípios SC | Limites municipais (GeoJSON otimizado) |
| CAR SC | Imóveis rurais, carregados por tiles conforme zoom e área visível (zoom 12+) |

## Uso local

1. Execute `iniciar.bat`
2. Abra [http://localhost:8080/index.html](http://localhost:8080/index.html)

## Reconstruir dados web

```bash
python scripts/build_municipios_web.py
python scripts/build_car_tiles.py
```

Os arquivos originais em `geojason/` não são enviados ao GitHub (são muito grandes). O site usa apenas `geojason/_web/`.

## GitHub Pages

Publicação automática a partir da branch `main` (pasta raiz do repositório).
