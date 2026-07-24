import * as THREE from 'three';
import { mergeRoomMeshesByMaterial } from './mergeRoomMeshes';

/**
 * Simple geometric decimation - removes triangles based on area threshold
 * Removes smallest triangles first to preserve silhouette
 */
function decimateGeometry(geometry: THREE.BufferGeometry, targetRatio: number): THREE.BufferGeometry {
  const decimated = geometry.clone();
  
  if (!decimated.attributes.position) return decimated;
  
  const posAttr = decimated.attributes.position;
  const indexAttr = decimated.index;
  
  // If no index, create one
  if (!indexAttr) {
    decimated.computeBoundingBox();
    return decimated;
  }
  
  const indices = indexAttr.array as Uint32Array | Uint16Array;
  const positions = posAttr.array as Float32Array;
  
  // Calculate per-triangle area and mark for removal
  const triangleAreas: { index: number; area: number }[] = [];
  
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;
    
    const v0 = new THREE.Vector3(positions[i0], positions[i0 + 1], positions[i0 + 2]);
    const v1 = new THREE.Vector3(positions[i1], positions[i1 + 1], positions[i1 + 2]);
    const v2 = new THREE.Vector3(positions[i2], positions[i2 + 1], positions[i2 + 2]);
    
    const edge1 = v1.sub(v0);
    const edge2 = v2.sub(v0);
    const area = edge1.cross(edge2).length() / 2;
    
    triangleAreas.push({ index: i, area });
  }
  
  // Sort by area and remove smallest triangles
  triangleAreas.sort((a, b) => a.area - b.area);
  const removeCount = Math.floor(triangleAreas.length * (1 - targetRatio));
  const indicesToRemove = new Set(triangleAreas.slice(0, removeCount).map(t => t.index));
  
  // Build new index array excluding removed triangles
  const newIndices: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    if (!indicesToRemove.has(i)) {
      newIndices.push(indices[i], indices[i + 1], indices[i + 2]);
    }
  }
  
  decimated.setIndex(new THREE.BufferAttribute(new Uint32Array(newIndices), 1));
  decimated.computeBoundingSphere();
  
  return decimated;
}

/**
 * Creates a simplified version of a geometry at a specific detail ratio
 * Higher ratio = more details (1.0 = full detail, 0.2 = 20% polygons)
 */
export function createSimplifiedGeometry(geometry: THREE.BufferGeometry, detailRatio: number): THREE.BufferGeometry {
  if (detailRatio >= 0.99) return geometry; // Don't simplify if nearly full detail
  return decimateGeometry(geometry, detailRatio);
}

/**
 * Creates a simplified version of a mesh hierarchy at a specific detail level
 * Returns a cloned object tree with simplified geometries
 */
export function createSimplifiedScene(
  root: THREE.Object3D,
  detailRatio: number,
  shouldExclude: (node: THREE.Object3D) => boolean = () => false
): THREE.Object3D {
  const simplified = root.clone(true);
  
  simplified.traverse(node => {
    if (!(node as THREE.Mesh).isMesh) return;
    if (shouldExclude(node)) return;
    
    const mesh = node as THREE.Mesh;
    if (!mesh.geometry?.attributes?.position) return;
    
    const simplifiedGeom = createSimplifiedGeometry(mesh.geometry, detailRatio);
    mesh.geometry = simplifiedGeom;
  });
  
  return simplified;
}

/**
 * Creates an LOD object from a room scene
 * High detail (close) -> Medium detail (mid distance) -> Low detail (far)
 */
export function createRoomLOD(
  originalScene: THREE.Object3D,
  animatedNodeNames: Set<string>
): THREE.LOD & { highDetailMesh?: THREE.Object3D } {
  const lod = new THREE.LOD();
  
  // Level 0: Full detail (0-8 units from camera)
  const highDetail = originalScene.clone(true);
  highDetail.name = 'LOD_HIGH';
  mergeRoomMeshesByMaterial(
    highDetail,
    (node) => animatedNodeNames.has(node.name)
  );
  lod.addLevel(highDetail, 8);
  
  // Level 1: Medium detail (8-25 units from camera) - 60% polygons
  const mediumDetail = createSimplifiedScene(
    originalScene,
    0.6,
    (node) => animatedNodeNames.has(node.name)
  );
  mediumDetail.name = 'LOD_MEDIUM';
  mergeRoomMeshesByMaterial(
    mediumDetail,
    (node) => animatedNodeNames.has(node.name)
  );
  lod.addLevel(mediumDetail, 25);
  
  // Level 2: Low detail (25+ units from camera) - 30% polygons
  const lowDetail = createSimplifiedScene(
    originalScene,
    0.3,
    (node) => animatedNodeNames.has(node.name)
  );
  lowDetail.name = 'LOD_LOW';
  mergeRoomMeshesByMaterial(
    lowDetail,
    (node) => animatedNodeNames.has(node.name)
  );
  lod.addLevel(lowDetail, 25); // Will use when camera > 25 units
  
  // Store reference to high-detail merged mesh for collision
  (lod as any).highDetailMesh = highDetail;
  
  return lod as any;
}

/**
 * Creates a mobile-optimized LOD with even lower detail levels
 * For devices with <500MB heap size
 */
