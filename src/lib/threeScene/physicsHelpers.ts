import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export function addStaticColliderFromMesh(world: CANNON.World, mesh: THREE.Mesh) {
  mesh.updateWorldMatrix(true, false);
  const box = new THREE.Box3().setFromObject(mesh);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) return;
  const halfExtents = new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2);
  const shape = new CANNON.Box(halfExtents);
  const body = new CANNON.Body({ mass: 0 });
  body.addShape(shape, new CANNON.Vec3(center.x, center.y, center.z));
  world.addBody(body);
}

export function addStaticTrimeshFromMesh(world: CANNON.World, mesh: THREE.Mesh) {
  const geom = mesh.geometry as THREE.BufferGeometry;
  if (!geom) return;
  const posAttr = geom.getAttribute('position');
  if (!posAttr) return;

  const positions: number[] = [];
  const indices: number[] = [];
  const v = new THREE.Vector3();
  const mat = new THREE.Matrix4();
  mat.copy(mesh.matrixWorld);

  for (let i = 0; i < posAttr.count; i++) {
    v.fromBufferAttribute(posAttr, i);
    v.applyMatrix4(mat);
    positions.push(v.x, v.y, v.z);
  }

  if (geom.index) {
    const idx = geom.index.array as Uint32Array | Uint16Array | number[];
    for (let i = 0; i < idx.length; i++) indices.push(idx[i]);
  } else {
    for (let i = 0; i < posAttr.count; i++) indices.push(i);
  }

  try {
    const trimesh = new CANNON.Trimesh(positions, indices);
    const body = new CANNON.Body({ mass: 0 });
    body.addShape(trimesh);
    world.addBody(body);
  } catch (e) {
    console.warn('Failed to create trimesh for mesh', mesh.name, e);
  }
}
