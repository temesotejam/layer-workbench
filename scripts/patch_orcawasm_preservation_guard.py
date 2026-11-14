#!/usr/bin/env python3
"""Fail-closed preservation guard for imported native 3MF project replacement.

Patches only Hiosdra/OrcaWasm@60a09e04 bridge/slicer.cpp in disposable CI
checkouts. Strict preservation must never claim success after setObjects has
discarded an imported archive or after imported project state became dirty.
Does not implement native in-place editing or desktop 3MF parity.
"""
from pathlib import Path
import sys

REPLACEMENTS = (
    (
        "    bool native_project_dirty = false;\n    int progress_base = 0;",
        "    bool native_project_dirty = false;\n"
        "    // Sticky until reset_project: setObjects discarded an imported 3MF.\n"
        "    bool native_project_replaced = false;\n"
        "    int progress_base = 0;",
    ),
    (
        "    session.native_project_dirty = false;\n"
        "    session.project_cancel_requested.store(false, std::memory_order_release);",
        "    session.native_project_dirty = false;\n"
        "    session.native_project_replaced = false;\n"
        "    session.project_cancel_requested.store(false, std::memory_order_release);",
    ),
    (
        "        session->project_manifest = std::move(normalized);\n"
        "        session->native_project_blob.clear();\n"
        "        session->native_project_dirty = false;\n"
        "        ++session->project_preview_revision;",
        "        session->project_manifest = std::move(normalized);\n"
        "        // setObjects replaces, rather than modifies, native project state.\n"
        "        // Keep a sticky origin flag even after releasing source ZIP bytes.\n"
        "        session->native_project_replaced = session->native_project_replaced\n"
        "            || !session->native_project_blob.empty();\n"
        "        session->native_project_blob.clear();\n"
        "        session->native_project_dirty = false;\n"
        "        ++session->project_preview_revision;",
    ),
    (
        "    if (options.include_slice_artifacts && gcode_by_plate.empty()) {\n"
        '        record_error(*session, "includeSliceArtifacts requires a current slice result with G-code");',
        '    if (options.preservation == "require"\n'
        "        && (session->native_project_replaced\n"
        "            || (!session->native_project_blob.empty() && session->native_project_dirty))) {\n"
        '        record_error(*session, "preservation=require cannot retain imported 3MF metadata after project replacement or mutation");\n'
        "        return ONESLICER_ERR_UNSUPPORTED;\n"
        "    }\n"
        "    if (options.include_slice_artifacts && gcode_by_plate.empty()) {\n"
        '        record_error(*session, "includeSliceArtifacts requires a current slice result with G-code");',
    ),
    (
        "    nlohmann::json warnings = nlohmann::json::array();\n"
        "    nlohmann::json omitted_opaque_entries = nlohmann::json::array();",
        "    nlohmann::json warnings = nlohmann::json::array();\n"
        "    if (session->native_project_replaced) {\n"
        "        warnings.push_back({\n"
        '            {"code", "native-project-replaced"},\n'
        '            {"message", "setObjects replaced an imported native 3MF; source project metadata is not preserved"},\n'
        "        });\n"
        "    }\n"
        "    nlohmann::json omitted_opaque_entries = nlohmann::json::array();",
    ),
)


def apply_patch(source: str) -> str:
    for old, new in REPLACEMENTS:
        if source.count(old) != 1:
            raise ValueError("pinned preservation-guard anchor missing, duplicated or already patched")
        source = source.replace(old, new, 1)
    return source


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch_orcawasm_preservation_guard.py <orcawasm/bridge/slicer.cpp>")
    path = Path(sys.argv[1])
    path.write_text(apply_patch(path.read_text(encoding="utf-8")), encoding="utf-8")
    print("PASS: staged native imported-3MF preservation guard, not a WASM parity claim")


if __name__ == "__main__":
    main()
