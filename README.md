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

The importer indexes files and writes local state under the active database profile. Source files are not changed.

```powershell
python -m Tagbum import Z:\Backup\DCIM
```

You can also configure one or more read-only album folders and import the active profile without passing a source each time:

```powershell
python -m Tagbum profile add default --database data\tagbum.sqlite --album Z:\Backup\DCIM --use
python -m Tagbum import
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

To start a named database profile:

```powershell
python -m Tagbum web --profile default --host 127.0.0.1 --port 8000
powershell -ExecutionPolicy Bypass -File .\scripts\start_tagbum.ps1 -Profile default
```

During development, add `--reload` if you want the server to restart after source edits.

Open:

- `http://127.0.0.1:8000/` for the main gallery.
- `http://127.0.0.1:8000/tag` for manual tagging.
- `http://127.0.0.1:8000/filter` for tag filtering.

## Profiles and paths

Tagbum reads local profiles from `tagbum.config.json` in the repository root. This file is ignored by git because it contains machine-specific paths. See `tagbum.config.example.json` for a template.

A profile has:

- `database`: the SQLite database path for tags, metadata, and grouping.
- `albums`: one or more read-only source folders.
- `thumbnail_dir`: optional generated thumbnail folder. If omitted, Tagbum uses a folder next to the database.

Useful commands:

```powershell
python -m Tagbum profile list
python -m Tagbum profile add family --database D:\TagbumDB\family.sqlite --album Z:\Backup\DCIM --use
python -m Tagbum profile add-album D:\Photos\Camera2 --profile family
python -m Tagbum profile use family
python -m Tagbum profile move-db family D:\TagbumDB\family-archive.sqlite
```

Switching profiles changes which database Tagbum opens; it does not delete or rewrite other databases. Moving a database updates the profile path and moves the SQLite file. Album folders remain read-only.

## Local state

These paths are intentionally ignored by git:

- `data/` for SQLite and generated thumbnails.
- `media/` and `imports/` for future managed assets or import manifests.
- `tagbum.config.json` for local profile paths.
- `*.sqlite` and SQLite journal files.
