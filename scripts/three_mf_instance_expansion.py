"""Bounded, read-only expansion of same-part 3MF core component instances.

3MF stores row-major affine transforms with row vectors: a point is multiplied
by a component's transform, then its containing component, then the build item.
No STL, editing, or native OrcaSlicer equivalence is implied by this inventory.
"""
import math

IDENTITY_3MF = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0,
                0.0, 0.0, 1.0, 0.0, 0.0, 0.0]
MAX_DEPTH = 64
MAX_INSTANCES = 4096
MAX_TRANSFORM_VALUE = 1_000_000_000


def compose_3mf(inner, outer):
    """Apply inner transform, then outer, using 3MF's row-vector convention."""
    if len(inner) != 12 or len(outer) != 12:
        raise ValueError("Invalid 3MF transform composition input")
    a = [inner[0:3] + [0.0], inner[3:6] + [0.0],
         inner[6:9] + [0.0], inner[9:12] + [1.0]]
    b = [outer[0:3] + [0.0], outer[3:6] + [0.0],
         outer[6:9] + [0.0], outer[9:12] + [1.0]]
    result = [sum(a[i][k] * b[k][j] for k in range(4))
              for i in range(4) for j in range(3)]
    if not all(math.isfinite(x) and abs(x) <= MAX_TRANSFORM_VALUE for x in result):
        raise ValueError("Excessive 3MF composed transform")
    return result


def expand_scene(objects, build_items, max_instances=MAX_INSTANCES):
    """Reject component cycles, then expand build items to concrete mesh leaves.

    objects is an ID-keyed dict of core object records with `mesh` (bool),
    `triangles` (int), and `componentInstances` (list of objectId and transform3mf).
    Returns a bounded diagnostic inventory; no geometry is transformed.
    """
    if not isinstance(max_instances, int) or isinstance(max_instances, bool) or not 1 <= max_instances <= MAX_INSTANCES:
        raise ValueError("Invalid 3MF mesh instance budget")
    for obj in objects.values():
        for comp in obj["componentInstances"]:
            if comp["objectId"] not in objects:
                raise ValueError("3MF component refers to missing object")
    # Detect cycles in every resource, including unreferenced components. An
    # explicit stack avoids recursion-limit failures for untrusted XML inputs.
    visited = set()
    for root in objects:
        if root in visited:
            continue
        active = set()
        pending = [(root, False)]
        while pending:
            oid, exiting = pending.pop()
            if exiting:
                active.remove(oid)
                visited.add(oid)
                continue
            if oid in active:
                raise ValueError("Cyclic 3MF component references")
            if oid in visited:
                continue
            if len(active) >= MAX_DEPTH:
                raise ValueError("3MF component nesting exceeds depth limit")
            active.add(oid)
            pending.append((oid, True))
            pending.extend((comp["objectId"], False) for comp in reversed(objects[oid]["componentInstances"]))
    instances = []
    for i, item in enumerate(build_items):
        # The transform is composed from the mesh outward to the build item.
        pending = [(item["objectId"], item["transform3mf"], [item["objectId"]])]
        while pending:
            oid, world, path = pending.pop()
            obj = objects[oid]
            if obj["mesh"]:
                instances.append({"buildItemIndex": i, "objectId": oid,
                                  "objectPath": path, "transform3mf": world,
                                  "triangles": obj["triangles"]})
                if len(instances) > max_instances:
                    raise ValueError("3MF mesh instances exceed audit limit")
            else:
                pending.extend((comp["objectId"],
                                compose_3mf(comp["transform3mf"], world),
                                path + [comp["objectId"]])
                               for comp in reversed(obj["componentInstances"]))
    return instances
