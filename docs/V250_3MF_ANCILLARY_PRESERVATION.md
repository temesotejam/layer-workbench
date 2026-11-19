# v2.5.0 Core 3MF: ancillary member preservation gate

This **read-only, development-only audit** compares decompressed ZIP member
bytes between 3MF archives. It neither edits projects nor proves desktop parity.

`python3 scripts/compare_3mf_metadata.py --baseline before.3mf --candidate after.3mf --scope ancillary`

- `all` (default) compares all members, including geometry/model XML.
- `metadata` keeps its historical narrow `Metadata/` meaning.
- `ancillary` compares all members except `3D/*.model`. This includes
  `[Content_Types].xml`, OPC `_rels/.rels`, textures, settings and unknown
  vendor assets regardless of their directory. Editing a model build transform
  is thus allowed while any changed/missing/added other member **FAILS**.
- A pair containing no non-model members except mandatory
  `[Content_Types].xml` is rejected as a vacuous match.
- ZIP member order/compression may differ; raw decompressed content must not.

The existing ZIP limits and path/symlink/duplicate/encryption checks apply to
both archives. This comparison cannot detect metadata embedded inside
`3D/*.model`, semantic broken references or loss of model geometry. A PASS
is not a native OrcaSlicer 3MF round-trip or print-safety certification.

The accepted isolated-Chrome Core-fixture workflow now also checks ancillary
preservation after the independent surgical translation, Z rotation and local
scale tests, and retains JSON reports. The synthetic fixture has an OPC
relationship but is not an OrcaSlicer desktop project. Unit tests exercise
opaque textures/vendor data and ensure that the narrower `metadata` mode
cannot silently claim broader coverage.
