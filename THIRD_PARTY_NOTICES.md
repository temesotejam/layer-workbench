# Third-party notices

This file records upstream projects considered for this workspace. It must be updated whenever code, binaries, profiles, or other assets from a third party are copied or bundled.

## Upstream desktop slicer

- Project: OrcaSlicer
- Upstream repository: https://github.com/OrcaSlicer/OrcaSlicer
- Upstream license: GNU AGPL-3.0.
- Current stable integration target: v2.5.0 (not yet ported into this workspace).
- No claim of affiliation, endorsement, or official status is made.

## WebAssembly engine candidate

- Project: OrcaWasm
- Upstream repository: https://github.com/Hiosdra/OrcaWasm
- Its current README identifies the engine source base as OrcaSlicer v2.4.2.
- Its repository includes an AGPL-3.0 license and a third-party notices file; verify the exact license and all included dependency notices at the pinned revision before incorporating code or artifacts.
- The engine is a headless slicing engine, not the original desktop UI.
- Its current documented API is one-slicer-api 0.7.0. Runtime capabilities must be queried; optional exported functions do not prove feature support.
- The existing build requires pthreads/SharedArrayBuffer and a cross-origin-isolated page.

## Required maintenance

For every incorporated upstream component, record:
- exact repository and revision/tag;
- license identifier and included license text;
- copyright and attribution notices;
- modifications made locally;
- source code availability and corresponding-source obligations, where applicable.

Do not remove upstream copyright notices or present upstream work as original work.
