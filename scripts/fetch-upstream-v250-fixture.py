#!/usr/bin/env python3
"""Fetch a narrow real OrcaSlicer v2.5.0 profile fixture only inside CI.

No upstream copyrighted profile JSON is committed or published. This fetches
four exact files at the immutable upstream commit (index + three parents).
"""
import hashlib
import json
import pathlib
import urllib.request

COMMIT = "40ecc66f78ed72dc368e0c1ebe40d77f00cc8a19"
ROOT = f"https://raw.githubusercontent.com/OrcaSlicer/OrcaSlicer/{COMMIT}/resources/profiles/"
FILAMENTS = ["fdm_filament_common", "fdm_filament_pla", "Generic PLA @System"]


def fetch(relative):
    if ".." in relative or relative.startswith("/"):
        raise ValueError("unsafe relative path")
    url = ROOT + urllib.parse.quote(relative, safe="/")
    request = urllib.request.Request(url, headers={"User-Agent": "layer-workbench-pinned-fixture-check"})
    with urllib.request.urlopen(request, timeout=35) as response:
        data = response.read(1_000_001)
    if len(data) > 1_000_000:
        raise ValueError("upstream file unexpectedly large")
    print(f"UPSTREAM {relative}: {len(data)} bytes SHA256 {hashlib.sha256(data).hexdigest()}")
    return json.loads(data)


def main():
    import urllib.parse  # used by fetch after import
    index = fetch("OrcaFilamentLibrary.json")
    entries = [entry for entry in index["filament_list"] if entry["name"] in FILAMENTS]
    if len(entries) != 3:
        raise ValueError("Pinned upstream filament index missing expected chain")
    files = {}
    for item in entries:
        relative = item["sub_path"]
        files[relative] = fetch("OrcaFilamentLibrary/" + relative)
    subset = {
        "vendor_index": {
            "name": index["name"], "version": index["version"],
            "machine_model_list": [], "machine_list": [], "process_list": [],
            "filament_list": entries,
        },
        "files": files,
        "upstream_commit": COMMIT,
    }
    path = pathlib.Path("upstream-v250-filament-fixture.json")
    path.write_text(json.dumps(subset, ensure_ascii=False), encoding="utf-8")
    print("Prepared pinned actual OrcaSlicer filament fixture:", path)


if __name__ == "__main__":
    main()
