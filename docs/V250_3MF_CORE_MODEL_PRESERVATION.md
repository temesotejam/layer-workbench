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
