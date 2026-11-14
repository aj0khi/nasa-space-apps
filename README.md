# TerraTwin

A starter web app for the NASA Space Apps Challenge idea of finding Earth
landscapes that can help prepare for future Moon and Mars missions.

This is a UI skeleton only. It does not yet include maps, NASA data, or
scientific rankings. The map and candidate areas are explicitly placeholders.

## Run locally

From the repository root, start a static server:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Project layout

- `index.html` — accessible single-page app shell
- `src/styles.css` — responsive visual styles
- `data/README.md` — notes for adding sourced datasets

## Next steps

1. Agree on a small set of geological and environmental comparison criteria.
2. Select public Earth, Moon, and Mars datasets and record their sources and
   limitations in `data/README.md`.
3. Replace the map placeholder with a real map and show the provenance of each
   displayed layer and candidate site.
