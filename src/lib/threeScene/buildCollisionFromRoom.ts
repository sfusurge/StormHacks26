import * as THREE from 'three';
import type { CollisionMapData } from './collisionMap';

// swap prop's complex geometry for a simple box in the collision mesh
// add a solid box that blocks the player from walking through the prop
export type CollisionProxy = {
    // the box that removes the prop's triangles from the collision mesh
    remove: THREE.Box3;
    solid: THREE.Box3;
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _centroid = new THREE.Vector3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

function vertexAt(positions: number[], index: number, out: THREE.Vector3) {
    return out.set(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
}

// drop triangles sitting inside a proxy's remove volume.
function filterProxiedTriangles(
    positions: number[],
    indices: number[],
    proxies: CollisionProxy[]
): number[] {
    if (!proxies.length) return indices;

    const kept: number[] = [];
    for (let i = 0; i < indices.length; i += 3) {
        vertexAt(positions, indices[i], _a);
        vertexAt(positions, indices[i + 1], _b);
        vertexAt(positions, indices[i + 2], _c);
        _centroid.copy(_a).add(_b).add(_c).multiplyScalar(1 / 3);

        if (proxies.some((p) => p.remove.containsPoint(_centroid))) continue;

        kept.push(indices[i], indices[i + 1], indices[i + 2]);
    }
    return kept;
}


// append each proxy's solid box to the collision mesh
// to figure out which way surface is facing so player can be pushed out
function appendProxyBoxes(positions: number[], indices: number[], proxies: CollisionProxy[]) {
    for (const proxy of proxies) {
        proxy.solid.getSize(_size);
        proxy.solid.getCenter(_center);
        if (_size.x <= 0 || _size.y <= 0 || _size.z <= 0) continue;

        const box = new THREE.BoxGeometry(_size.x, _size.y, _size.z);
        box.translate(_center.x, _center.y, _center.z);

        const boxPos = box.attributes.position;
        const boxIdx = box.index;
        const vertexOffset = positions.length / 3;

        for (let i = 0; i < boxPos.count; i++) {
            _a.fromBufferAttribute(boxPos, i);
            positions.push(_a.x, _a.y, _a.z);
        }
        if (boxIdx) {
            for (let i = 0; i < boxIdx.count; i++) indices.push(boxIdx.getX(i) + vertexOffset);
        } else {
            for (let i = 0; i < boxPos.count; i++) indices.push(vertexOffset + i);
        }

        box.dispose();
    }
}

// get collision mesh from the room's geometry
export function buildCollisionFromRoom(
    root: THREE.Object3D,
    proxies: CollisionProxy[] = []
): CollisionMapData {
    const positions: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;
    const v = new THREE.Vector3();

    root.traverse((node) => {
        if (!(node as THREE.Mesh).isMesh) return;
        const mesh = node as THREE.Mesh;
        const geom = mesh.geometry as THREE.BufferGeometry;
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

    // orphaned vertices can cause problems for the BVH, so filter them out
    const filtered = filterProxiedTriangles(positions, indices, proxies);
    appendProxyBoxes(positions, filtered, proxies);

    const posArr = new Float32Array(positions);
    const idxArr = new Uint32Array(filtered);
    const bounds = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(posArr, 3));

    return { bounds, positions: posArr, indices: idxArr };
}