export function createMobileLOD(
  originalScene: THREE.Object3D,
  animatedNodeNames: Set<string>
): THREE.LOD & { highDetailMesh?: THREE.Object3D } {
  const lod = new THREE.LOD();
  
  // Level 0: Medium detail (0-6 units)
  const mediumDetail = createSimplifiedScene(
    originalScene,
    0.6,
    (node) => animatedNodeNames.has(node.name)
  );
  mediumDetail.name = 'LOD_MEDIUM';
  mergeRoomMeshesByMaterial(
    mediumDetail,
    (node) => animatedNodeNames.has(node.name)
  );
  lod.addLevel(mediumDetail, 6);
  
  // Level 1: Low detail (6+ units)
  const lowDetail = createSimplifiedScene(
    originalScene,
    0.2,
    (node) => animatedNodeNames.has(node.name)
  );
  lowDetail.name = 'LOD_LOW';
  mergeRoomMeshesByMaterial(
    lowDetail,
    (node) => animatedNodeNames.has(node.name)
  );
  lod.addLevel(lowDetail, 6);
  
  // Store reference to high-detail merged mesh (medium detail on mobile)
  (lod as any).highDetailMesh = mediumDetail;
  
  return lod as any;
}

/**
 * For best performance, dispose of unused LOD levels when they're not needed
 */
export function disposeLODLevel(level: THREE.Object3D) {
  level.traverse(node => {
    if ((node as THREE.Mesh).isMesh) {
      const mesh = node as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(m => m.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    }
  });
}

/**
 * Creates simplified collision geometry at the specified detail ratio
 * Returns { positions, indices } suitable for physics/collision
 */
export function createSimplifiedCollisionGeometry(
  positions: Float32Array,
  indices: Uint32Array,
  detailRatio: number
): { positions: Float32Array; indices: Uint32Array } {
  if (detailRatio >= 0.99) {
    return { positions, indices };
  }

  // Calculate per-triangle areas and mark small ones for removal
  const triangleAreas: { triIndex: number; area: number }[] = [];

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;

    const v0x = positions[i0],
      v0y = positions[i0 + 1],
      v0z = positions[i0 + 2];
    const v1x = positions[i1],
      v1y = positions[i1 + 1],
      v1z = positions[i1 + 2];
    const v2x = positions[i2],
      v2y = positions[i2 + 1],
      v2z = positions[i2 + 2];

    const e1x = v1x - v0x,
      e1y = v1y - v0y,
      e1z = v1z - v0z;
    const e2x = v2x - v0x,
      e2y = v2y - v0y,
      e2z = v2z - v0z;

    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;

    const area = Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
    triangleAreas.push({ triIndex: i / 3, area });
  }

  // Sort by area (smallest first) and mark for removal
  triangleAreas.sort((a, b) => a.area - b.area);
  const removeCount = Math.floor(triangleAreas.length * (1 - detailRatio));
  const indicesToRemove = new Set(
    triangleAreas.slice(0, removeCount).map(t => t.triIndex)
  );

  // Build new indices excluding removed triangles
  const newIndices: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const triIndex = i / 3;
    if (!indicesToRemove.has(triIndex)) {
      newIndices.push(indices[i], indices[i + 1], indices[i + 2]);
    }
  }

  // Rebuild position array with only referenced vertices
  const usedVertices = new Set<number>();
  for (const idx of newIndices) {
    usedVertices.add(idx);
  }

  const vertexMap = new Map<number, number>();
  const newPositions: number[] = [];
  let newVertexIndex = 0;

  for (let i = 0; i < positions.length; i += 3) {
    const vertexIdx = i / 3;
    if (usedVertices.has(vertexIdx)) {
      vertexMap.set(vertexIdx, newVertexIndex++);
      newPositions.push(positions[i], positions[i + 1], positions[i + 2]);
    }
  }

  // Remap indices to new vertex indices
  const remappedIndices = newIndices.map(idx => vertexMap.get(idx)!);

  return {
    positions: new Float32Array(newPositions),
    indices: new Uint32Array(remappedIndices),
  };
}

/**
 * Manager for collision LOD - switches collision geometry based on camera distance
 * Much more efficient than visual LOD since collision doesn't need BVH rebuild
 */
export class CollisionLODManager {
  private collisionLevels: Array<{ mesh: THREE.Mesh; distance: number }> = [];
  private currentCollisionMesh: THREE.Mesh | null = null;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Add a collision level. Lower ratios = simpler geometry
   * distance: switches to this level when camera is further than this distance
   */
  addLevel(mesh: THREE.Mesh, distance: number) {
    this.collisionLevels.push({ mesh, distance });
    this.collisionLevels.sort((a, b) => a.distance - b.distance);
    
    // Hide all initially
    mesh.visible = false;
    this.scene.add(mesh);
    
    if (!this.currentCollisionMesh) {
      this.currentCollisionMesh = mesh;
      mesh.visible = false; // Keep invisible, we only use it for raycasting
    }
  }

  /**
   * Update collision mesh based on camera distance to target
   * Called each frame in animate loop
   */
  update(cameraPos: THREE.Vector3, targetPos: THREE.Vector3) {
    const distance = cameraPos.distanceTo(targetPos);
    let targetMesh = this.collisionLevels[0]?.mesh;

    for (const level of this.collisionLevels) {
      if (distance >= level.distance) {
        targetMesh = level.mesh;
      }
    }

    if (targetMesh && targetMesh !== this.currentCollisionMesh) {
      if (this.currentCollisionMesh) {
        this.currentCollisionMesh.visible = false;
      }
      this.currentCollisionMesh = targetMesh;
      this.currentCollisionMesh.visible = false;
    }
  }

  getCurrentMesh(): THREE.Mesh | null {
    return this.currentCollisionMesh;
  }

  dispose() {
    for (const level of this.collisionLevels) {
      if (level.mesh.geometry) level.mesh.geometry.dispose();
      if (level.mesh.material) {
        if (Array.isArray(level.mesh.material)) {
          level.mesh.material.forEach(m => m.dispose());
        } else {
          level.mesh.material.dispose();
        }
      }
      this.scene.remove(level.mesh);
    }
    this.collisionLevels = [];
    this.currentCollisionMesh = null;
  }
}
