#!/usr/bin/env python3
"""Fetch a tiny multi-vendor OrcaSlicer v2.5.0 fixture for CI only.

Keep official JSON confined to the runner; never commit or upload it.
"""
import hashlib
import json
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

COMMIT = "40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19"
ROOT = f"https://raw.githubusercontent.com/OrcaSlicer/OrcaSlicer/{COMMIT}/resources/profiles/"
SELECTIONS = {
    "Snapmaker": {
        "machine_model_list": "Snapmaker U1",
        "machine_list": "Snapmaker U1 (0.4 nozzle)",
        "filament_list": "Snapmaker PLA Basic @U1",
        "process_list": "0.20 Standard @Snapmaker U1 (0.4 nozzle)",
    },
    "Prusa": {
        "machine_model_list": "Prusa MK4S",
        "machine_list": "Prusa MK4S 0.4 nozzle",
        "filament_list": "Generic PLA @Prusa MK4S",
        "process_list": "0.20mm STRUCTURAL @MK4S 0.4",
    },
}


def fetch(relative):
    parts = relative.split("/")
    if (not parts or any(not part or part in (".", "..") for part in parts)
            or "\\" in relative or relative.startswith("/")):
        raise ValueError(f"unsafe upstream relative path: {relative!r}")
    url = ROOT + quote(relative, safe="/")
    with urlopen(Request(url, headers={"User-Agent": "layer-workbench-v250-multi-vendor-test"}),
                 timeout=35) as response:
        data = response.read(1_000_001)
    if len(data) > 1_000_000:
        raise ValueError("upstream source exceeds test fixture size limit")
    print(f"UPSTREAM {relative}: SHA256 {hashlib.sha256(data).hexdigest()}")
    return json.loads(data)


def main():
    vendors = []
    for name, selections in SELECTIONS.items():
        source = fetch(name + ".json")
        sections = {}
        files = {}
        for section, selected_name in selections.items():
            matches = [item for item in source.get(section, [])
                       if item.get("name") == selected_name]
            if len(matches) != 1:
                raise ValueError(f"{name} missing or ambiguous {section} {selected_name}")
            entry = matches[0]
            path = entry["sub_path"]
            if not isinstance(path, str) or not path.startswith(
                    {"machine_model_list": "machine/", "machine_list": "machine/",
                     "filament_list": "filament/", "process_list": "process/"}[section]):
                raise ValueError(f"{name} invalid profile path for {section}")
            if path in files:
                raise ValueError(f"{name} duplicate profile path: {path}")
            files[path] = fetch(f"{name}/{path}")
            sections[section] = [entry]
        vendors.append({
            "name": name,
            "index": {"name": source["name"], "version": source["version"], **sections},
            "files": files
        })
    result = {"upstream_commit": COMMIT, "vendors": vendors}
    output = Path("upstream-v250-multi-vendor-fixture.json")
    output.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    print(f"Prepared {len(vendors)} pinned vendor subsets: {output}")


if __name__ == "__main__":
    main()
