import * as THREE from 'three';
import { mergeRoomMeshesByMaterial } from './mergeRoomMeshes';
import { isPortalMesh } from './portalFlipbook';

/**
 * Creates a single merged room group (no LOD cloning).
 *
 * The previous implementation cloned the entire scene 2-3× for LOD levels,
 * duplicating all geometry, materials, and textures in RAM.  Since this is a
 * room-scale environment (~20 units) with the camera always relatively close,
 * LOD transitions were barely visible.  A single merged mesh is sufficient.
 *
 * Returns a THREE.Group with a `highDetailMesh` property for collision.
 */
export function createSingleMergedRoom(
  originalScene: THREE.Object3D,
  animatedNodeNames: Set<string>
): THREE.Group & { highDetailMesh?: THREE.Object3D } {
  const group = new THREE.Group();

  // Merge static meshes by material to minimize draw calls.
  // Animated nodes (portal flipbook frames, etc.) are excluded from merging.
  const merged = originalScene.clone(true);
  merged.name = 'MERGED_ROOM';
  mergeRoomMeshesByMaterial(
    merged,
    (node) => animatedNodeNames.has(node.name) || isPortalMesh(node)
  );

  group.add(merged);

  // Store reference for collision extraction (mirrors old LOD API)
  (group as any).highDetailMesh = merged;

  return group as any;
}

/**
 * Dispose all geometry and materials in a scene subtree.
 * Used to free the original source scene after collision data is extracted.
 */
export function disposeSceneGraph(root: THREE.Object3D) {
  root.traverse(node => {
    if (!(node as THREE.Mesh).isMesh) return;
    if (isPortalMesh(node)) return;
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
}

