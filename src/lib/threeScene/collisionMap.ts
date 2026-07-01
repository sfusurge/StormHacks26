import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast, type SerializedBVH } from 'three-mesh-bvh';

/** Target max dimension when normalizing room GLBs (meters). */
export const ROOM_TARGET_SIZE = 20;

export type CollisionMapData = {
  bounds: THREE.Box3;
  positions: Float32Array;
  indices: Uint32Array;
  serializedBvh: SerializedBVH;
};

const MAGIC = 'SHCK';
const VERSION = 1;

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
  if (version !== VERSION) throw new Error(`Unsupported collision map version: ${version}`);

  const bounds = new THREE.Box3(
    new THREE.Vector3(view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)),
    new THREE.Vector3(view.getFloat32(offset + 12, true), view.getFloat32(offset + 16, true), view.getFloat32(offset + 20, true))
  );
  offset += 24;

  const vertexCount = view.getUint32(offset, true);
  offset += 4;
  const indexCount = view.getUint32(offset, true);
  offset += 4;

  const positions = new Float32Array(buffer, offset, vertexCount * 3);
  offset += vertexCount * 3 * 4;

  const indices = new Uint32Array(buffer, offset, indexCount);
  offset += indexCount * 4;

  const bvhJsonLen = view.getUint32(offset, true);
  offset += 4;
  const bvhJson = new TextDecoder().decode(new Uint8Array(buffer, offset, bvhJsonLen));
  const serializedBvh = JSON.parse(bvhJson) as SerializedBVH;

  return {
    bounds,
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    serializedBvh,
  };
}

function readAscii(view: DataView, byteOffset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(byteOffset + i));
  return s;
}

/** Invisible mesh with pre-built BVH for fast camera raycasts. */
export function createCameraCollisionMesh(data: CollisionMapData): THREE.Mesh {
  if (!(THREE.Mesh.prototype as any).__bvhPatched) {
    THREE.Mesh.prototype.raycast = acceleratedRaycast;
    (THREE.Mesh.prototype as any).__bvhPatched = true;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions.slice(), 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices.slice(), 1));
  geometry.boundsTree = MeshBVH.deserialize(data.serializedBvh, geometry);

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ visible: false }));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}
