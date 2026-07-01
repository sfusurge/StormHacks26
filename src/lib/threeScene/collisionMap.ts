import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

/** Target max dimension when normalizing room GLBs (meters). */
export const ROOM_TARGET_SIZE = 20;

export type CollisionMapData = {
  bounds: THREE.Box3;
  positions: Float32Array;
  indices: Uint32Array;
};

const MAGIC = 'SHCK';
const VERSION = 2;
/** Large room meshes need a deeper BVH than the library default (40). */
const BVH_MAX_DEPTH = 80;

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

export async function loadCollisionMap(url: string): Promise<CollisionMapData> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load collision map: ${response.status}`);
  const buffer = await response.arrayBuffer();
  return decodeCollisionMap(buffer);
}

export function decodeCollisionMap(buffer: ArrayBuffer): CollisionMapData {
  const view = new DataView(buffer);
  let offset = 0;

  const magic = readAscii(view, offset, 4);
  offset += 4;
  if (magic !== MAGIC) throw new Error(`Invalid collision map magic: ${magic}`);

  const version = view.getUint32(offset, true);
  offset += 4;
  if (version !== 1 && version !== 2) {
    throw new Error(`Unsupported collision map version: ${version}`);
  }

  const bounds = new THREE.Box3(
    new THREE.Vector3(view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)),
    new THREE.Vector3(view.getFloat32(offset + 12, true), view.getFloat32(offset + 16, true), view.getFloat32(offset + 20, true))
  );
  offset += 24;

  const vertexCount = view.getUint32(offset, true);
  offset += 4;
  const indexCount = view.getUint32(offset, true);
  offset += 4;

  const positions = new Float32Array(vertexCount * 3);
  positions.set(new Float32Array(buffer, offset, vertexCount * 3));
  offset += vertexCount * 3 * 4;

  const indices = new Uint32Array(indexCount);
  indices.set(new Uint32Array(buffer, offset, indexCount));
  offset += indexCount * 4;

  // v1 files embed a broken pre-baked BVH JSON blob — skip it; we rebuild at load.
  if (version === 1) {
    const bvhJsonLen = view.getUint32(offset, true);
    offset += 4 + bvhJsonLen;
  }

  return { bounds, positions, indices };
}

function readAscii(view: DataView, byteOffset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(byteOffset + i));
  return s;
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
    maxLeafTris: 5,
    onProgress: (progress) => onProgress?.(progress),
  });

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ visible: false }));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
