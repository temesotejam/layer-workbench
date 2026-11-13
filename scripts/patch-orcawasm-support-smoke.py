#!/usr/bin/env python3
"""Fail-closed adjustment of a pinned OrcaWasm test fixture, NOT its engine.

The generic support-modifier smoke scenario must explicitly enable support
generation; Orca's implicit config default is not an acceptance criterion.
The output-difference and native round-trip assertions remain unchanged.
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


def apply_patch(source: str) -> str:
    if source.count(OLD) != 1:
        raise ValueError("pinned modifier smoke setup missing, changed, or already patched")
    if source.count(ASSERTION) != 1:
        raise ValueError("original support-output regression assertion missing or duplicated")
    result = source.replace(OLD, NEW, 1)
    if result.count(ASSERTION) != 1:
        raise ValueError("support-output regression assertion must be preserved")
    return result


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch-orcawasm-support-smoke.py <pinned/smoke-test.mjs>")
    path = Path(sys.argv[1])
    source = path.read_text(encoding="utf-8")
    path.write_text(apply_patch(source), encoding="utf-8")
    print("PASS: generic modifier smoke explicitly enables supports; strict assertion unchanged")


if __name__ == "__main__":
    main()
