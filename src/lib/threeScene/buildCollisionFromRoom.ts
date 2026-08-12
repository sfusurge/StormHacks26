import * as THREE from 'three';
import type { CollisionMapData } from './collisionMap';

/** Extract world-space collision from the loaded (normalized) room — matches visuals exactly. */
export function buildCollisionFromRoom(root: THREE.Object3D): CollisionMapData {
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

    const posArr = new Float32Array(positions);
    const idxArr = new Uint32Array(indices);
    const bounds = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(posArr, 3));

    return { bounds, positions: posArr, indices: idxArr };
}

// add an extra collider wall for glitchy areas
export function addColliders(
    data: CollisionMapData,
    boxes: THREE.Box3[]
): CollisionMapData {
    const positions = Array.from(data.positions);
    const indices = Array.from(data.indices);
    const vertexOffset = positions.length / 3;

    for (const box of boxes) {
        const vertexOffset = positions.length / 3;

        const corners = [
            [box.min.x, box.min.y, box.min.z],
            [box.max.x, box.min.y, box.max.z],
            [box.max.x, box.max.y, box.max.z],
            [box.min.x, box.max.y, box.min.z],
        ];

        corners.forEach(([x, y, z]) => positions.push(x, y, z));
        indices.push(
            vertexOffset, vertexOffset + 1, vertexOffset + 2,
            vertexOffset, vertexOffset + 2, vertexOffset + 3
        );
    }

    return {
        bounds: data.bounds,
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
    };
}