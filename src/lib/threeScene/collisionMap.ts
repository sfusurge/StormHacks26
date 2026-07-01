import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

/** Target max dimension when normalizing room GLBs (meters). */
export const ROOM_TARGET_SIZE = 20;

export type CollisionMapData = {
  bounds: THREE.Box3;
  positions: Float32Array;
  indices: Uint32Array;
};

/** Invisible mesh with BVH for fast camera raycasts. */
export function createCameraCollisionMesh(data: CollisionMapData): THREE.Mesh {
  if (!(THREE.Mesh.prototype as any).__bvhPatched) {
    THREE.Mesh.prototype.raycast = acceleratedRaycast;
    (THREE.Mesh.prototype as any).__bvhPatched = true;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions.slice(), 3));
  // Keep typed array — Array.from() on ~5M indices freezes the main thread.
  geometry.setIndex(new THREE.BufferAttribute(data.indices.slice(), 1));
  geometry.boundsTree = new MeshBVH(geometry);

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ visible: false }));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

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
