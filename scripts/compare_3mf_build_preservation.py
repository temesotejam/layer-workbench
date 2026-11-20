#!/usr/bin/env python3
"""Strict, read-only Core 3MF byte-preservation gate for ONE build-item edit.

Compare complete ZIP payloads, ignoring only the numeric value of a Core
<build><item transform="..."> attribute. This is NOT native OrcaSlicer parity.
"""
import argparse
import json
import math
from pathlib import Path
import re
import sys
import zipfile
from xml.parsers import expat

from compare_3mf_metadata import compare, inventory

CORE = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
MODEL_PART = "3D/3dmodel.model"
MAX_TAG_BYTES = 8192
# The leading whitespace rules out vendor:transform, data-transform and text.
TRANSFORM_ATTRIBUTE = re.compile(
    rb'\s+transform\s*=\s*(?P<q>["\x27])(?P<value>[^"\x27]*)(?P=q)'
)
MASK = b"__CORE_3MF_BUILD_TRANSFORM_VALUE__"
IDENTITY = (1.0, 0.0, 0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, 1.0, 0.0, 0.0, 0.0)


def valid_transform(raw):
    try:
        values = tuple(float(token) for token in raw.split())
    except (ValueError, OverflowError) as exc:
        raise ValueError("Invalid Core 3MF build transform") from exc
    if len(values) != 12 or any(not math.isfinite(n) or abs(n) > 1e6 for n in values):
        raise ValueError("Invalid or excessive Core 3MF build transform")
    a, b, c, d, e, f, g, h, i = values[:9]
    determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
    if not math.isfinite(determinant) or abs(determinant) < 1e-10:
        raise ValueError("Singular Core 3MF build transform")
    return values


def start_tag_end(data, start):
    if data[start:start + 1] != b"<":
        raise ValueError("Cannot locate Core 3MF XML start tag")
    quote = None
    for index in range(start, min(len(data), start + MAX_TAG_BYTES)):
        char = data[index]
        if quote is not None:
            if char == quote:
                quote = None
        elif char in (34, 39):
            quote = char
        elif char == 62:  # >
            return index + 1
    raise ValueError("Unsupported long/unterminated Core 3MF start tag")


def mask_build_transforms(data):
    """Return exact original XML bytes with ONLY Core build transform values masked.

    Every other byte, including unknown vendor XML, processing instructions,
    comments, geometry, namespace prefixes and whitespace, remains untouched.
    """
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise ValueError("DTD and XML entities are unsupported in this audit")
    parser = expat.ParserCreate(namespace_separator="}")
    path = []
    spans = []
    placements = []

    def begin(tag, attributes):
        path.append(tag)
        if path != [CORE + "}model", CORE + "}build", CORE + "}item"]:
            return
        raw = attributes.get("transform")
        if raw is None:
            placements.append(None)
            return
        start = parser.CurrentByteIndex
        end = start_tag_end(data, start)
        matches = list(TRANSFORM_ATTRIBUTE.finditer(data[start:end]))
        if len(matches) != 1:
            raise ValueError("Ambiguous Core 3MF build transform attribute")
        match = matches[0]
        try:
            raw_bytes = match.group("value").decode("ascii")
        except UnicodeDecodeError as exc:
            raise ValueError("Non-ASCII Core 3MF transform") from exc
        if raw != raw_bytes:
            raise ValueError("Escaped Core 3MF transform is unsupported")
        placements.append(valid_transform(raw_bytes))
        spans.append((start + match.start("value"), start + match.end("value")))

    def end(tag):
        if not path or path[-1] != tag:
            raise ValueError("Unexpected 3MF XML nesting")
        path.pop()

    parser.StartElementHandler = begin
    parser.EndElementHandler = end
    try:
        parser.Parse(data, True)
    except expat.ExpatError as exc:
        raise ValueError("Invalid Core 3MF model XML") from exc
    if not placements:
        raise ValueError("No Core 3MF build items in model part")
    chunks = []
    cursor = 0
    for start, end in spans:
        if start < cursor or start >= end:
            raise ValueError("Overlapping Core 3MF transform spans")
        chunks.extend((data[cursor:start], MASK))
        cursor = end
    chunks.append(data[cursor:])
    return b"".join(chunks), placements


