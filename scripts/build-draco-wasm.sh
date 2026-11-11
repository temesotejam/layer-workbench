#!/usr/bin/env bash
# Compile the exact Draco dependency pinned by OrcaSlicer v2.5.0 for wasm32.
# Only the disposable CI working directory is modified; upstream sources and
# license/notice files remain unchanged.
set -euo pipefail

EMSDK="${EMSDK:-/opt/emsdk}"
source "${EMSDK}/emsdk_env.sh"

WORKSPACE="${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
INSTALL="${WORKSPACE}/orcawasm/deps-install"
VERSION="1.5.7"
STAMP="${INSTALL}/.draco_${VERSION}_wasm_mt_eh_v1"

if [[ -f "${STAMP}" &&
      -f "${INSTALL}/lib/libdraco.a" &&
      -f "${INSTALL}/share/cmake/draco/draco-config.cmake" &&
      -f "${INSTALL}/include/draco/draco_features.h" ]]; then
  echo "[draco] ${VERSION} WASM library and package already installed"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
ARCHIVE="${TMP}/draco-${VERSION}.zip"

# Exact version and SHA-256 in OrcaSlicer v2.5.0 deps/Draco/Draco.cmake.
curl --fail --location --retry 3 --silent --show-error \
  "https://github.com/google/draco/archive/refs/tags/${VERSION}.zip" \
  --output "${ARCHIVE}"
printf '%s  %s\n' \
  '27b72ba2d5ff3d0a9814ad40d4cb88f8dc89a35491c0866d952473f8f9416b77' \
  "${ARCHIVE}" | sha256sum -c -

unzip -q "${ARCHIVE}" -d "${TMP}"
SOURCE="${TMP}/draco-${VERSION}"
test -f "${SOURCE}/CMakeLists.txt"
mkdir -p "${INSTALL}"

# Build the C++ static archive and installed CMake package; JS glue is not
# needed because the host slicer links draco::draco directly.
# Keep ABI-compatible flags with the Emscripten pthread/wasm-EH engine.
emcmake cmake -S "${SOURCE}" -B "${TMP}/build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="${INSTALL}" \
  -DCMAKE_INSTALL_LIBDIR=lib \
  -DBUILD_SHARED_LIBS=OFF \
  -DDRACO_INSTALL=ON \
  -DDRACO_TESTS=OFF \
  -DDRACO_JS_GLUE=OFF \
  -DDRACO_WASM=ON \
  -DDRACO_TRANSCODER_SUPPORTED=OFF \
  -DPYTHON_EXECUTABLE="$(command -v python3)" \
  "-DCMAKE_C_FLAGS=${EXTRA_C_FLAGS:--sSUPPORT_LONGJMP=wasm -pthread}" \
  "-DCMAKE_CXX_FLAGS=${EXTRA_CXX_FLAGS:--fwasm-exceptions -pthread}"

cmake --build "${TMP}/build" --parallel 4
cmake --install "${TMP}/build"

test -s "${INSTALL}/lib/libdraco.a"
test -f "${INSTALL}/share/cmake/draco/draco-config.cmake"
test -f "${INSTALL}/share/cmake/draco/draco-targets.cmake"
test -f "${INSTALL}/include/draco/draco_features.h"
grep -Fq 'draco::draco' "${INSTALL}/share/cmake/draco/draco-targets.cmake"

touch "${STAMP}"
echo "[draco] ${VERSION} static WASM library and draco::draco CMake package ready"
