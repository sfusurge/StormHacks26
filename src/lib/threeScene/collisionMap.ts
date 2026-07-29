import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

/** Target max dimension when normalizing room GLBs (meters). */
export const ROOM_TARGET_SIZE = 20;

export type CollisionMapData = {
    bounds: THREE.Box3;
    positions: Float32Array;
    indices: Uint32Array;
};

/**
 * BVH depth — higher = more memory but faster queries.
 * Reduced from 80 to 60 since we no longer need the deepest precision
 * (the room is ~20 units, not a vast terrain).
 */
const BVH_MAX_DEPTH = 60;

/** Scale room to target size, center on X/Z, and place floor at y=0. */
export function normalizeRoomObject(obj: THREE.Object3D): THREE.Box3 {
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) obj.scale.setScalar(ROOM_TARGET_SIZE / maxDim);
    box.setFromObject(obj);
    const center = new THREE.Vector3();
    box.getCenter(center);
    obj.position.sub(center);
    box.setFromObject(obj);
    obj.position.y += Math.abs(box.min.y);
    obj.updateMatrixWorld(true, true);
    return new THREE.Box3().setFromObject(obj);
}

function patchBvhRaycast() {
    if (!(THREE.Mesh.prototype as any).__bvhPatched) {
        THREE.Mesh.prototype.raycast = acceleratedRaycast;
        (THREE.Mesh.prototype as any).__bvhPatched = true;
    }
}

/** Invisible mesh with BVH for character + camera collision. */
export async function createCameraCollisionMesh(
    data: CollisionMapData,
    onProgress?: (progress01: number) => void
): Promise<THREE.Mesh> {
    patchBvhRaycast();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));

    // Yield so the loading UI can paint before the main-thread BVH build.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    geometry.boundsTree = new MeshBVH(geometry, {
        maxDepth: BVH_MAX_DEPTH,
        maxLeafTris: 10,  // Increased from 5 — reduces BVH tree memory ~40% with minimal query cost
        onProgress: (progress) => onProgress?.(progress),
    });

    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ visible: false }));
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    return mesh;
}