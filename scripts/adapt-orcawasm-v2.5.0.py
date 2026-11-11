#!/usr/bin/env python3
"""Adapt the upstream OrcaWasm patcher to the v2.5.0 source layout.

This changes only the disposable OrcaWasm checkout used by CI. It does not
modify OrcaSlicer upstream or commit upstream source into this repository.
"""
from pathlib import Path
import sys

if len(sys.argv) != 4:
    raise SystemExit("usage: adapt-orcawasm-v2.5.0.py <path-to-orcawasm/patches/apply.py> <path-to-orca/CMakeLists.txt> <path-to-build-local-wsl.sh>")

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
    r"""   \tpthread_setname_np\(thread\.native_handle\(\), thread_name\);""",
    r"""\s*pthread_setname_np\(thread\.native_handle\(\), thread_name\);""",
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

# The v2.5.0 desktop GUI embeds CPython through pybind11. The headless
# SLIC3R_GUI=OFF WebAssembly target does not compile that GUI/plugin layer, so
# skip the desktop-only Python embed dependency in the upstream root CMake file.
orca_cmake = Path(sys.argv[2])
orca_source = orca_cmake.read_text(encoding="utf-8")
python_begin = "# Use bundled Python from deps instead of system Python\n"
python_end = "add_library(pybind11::embed ALIAS pybind11_embed)\n"
if python_begin not in orca_source or python_end not in orca_source:
    raise SystemExit("Expected v2.5.0 embedded-Python CMake block not found in OrcaSlicer root CMakeLists.txt")
orca_source = orca_source.replace(python_begin, "if(NOT SLIC3R_WASM)\n" + python_begin, 1)
orca_source = orca_source.replace(python_end, python_end + "endif()\n", 1)
orca_cmake.write_text(orca_source, encoding="utf-8")

# The browser engine build does not include the desktop Parametric Design tab.
# v2.5.0 defaults SLIC3R_CAD=ON and therefore requires the native SolveSpace
# (SLVS) package, which the current WASM dependency set does not build. Keep
# the CAD feature explicitly disabled in this headless engine candidate.
build_script = Path(sys.argv[3])
build_source = build_script.read_text(encoding="utf-8")
cmake_flag = "  -DSLIC3R_WASM=ON \\\\n"
if cmake_flag not in build_source:
    raise SystemExit("Could not find SLIC3R_WASM CMake flag in OrcaWasm build script")
build_source = build_source.replace(
    cmake_flag,
    cmake_flag + "  -DSLIC3R_CAD=OFF \\\\n",
    1,
)
build_script.write_text(build_source, encoding="utf-8")

path.write_text(source, encoding="utf-8")
print(f"Adapted OrcaWasm patcher for v2.5.0: {path}")
