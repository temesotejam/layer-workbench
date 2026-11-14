#!/usr/bin/env python3
"""Stage an isolated, private imported-3MF instance-transform C bridge.

Patch only the pinned disposable OrcaWasm checkout. This is deliberately NOT
one-slicer-api 0.7.0, a native Model hierarchy mutation, metadata preservation
or any production/desktop parity claim. The C bridge updates session-owned
native-import geometry manifests without calling setObjects. Strict export
remains forbidden after a dirty import; best-effort is explicitly lossy.
"""
from pathlib import Path
import sys

BRIDGE_ANCHOR = "EMSCRIPTEN_KEEPALIVE\noneslicer_status_t oneslicer_project_get_manifest(\n"
LINK_ANCHOR = "'_oneslicer_project_get_manifest',\\\n"
LINK_NEW = LINK_ANCHOR + "'_orcawasm_project_edit_instance_transform',\\\n"

BRIDGE_CODE = r"""
// PRIVATE, experimental entry point, not part of one-slicer-api 0.7.0.
// Operates on the session's native-imported geometry manifest (not on a
// persistent Slic3r::Model). Never silently advertises lossless metadata
// preservation: strict export is denied by the existing dirty-import guard.
EMSCRIPTEN_KEEPALIVE
oneslicer_status_t orcawasm_project_edit_instance_transform(
    oneslicer_session_t session_ptr,
    const uint8_t* request_data,
    uint32_t request_len
) {
    OrcSession* session = as_session(session_ptr);
    if (!session) return ONESLICER_ERR_INVALID_ARGUMENT;
    session->last_error.clear();
    if (!session->initialized || session->native_project_blob.empty()) {
        record_error(*session, "private instance edit requires an imported 3MF project");
        return ONESLICER_ERR_UNSUPPORTED;
    }
    if (!request_data || request_len == 0 || request_len > 8192) {
        record_error(*session, "private instance edit request must contain 1..8192 bytes");
        return ONESLICER_ERR_VALIDATION;
    }
    {
        std::lock_guard<std::mutex> lock(session->control_mutex);
        if (session->active_slice) {
            record_error(*session, "private instance edit cannot run while slicing");
            return ONESLICER_ERR_INVALID_ARGUMENT;
        }
    }
    try {
        const auto request = nlohmann::json::parse(
            request_data, request_data + request_len);
        std::string error;
        if (!request.is_object()
            || !reject_unknown_keys(request, {"instanceId", "matrix"}, "private instance edit", error)
            || !request.contains("instanceId") || !request.contains("matrix")) {
            record_error(*session, error.empty()
                ? "private instance edit requires instanceId and matrix" : error);
            return ONESLICER_ERR_VALIDATION;
        }
        std::string instance_id;
        std::array<double, 16> matrix{};
        if (!valid_project_id(request.at("instanceId"), instance_id,
                              "instanceId", error)
            || !parse_project_matrix(request.at("matrix"), matrix, "matrix", error)) {
            record_error(*session, error);
            return ONESLICER_ERR_VALIDATION;
        }
        for (double value : matrix) {
            if (std::abs(value) > 100000.) {
                record_error(*session, "private instance matrix exceeds diagnostic bounds");
                return ONESLICER_ERR_VALIDATION;
            }
        }
        nlohmann::json next = session->project_manifest;
        if (!next.is_object() || !next.contains("instances")
            || !next["instances"].is_array()
            || next["instances"].empty() || next["instances"].size() > 64) {
            record_error(*session, "private instance edit requires a bounded imported manifest");
            return ONESLICER_ERR_VALIDATION;
        }
        std::size_t matched = 0;
        for (auto& instance : next["instances"]) {
            if (!instance.is_object() || !instance.contains("id")
                || !instance["id"].is_string()) {
                record_error(*session, "imported manifest has malformed instance IDs");
                return ONESLICER_ERR_VALIDATION;
            }
            if (instance["id"].get<std::string>() != instance_id)
                continue;
            ++matched;
            if (!instance.contains("transform") || !instance["transform"].is_object()
                || !instance["transform"].contains("matrix")) {
                record_error(*session, "imported instance lacks an affine transform");
                return ONESLICER_ERR_VALIDATION;
            }
            if (instance["transform"]["matrix"] == request["matrix"]) {
                record_error(*session, "private instance transform is unchanged");
                return ONESLICER_ERR_VALIDATION;
            }
            instance["transform"]["matrix"] = request["matrix"];
        }
        if (matched != 1) {
            record_error(*session, "private instance edit requires exactly one matching instance");
            return ONESLICER_ERR_VALIDATION;
        }
        // No archive ZIP mutation, no setObjects, and no geometry replacement.
        // Best-effort export rebuilds a 3MF from these modified placements;
        // any imported opaque metadata must be reported or refused.
        session->project_manifest.swap(next);
        session->native_project_dirty = true;
        ++session->project_preview_revision;
        clear_project_outputs(*session);
        return ONESLICER_OK;
    } catch (const std::exception& exception) {
        record_error(*session, std::string("private instance edit rejected: ") + exception.what());
        return ONESLICER_ERR_VALIDATION;
    }
}

"""


def apply_patch(bridge: str, cmake: str) -> tuple[str, str]:
    if bridge.count(BRIDGE_ANCHOR) != 1 or cmake.count(LINK_ANCHOR) != 1:
        raise ValueError("pinned OrcaWasm private edit anchors missing or duplicated")
    if "orcawasm_project_edit_instance_transform(" in bridge or (
        "_orcawasm_project_edit_instance_transform" in cmake
    ):
        raise ValueError("private imported 3MF transform patch already staged")
    return (
        bridge.replace(BRIDGE_ANCHOR, BRIDGE_CODE + BRIDGE_ANCHOR, 1),
        cmake.replace(LINK_ANCHOR, LINK_NEW, 1),
    )


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: patch_orcawasm_private_instance_edit.py <bridge/slicer.cpp> <wasm/CMakeLists.txt>")
    bridge_path, cmake_path = map(Path, sys.argv[1:])
    new_bridge, new_cmake = apply_patch(
        bridge_path.read_text(encoding="utf-8"),
        cmake_path.read_text(encoding="utf-8"),
    )
    bridge_path.write_text(new_bridge, encoding="utf-8")
    cmake_path.write_text(new_cmake, encoding="utf-8")
    print("PASS: staged opt-in private imported-3MF session edit; engine must be rebuilt and tested")


if __name__ == "__main__":
    main()
