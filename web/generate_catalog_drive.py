from __future__ import annotations

import json
import re
from datetime import datetime
from html import unescape
from pathlib import Path
from urllib.parse import quote

import requests

ROOT_FOLDER_ID = "10i0L3CYd_kz6cCsyoIoAEbDHutjNhdje"
ROOT_FOLDER_URL = f"https://drive.google.com/embeddedfolderview?id={ROOT_FOLDER_ID}#list"
OUTPUT = Path(__file__).resolve().parent / "catalogo.json"
LOCAL_ROOT = Path(__file__).resolve().parent.parent
LOCAL_FAVORITES = LOCAL_ROOT / "Favoritos" / "favoritos.json"
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


def natural_key(text: str):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", text)]


def parse_folder_date(folder_name: str):
    try:
        return datetime.strptime(folder_name, "%y%m%d").date()
    except ValueError:
        return None


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip()).lower()


def parse_image_metadata(filename: str):
    stem = Path(filename).stem
    suffix = Path(filename).suffix.lower()

    if suffix not in IMAGE_EXTENSIONS:
        return None

    parts = stem.split(" - ")
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


def load_local_favorites():
    if not LOCAL_FAVORITES.exists():
        return set()

    try:
        data = json.loads(LOCAL_FAVORITES.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()

    return {
        rel_path.replace("\\", "/")
        for rel_path in data.get("favorites", [])
        if isinstance(rel_path, str)
    }


def fetch_text(url: str) -> str:
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    return response.text


def parse_embedded_entries(html: str):
    pattern = re.compile(
        r'<div class="flip-entry" id="entry-(?P<id>[^"]+)".*?'
        r'<a href="(?P<href>[^"]+)".*?'
        r'(?:<img src="(?P<img>[^"]+)" alt="[^"]*"/></div></div></div>)?.*?'
        r'<div class="flip-entry-title">(?P<title>.*?)</div>',
        re.DOTALL,
    )

    entries = []
    for match in pattern.finditer(html):
        entries.append(
            {
                "id": match.group("id"),
                "href": unescape(match.group("href")),
                "img": unescape(match.group("img") or ""),
                "title": unescape(match.group("title")),
            }
        )
    return entries


def build_drive_image_urls(file_id: str):
    return {
        "url": f"https://lh3.googleusercontent.com/d/{file_id}=w1400",
        "thumbnail_url": f"https://lh3.googleusercontent.com/d/{file_id}=w700",
        "viewer_url": f"https://drive.google.com/file/d/{file_id}/view?usp=drive_web",
    }


def build_catalog():
    root_entries = parse_embedded_entries(fetch_text(ROOT_FOLDER_URL))
    local_favorites = load_local_favorites()
    palettes = set()
    dithers = set()
    output_entries = []
    dates = []

    date_folders = []
    for item in root_entries:
        folder_name = item["title"].strip()
        folder_date = parse_folder_date(folder_name)
        if folder_date is None:
            continue
        date_folders.append((folder_date, folder_name, item["id"]))

    date_folders.sort(key=lambda item: item[0], reverse=True)

    for index, (folder_date, folder_name, folder_id) in enumerate(date_folders, start=1):
        dates.append(folder_date.isoformat())
        folder_url = f"https://drive.google.com/embeddedfolderview?id={quote(folder_id)}#list"
        folder_entries = parse_embedded_entries(fetch_text(folder_url))

        image_entries = []
        for file_item in folder_entries:
            filename = file_item["title"].strip()
            metadata = parse_image_metadata(filename)
            if metadata is None:
                continue

            relative_path = f"{folder_name}/{filename}"
            palettes.add(metadata["palette"])
            dithers.add(metadata["dither"])

            image_entries.append(
                {
                    "path": relative_path,
                    "drive_file_id": file_item["id"],
                    "filename": filename,
                    "folder_name": folder_name,
                    "date_iso": folder_date.isoformat(),
                    "date_br": folder_date.strftime("%d/%m/%Y"),
                    "is_favorite_seed": relative_path in local_favorites,
                    **build_drive_image_urls(file_item["id"]),
                    **metadata,
                }
            )

        image_entries.sort(
            key=lambda item: (
                item["date_iso"],
                natural_key(item["id"]),
                natural_key(item["filename"]),
            ),
            reverse=True,
        )
        output_entries.extend(image_entries)

        print(f"Processed {index}/{len(date_folders)} folders: {folder_name} ({len(image_entries)} images)")

    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "source": "google-drive-embeddedfolderview",
        "root_folder_id": ROOT_FOLDER_ID,
        "root_folder_url": ROOT_FOLDER_URL,
        "dates": dates,
        "palettes": sorted(palettes, key=str.lower),
        "dithers": sorted(dithers, key=str.lower),
        "favorites_seed": sorted(local_favorites, key=natural_key),
        "entries": output_entries,
    }


def main():
    catalog = build_catalog()
    OUTPUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Catalog generated at {OUTPUT}")
    print(f"Entries: {len(catalog['entries'])}")


if __name__ == "__main__":
    main()