def strip_single_appended_implicit_transform(data, item_index):
    """Independently undo ONLY a canonical appended Core transform attribute.

    This proves an implicit identity acquired exactly one attribute, with
    every other model XML byte retained. Other attribute edits fail closed.
    """
    parser = expat.ParserCreate(namespace_separator="}")
    path, found = [], None
    seen = 0

    def begin(tag, attrs):
        nonlocal found, seen
        path.append(tag)
        if path != [CORE + "}model", CORE + "}build", CORE + "}item"]:
            return
        if seen == item_index:
            if "transform" not in attrs:
                raise ValueError("Expected an added explicit build transform")
            start = parser.CurrentByteIndex
            end = start_tag_end(data, start)
            raw = data[start:end]
            matches = list(TRANSFORM_ATTRIBUTE.finditer(raw))
            if len(matches) != 1:
                raise ValueError("Ambiguous added Core build transform")
            match = matches[0]
            # The surgical editor appends exactly one ASCII double-quoted
            # attribute directly before > or />, never reserializes the tag.
            expected = b' transform="' + match.group("value") + b'"'
            closing = len(raw) - (2 if raw.endswith(b'/>') else 1)
            # Existing XML whitespace before /> must survive untouched.
            # The regex consumes it together with the newly inserted space:
            # delete only the FINAL space + attribute, never the old spaces.
            if not match.group(0).endswith(expected) or match.end() != closing:
                raise ValueError("Noncanonical added Core build attribute")
            if found is not None:
                raise ValueError("Ambiguous selected Core build item")
            found = (start + match.end() - len(expected), start + match.end())
        seen += 1

    def end(tag):
        if not path or path[-1] != tag:
            raise ValueError("Unexpected 3MF XML nesting")
        path.pop()

    parser.StartElementHandler = begin
    parser.EndElementHandler = end
    try:
        parser.Parse(data, True)
    except expat.ExpatError as exc:
        raise ValueError("Invalid Core 3MF model XML") from exc
    if found is None:
        raise ValueError("Selected build item is missing")
    return data[:found[0]] + data[found[1]:]


def compare_build_preservation(baseline, candidate):
    # The existing bounded streaming inventory checks paths, ZIP duplicates,
    # symlinks, compressed input integrity and decompressed-size limits.
    before = inventory(baseline)
    after = inventory(candidate)
    for manifest in (before, after):
        model_parts = [name for name in manifest if name.startswith("3D/")
                       and name.lower().endswith(".model")]
        if model_parts != [MODEL_PART]:
            raise ValueError("Only one 3D/3dmodel.model Core part is supported")
    # This also validates every non-model member, including opaque extensions.
    ancillary = compare(baseline, candidate, "ancillary")
    with zipfile.ZipFile(baseline) as archive:
        original_xml = archive.read(MODEL_PART)
    with zipfile.ZipFile(candidate) as archive:
        edited_xml = archive.read(MODEL_PART)
    original_masked, old = mask_build_transforms(original_xml)
    edited_masked, new = mask_build_transforms(edited_xml)
    same_structure = original_masked == edited_masked and len(old) == len(new)
    changes = [
        {"build_index": i, "before": list(left) if left else None,
         "after": list(right) if right else None}
        for i, (left, right) in enumerate(zip(old, new))
        if left != right
    ]
    # A missing transform denotes identity in Core 3MF. Permit precisely one
    # implicit-to-explicit edit if independently removing the added attribute
    # recreates ALL original model bytes, without weakening explicit edits.
    if not same_structure and len(changes) == 1:
        index = changes[0]["build_index"]
        if old[index] is None and new[index] is not None and new[index] != IDENTITY:
            try:
                same_structure = (
                    strip_single_appended_implicit_transform(edited_xml, index)
                    == original_xml
                )
            except ValueError:
                same_structure = False
    # Exactly one semantic placement change is required, not a no-op.
    semantic_change = len(changes) == 1 and not (
        old[changes[0]["build_index"]] is None and
        new[changes[0]["build_index"]] == IDENTITY
    )
    match = ancillary["match"] and same_structure and semantic_change
    return {
        "baseline": str(baseline), "candidate": str(candidate),
        "scope": "one-core-build-transform",
        "match": match, "model_bytes_unchanged_except_build_transform": same_structure,
        "changed_build_items": changes,
        "ancillary_match": ancillary["match"],
        "ancillary_missing": ancillary["missing"],
        "ancillary_added": ancillary["added"],
        "ancillary_changed": ancillary["changed"],
        "limitations": (
            "Exact decompressed XML byte preservation excluding one explicit "
            "Core build-item transform value or exactly one appended implicit-"
            "identity transform attribute, plus ancillary ZIP members. "
            "Only one model part is supported. This does not establish semantic "
            "3MF equivalence, OrcaSlicer desktop round-trip or printer safety."
        ),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        report = compare_build_preservation(args.baseline, args.candidate)
    except (ValueError, OSError, zipfile.BadZipFile, RuntimeError, EOFError) as exc:
        print(f"Core 3MF preservation audit error: {exc}", file=sys.stderr)
        return 2
    output = json.dumps(report, indent=2)
    if args.report:
        args.report.write_text(output + "\n", encoding="utf-8")
    else:
        print(output)
    return 0 if report["match"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
