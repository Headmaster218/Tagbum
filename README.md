# Tagbum

Tagbum is a local-first photo album indexer. It keeps source files in place, builds a SQLite database, groups related resources, generates previews, and provides a small web UI for browsing and manual tagging.

## Current scope

- Import a local photo folder without moving or rewriting source files.
- Group related resources by folder and normalized filename stem.
- Keep `.AAE` files as sidecar resources, so edited iPhone photos stay with their media group.
- Generate thumbnails for common image formats, including HEIC/HEIF.
- Browse recent asset groups in a web UI.
- Add and remove manual tags.
- Filter the gallery by tag.

Map view, Apple automatic import, and YOLO/CLIP automatic tagging are planned follow-up modules.

## Environment

Create the conda environment:

```powershell
conda env create -f environment.yml
conda activate tagbum
```

If the environment already exists:

```powershell
conda env update -f environment.yml --prune
conda activate tagbum
```

## Import photos

The importer indexes files and writes local state under `data/`. Source files are not changed.

```powershell
python -m Tagbum import Z:\Backup\DCIM
```

For a quick smoke test:

```powershell
python -m Tagbum import Z:\Backup\DCIM --limit 100
```

Long imports are committed in batches and can be rerun safely:

```powershell
python -m Tagbum import Z:\Backup\DCIM --commit-every 250
```

## Run the web app

One-click local startup on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start_tagbum.ps1
```

The script opens `http://127.0.0.1:8000/` in your browser. Close the terminal window or press `Ctrl+C` to stop Tagbum.
If port `8000` is already in use, the script automatically tries the next free port.

To request a specific port:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start_tagbum.ps1 -Port 8010
```

Manual startup:

```powershell
python -m Tagbum web --host 127.0.0.1 --port 8000
```

During development, add `--reload` if you want the server to restart after source edits.

Open:

- `http://127.0.0.1:8000/` for the main gallery.
- `http://127.0.0.1:8000/tag` for manual tagging.
- `http://127.0.0.1:8000/filter` for tag filtering.

## Local state

These paths are intentionally ignored by git:

- `data/` for SQLite and generated thumbnails.
- `media/` and `imports/` for future managed assets or import manifests.
- `*.sqlite` and SQLite journal files.
