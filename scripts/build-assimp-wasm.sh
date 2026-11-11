#!/usr/bin/env bash
# Build OrcaSlicer v2.5.0's pinned Assimp importer as a WASM static library.
# Runs only in the disposable GitHub Actions OrcaWasm checkout. The upstream
# source and repository licensing are left unchanged.
set -euo pipefail

EMSDK="${EMSDK:-/opt/emsdk}"
source "${EMSDK}/emsdk_env.sh"

WORKSPACE="${GITHUB_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
INSTALL="${WORKSPACE}/orcawasm/deps-install"
VERSION="5.4.3"
STAMP="${INSTALL}/.assimp_${VERSION}_wasm_mt_eh_v1"
if [[ -f "${STAMP}" && -f "${INSTALL}/lib/libassimp.a" ]]; then
  echo "[assimp] ${VERSION} WASM static library already installed"
  exit 0
fi

# Official OrcaSlicer v2.5.0 deps/Assimp/Assimp.cmake pins v5.4.3
# with this exact upstream archive SHA-256.
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
ARCHIVE="${TMP}/assimp-${VERSION}.tar.gz"
curl --fail --location --retry 3 --silent --show-error \
  "https://github.com/assimp/assimp/archive/refs/tags/v${VERSION}.tar.gz" \
  --output "${ARCHIVE}"
echo "66dfbaee288f2bc43172440a55d0235dfc7bf885dda6435c038e8000e79582cb  ${ARCHIVE}" | sha256sum -c -
mkdir -p "${TMP}/source"
tar -xzf "${ARCHIVE}" -C "${TMP}/source" --strip-components=1
mkdir -p "${INSTALL}"

# Build the same import-only formats enabled by OrcaSlicer's official recipe.
# Never link to the runner's native assimp library; emcmake creates wasm32
# libraries and exports assimp::assimp via its installed CMake package.
emcmake cmake -S "${TMP}/source" -B "${TMP}/build" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="${INSTALL}" \
  -DCMAKE_INSTALL_LIBDIR=lib \
  -DBUILD_SHARED_LIBS=OFF \
  -DASSIMP_INSTALL=ON \
  -DASSIMP_BUILD_TESTS=OFF \
  -DASSIMP_BUILD_SAMPLES=OFF \
  -DASSIMP_BUILD_ASSIMP_TOOLS=OFF \
  -DASSIMP_INSTALL_PDB=OFF \
  -DASSIMP_BUILD_USE_CCACHE=OFF \
  -DASSIMP_NO_EXPORT=ON \
  -DASSIMP_BUILD_ALL_IMPORTERS_BY_DEFAULT=OFF \
  -DASSIMP_BUILD_GLTF_IMPORTER=ON \
  -DASSIMP_BUILD_OBJ_IMPORTER=ON \
  -DASSIMP_BUILD_FBX_IMPORTER=ON \
  -DASSIMP_BUILD_ZLIB=ON \
  -DASSIMP_WARNINGS_AS_ERRORS=OFF \
  "-DCMAKE_C_FLAGS=${EXTRA_C_FLAGS:--sSUPPORT_LONGJMP=wasm -pthread}" \
  "-DCMAKE_CXX_FLAGS=${EXTRA_CXX_FLAGS:--fwasm-exceptions -pthread}"
cmake --build "${TMP}/build" --target install -j4

test -f "${INSTALL}/lib/libassimp.a"
if ! find "${INSTALL}/lib/cmake" -type f \
  \( -name 'assimpConfig.cmake' -o -name 'assimp-config.cmake' \) \
  -print -quit | grep -q .; then
  echo "[assimp] CMake package config was not installed" >&2
  exit 1
fi

touch "${STAMP}"
echo "[assimp] ${VERSION} WASM importer library and CMake package ready"
