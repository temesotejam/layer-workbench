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


## 2026-11-20: read-only CLI multipart object/component topology inventory

The official v2.5.0 CLI 3MF acceptance workflow now runs
`scripts/inspect_native_3mf_hierarchy.py` on the exported project. It
first applies the existing bounded ZIP and internal OPC package checks,
then records Core model-part object IDs, main build-item references, mesh
objects and component edges. Namespace-qualified component `path` hints
are resolved within the package; missing target objects, missing main build
resources and unresolved component references are reported explicitly.
It rejects duplicate/missing resource object IDs and unsafe component paths.

The diagnostic output is textual JSON in CI; the native 3MF archive itself
is not uploaded. The pinned two-object CLI case requires two main build
items, but intentionally **does not yet gate on every component edge being
resolved**. Inspect the resulting topology before accepting a broader editor
that changes component transforms or flattens multiple instances. The
report does not compose nested transforms, inspect proprietary metadata
semantics, prove GUI-authored 3MF compatibility, or certify printing.

Offline tests construct a two-object synthetic multipart graph and cover
valid external links, dangling build references, dangling external object
IDs, duplicate object IDs and path traversal. These tests run before the
native AppImage is downloaded; they do not replace native reimport checks.

The inspector also recognizes Production Extension `p:path` on **root build items**
(as well as root-model components) and resolves such IDs against their target
model part. It ignores unrelated vendor attributes named `path`, requires
absolute package paths, and rejects cross-part `p:path` on non-root model
components. These restrictions follow the [3MF Production Extension v1.1.2](https://3mf.io/wp-content/uploads/sites/106/2025/02/3MF_Production_Extension_v1_1_2.pdf),
sections 2 and 3. They are reference-inventory rules, not a guarantee that
all transform/metadata extension semantics are implemented.


## 2026-11-20: read-only cross-part Core transform composition and STL agreement gate

The new `scripts/audit_native_3mf_instance_placement.py` extends the
existing read-only multipart reference inventory without editing any 3MF
member. After strict ZIP/OPC/reference validation, it follows each main
build item through its Core component graph to concrete mesh leaves.
Per-instance Core matrices are composed with the existing **row-vector**
convention (leaf component first, containing component next, build item
last). It computes *exact transformed vertex* XYZ bounds in millimetres
from vertices referenced by mesh triangles, not merely an enclosing
rotated local AABB. Repeated references to the same mesh produce
distinct instances. Cycles, unresolved references, invalid mesh indices,
nonfinite coordinates, excessive graph expansion and mixed model units
fail closed. This initial gate intentionally requires equal model units
across parts and a bounded graph; broader unit-conversion rules are not
inferred from unsupported metadata.

The pinned native CLI workflow separately reopens the official-v2.5.0
CLI-authored two-cube multipart archive as STL. The new gate now compares
the two independently composed Core world bounds against real native STL
triangles using the existing exact two-box geometry auditor. This can
detect wrong transform order, dropped component placements and duplicate
mesh instance misunderstandings without interpreting printer metadata.
Offline regression cases include nested rotation/translation, shared
mesh references, cycles, dangling links, mixed units and malformed
vertices/triangles. It remains a narrowly scoped two-cube acceptance
test, **not** GUI-created 3MF compatibility, general unit conversion,
full project metadata parity, native/WASM G-code identity, or print safety.

## 2026-11-20: Second shared-mesh instance edit acceptance gate

The first native-authored multipart edit tests moved build item 0 while
leaving item 1 unchanged. The new gate instead moves **build item 1**
by -10 mm on X, preserving the original shared external mesh and its sibling.

`scripts/verify_native_3mf_edit_effect.py` independently expands the
multipart Core component graph in both archives. It checks the full mesh
instance identity paths, unchanged linear transforms, XYZ bounds translated
only for the requested build, and exact sibling world placement. It also
requires the existing byte-preservation comparator to reject changed opaque
settings, OPC relationships, external mesh bytes and extra build edits.
Offline tests exercise nested component transforms, two builds sharing one
external mesh, multiple leaves under one build, an incorrect claimed move,
a wrong build index, and accidental edits of both builds.

The official v2.5.0 CLI acceptance step exports STL from the edited 3MF,
then compares both independently composed per-build bounds with the native
triangles. The test additionally requires the expected fixture boxes
**[90,110]** mm and **[140,160]** mm on X respectively (original second
box [150,170] mm), with unchanged Y/Z limits. This demonstrates per-instance
placement isolation for the *specific CLI-authored two-cube archive* only.

This is not desktop-GUI-created 3MF compatibility, full metadata semantics,
a WebAssembly G-code comparison, or approval for a physical print.


## 2026-11-20: Isolated linear edits of shared-mesh native build instances

`scripts/verify_native_3mf_linear_edit_effect.py` independently checks a
requested Z rotation or bounded XYZ scale of **one** main Core build item, without
trusting the editing script's success report. It first applies the existing
byte-preservation gate: no external mesh, OPC relationships, settings, unknown
metadata or other build transforms may change. It then expands all Core mesh
instances before and after the edit, validates unchanged identities and sibling
world matrices/bounds, and verifies each selected leaf's complete composed
12-component affine matrix against the declared operation.

Rotation and scale are around the **original build translation**, not world
zero or mesh center; child component offsets are transformed relative to that
anchor. Shared meshes and nested/multiple component leaves are covered by
offline regression tests. The official-native v2.5.0 acceptance workflow
additionally rotates **build item 1** by 30° in the pinned two-object archive,
reimports with the actual CLI, and compares resulting STL bounds to
independently composed exact Core mesh vertex bounds.

These tests address one shared-mesh sibling-isolation hazard but do not mutate
component definitions, split shared resources, establish GUI-created 3MF
compatibility, guarantee opaque metadata semantics, establish full native/WASM
G-code parity, or certify printable output. The public website is unchanged.


## 2026-11-20: Core resource ownership / copy-on-write preflight

The bounded, **read-only** `scripts/audit_native_3mf_edit_ownership.py`
now counts every reachable Core object *occurrence* per build item in a
native CLI-authored multipart 3MF. Each instance follows the actual
component-reference graph; duplicate edges to the same child object are
counted independently instead of being collapsed by object ID or mesh
path. The audit first invokes the strict composed-placement gate, including
its cycle, mixed-unit, malformed-mesh, and expansion-budget checks.

A Core object instantiated multiple times is marked
`requires_copy_on_write_for_one_instance`: modifying that shared object
in place would affect more than one placement. This differs from the
already-tested main **build-transform** edits, which do not rewrite the
shared mesh resource. A root component object instantiated only once
may be a *candidate* for a future isolated component edit, but this
preflight does **not** authorize changing opaque OrcaSlicer metadata.

The official pinned v2.5.0 native CLI acceptance workflow now requires
its two build roots to be independently instantiated and at least one
external mesh to be shared across builds. Offline regression tests cover
shared leaves, duplicate edges within a build, shared parent roots,
dangling references, and non-mutation of archive bytes. All native files
remain in the CI runner.

**Not yet implemented:** cloning shared Core resources and retargeting an
individual component chain (copy-on-write), general GUI-saved 3MF support,
vendor metadata coherence, native/WASM G-code parity, or print safety.
The next editor must clone and retarget precisely one path, then
independently compare sibling geometry and opaque package members.

## 2026-11-20: occurrence-specific Core copy-on-write plan (read-only)

`scripts/plan_native_3mf_copy_on_write.py` turns per-build Core ownership
counts into a specific clone-chain plan. Given a main build index and
zero-based component-edge path (e.g. `--build-index 1 --component-edges 0`),
it selects **one occurrence**, even when identical child IDs appear twice
under the same component parent. Object IDs alone cannot distinguish them.

The plan lists shared objects to clone **leaf first**, and the exact
component edge or build item reference to redirect at each step.
A shared leaf with a unique parent needs one clone; a shared root requires
both the leaf and the root to be cloned. Invalid paths and malformed Core
packages fail closed through the validated ownership/placement audit.

The official native CLI CI tests a shared-mesh occurrence in its generated
two-object v2.5.0 project. Offline regressions exercise repeated edges,
shared roots, unique leaves, invalid indices, and read-only preservation.

**Nothing is rewritten.** The planner allocates no object IDs, changes no
model parts or OPC relationships, and cannot certify native project metadata,
real-world printability, GUI-saved 3MF or WASM toolpath parity. A later
clone-and-redirect implementation requires independent checks of sibling
geometry and untouched archive members with the official CLI. Published
Pages and WASM remain unchanged.


## 2026-11-20: experimental external Core mesh leaf copy-on-write (clone only)

`scripts/clone_native_3mf_shared_leaf.py` executes the first bounded,
non-printing Core copy-on-write edit after the read-only occurrence planner.
It supports only the already audited **two-build-item, one-mesh-per-build**
native multipart layout: a shared mesh in an external model part, reached
through one component edge of an independently owned main-part parent.
A path requiring cloned parents, additional leaf instances, nested parent
chains or non-Core XML is rejected.

The writer allocates a fresh decimal Core object ID in the same external
model part, inserts an *exact raw-byte copy* of the original mesh object
with only its ID changed, and rewrites the selected parent component's
`objectid` **in place**. Surgical raw-byte surgery is used instead of
re-serializing unrelated vendor XML. Ambiguous raw markup, comments,
CDATA, processing instructions and unsafe or duplicate references fail
closed. No mesh vertices, plate coordinates, process settings, profiles
or machine-facing G-code are edited.

Postconditions check the bounded 3MF/OPC package, untouched non-model ZIP
members byte for byte, exactly two changed model parts, the independently
composed geometry of *both* build instances, and the absence of further
sharing along the newly retargeted leaf. The original archive is never
overwritten. The official OrcaSlicer v2.5.0 CLI CI gate reopens the new
archive and independently checks its STL output. This acceptance test is
clone-only: geometry intentionally remains unchanged.

This does **not** prove semantic integrity of vendor metadata embedded
inside touched model parts, general GUI-saved 3MF compatibility, future
mesh vertex edits, WASM-native G-code parity or physical printer safety.
The next stage is a separately validated bounded edit of the new, private
mesh, comparing sibling geometry before/after in the native engine. Keep
all generated project data ephemeral and do not expose this writer in the
published browser UI.


## 2026-11-20: bounded private Core mesh vertex edit after copy-on-write

The offline-only scripts/scale_native_3mf_private_leaf.py now edits a
previously detached Core leaf, after scripts/clone_native_3mf_shared_leaf.py
has split the second of two mesh occurrences. X coordinates of the private
leaf's vertices are scaled around their local X midpoint, not the plate
origin. No mesh topology, build placement, component transform, printer
profile, or generated G-code is changed.

It requires a validated two-build native CLI project, independent selected
Core ownership, millimetre model units, supported literal vertex markup,
a finite nonidentity scale in 0.5..1.5 and a new output destination.
Comments, ambiguous XML, shared leaves and unsupported hierarchy fail closed.
The raw Core XML writer preserves the sibling mesh object byte for byte.
Postconditions require that exactly one external model ZIP member changed,
all unrelated decompressed ZIP members are identical, composed instance
transforms and triangle counts stay fixed, sibling world bounds are unchanged,
and edited instance bounds differ.

The official v2.5.0 CLI workflow reimports the independently scaled native
3MF and exports STL with auto-arrangement disabled. An independent Core
vertex/placement reader compares BOTH world-space bounds against the actual
native STL triangles. Only textual diagnostics are archived; project files
and official binaries remain ephemeral CI data.

This is not desktop GUI-authored 3MF compatibility, arbitrary geometry edit
support, vendor metadata semantic equivalence, native/WASM G-code parity,
or safe physical printing. It is not enabled in the public browser.
Next: generalize nested copy-on-write and audit metadata references before
considering arbitrary native project edits.

## 2026-11-21: bounded Y/Z private leaf vertex scaling

The isolated offline `scale_native_3mf_private_leaf.py` writer now supports
`--scale-y` and `--scale-z` in addition to the existing `--scale-x`.
These flags are mutually exclusive: one detached Core mesh and one local axis
at a time, scaling about that axis's local bounding-box midpoint. The Python
API retains its prior X-default positional factor and adds an explicit axis.
For any chosen axis it requires the preexisting one-private-leaf ownership
gate, millimetre Core model units, finite factor within 0.5..1.5, no
zero-width target dimension, immutable source, and a new output pathname.
Only the selected axis's literal vertex numeric attributes may change.

Offline regression tests check X compatibility, Y/Z isolated edits,
byte-preserved sibling/opaque ZIP members, and invalid axis rejection.
The pinned official v2.5.0 native CLI acceptance additionally reopens the
two separately edited Y/Z archives and matches re-exported STL world
bounds against independently composed Core vertex placements, ensuring
the other build's geometry remains unchanged. Only CI-ephemeral generated
projects are used. This does not implement nested copy-on-write, arbitrary
GUI-authored 3MF compatibility, print safety, or WASM G-code equality.


## 2026-11-21: bounded two-level shared-root Copy-on-Write

The existing leaf-only writer refuses to change an external mesh when the
parent **main Core object itself** is shared by two build items. The new
offline script scripts/clone_native_3mf_shared_root_chain.py implements
one additional, narrowly-scoped case: two build items each instantiate
the same main Core root, which contains a single cross-part component edge
to a shared external mesh. The second occurrence is isolated by cloning
the external mesh, cloning the shared main root with its component redirected
to the new mesh ID, then retargeting only the second build item. This is
**not** a general arbitrary-depth instance editor.

The operation checks the occurrence-specific ownership planner both before
and after editing. It compares per-build world bounds and transforms, preserves
all other ZIP members and the original Core object bytes, and refuses
ambiguous XML, extra component edges, unsafe indices and existing output
paths. A dedicated five-case Python regression suite runs in the official
native CLI workflow. That workflow also constructs a bounded shared-root
Core fixture, opens the rewritten project using official OrcaSlicer v2.5.0,
and compares exported STL geometry to the independent Core hierarchy reader.

This test does not exercise Orca GUI metadata or 3MF paint/material/texture
semantics. It does not change vertex positions or certify G-code, and the
writer remains outside the production browser UI. Next: generalize
occurrence-path cloning to nested same-part and cross-part components with
explicit metadata preservation and test per-instance private mesh editing.

## 2026-11-21: shared-root detachment → private Y-mesh edit acceptance

The independently audited two-level shared-root writer can now be chained,
**without broadening its accepted input structure**, to the existing private
Core mesh vertex scaler. An additional regression starts with two build
items sharing a main component root and external mesh. It proves direct
scaling is rejected while the mesh is shared, clones the main root and
leaf for build item 1, and then applies a bounded 1.2× local Y-vertex
scale to that detached leaf only.

The regression preserves the original archive and detached source bytes,
all non-target ZIP member payloads and the shared sibling's coordinates.
The original and edited instance transform/identity chains are compared,
as are independently composed per-build mesh bounds. In the official
v2.5.0 native CLI workflow, the post-edit archive is reopened with
auto-arrangement disabled and the exported STL is numerically compared
with the Core hierarchy reader. This is a combined **geometry-only**
gate, not a desktop GUI project or lossless Orca metadata edit.

The accepted structure is still precisely two build items with one
shared main root, one external leaf and a single component edge.
Arbitrary-depth component graphs, mixed model parts, opaque Orca metadata
semantics, user-facing browser editing, full-profile native/WASM G-code
parity and real printer validation remain unverified. Test project
files remain ephemeral in CI; do not publish generated G-code.


## 2026-11-21: bounded three-level occurrence Copy-on-Write (candidate)

The new `scripts/clone_native_3mf_three_level_chain.py` extends the
native-CLI-only Core ownership experiment to a single
**build item → shared root → shared middle → external shared mesh**
reference path. Two builds must share all three resources, each with exactly
one mesh occurrence. It first copies the mesh, then the same-part middle,
then the root, and redirects **only build item 1**; the original path remains
byte-identical. All unknown ZIP members, printer/profile data and relationships
are copied without interpretation. The writer refuses extra edges, ambiguous
XML, ID overflow, unsupported paths and destination overwrite.

`test_clone_native_3mf_three_level_chain.py` covers a nested nontrivial
transform, exact sibling preservation, invalid selection, missing/extra
edges, pre-existing output and comment-based ambiguous XML. A new official
v2.5.0 native CLI gate constructs the nested variant from the prior
native-CLI-exported project (retaining its real OPC and opaque metadata),
requires the independent Core placement audit to show identical pre-clone
bounds, performs three-level COW, reimports with `--arrange 0 --export-stl`,
and compares native STL bounds to the independently expanded model.

**This does not cover** arbitrary depth, multi-edge DAG, unit conversions,
native GUI-saved project metadata semantics, filament/process settings,
browser integration, native/WASM G-code parity or print verification.
The native gate must pass before merging; until it does this remains a
candidate capability.

## 2026-11-21: detached three-level Core instance → private Y-vertex edit

A deliberately bounded extension to `scale_native_3mf_private_leaf.py` accepts
`--component-edges 0,0` **only when** the selected Core mesh actually has
root → middle → external mesh ancestry, the corresponding second build has
the same depth, and the occurrence-specific copy-on-write planner confirms
that the selected path is private. The original `--component-edge 0`
two-level behavior remains the default. All other multi-edge paths fail
closed rather than silently editing a different leaf.

The offline regression starts with a shared three-level chain, rejects
premature edits, detaches root/middle/mesh using the previously audited
writer, and scales only the selected mesh's local Y vertices by 1.2×.
It requires unchanged sibling world bounds, exact component identities and
transforms, identical opaque archive members and no mutation of either
source archive. The pinned official v2.5.0 CLI workflow then reopens the
Y-edited, CLI-derived three-level project with `--arrange 0` and compares
the actual exported STL geometry against independently composed Core bounds.
Native project and preset payloads stay ephemeral in CI.

**Scope is geometry-only.** This does not validate general GUI-saved 3MF
metadata interpretation, nonzero component indices, branched graphs,
additional nesting, official-native vs WASM G-code equivalence, published
Pages slicing or real-world printing. A green CI run is required before
considering the narrow acceptance gate complete.

## 2026-11-21: fail-closed cloned Core object identity annotations

The two- and three-level native Core Copy-on-Write helpers now refuse to
clone a root, middle or external mesh carrying per-object Core
`<metadata>`, foreign-namespace child elements or *unknown vendor*
identity-bearing attributes (for example, `uuid`, `guid`,
`unique_id`, `instance_id`). Copying those declarations verbatim can
make detached resources reuse opaque identifiers belonging to their source.

The **standard 3MF Production Extension `p:UUID`** is a supported,
well-defined exception: a cloned Core `object` and its cloned
`component` edge each receive a fresh lowercase RFC 4122 UUIDv4, while
the original object/component bytes and untouched build item identifiers
remain unchanged. Its namespace binding and old value must be unambiguous.
This is required by the 3MF Production Extension Chapter 4; the first
PR CI run revealed that the official OrcaSlicer v2.5.0 CLI exports
`p:UUID` on external mesh objects, which made the initial
blanket-UUID refusal reject an otherwise supported fixture.
The correction regenerates those known-standard identifiers instead.

The offline regression now checks annotations on each of the three
cloned resources, an unknown extension element, a benign Core `name`
field and five distinct original/renewed Production object/component UUIDs.
The pinned native CLI gate also reimports the real exported project.
The native workflow trigger includes the shared-leaf helper because
the root and middle writers import it.

Out-of-object references in `Metadata/model_settings.config`, other
vendor files, and unrecognized identifier naming schemes remain
uninterpreted. The Production UUID renewal and opaque-annotation guard do **not**
prove complete semantic metadata integrity, general GUI-authored 3MF
support or physical print safety.

## 2026-11-21: bounded two-edge shared-root COW candidate (offline)

An additional, **experimental and unpublished** Core writer,
`scripts/clone_native_3mf_branched_root.py`, handles precisely two build
items that share a **single main-part root with two component edges referencing
the same external mesh**. The user-selected edge (0 or 1) in build item 1 is
isolated by copying the external mesh and root, redirecting only that cloned
edge, and redirecting only build item 1. The other three mesh occurrences
continue to reference the original external mesh. Any other topology is
rejected; this does not generalize to multiple distinct meshes or 3MF DAGs.

The writer preserves the original archive, original root bytes and all
non-target ZIP payloads. It validates the independently composed world-space
bounds of all four mesh occurrences before/after and requires that the
selected occurrence has no remaining shared Core object on its ancestry.
Any standard Production `p:UUID` on the **cloned root and BOTH cloned
component occurrences**, including the unretargeted branch, is regenerated;
opaque object identities are rejected. Otherwise, duplicating the untouched
branch's Production UUID would silently create an invalid identity collision.

The lightweight 3MF CI gate covers both component selections, UUID uniqueness,
preserved non-target resources, invalid indices, unsafe graphs and ambiguous
identities. The [pinned v2.5.0 native CLI acceptance run #44829047039](https://github.com/temesotejam/layer-workbench/actions/runs/44829047039)
also passed: it adds a second displaced Core edge to a **real official
CLI-export-derived project**, detaches edge 1 of the second build, reopens the
archive in the official AppImage with auto-arrangement disabled, and checks
all **four exported 12-facet mesh occurrences** against independently
composed XYZ bounds. The repeated source edge is a deliberately synthesized
fixture; this is not an OrcaSlicer GUI-saved branching project.

The success demonstrates this one geometry-only native reimport, **not**
complete 3MF vendor-metadata semantics, non-identical child meshes,
multi-edge DAGs, arbitrary GUI projects, native-vs-WASM G-code parity,
browser editing, or any assurance that generated output can be printed.


## 2026-11-21: bounded COW for two distinct external mesh branches

The offline `clone_native_3mf_branched_root.py` writer now also accepts a
two-edge shared main Core root whose edges refer to **different external mesh
parts and object IDs**. Previously it required both edges to instantiate the
same leaf. The selected build item (index 1) and one selected edge (0 or 1)
are isolated by cloning that external leaf and the shared main root; the
unselected sibling edge keeps its original part and ID. The read-only planner
must report exactly two visits to each selected leaf/root in the distinct
case, or four leaf visits/two root visits in the original repeated-leaf case.

Offline regressions exercise both edge indices with distinguishable mesh
geometries. They verify all four pre/post world-space occurrences, unchanged
sibling identifiers and bytes, original source preservation, ZIP metadata
preservation, and refusal to edit still-shared sibling meshes. Existing
identical-leaf and official v2.5.0 CLI acceptance checks remain in place.

This extension does **not** prove that a native desktop GUI-saved project
with disparate child meshes can be round-tripped; the distinct-child fixture
is synthetic, and native CLI acceptance for that particular branch shape
remains to be added. Opaque metadata identity references, arbitrary DAG
graphs, full project fidelity, WASM/native G-code parity and print safety
are still unsupported.

## 2026-11-21: native-derived distinct-leaf 3MF reimport acceptance gate

The previous distinct-leaf COW proof covered offline synthetic archives only.
The first native acceptance attempt (PR #148, run
[#44842478620](https://github.com/temesotejam/layer-workbench/actions/runs/44842478620))
failed for a useful reason: the pinned v2.5.0 native CLI export's **two main
roots both referenced the same external mesh**. Its second OPC-related
`3D/Objects/*.model` member contained no Core resources or mesh, so it
was incorrect to assume the second root supplied a separate mesh.

`scripts/make_native_3mf_distinct_branch_fixture.py` now retains the
official-exported 3MF and uses the **existing empty, OPC-related model part**
as an explicit *synthetic* second mesh slot, populated from a cloned mesh
resource with a renewed standard Production UUID (when present). It changes
the second edge's Core `objectid` and `p:path` in the existing
official-derived shared-root test fixture. It refuses nonempty alternative
model parts, unrecognized resource structures, ambiguous relationships
and existing output destinations. All original upstream bytes remain
untouched; the test-derived 3MF has two intentionally modified ZIP members
(main Core model and the formerly empty external model). Other ZIP payloads
remain unchanged after decompression. A separately valid original export
with already-distinct external resources is also supported.

The regression suite covers standard distinct leaves, the actual shared-leaf
plus empty-slot scenario, negative shapes, archive/member preservation and
safe output refusal. The GitHub workflow then clones only the second branch,
reopens the result in the pinned official OrcaSlicer v2.5.0 CLI, exports
native STL without auto-arrangement, and verifies four nonoverlapping
12-facet occurrence bounds from an independent Core graph.

**The native reimport gate must PASS before this is considered accepted.**
This tests distinct resource identity and cross-part references, but both
mesh shapes may initially be geometrically identical. It is neither a
native GUI-exported distinct-shape fixture nor full metadata semantic
preservation, native/WASM G-code parity, public WASM deployment or
physical printing validation.

## 2026-11-21: native-derived distinct-*shape* synthetic branch gate

The next acceptance test must distinguish **two external mesh shapes**, not
merely two resource paths. `scripts/make_native_3mf_distinct_shape_fixture.py`
takes the bounded two-build/two-edge native-derived distinct-part fixture and
scales **only the second external mesh's Y vertex coordinates by 1.2**.
The first leaf, build and component transforms, ZIP comment, and all other
decompressed archive members are preserved. The second leaf is still shared
by both builds until the existing branched COW writer isolates one occurrence.

The new offline suite rejects same-path output, existing destinations and
non-distinct graphs, confirms first-leaf geometry and metadata are unchanged,
confirms both second-leaf occurrences changed, and verifies a COW clone for
each edge preserves all four shape bounds. The pinned CLI workflow then
reopens the **synthetically reshaped and detached** 3MF, exports native STL,
and compares all four 12-triangle groups against expanded Core bounds, with
an additional check for measurably different Y extents. A successful workflow
proves only this bounded native reimport geometry, not a real independently
authored second mesh, complete GUI project preservation, arbitrary 3MF DAG
semantics, native-vs-WASM G-code agreement or physical print safety.

Native CLI acceptance status must be read from the associated Actions run;
passing the Python unit tests alone does not satisfy the native gate.

## 2026-11-21: edited private mesh after distinct-shape branched COW

The new offline-only `scripts/scale_native_3mf_branched_private_leaf.py`
provides a bounded follow-up to the previous native-derived branch fixture:
after detaching **one** of the two external leaves under build item 1, it
scales the selected *private* mesh's vertex coordinates on one axis. This
separates the geometry of the selected occurrence from both build 0 and the
other branch of build 1, while preserving all three unselected occurrences.

The writer explicitly requires two build items, two direct external leaf
occurrences per build, a non-shared selected mesh object, and a safe numeric
factor in 0.5..1.5. It rejects unsupported graphs, ambiguous XML, shared
ownership, invalid axes/factors, and existing output destinations. It changes
only the selected external model-part's target mesh vertex attributes,
preserving every other decompressed ZIP member and all Core XML outside the
selected object block. The independent Core geometry inventory checks all
four instances after the change; the source file remains untouched.

The native v2.5.0 CLI workflow additionally reopens the **synthetic**
distinct-shape fixture *after both branch detachment and private Y-vertex
scaling*, exporting STLs without auto-arrangement and comparing four
12-triangle instance bounds with an independent Core expansion. This gate
does not establish complete GUI-authored 3MF interoperability, full opaque
metadata semantics, arbitrary DAG editing, WASM/native G-code equality or
printer safety. Check the PR and main GitHub Actions for actual gate results.


## 2026-11-21: direct model-settings object ID reference preflight (read-only)

The offline `scripts/audit_native_3mf_metadata_object_refs.py` reads
`3D/3dmodel.model` and `Metadata/model_settings.config` from a bounded 3MF
archive. It inventories main Core object IDs, main build object references,
direct native `<config><object id="…">` entries and the count (not meaning)
of per-object `<part>` elements. XML DTDs/entities, duplicate object IDs,
missing files and out-of-range IDs are rejected. No archive is rewritten.

In `--baseline` / `--candidate` mode it detects a specific semantic risk:
a build item retargeted to a newly cloned main Core object may lack its own
`model_settings.config` object entry even though the original build target
had one. This is surfaced as `needs_vendor_metadata_mapping`; the optional
`--fail-on-unmapped-root` flag refuses such a candidate. The checker does not
fabricate or copy vendor metadata and the existing geometry-only native 3MF
clone experiments are **not** silently promoted to metadata-safe operations.

Six synthetic offline regression tests cover the mapped/unmapped clone
distinction, non-assertion when the original had no mapping, direct part
inventory, duplicate/invalid XML, ZIP ambiguity, and source metadata-ID
continuity. They run in lightweight 3MF CI; no AppImage or WASM rebuild is
required. A matching object ID alone does not establish correct per-instance
settings, plate membership, part-ID mapping, Production UUID references,
compatibility with GUI-authored projects, or real printer safety. A native
CLI-exported sample must still be inspected separately before broadening any
writer's accepted layout.

## 2026-11-21: native CLI-produced model-settings ID reference probe

The official pinned OrcaSlicer v2.5.0 CLI verification workflow now runs the
read-only `audit_native_3mf_metadata_object_refs.py` against the actual
CLI-exported full-preset 3MF, rather than using only hand-authored XML
fixtures. It also compares that CLI project to the bounded *leaf-only*
Copy-on-Write output, with `--fail-on-unmapped-root`. It records JSON
inventories inside the ephemeral workflow run; no upstream vendor file or
binary is committed or published by the feature.

The auditor normalizes positive decimal IDs (e.g. `01` and `1` both
identify object 1), so lexical aliases can neither produce false missing
references nor evade duplicate-ID rejection. Synthetic tests cover both
cases, with the same fail-closed XML/member validation as before.

**Acceptance depends on the GitHub Actions result** for the changed workflow;
a green offline test alone does not establish native acceptance. Even when
the direct-ID comparison passes, a leaf-only copy does not change the main
build root. This narrow check therefore cannot establish preservation of
`part` IDs, copied Production UUID references, plate/instance assignments,
external mesh-specific metadata, native-vs-WASM G-code parity or GUI-saved
project semantics. Any *root* remap with source object settings but no
candidate mapping must still be refused.
