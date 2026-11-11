#!/usr/bin/env bash
# Prepare the preinstalled Ubuntu 24.04 GitHub-hosted runner for the WASM build.
# Avoid apt-get update/install: the runner's Azure Ubuntu mirror suffered
# repeated DNS failures in runs 43047097790 and 43051471275, despite retries.
# GitHub's published Ubuntu 24.04 image includes the required build tools.
set -euo pipefail

tools=(bash git curl cmake ninja clang gcc g++ make python3 pkg-config m4 makeinfo tar xz unzip zip sha256sum)
missing=()
for tool in "${tools[@]}"; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing+=("$tool")
  fi
done
if (( ${#missing[@]} > 0 )); then
  printf '::error::Missing preinstalled runner tools: %s\n' "${missing[*]}" >&2
  exit 1
fi
if [[ ! -f /usr/include/openssl/ssl.h ]]; then
  echo "::error::Missing libssl-dev headers on the hosted runner" >&2
  exit 1
fi

# CMake in the pinned OrcaWasm recipe always passes ccache as a compiler
# launcher. If GitHub stops shipping it, preserve the compile command by
# providing a *transparent* passthrough. No fake cached hits are claimed.
if ! command -v ccache >/dev/null 2>&1; then
  shimdir="${RUNNER_TEMP:-/tmp}/orcaslicer-wasm-tool-shims"
  mkdir -p "$shimdir"
  cat > "$shimdir/ccache" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  --max-size=*|-s|--show-stats) exit 0 ;;
esac
exec "$@"
EOF
  chmod +x "$shimdir/ccache"
  [[ "$("$shimdir/ccache" printf 'ok')" == "ok" ]]
  export PATH="$shimdir:$PATH"
  if [[ -n "${GITHUB_PATH:-}" ]]; then
    printf '%s\n' "$shimdir" >> "$GITHUB_PATH"
  fi
  echo "::notice::ccache not installed; using transparent compiler launcher (no cache acceleration)"
else
  echo "[tooling] ccache present: $(command -v ccache)"
fi
echo "[tooling] Ubuntu runner toolchain verified without network-dependent apt install"
cmake --version | head -1
ninja --version
clang --version | head -1
