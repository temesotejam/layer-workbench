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
                // Keep manifest objects and their instances separate in Orca's 3MF
                // model, instead of baking all transforms into one STL mesh.
                // This is an experimental candidate, NOT desktop 3MF parity.
                Slic3r::Model native_model;
                for (const auto& plate_id : manifest.plate_ids) {
                    export_status = build_project_plate_model(
                        *session, manifest, plate_id, native_model, error, true
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


# Pinned Hiosdra/OrcaWasm constructor anchors. Only the new ordinary
# non-sliced export call opts in; slicing, modifier and artifact paths
# continue to use the original per-instance construction.
CONSTRUCTOR_OLD = '''static oneslicer_status_t build_project_plate_model(
    OrcSession& session,
    const ProjectManifestInput& manifest,
    const std::string& plate_id,
    Slic3r::Model& model,
    std::string& error
) {'''
CONSTRUCTOR_NEW = '''static oneslicer_status_t build_project_plate_model(
    OrcSession& session,
    const ProjectManifestInput& manifest,
    const std::string& plate_id,
    Slic3r::Model& model,
    std::string& error,
    bool reuse_manifest_objects = false
) {'''
STAGE_MESH = '''        const std::string path = "/tmp/ow-project-slice-"
            + std::to_string(session.id) + "-" + std::to_string(instance_index++)
            + ".stl";'''
INSTANCE_TRANSFORM = '''        Slic3r::Transform3d matrix = Slic3r::Transform3d::Identity();
        for (int row = 0; row < 4; ++row) {
            for (int column = 0; column < 4; ++column) {
                matrix.matrix()(row, column) = instance.matrix[
                    static_cast<std::size_t>(row * 4 + column)
                ];
            }
        }
        const Slic3r::Geometry::Transformation transformation(matrix);
'''
REUSE_OBJECT = '''        // Reuse only the SAME manifest object on this plate. Different
        // object IDs may have independent settings even with the same mesh.
        if (reuse_manifest_objects) {
            const auto existing = native_objects_by_id.find(object_input->id);
            if (existing != native_objects_by_id.end()) {
                for (auto* object : existing->second) {
                    auto* native_instance = object->add_instance();
                    if (!native_instance) {
                        error = "OrcaSlicer could not allocate a shared project instance";
                        return ONESLICER_ERR_OUTPUT;
                    }
                    native_instance->set_transformation(transformation);
                }
                continue;
            }
        }
'''


def apply_patch(source: str) -> str:
    if source.count(OLD) != 1:
        raise ValueError("pinned OrcaWasm 3MF flattening branch missing, duplicated or already patched")
    if source.count("static oneslicer_status_t build_project_plate_model(") != 1:
        raise ValueError("native per-instance model constructor missing or duplicated")
    if source.count("static oneslicer_status_t write_project_model_3mf(") != 1:
        raise ValueError("native 3MF exporter missing or duplicated")
    start = source.index("static oneslicer_status_t build_project_plate_model(")
    end = source.index("static oneslicer_status_t slice_project_model(", start)
    constructor = source[start:end]
    for anchor in (CONSTRUCTOR_OLD, STAGE_MESH, INSTANCE_TRANSFORM):
        if constructor.count(anchor) != 1:
            raise ValueError("pinned native constructor anchor missing or duplicated")
    constructor = constructor.replace(CONSTRUCTOR_OLD, CONSTRUCTOR_NEW, 1)
    constructor = constructor.replace(INSTANCE_TRANSFORM, "", 1)
    constructor = constructor.replace(
        STAGE_MESH, INSTANCE_TRANSFORM + REUSE_OBJECT + STAGE_MESH, 1
    )
    source = source[:start] + constructor + source[end:]
    return source.replace(OLD, NEW, 1)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch-orcawasm-3mf-object-export.py <orcawasm/bridge/slicer.cpp>")
    path = Path(sys.argv[1])
    modified = apply_patch(path.read_text(encoding="utf-8"))
    path.write_text(modified, encoding="utf-8")
    print("PASS: staged native 3MF manifest-object reuse export patch; no WASM built")


if __name__ == "__main__":
    main()
