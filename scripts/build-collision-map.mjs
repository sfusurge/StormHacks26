/**
 * Offline collision bake: normalize room like runtime, extract trimesh + BVH, write .collision.bin
 * Run after changing room_foundation.glb: pnpm collision
 */
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOM_TARGET_SIZE = 20;
const MAGIC = 'SHCK';
const VERSION = 2;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const glbPath = path.join(root, 'assets/models/room_foundation.glb');
const outPath = path.join(root, 'assets/collision/room_foundation.collision.bin');

function normalizeRoomObject(obj) {
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

function mergeRoomMeshesByMaterial(rootObj) {
  const groups = new Map();
  const meshesToRemove = [];

  rootObj.traverse((node) => {
    if (!node.isMesh) return;
    const mesh = node;
    if (!mesh.geometry?.attributes?.position) return;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!material) return;
    const key = material.uuid;
    if (!groups.has(key)) groups.set(key, { material, geoms: [] });
    const geom = mesh.geometry.clone();
    mesh.updateWorldMatrix(true, false);
    geom.applyMatrix4(mesh.matrixWorld);
    groups.get(key).geoms.push(geom);
    meshesToRemove.push(mesh);
  });

  const mergedMeshes = [];
  for (const { material, geoms } of groups.values()) {
    if (geoms.length === 0) continue;
    const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.identity();
    mergedMeshes.push(mesh);
    for (const g of geoms) g.dispose();
  }

  for (const mesh of meshesToRemove) {
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
  }
  for (const mesh of mergedMeshes) rootObj.add(mesh);
  return mergedMeshes.length;
}

function buildCollisionFromRoom(rootObj) {
  const positions = [];
  const indices = [];
  let vertexOffset = 0;
  const v = new THREE.Vector3();

  rootObj.traverse((node) => {
    if (!node.isMesh) return;
    const mesh = node;
    const geom = mesh.geometry;
    const posAttr = geom?.attributes?.position;
    if (!posAttr) return;
    mesh.updateWorldMatrix(true, false);

    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
      positions.push(v.x, v.y, v.z);
    }

    if (geom.index) {
      for (let i = 0; i < geom.index.count; i++) {
        indices.push(geom.index.getX(i) + vertexOffset);
      }
    } else {
      for (let i = 0; i < posAttr.count; i++) indices.push(vertexOffset + i);
    }
    vertexOffset += posAttr.count;
  });

  const posArr = new Float32Array(positions);
  const idxArr = new Uint32Array(indices);
  const bounds = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(posArr, 3));
  return { bounds, positions: posArr, indices: idxArr };
}

function encodeCollisionFile(data) {
  const header = Buffer.alloc(40);
  header.write(MAGIC, 0, 4, 'ascii');
  header.writeUInt32LE(VERSION, 4);
  header.writeFloatLE(data.bounds.min.x, 8);
  header.writeFloatLE(data.bounds.min.y, 12);
  header.writeFloatLE(data.bounds.min.z, 16);
  header.writeFloatLE(data.bounds.max.x, 20);
  header.writeFloatLE(data.bounds.max.y, 24);
  header.writeFloatLE(data.bounds.max.z, 28);
  header.writeUInt32LE(data.positions.length / 3, 32);
  header.writeUInt32LE(data.indices.length, 36);

  const posBuf = Buffer.from(data.positions.buffer, data.positions.byteOffset, data.positions.byteLength);
  const idxBuf = Buffer.from(data.indices.buffer, data.indices.byteOffset, data.indices.byteLength);

  return Buffer.concat([header, posBuf, idxBuf]);
}

function primitiveToGeometry(prim) {
  const pos = prim.getAttribute('POSITION');
  if (!pos) return null;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(pos.getArray()), pos.getElementSize())
  );
  const index = prim.getIndices();
  if (index) {
    geom.setIndex(new THREE.BufferAttribute(new Uint32Array(index.getArray()), 1));
  }
  return geom;
}

function convertNode(node, materials) {
  const group = new THREE.Group();
  const [tx, ty, tz] = node.getTranslation();
  const [rx, ry, rz, rw] = node.getRotation();
  const [sx, sy, sz] = node.getScale();
  group.position.set(tx, ty, tz);
  group.quaternion.set(rx, ry, rz, rw);
  group.scale.set(sx, sy, sz);

  const mesh = node.getMesh();
  if (mesh) {
    for (const prim of mesh.listPrimitives()) {
      const geom = primitiveToGeometry(prim);
      if (!geom) continue;
      const srcMat = prim.getMaterial();
      const key = srcMat ? srcMat.getName() || `mat-${srcMat.propertyType}` : 'default';
      if (!materials.has(key)) {
        materials.set(key, new THREE.MeshBasicMaterial({ visible: false }));
      }
      group.add(new THREE.Mesh(geom, materials.get(key)));
    }
  }

  for (const child of node.listChildren()) {
    group.add(convertNode(child, materials));
  }
  return group;
}

function gltfDocumentToThree(doc) {
  const materials = new Map();
  const root = new THREE.Group();
  const scenes = doc.getRoot().listScenes();
  const scene = scenes[0] ?? doc.getRoot();
  for (const child of scene.listChildren()) {
    root.add(convertNode(child, materials));
  }
  return root;
}

async function loadRoomObject() {
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });

  console.log('Loading', glbPath);
  const doc = await io.read(glbPath);
  return gltfDocumentToThree(doc);
}

async function main() {
  const obj = await loadRoomObject();

  normalizeRoomObject(obj);
  obj.traverse((node) => {
    if (!node.isMesh) return;
    node.matrixAutoUpdate = false;
    if (node.geometry?.attributes.normal === undefined) {
      node.geometry.computeVertexNormals();
    }
  });

  const merged = mergeRoomMeshesByMaterial(obj);
  console.log(`Merged room into ${merged} draw calls`);

  const collisionData = buildCollisionFromRoom(obj);
  console.log(
    `Collision mesh: ${collisionData.positions.length / 3} verts, ${collisionData.indices.length} indices`
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, encodeCollisionFile(collisionData));
  console.log('Wrote', outPath, `(${(fs.statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
