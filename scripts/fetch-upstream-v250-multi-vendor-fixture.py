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
            indexed = source.get(section, [])
            if not isinstance(indexed, list):
                raise ValueError(f"{name} invalid index section {section}")
            expected_type = {"machine_model_list": "machine_model",
                             "machine_list": "machine", "filament_list": "filament",
                             "process_list": "process"}[section]
            folder = "machine" if expected_type == "machine_model" else expected_type

            def fetch_chain(preset, ancestors=()):
                # Stay inside this vendor and the correct index section.
                # Never fabricate missing ancestors or flatten tool vectors.
                if not isinstance(preset, str) or not preset or len(preset) > 160:
                    raise ValueError(f"{name} invalid {section} ancestor name")
                if preset in ancestors:
                    raise ValueError(f"{name} profile inheritance cycle: {preset}")
                if len(ancestors) >= 16:
                    raise ValueError(f"{name} profile inheritance exceeds depth limit")
                matches = [item for item in indexed if isinstance(item, dict)
                           and item.get("name") == preset]
                if len(matches) != 1:
                    raise ValueError(f"{name} missing or ambiguous {section} ancestor: {preset}")
                entry = matches[0]
                path = entry.get("sub_path")
                if not isinstance(path, str) or not path.startswith(folder + "/"):
                    raise ValueError(f"{name} invalid {section} profile path")
                if path in files:
                    raise ValueError(f"{name} duplicate profile path: {path}")
                if len(files) >= 48:
                    raise ValueError(f"{name} profile fixture exceeds record limit")
                record = fetch(f"{name}/{path}")
                if not isinstance(record, dict) or record.get("name") != preset or record.get("type") != expected_type:
                    raise ValueError(f"{name} profile name/type mismatch: {path}")
                files[path] = record
                parent = record.get("inherits") if expected_type != "machine_model" else None
                if parent in (None, ""):
                    return [entry]
                if not isinstance(parent, str):
                    raise ValueError(f"{name} invalid inherited profile: {path}")
                return fetch_chain(parent, ancestors + (preset,)) + [entry]

            # Index the complete root-to-leaf chain for each selected preset.
            sections[section] = fetch_chain(selected_name)
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
