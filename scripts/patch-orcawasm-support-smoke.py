#!/usr/bin/env python3
"""Fail-closed adjustment of a pinned OrcaWasm test fixture, NOT its engine.

The pinned generic modifier smoke previously compared an enforcer against
an *automatic* baseline that had already placed supports under the sphere.
This checks separate, role-appropriate references: a manual-support baseline
for the enforcer, and an automatic-support baseline for the blocker. The
enforcer volume is moved onto the actual sphere underside rather than its
upper rim. The blocker volume covers the entire synthetic sphere footprint
and full above-bed column so edge supports are not left outside the blocker. Output-difference and native re-import assertions remain STRICT.
Only used in disposable CI checkouts of pinned Hiosdra/OrcaWasm sources.
"""
from pathlib import Path
import sys

OLD = """function runSupportModifierSmoke(module, session, configureSession = () => {
  initSession(module, session, JSON.stringify({
    ...BASE_CONFIG,
    support_type: 'normal(auto)',
    support_threshold_angle: 45,
  }))
"""
NEW = """function runSupportModifierSmoke(module, session, configureSession = () => {
  initSession(module, session, JSON.stringify({
    ...BASE_CONFIG,
    support_enable: 1,
    support_type: 'normal(auto)',
    support_threshold_angle: 45,
  }))
"""
ASSERTION = "if (assertSupportOutputChange && !supportOutputChanged)"
ENFORCER_OLD = """    {
      role: 'support-enforcer',
      position: [9, 0, 16],
      size: [8, 8, 8],
    },"""
ENFORCER_NEW = """    {
      role: 'support-enforcer',
      position: [0, 0, 5],
      size: [16, 16, 12],
    },"""
BLOCKER_OLD = """    {
      role: 'support-blocker',
      position: [0, 0, 6],
      size: [16, 16, 12],
    },"""
BLOCKER_NEW = """    {
      role: 'support-blocker',
      // Cover the entire 10 mm radius synthetic sphere and the full
      // above-bed support column, rather than only its central 8 mm.
      // The earlier box missed supports near the sphere perimeter.
      position: [0, 0, 15],
      size: [30, 30, 30],
    },"""

LOOP_OLD = """  for (const modifier of cases) {
    const project = makeSupportModifierProject(meshBytes, modifier)"""
LOOP_NEW = """  for (const modifier of cases) {
    let referenceSupports = automaticSupports
    if (assertSupportOutputChange) {
      // Native modifier export/re-import can reinitialize the session profile.
      // Restore the generic-PLA support fixture before EACH independent case.
      configureSession()
      // Manual baseline exercises the enforcer; automatic baseline exercises
      // the blocker. Both must actually change sliced G-code (not just metadata).
      applyProfileOnce(module, session, {
        support_type: modifier.role === 'support-enforcer' ? 'normal(manual)' : 'normal(auto)',
      }, 'orca.native-json')
      projectSetObjectsOnce(module, session, baseline.blob, baseline.manifest)
      referenceSupports = sliceSupportProject(
        module, session, modifier.role + ' reference baseline')
    }
    const project = makeSupportModifierProject(meshBytes, modifier)"""
COMPARE_OLD = "    const supportOutputChanged = modifiedSupports !== automaticSupports"
COMPARE_NEW = "    const supportOutputChanged = modifiedSupports !== referenceSupports"


def apply_patch(source: str) -> str:
    if source.count(OLD) != 1:
        raise ValueError("pinned modifier smoke setup missing, changed, or already patched")
    if source.count(ASSERTION) != 1:
        raise ValueError("original support-output regression assertion missing or duplicated")
    patches = (
        (OLD, NEW, "generic support setup"),
        (ENFORCER_OLD, ENFORCER_NEW, "enforcer geometry"),
        (BLOCKER_OLD, BLOCKER_NEW, "blocker full-footprint geometry"),
        (LOOP_OLD, LOOP_NEW, "role-specific reference baseline"),
        (COMPARE_OLD, COMPARE_NEW, "reference comparison"),
    )
    for old, new, label in patches:
        if source.count(old) != 1:
            raise ValueError(f"pinned smoke {label} missing, duplicated, or already patched")
    result = source
    for old, new, _ in patches:
        result = result.replace(old, new, 1)
    if result.count(ASSERTION) != 1:
        raise ValueError("support-output regression assertion must be preserved")
    return result


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch-orcawasm-support-smoke.py <pinned/smoke-test.mjs>")
    path = Path(sys.argv[1])
    source = path.read_text(encoding="utf-8")
    path.write_text(apply_patch(source), encoding="utf-8")
    print("PASS: independent manual/auto support references with strict output and round-trip assertions")


if __name__ == "__main__":
    main()
