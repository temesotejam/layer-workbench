#!/usr/bin/env python3
"""Adapt the upstream OrcaWasm patcher to the v2.5.0 source layout.

This changes only the disposable OrcaWasm checkout used by CI. It does not
modify OrcaSlicer upstream or commit upstream source into this repository.
"""
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: adapt-orcawasm-v2.5.0.py <path-to-orcawasm/patches/apply.py>")

path = Path(sys.argv[1])
source = path.read_text(encoding="utf-8")

def replace_once(old: str, new: str, label: str) -> None:
    global source
    if old not in source:
        raise SystemExit(f"Expected upstream patcher anchor not found: {label}")
    source = source.replace(old, new, 1)

# v2.5.0 already initializes these fields to 0.f. Preserve the defensive
# non-zero defaults required by the headless profile-less WASM build.
replace_once(
    r"""r'float   min_bead_width;\n    float   min_feature_size;\n    float   min_length_factor;\n    float   wall_transition_length;\n    float   wall_transition_angle;\n    float   wall_transition_filter_deviation;\n    int     wall_distribution_count;\n    bool    is_top_or_bottom_layer;',""",
    r"""r'float\s+min_bead_width\s*=\s*0\.f;.*?bool\s+is_top_or_bottom_layer\s*=\s*false;',""",
    "WallToolPathsParams field pattern",
)

# Make the existing pthread replacement tolerant of the upstream whitespace.
replace_once(
    r"""r"   \tpthread_setname_np\(thread\.native_handle\(\), thread_name\);" """.rstrip(),
    r"""r"\s*pthread_setname_np\(thread\.native_handle\(\), thread_name\);" """.rstrip(),
    "Thread.cpp pthread regex",
)

# Update the full Thread.cpp patch anchor to match the current POSIX branch.
replace_once(
    r"""r'#else\n\n// posix\n""" + r"""bool set_thread_name\(std::thread &thread, const char \*thread_name\)\n\{\n\s*pthread_setname_np\(thread\.native_handle\(\), thread_name\);',""",
    r"""r'#else\s*// posix\s*bool set_thread_name\(std::thread &thread, const char \*thread_name\)\s*\{\s*pthread_setname_np\(thread\.native_handle\(\), thread_name\);',""",
    "Thread.cpp full patch regex",
)

# v2.5.0 adds an MSVC branch before the FLATPAK branch. Insert the Emscripten
# branch as an elseif so the MSVC behavior remains unchanged.
replace_once(
    r"""r'(?s)^if \(FLATPAK""",
    r"""r'(?s)^elseif \(FLATPAK""",
    "oneTBB patch regex",
)
replace_once(
    "'if (EMSCRIPTEN)\\n'",
    "'elseif (EMSCRIPTEN)\\n'",
    "oneTBB Emscripten branch",
)

path.write_text(source, encoding="utf-8")
print(f"Adapted OrcaWasm patcher for v2.5.0: {path}")
