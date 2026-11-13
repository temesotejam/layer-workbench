// Read-only split of ThreeMFLoader's top-level 3MF <build> entries.
// Three.js r180 constructs exactly one direct child per build item.
// This does not split native mesh resources or claim to preserve Orca metadata.
export function get3mfViewportBuildItems(root, maxItems = 64) {
  if (!root?.isGroup || !Array.isArray(root.children))
    throw new Error("Expected a ThreeMFLoader project group.");
  if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 64)
    throw new Error("Invalid local 3MF build-item limit.");
  if (!root.children.length || root.children.length > maxItems)
    throw new Error("3MF build item count is empty or exceeds the local viewer limit.");
  return root.children.map((object, index) => {
    if (!object?.isObject3D || typeof object.traverse !== "function")
      throw new Error("3MF build item is not a renderable scene node.");
    let meshCount = 0;
    object.traverse(node => {
      if (node.isMesh && node.geometry?.attributes?.position?.count > 0) meshCount++;
    });
    if (meshCount === 0) throw new Error("3MF build item " + (index + 1) + " has no mesh.");
    return {object, buildIndex: index + 1, meshCount};
  });
}
