# Core 3MF: exact model-byte preservation across one build transform

The previous ancillary ZIP audit intentionally excluded 3D/*.model to allow the
selected build item to change. That exclusion also missed changes to embedded
geometry, comments, object attributes, and unknown vendor XML.

Run against two local Core 3MF files:

    python3 scripts/compare_3mf_build_preservation.py \
      --baseline original.3mf --candidate translated.3mf \
      --report preservation.json

PASS requires:

1. Both ZIP archives pass the preexisting streaming inventory and safety limits.
2. Exactly one 3D/3dmodel.model Core part is present in each archive.
3. All other ZIP member decompressed bytes (textures, settings, relationships,
   unknown vendor extensions) are unchanged.
4. Every original Core model XML byte remains unchanged, apart from numeric
   values within explicit Core build/item transform attributes.
5. Exactly one build item has a changed valid finite, nonsingular 12-number
   transform. Geometry, objectid, comments, vendor XML, sibling placements,
   missing transforms, entities and DTDs are NOT normalized or ignored.

The isolated Chrome fixture workflow applies this independent check to
translation, Z rotation and local scale outputs and saves JSON reports.
The lightweight archive parity workflow runs adversarial unit tests.

This is deliberately stricter than semantic XML equivalence. Harmless
reserialization, whitespace changes, attribute ordering and namespace prefix
changes all fail. The audit is suitable for the existing surgical byte-edit
path, not general native OrcaSlicer project round-trip. It does NOT establish
native OrcaSlicer v2.5.0 3MF compatibility, multi-model project support,
G-code parity or physical print safety.

Related code: scripts/edit_3mf_build_transform.py,
scripts/compare_3mf_metadata.py,
docs/V250_3MF_ANCILLARY_PRESERVATION.md.

## 2026-11-20: XML attribute quote compatibility

The offline surgical editor now accepts the XML-permitted single-quoted and
spaced-equals forms of an explicit Core `<build><item transform='...'>`
attribute. It preserves the original quote character, spacing and every
other model XML byte while replacing only the numeric value. Namespace-
qualified vendor attributes such as `v:transform` are not edit targets.
An independent exact-byte preservation audit and tests cover these variants.
DTD/entity expansion, implicit transforms, escaped transform values, multiple
model parts, and general OrcaSlicer project compatibility remain unsupported.
The CI archive audit and isolated Core-3MF verification are triggered when
the surgical editor or its regression tests change on a pull request.

## 2026-11-20: implicit Core build identity support (isolated diagnostic)

Core 3MF permits an absent `<build><item transform>` attribute, meaning
the identity transform. The offline surgical editor now supports **one
selected implicit-identity item** in addition to explicit 12-number matrices.
For an actual non-identity translation, rotation or scaling, it inserts
exactly one ` transform="..."` immediately before the selected item's
`>` or `/>` without rewriting any other model XML bytes or ZIP member
payloads. An identity-to-identity request fails instead of creating a
spurious change.

The independent preservation comparator accepts this path **only** when
removing the one canonical inserted Core attribute recreates the complete
original model XML byte sequence. Any additional change (geometry, XML
spacing, vendor data, another build item or ancillary member) fails. The
existing explicit-transform path still requires exact bytes outside the
numeric value. Self-closing and paired item tags, malformed/no-op edits,
and adversarial preservation cases are covered by regression tests.

This does **not** imply OrcaSlicer desktop-created 3MF or arbitrary implicit
transform compatibility. Multi-model-part projects, nested native settings,
paint data, source-to-WASM conversions and round-trip opening in the desktop
application remain unverified. No production UI, WASM engine, vendor
profiles, or printable G-code are changed.

## 2026-11-20: independent native CLI acceptance of edited Core placement

The official v2.5.0 Linux AppImage verification workflow now tests a real
`--arrange 0 --export-stl` import of a surgically translated **synthetic**
two-build-item Core archive. The first build item moves +10 mm along X,
from x=90..110 to x=100..120; the second stays x=150..170.

The offline archive comparator must independently confirm that exactly
one Core build transform changed and all remaining decompressed model
and ancillary ZIP member bytes survived. A separate STL geometry audit
then verifies the *official native CLI's output*, with 12 nondegenerate
triangles per box and independently asserted XYZ bounds for both items.
The audit now accepts two explicit finite min/max boxes, retaining its
original fixed baseline bounds as the default. The native AppImage remains
pinned to the existing verified v2.5.0 release SHA-256 in the workflow.

This is stronger than validating an edited archive with XML-only parsing:
it confirms the native CLI applied the changed placement rather than
silently replacing it with auto-arrangement or dropping an instance.
However, the source is still a synthetic Core 3MF generated by this
repository, **not an OrcaSlicer desktop-saved project**. It does not
establish desktop project metadata preservation, arbitrary 3MF support,
native-vs-WASM G-code equality, or printable machine settings.

## 2026-11-20: official CLI-authored 3MF export/reopen acceptance gate

The native v2.5.0 CLI workflow now has a separate **experimental 3MF
export-and-reopen gate**. It first imports our independent two-build-item
Core 3MF with the fully inherited, source-pinned Creality CR-10 machine,
process and Generic PLA files, with `--arrange 0`. The official v2.5.0
AppImage then exports a new 3MF project using `--export-3mf`.
This output is *authored by the native CLI*, rather than by our Core fixture
writer. Its archive is scanned using the existing bounded ZIP inventory and a
new **native external-part OPC package audit**, then reopened by the same
native CLI and exported to STL.
The existing geometry gate checks that both independent world-space boxes
remain in their original positions and retain their 12 triangles each.

All official binaries, resolved profile JSON, the native-authored 3MF,
and resulting STLs remain in disposable CI storage. Only textual diagnostics
and hashes are archived. The gate does not claim that CLI serialization
preserves every vendor setting or opaque metadata; it also does not prove
that an OrcaSlicer *desktop GUI-saved* project can be edited. In particular,
the archive scan does not certify the native project as safe to print.

Next, inspect the native-authored member hierarchy and evaluate whether
the existing surgical Core build editor can preserve its metadata without
rewriting project data. Only expand support with a tested fixture and
explicit failure for unsupported native project structures.

The initial PR run [#44674738227](https://github.com/temesotejam/layer-workbench/actions/runs/44674738227)
exposed a genuine format gap: the native exporter writes one main Core model
plus two `3D/Objects/*.model` parts, linked by `3D/_rels/3dmodel.model.rels`,
and includes project/model settings under `Metadata/`. The earlier synthetic
Core scene auditor **correctly refused** these cross-part component references.
It was not relaxed to misinterpret a native project as a single-part model.
The new narrow package audit checks required members, XML syntax, and that
internal OPC relationships resolve to existing members. Geometry is accepted
only after an actual native CLI reopen and world-space STL check. This still
is not a general external-part scene parser or metadata-semantic validator.

## 2026-11-20: native CLI-authored multi-part build edit acceptance experiment

A separate `scripts/edit_native_3mf_build_transform.py` intentionally supports
**only** the source-pinned OrcaSlicer v2.5.0 two-object CLI-exported project
layout audited by `verify_native_3mf_package.py`. Unlike the synthetic Core
editor, this reads the main Core `3D/3dmodel.model` build item while allowing
external `3D/Objects/*.model` parts. It alters one main build-item transform
by a requested finite relative millimetre translation, retaining all original
ZIP member payload bytes except the main model XML's one transform attribute.

The independent comparison checks every external model, relationship, printer
and process metadata part byte-for-byte after decompression, and masks only a
single main build-item transform attribute. It refuses unsupported native
layouts, invalid transforms, multiple changed placements and structural XML
changes; absent identity attributes are accepted only if insertion is the
single canonical change. The official CLI regression reopens the edited
native-authored project with `--arrange 0 --export-stl` and checks that only
the first cube moves +10 mm X while the other remains in place.

This verifies a narrowly scoped native CLI interchange path, **not** GUI-saved
3MF compatibility, opaque metadata *semantics*, external-component transform
editing, full 3MF round-trip, native/WASM G-code parity or printable output.

## 2026-11-20: native CLI-authored multipart Z-axis placement rotation gate

The narrow native multipart editor now has a separate `--rotate-z-deg`
operation in addition to the existing `--translate-mm` command. It rotates
the **selected main Core build item** around its existing build translation
anchor (not the geometric mesh center), following the Core 3MF row-vector
convention. The previous 3-by-3 linear transform is composed with world-Z
rotation; translation and all opaque 3MF members are retained byte-for-byte
after decompression. Only finite nonzero angles in -360..360 degrees are
accepted. The destination must be new; a rejected edit is not left behind.

Offline tests cover a translated first item with an unchanged sibling,
implicit identity transforms, pre-existing rotation/nonuniform scale and
invalid/no-op angles. The native CLI workflow also reopens a surgically
rotated, **official-CLI-exported** 3MF with `--arrange 0` and checks the
native STL coordinates of both cubes, in addition to the independent exact
archive-member preservation comparator. All 3MF files stay in ephemeral CI.

This is only an acceptance gate for the pinned two-object CLI-exported
fixture. It does NOT establish support for general GUI-saved projects,
object-center pivots, arbitrary multipart hierarchy, native/WASM G-code
equivalence, production WASM integration or print safety.

## 2026-11-20: native CLI-authored multi-part XYZ scale acceptance gate

The isolated command-line 3MF editor now supports `--scale-xyz SX SY SZ`
in addition to translation and Z rotation. Scale factors must be finite,
positive, within 0.25..4 per axis and not all 1. The operation composes
world-axis scaling onto the selected main Core build transform, while
preserving that transform's original translation anchor. This is **not**
scaling around the mesh center, and it does not edit external
`3D/Objects/*.model` geometry or printer/project settings.

Regression tests cover nonuniform scaling, a previously rotated/nonuniform
transform, missing implicit-identity transforms, untouched sibling items,
opaque metadata byte preservation, and fail-closed invalid, negative,
nonfinite, out-of-range or no-op factors.

The official v2.5.0 native CLI workflow exports its existing source-pinned
two-object project, scales only the first build item by
`(1.5, 0.75, 1.25)`, independently checks all other 3MF ZIP member
payloads and Core XML bytes, then reimports with `--arrange 0 --export-stl`.
Expected XYZ bounds come from the first object's already independently
verified world-space cube bounds and the *actual* main build transform's
translation, not a presumed origin. The second cube must keep its original
bounds and triangle count. No proprietary profile payload, exported 3MF or
generated STL is uploaded from CI.

This is a tightly bounded native CLI export/reimport acceptance case. It
does **not** establish support for arbitrary GUI-saved multipart hierarchy,
model-center pivot semantics, complete 3MF project round-trip,
native-vs-WASM G-code equivalence, or safe physical printing.
