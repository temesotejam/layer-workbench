#!/usr/bin/env python3
"""Experimental isolated OrcaWasm 3MF export hierarchy fix.

Targets only Hiosdra/OrcaWasm@60a09e04 (bridge/slicer.cpp) in a disposable
CI checkout. Does NOT patch desktop OrcaSlicer upstream, deploy WASM,
or assert desktop 3MF parity. Fails closed on any drift or second application.
"""
from pathlib import Path
import sys

OLD = '''            } else {
                Slic3r::TriangleMesh mesh;
                if (!build_project_export_mesh(*session, manifest, mesh, error)) {
                    record_error(*session, error);
                    return ONESLICER_ERR_UNSUPPORTED;
                }
                const std::string stl_path = "/tmp/ow-project-export-"
                    + std::to_string(session->id) + ".stl";
                TempFileGuard stl_guard(stl_path);
                if (!Slic3r::store_stl(stl_path.c_str(), &mesh, true)) {
                    record_error(*session, "OrcaSlicer could not serialize the project export mesh");
                    return ONESLICER_ERR_OUTPUT;
                }
                long stl_size = 0;
                const char* read_error = nullptr;
                bool out_of_memory = false;
                char* stl_data = read_file_to_buffer(
                    stl_path.c_str(), &stl_size, &read_error, &out_of_memory
                );
                if (!stl_data) {
                    record_error(*session, std::string{"unable to read project export mesh: "}
                        + (read_error ? read_error : "read failed"));
                    return out_of_memory ? ONESLICER_ERR_OUTPUT : ONESLICER_ERR_INPUT_IO;
                }
                export_status = write_single_mesh_3mf(
                    reinterpret_cast<oneslicer_session_t>(session),
                    reinterpret_cast<const uint8_t*>(stl_data),
                    static_cast<uint32_t>(stl_size),
                    &exported_data,
                    &exported_len
                );
                std::free(stl_data);
            }
''';
NEW = '''            } else {
                // Keep independent source instances separate in Orca's 3MF
                // model, instead of baking all transforms into one STL mesh.
                // This is an experimental candidate, NOT desktop 3MF parity.
                Slic3r::Model native_model;
                for (const auto& plate_id : manifest.plate_ids) {
                    export_status = build_project_plate_model(
                        *session, manifest, plate_id, native_model, error
                    );
                    if (export_status != ONESLICER_OK) {
                        record_error(*session, error);
                        return export_status;
                    }
                }
                if (native_model.objects.empty()) {
                    record_error(*session, "project contains no objects to export");
                    return ONESLICER_ERR_EMPTY_INPUT;
                }
                export_status = write_project_model_3mf(
                    *session, native_model, &exported_data, &exported_len
                );
            }
''';


def apply_patch(source: str) -> str:
    if source.count(OLD) != 1:
        raise ValueError("pinned OrcaWasm 3MF flattening branch missing, duplicated or already patched")
    if source.count("static oneslicer_status_t build_project_plate_model(") != 1:
        raise ValueError("native per-instance model constructor missing or duplicated")
    if source.count("static oneslicer_status_t write_project_model_3mf(") != 1:
        raise ValueError("native 3MF exporter missing or duplicated")
    return source.replace(OLD, NEW, 1)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch-orcawasm-3mf-object-export.py <orcawasm/bridge/slicer.cpp>")
    path = Path(sys.argv[1])
    modified = apply_patch(path.read_text(encoding="utf-8"))
    path.write_text(modified, encoding="utf-8")
    print("PASS: staged native 3MF per-instance object export patch; no WASM built")


if __name__ == "__main__":
    main()
