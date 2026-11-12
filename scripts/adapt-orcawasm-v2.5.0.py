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

# The pinned OrcaWasm v2.4.2 patcher injects a TextShape override
# unconditionally. The v2.5.0 source tree no longer contains Shape/TextShape
# or its header, so that obsolete override cannot compile. Fail closed if a
# future source revision reintroduces the files; that needs a real API audit.
text_shape_dir = Path(sys.argv[2]).parent / "src" / "libslic3r" / "Shape"
if (text_shape_dir / "TextShape.cpp").exists() or (text_shape_dir / "TextShape.hpp").exists():
    raise SystemExit("Unexpected v2.5.0 TextShape source: review WASM override API")
replace_once(
    '    "${CMAKE_CURRENT_SOURCE_DIR}/Shape/TextShape.cpp"\n',
    "",
    "obsolete v2.4.2 TextShape original",
)
replace_once(
    '    "${ORCA_WEB_OVERRIDES_DIR}/src/libslic3r/Shape/TextShape.cpp"\n',
    "",
    "obsolete v2.4.2 TextShape WASM stub",
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

# OrcaSlicer v2.5.0 stages native FFmpeg .so libraries for the Linux desktop
# executable. A headless Emscripten target has no ELF shared objects to copy.
# Skip only this desktop staging target when SLIC3R_WASM=ON; do not claim
# support for media features that have not been ported to the browser.
orca_src_cmake = orca_cmake.parent / "src" / "CMakeLists.txt"
src_source = orca_src_cmake.read_text(encoding="utf-8")
native_sos_anchor = '    if (NOT APPLE)\n        set(output_sos_Release "")\n'
if src_source.count(native_sos_anchor) != 1:
    raise SystemExit("Expected v2.5.0 native FFmpeg .so copy anchor not found in src/CMakeLists.txt")
src_source = src_source.replace(
    native_sos_anchor,
    '    if (NOT APPLE AND NOT SLIC3R_WASM)\n        set(output_sos_Release "")\n',
    1,
)
orca_src_cmake.write_text(src_source, encoding="utf-8")

# The pinned OrcaWasm OpenCV finder is a stub, not an image-processing
# library. v2.5.0 added texture conversion implementations which include real
# opencv2 headers; these fail to compile in Emscripten. Keep all model import
# and texture metadata structures, but exclude only the two OpenCV-dependent
# .cpp translation units from this headless WASM build. The native desktop
# build remains unchanged. Texture-to-color conversion must be marked
# unsupported until a real OpenCV WASM port and functional tests are added.
libslic3r_cmake = orca_cmake.parent / "src" / "libslic3r" / "CMakeLists.txt"
libslic3r_source = libslic3r_cmake.read_text(encoding="utf-8")
texture_sources = (
    "    TexturePainting.cpp\n",
    "    TextureToColor/TextureToColor.cpp\n",
)
for texture_source in texture_sources:
    if libslic3r_source.count(texture_source) != 1:
        raise SystemExit(f"Expected v2.5.0 texture source missing or duplicated: {texture_source}")
source_list_anchor = "add_library(libslic3r STATIC ${lisbslic3r_sources}\n"
if libslic3r_source.count(source_list_anchor) != 1:
    raise SystemExit("Expected v2.5.0 libslic3r library anchor missing")
wasm_texture_guard = """# WASM limitation: OpenCV-dependent texture-to-color conversion is not ported.
if(SLIC3R_WASM)
    list(REMOVE_ITEM lisbslic3r_sources
        TexturePainting.cpp
        TextureToColor/TextureToColor.cpp
    )
endif()

"""
libslic3r_source = libslic3r_source.replace(
    source_list_anchor, wasm_texture_guard + source_list_anchor, 1
)
libslic3r_cmake.write_text(libslic3r_source, encoding="utf-8")


# OrcaSlicer v2.5.0 compares a size_t inset count against a 64-bit coord_t
# limit. On wasm32 the comparison is always true, and the fallback narrows
# INT64_MAX to 32 bits; both diagnostics are fatal under -Werror. Saturate
# in size_t's own range instead, with no overflow in the doubling operation.
# The edit is restricted to CI's disposable upstream source checkout.
wall_paths = orca_cmake.parent / "src" / "libslic3r" / "Arachne" / "WallToolPaths.cpp"
wall_source = wall_paths.read_text(encoding="utf-8")
old_bead_count = "    const size_t max_bead_count = (inset_count < std::numeric_limits<coord_t>::max() / 2) ? 2 * inset_count : std::numeric_limits<coord_t>::max();"
new_bead_count = (
    "    const size_t max_bead_count = (inset_count > std::numeric_limits<size_t>::max() / 2)\n"
    "        ? std::numeric_limits<size_t>::max()\n"
    "        : 2 * inset_count;"
)
if wall_source.count(old_bead_count) != 1:
    raise SystemExit("Expected v2.5.0 Arachne bead-count overflow guard anchor not found")
wall_paths.write_text(wall_source.replace(old_bead_count, new_bead_count, 1), encoding="utf-8")

# The v2.5.0 CGAL Voronoi validation translation unit uses a fast interval
# filter plus an exact fallback on desktop. WebAssembly has no adjustable
# floating-point rounding mode, so interval filters cannot provide their
# required enclosing bounds. Do not force Boost/C99 fenv macros or silently
# accept an inexact predicate. Use the already-existing CGAL::MP_Float exact
# predicate for the WASM planar-angle checker (slower, exact +,-,* arithmetic).
# The CGAL surface-sweep intersection checker is used only by ARACHNE_DEBUG;
# keep it on desktop and fail closed if a debug WASM build requests it.
voronoi_cgal = orca_cmake.parent / "src" / "libslic3r" / "Geometry" / "VoronoiUtilsCgal.cpp"
voronoi_source = voronoi_cgal.read_text(encoding="utf-8")

def replace_voronoi_once(old: str, new: str, label: str) -> None:
    global voronoi_source
    if voronoi_source.count(old) != 1:
        raise SystemExit(f"Expected v2.5.0 Voronoi anchor missing or duplicated: {label}")
    voronoi_source = voronoi_source.replace(old, new, 1)

replace_voronoi_once(
    """#include <CGAL/Interval_nt.h>
#include <CGAL/Cartesian_converter.h>
#include <CGAL/Filtered_kernel.h>
#include <CGAL/Kernel/Type_equality_wrapper.h>
#include <CGAL/Filtered_predicate.h>
#include <CGAL/enum.h>
#include <CGAL/Kernel/global_functions_2.h>
#include <boost/next_prior.hpp>
#include <CGAL/Exact_predicates_exact_constructions_kernel.h>
#include <CGAL/Arr_segment_traits_2.h>
#include <CGAL/Surface_sweep_2_algorithms.h>
""",
    """#include <CGAL/MP_Float.h>
#include <CGAL/Cartesian_converter.h>
#include <CGAL/enum.h>
#include <CGAL/Kernel/global_functions_2.h>
#include <boost/next_prior.hpp>
#if !defined(SLIC3R_WASM)
#include <CGAL/Interval_nt.h>
#include <CGAL/Filtered_kernel.h>
#include <CGAL/Kernel/Type_equality_wrapper.h>
#include <CGAL/Filtered_predicate.h>
#include <CGAL/Exact_predicates_exact_constructions_kernel.h>
#include <CGAL/Arr_segment_traits_2.h>
#include <CGAL/Surface_sweep_2_algorithms.h>
#endif
#if defined(SLIC3R_WASM) && defined(ARACHNE_DEBUG)
#error "WASM ARACHNE_DEBUG requires a port of the CGAL surface-sweep intersection checker"
#endif
""",
    "interval-filter and surface-sweep headers",
)
replace_voronoi_once(
    """    using K   = CGAL::Simple_cartesian<double>;
    using FK  = CGAL::Simple_cartesian<CGAL::Interval_nt_advanced>;
    using EK  = CGAL::Simple_cartesian<CGAL::MP_Float>;
    using C2E = CGAL::Cartesian_converter<K, EK>;
    using C2F = CGAL::Cartesian_converter<K, FK>;
    class Epick : public CGAL::Filtered_kernel_adaptor<CGAL::Type_equality_wrapper<K::Base<Epick>::Type, Epick>, true> {};
""",
    """    using K   = CGAL::Simple_cartesian<double>;
    using EK  = CGAL::Simple_cartesian<CGAL::MP_Float>;
    using C2E = CGAL::Cartesian_converter<K, EK>;
#if !defined(SLIC3R_WASM)
    using FK  = CGAL::Simple_cartesian<CGAL::Interval_nt_advanced>;
    using C2F = CGAL::Cartesian_converter<K, FK>;
    class Epick : public CGAL::Filtered_kernel_adaptor<CGAL::Type_equality_wrapper<K::Base<Epick>::Type, Epick>, true> {};
#endif
""",
    "filtered kernel declarations",
)
replace_voronoi_once(
    """    using ParabolicTangentToSegmentOrientationPredicateFiltered = CGAL::Filtered_predicate<ParabolicTangentToSegmentOrientationPredicate<EK>, ParabolicTangentToSegmentOrientationPredicate<FK>, C2E, C2F>;
    using ParabolicTangentToParabolicTangentOrientationPredicateFiltered = CGAL::Filtered_predicate<ParabolicTangentToParabolicTangentOrientationPredicate<EK>, ParabolicTangentToParabolicTangentOrientationPredicate<FK>, C2E, C2F>;
""",
    """#if defined(SLIC3R_WASM)
    // MP_Float preserves exact conversion from double and exact +,-,*.
    // The parabolic tangent orientation computations do not divide/sqrt.
    template<class ExactPredicate> struct ExactWasmPredicate {
        static EK::Point_2 convert(const K::Point_2 &p) { return C2E{}(p); }
        static CGAL::Orientation convert(CGAL::Orientation o) { return o; }

        template<class... Args>
        CGAL::Orientation operator()(const Args &... args) const {
            return ExactPredicate{}(convert(args)...);
        }
    };
    using ParabolicTangentToSegmentOrientationPredicateFiltered = ExactWasmPredicate<ParabolicTangentToSegmentOrientationPredicate<EK>>;
    using ParabolicTangentToParabolicTangentOrientationPredicateFiltered = ExactWasmPredicate<ParabolicTangentToParabolicTangentOrientationPredicate<EK>>;
#else
    using ParabolicTangentToSegmentOrientationPredicateFiltered = CGAL::Filtered_predicate<ParabolicTangentToSegmentOrientationPredicate<EK>, ParabolicTangentToSegmentOrientationPredicate<FK>, C2E, C2F>;
    using ParabolicTangentToParabolicTangentOrientationPredicateFiltered = CGAL::Filtered_predicate<ParabolicTangentToParabolicTangentOrientationPredicate<EK>, ParabolicTangentToParabolicTangentOrientationPredicate<FK>, C2E, C2F>;
#endif
""",
    "exact-only parabolic orientation predicates",
)
replace_voronoi_once(
    "bool VoronoiUtilsCgal::is_voronoi_diagram_planar_intersection(const VD &voronoi_diagram)\n",
    "#if !defined(SLIC3R_WASM)\nbool VoronoiUtilsCgal::is_voronoi_diagram_planar_intersection(const VD &voronoi_diagram)\n",
    "desktop-only surface-sweep checker start",
)
replace_voronoi_once(
    "    return intersections_pt.empty();\n}\n\nstruct ParabolicSegment\n",
    "    return intersections_pt.empty();\n}\n#endif\n\nstruct ParabolicSegment\n",
    "desktop-only surface-sweep checker end",
)
voronoi_cgal.write_text(voronoi_source, encoding="utf-8")

# The browser engine build does not include the desktop Parametric Design tab.
# v2.5.0 defaults SLIC3R_CAD=ON and therefore requires the native SolveSpace
# (SLVS) package, which the current WASM dependency set does not build. Keep
# the CAD feature explicitly disabled in this headless engine candidate.
build_script = Path(sys.argv[3])
build_source = build_script.read_text(encoding="utf-8")
cmake_flag = "  -DSLIC3R_WASM=ON " + "\\" + "\n"
if cmake_flag not in build_source:
    raise SystemExit("Could not find SLIC3R_WASM CMake flag in OrcaWasm build script")
build_source = build_source.replace(
    cmake_flag,
    cmake_flag + "  -DSLIC3R_CAD=OFF " + "\\" + "\n",
    1,
)
# OrcaSlicer v2.5.0 requires CGAL >= 6.2, while the pinned OrcaWasm
# dependency recipe still installs 5.6.2. Align with upstream's tested 6.2.1.
# This is a real dependency upgrade, not a bypass of the CMake version check.
old_cgal_version = "CGAL_VERSION=5.6.2\n"
if old_cgal_version not in build_source:
    raise SystemExit("Expected pinned CGAL 5.6.2 version not found in OrcaWasm recipe")
build_source = build_source.replace(
    old_cgal_version, "CGAL_VERSION=6.2.1\n", 1
)
# Invalidate the math dependency stamp so restored caches never silently use
# the old 5.6.2 headers or CGALConfig.cmake.
old_math_stamp = '.math_built_mt_native_eh_v1'
if old_math_stamp not in build_source:
    raise SystemExit("Expected math dependency stamp not found in OrcaWasm recipe")
build_source = build_source.replace(
    old_math_stamp, '.math_built_mt_native_eh_v2_cgal_6_2_1', 1
)

# OrcaWasm's older single-threaded Boost.Log workaround is incompatible with
# v2.5.0: utils.cpp now uses asynchronous sinks and current_thread_id. These
# require a threaded Boost.Log build. Restore the upstream logging code rather
# than suppressing errors or making a pthread engine use unlocked sinks.
utils_patch_begin = "# 7. utils.cpp — Boost.Log ABI compatibility\n"
utils_patch_end = "\n# =============================================================================\n# 8. Arachne/SkeletalTrapezoidation.cpp"
if source.count(utils_patch_begin) != 1 or source.count(utils_patch_end) != 1:
    raise SystemExit("Expected pinned OrcaWasm Boost.Log patch section missing")
utils_begin = source.index(utils_patch_begin)
utils_end = source.index(utils_patch_end, utils_begin)
source = (
    source[:utils_begin]
    + "# 7. utils.cpp — retain original thread-safe Boost.Log sinks\n"
    + source[utils_end:]
)

# Cache restores may contain the old single-thread Boost.Log. Force a rebuilt
# pthread-capable static Boost install by updating its completion stamp.
old_boost_define = """  # Always on — see the step comment above for why this must match
  # libslic3r's own (unconditional, upstream) compile flags.
  "define=BOOST_LOG_NO_THREADS=1"
"""
if build_source.count(old_boost_define) != 1:
    raise SystemExit("Expected old Boost.Log b2 flags missing or duplicated")
build_source = build_source.replace(old_boost_define, "", 1)
old_boost_stamp = 'STAMP="${INSTALL}/.boost_built_mt_native_eh_v3"'
if build_source.count(old_boost_stamp) != 1:
    raise SystemExit("Expected old Boost.Log dependency stamp missing or duplicated")
build_source = build_source.replace(
    old_boost_stamp, 'STAMP="${INSTALL}/.boost_built_mt_native_eh_v4"', 1
)
old_boost_comment = """# _v3 suffix: manually bumped, not tied to BOOST_VERSION — the
# BOOST_LOG_NO_THREADS fix above changed Boost's build *flags*,
# not its pinned version, so BOOST_VERSION alone wouldn't
# invalidate a stale cached build. Restore-keys below prefix-match
# regardless of this suffix (see "Restore dep cache"'s own
# comment on why a version bump alone isn't sufficient), so
# without this the job could restore its OLD, wrongly-built
# libboost_log.a from cache and skip rebuilding it entirely.
"""
new_boost_comment = """# _v4 stamp: require a pthread-enabled Boost.Log build after restoring
# caches containing the former BOOST_LOG_NO_THREADS single-thread ABI.
"""
if build_source.count(old_boost_comment) != 1:
    raise SystemExit("Expected old Boost.Log cache explanation not found")
build_source = build_source.replace(old_boost_comment, new_boost_comment, 1)
build_script.write_text(build_source, encoding="utf-8")

# Remove the pinned port's global single-thread Boost.Log definition. All
# consumers must use the same pthread-enabled Boost.Log ABI as the new b2 build.
wasm_find_paths = build_script.parent.parent / "cmake" / "wasm_find_paths.cmake"
find_source = wasm_find_paths.read_text(encoding="utf-8")
old_find_define = """    # OrcaSlicer's Boost.Log ABI uses BOOST_LOG_NO_THREADS=1 even in the
    # pthread-enabled engine. The define selects its v2s_st symbols; without
    # it, consumers reference v2s_mt_posix and wasm-ld reports undefined
    # boost::log symbols at link time.
    BOOST_LOG_NO_THREADS=1
"""
if find_source.count(old_find_define) != 1:
    raise SystemExit("Expected old Boost.Log global CMake definition missing")
wasm_find_paths.write_text(
    find_source.replace(old_find_define, "", 1), encoding="utf-8"
)

# OrcaSlicer v2.5.0 changed Print::validate's optional warnings output from
# StringObjectException* to std::vector<StringObjectException>*. The bridge
# only uses its returned validation error, so preserve validation semantics
# and use the API default (null warning collector). Do not discard errors.
bridge = build_script.parent.parent / "bridge" / "slicer.cpp"
bridge_source = bridge.read_text(encoding="utf-8")
old_validation = (
    "        Slic3r::StringObjectException warning;\n"
    "        Slic3r::StringObjectException validation_error = print.validate(&warning);"
)
new_validation = (
    "        Slic3r::StringObjectException validation_error = print.validate();"
)
if bridge_source.count(old_validation) != 1:
    raise SystemExit("Expected pinned OrcaWasm Print::validate bridge anchor missing or duplicated")
bridge.write_text(
    bridge_source.replace(old_validation, new_validation, 1), encoding="utf-8"
)

path.write_text(source, encoding="utf-8")
print(f"Adapted OrcaWasm patcher for v2.5.0: {path}")
