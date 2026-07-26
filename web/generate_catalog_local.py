from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
ROOT = Path(__file__).resolve().parent.parent
OUTPUT = Path(__file__).resolve().parent / "catalogo.json"
FAVORITES_MANIFEST = ROOT / "Favoritos" / "favoritos.json"


def natural_key(text: str):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", text)]


def parse_folder_date(folder_name: str):
    try:
        return datetime.strptime(folder_name, "%y%m%d").date()
    except ValueError:
        return None


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip()).lower()


def parse_image_metadata(path: Path):
    if path.suffix.lower() not in IMAGE_EXTENSIONS:
        return None

    parts = path.stem.split(" - ")
    if len(parts) < 4:
        return None

    identifier = parts[0].strip()
    title = " - ".join(part.strip() for part in parts[1:-2])
    palette = parts[-2].strip()
    dither = parts[-1].strip()

    return {
        "id": identifier,
        "title": title,
        "palette": palette,
        "dither": dither,
        "palette_norm": normalize_text(palette),
        "dither_norm": normalize_text(dither),
    }


def load_favorites_manifest():
    if not FAVORITES_MANIFEST.exists():
        return set()

    try:
        data = json.loads(FAVORITES_MANIFEST.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()

    return {
        rel_path.replace("\\", "/")
        for rel_path in data.get("favorites", [])
        if isinstance(rel_path, str)
    }


def build_catalog():
    favorites = load_favorites_manifest()
    dates = []
    entries = []
    palettes = set()
    dithers = set()

    candidate_folders = sorted(
        (item for item in os.scandir(ROOT) if item.is_dir()),
        key=lambda item: natural_key(item.name),
    )

    for index, folder in enumerate(candidate_folders, start=1):
        folder_date = parse_folder_date(folder.name)
        if folder_date is None:
            continue

        dates.append(folder_date.isoformat())

        image_paths = []
        for root_dir, _, file_names in os.walk(folder.path):
            for file_name in file_names:
                if Path(file_name).suffix.lower() not in IMAGE_EXTENSIONS:
                    continue
                image_paths.append(Path(root_dir) / file_name)

        image_paths.sort(
            key=lambda path: natural_key(str(path.relative_to(ROOT)).replace("\\", "/"))
        )

        for image_path in image_paths:
            metadata = parse_image_metadata(image_path)
            if metadata is None:
                continue

            relative_path = image_path.relative_to(ROOT).as_posix()
            url = "../" + relative_path

            palettes.add(metadata["palette"])
            dithers.add(metadata["dither"])

            entries.append(
                {
                    "path": relative_path,
                    "url": url,
                    "filename": image_path.name,
                    "folder_name": folder.name,
                    "date_iso": folder_date.isoformat(),
                    "date_br": folder_date.strftime("%d/%m/%Y"),
                    "is_favorite_seed": relative_path in favorites,
                    **metadata,
                }
            )

        if index % 10 == 0:
            print(f"Processed {index} folders...")

    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "root_folder_name": ROOT.name,
        "dates": sorted(dates),
        "palettes": sorted(palettes, key=str.lower),
        "dithers": sorted(dithers, key=str.lower),
        "favorites_seed": sorted(favorites, key=natural_key),
        "entries": entries,
    }


def main():
    catalog = build_catalog()
    OUTPUT.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Catalog generated at {OUTPUT}")
    print(f"Entries: {len(catalog['entries'])}")


if __name__ == "__main__":
    main()
