#!/usr/bin/env python3
"""Generate a small independent 3MF Core scene with two selectable build items.

Synthetic 20 mm cube at two translations. Not an OrcaSlicer project fixture
or evidence of desktop/WASM model hierarchy parity.
"""
import argparse
from math import cos, radians, sin
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

TRIANGLES = (
    (0, 1, 2), (0, 2, 3), (4, 6, 5), (4, 7, 6),
    (0, 5, 1), (0, 4, 5), (3, 2, 6), (3, 6, 7),
    (0, 3, 7), (0, 7, 4), (1, 5, 6), (1, 6, 2),
)
VERTICES = (
    (0, 0, 0), (20, 0, 0), (20, 20, 0), (0, 20, 0),
    (0, 0, 20), (20, 0, 20), (20, 20, 20), (0, 20, 20),
)
MODEL = """<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<resources><object id="1" type="model"><mesh><vertices>
%s
</vertices><triangles>
%s
</triangles></mesh></object></resources><build>
<item objectid="1" transform="1 0 0 0 1 0 0 0 1 90 90 0"/>
<item objectid="1" transform="1 0 0 0 1 0 0 0 1 150 90 0"/>
</build></model>"""
CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>"""
RELS = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/>
</Relationships>"""


def make_file(destination: Path, *, rotated_scaled=False):
    vertices = "\n".join(f'<vertex x="{x}" y="{y}" z="{z}"/>' for x,y,z in VERTICES)
    triangles = "\n".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a,b,c in TRIANGLES)
    model_xml = MODEL % (vertices, triangles)
    if rotated_scaled:
        # 3MF Core row-vector affine: local nonuniform scale then +30° Z
        # rotation about the build item's translation anchor (90, 90, 0).
        angle = radians(30)
        sx, sy, sz = 1.5, 0.75, 1.25
        matrix = (
            sx * cos(angle), sx * sin(angle), 0,
            -sy * sin(angle), sy * cos(angle), 0,
            0, 0, sz, 90, 90, 0,
        )
        baseline = 'transform="1 0 0 0 1 0 0 0 1 90 90 0"'
        if model_xml.count(baseline) != 1:
            raise ValueError("Unexpected first-build transform in fixture")
        edited = 'transform="' + " ".join(f"{x:.12g}" for x in matrix) + '"'
        model_xml = model_xml.replace(baseline, edited, 1)
    content = model_xml.encode("utf-8")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(destination, "w", compression=ZIP_DEFLATED) as archive:
        for name, data in (
            ("[Content_Types].xml",CONTENT_TYPES.encode()),
            ("_rels/.rels",RELS.encode()),
            ("3D/3dmodel.model",content),
        ):
            meta = ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            meta.compress_type = ZIP_DEFLATED
            archive.writestr(meta, data)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rotated-scaled", action="store_true",
                        help="Apply +30 deg Z and (1.5, 0.75, 1.25) local scale to build item 1")
    args = parser.parse_args()
    make_file(args.output, rotated_scaled=args.rotated_scaled)
    print("Generated synthetic two-build-item Core 3MF "
          "(rotated-scaled variant; not desktop parity)" if args.rotated_scaled
          else "Generated synthetic two-build-item Core 3MF (not desktop parity):",
          args.output)
