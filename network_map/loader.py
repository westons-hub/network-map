"""Load contacts from the Excel template and/or a LinkedIn Connections.csv export.

Both sources end up as a list of ``Person`` records. When the same name shows up
in both files, the Excel row wins for any field it fills in, because that is the
file you edit by hand.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

# Column names in contacts_template.xlsx (matched case-insensitively).
TEMPLATE_COLUMNS = [
    "Name",
    "Company",
    "School",
    "Role",
    "Connected Through",
    "LinkedIn URL",
    "Status",
    "Tags",
    "Notes",
]


@dataclass
class Person:
    name: str
    company: str = ""
    school: str = ""
    role: str = ""
    connected_through: str = ""  # blank = you know them directly
    linkedin_url: str = ""
    status: str = ""
    tags: list[str] = field(default_factory=list)
    notes: str = ""
    source: str = ""  # "excel", "linkedin" or "excel+linkedin"

    @property
    def key(self) -> str:
        return normalize_name(self.name)


def normalize_name(name: str) -> str:
    return " ".join(str(name).split()).casefold()


def _clean(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
        return ""
    return " ".join(str(value).split())


def _split_tags(value) -> list[str]:
    text = _clean(value)
    if not text:
        return []
    return [t.strip() for t in text.replace(";", ",").split(",") if t.strip()]


def _source_name(src) -> str:
    """File name for a path or an uploaded file object (e.g. from Streamlit)."""
    return Path(getattr(src, "name", str(src))).name


def _rewind(src) -> None:
    if hasattr(src, "seek"):
        src.seek(0)


def load_excel(path) -> list[Person]:
    """Read contacts from the Excel template (first sheet) or a CSV with the same columns.

    ``path`` can be a file path or an open file object with a ``.name``.
    """
    name = _source_name(path)
    _rewind(path)
    if name.lower().endswith(".csv"):
        df = pd.read_csv(path, dtype=str)
    else:
        df = pd.read_excel(path, dtype=str)
    columns = {c.strip().casefold(): c for c in df.columns}

    def col(row, name):
        real = columns.get(name.casefold())
        return _clean(row[real]) if real is not None else ""

    if "name" not in columns:
        raise ValueError(f"{name} needs a 'Name' column. Found: {list(df.columns)}")

    people = []
    for _, row in df.iterrows():
        name = col(row, "Name")
        if not name:
            continue
        people.append(
            Person(
                name=name,
                company=col(row, "Company"),
                school=col(row, "School"),
                role=col(row, "Role"),
                connected_through=col(row, "Connected Through"),
                linkedin_url=col(row, "LinkedIn URL"),
                status=col(row, "Status"),
                tags=_split_tags(col(row, "Tags")),
                notes=col(row, "Notes"),
                source="excel",
            )
        )
    return people


def load_targets(path) -> list[str]:
    """Read target companies from the workbook's "Targets" sheet ("Company" column).

    Returns [] for CSV files or workbooks without a Targets sheet.
    """
    if _source_name(path).lower().endswith(".csv"):
        return []
    _rewind(path)
    sheets = pd.read_excel(path, sheet_name=None, dtype=str)
    sheet = next((df for s, df in sheets.items() if s.strip().casefold() == "targets"), None)
    if sheet is None:
        return []
    columns = {c.strip().casefold(): c for c in sheet.columns}
    real = columns.get("company") or next(iter(sheet.columns), None)
    if real is None:
        return []
    return [t for t in (_clean(v) for v in sheet[real]) if t]


def parse_target_list(text: str) -> list[str]:
    """'Delta, Google; Bain' -> ['Delta', 'Google', 'Bain'] (also accepts newlines)."""
    return [t.strip() for t in str(text).replace(";", ",").replace("\n", ",").split(",") if t.strip()]


def load_linkedin_export(path) -> list[Person]:
    """Read LinkedIn's Connections.csv (Settings > Data privacy > Get a copy of your data).

    The export starts with a few "Notes:" lines before the real header, so we
    skip ahead to the line that begins with "First Name".
    """
    if hasattr(path, "read"):
        _rewind(path)
        raw = path.read()
        text = raw.decode("utf-8-sig") if isinstance(raw, bytes) else raw.lstrip("﻿")
    else:
        text = Path(path).read_text(encoding="utf-8-sig")
    lines = text.splitlines()
    start = next(
        (i for i, line in enumerate(lines) if line.lower().startswith("first name")), None
    )
    if start is None:
        raise ValueError(f"{_source_name(path)} doesn't look like a LinkedIn Connections export.")

    reader = csv.DictReader(io.StringIO("\n".join(lines[start:])))
    people = []
    for row in reader:
        first = _clean(row.get("First Name"))
        last = _clean(row.get("Last Name"))
        name = f"{first} {last}".strip()
        if not name:
            continue
        people.append(
            Person(
                name=name,
                company=_clean(row.get("Company")),
                role=_clean(row.get("Position")),
                linkedin_url=_clean(row.get("URL")),
                source="linkedin",
            )
        )
    return people


def merge_people(*sources: list[Person]) -> list[Person]:
    """Combine sources by name. Earlier sources fill gaps; later sources win on conflicts.

    Pass LinkedIn first and Excel second so your hand edits take priority.
    """
    merged: dict[str, Person] = {}
    for people in sources:
        for p in people:
            existing = merged.get(p.key)
            if existing is None:
                merged[p.key] = p
                continue
            for attr in ("company", "school", "role", "connected_through",
                         "linkedin_url", "status", "notes"):
                new = getattr(p, attr)
                if new:
                    setattr(existing, attr, new)
            existing.tags = sorted(set(existing.tags) | set(p.tags))
            if p.source not in existing.source:
                existing.source = f"{existing.source}+{p.source}"
    return list(merged.values())
