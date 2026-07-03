import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Bakes animated mesh transforms into geometry the same way mergeRoomMeshesByMaterial
 * does for static meshes, so flipbook frames line up with the merged room.
 */
export function bakeAnimatedMeshesForMergedSpace(
    root: THREE.Object3D,
    animatedNodeNames: Set<string>,
): void {
    root.traverse((node) => {
        if (!(node as THREE.Mesh).isMesh || !animatedNodeNames.has(node.name)) return;

        const mesh = node as THREE.Mesh;
        if (!mesh.geometry?.attributes?.position) return;

        // Hidden flipbook frames load with scale 0; bake at scale 1 so geometry isn't collapsed.
        mesh.scale.set(1, 1, 1);
        mesh.updateMatrix();
        mesh.updateWorldMatrix(true, false);

        const geom = mesh.geometry.clone();
        geom.applyMatrix4(mesh.matrixWorld);
        geom.computeBoundingSphere();
        mesh.geometry.dispose();
        mesh.geometry = geom;

        mesh.position.set(0, 0, 0);
        mesh.rotation.set(0, 0, 0);
        mesh.scale.set(1, 1, 1);
        mesh.frustumCulled = false;
        mesh.updateMatrix();
    });
}

/**
 * Merges static room meshes by material to cut draw calls (714 → ~material count).
 */
export function mergeRoomMeshesByMaterial(
    root: THREE.Object3D,
    shouldExclude: (node: THREE.Object3D) => boolean = () => false,
): number {
    const groups = new Map<string, { material: THREE.Material; geoms: THREE.BufferGeometry[] }>();
    const meshesToRemove: THREE.Mesh[] = [];

    root.traverse((node) => {
        if (!(node as THREE.Mesh).isMesh) return;
        if (shouldExclude(node)) return;
        const mesh = node as THREE.Mesh;
        if (!mesh.geometry?.attributes?.position) return;

        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        if (!material) return;

        const key = material.uuid;
        if (!groups.has(key)) groups.set(key, { material, geoms: [] });

        const geom = mesh.geometry.clone();
        mesh.updateWorldMatrix(true, false);
        geom.applyMatrix4(mesh.matrixWorld);
        groups.get(key)!.geoms.push(geom);
        meshesToRemove.push(mesh);
    });

    const mergedMeshes: THREE.Mesh[] = [];

    for (const { material, geoms } of groups.values()) {
        if (geoms.length === 0) continue;
        const merged = geoms.length === 1 ? geoms[0] : mergeGeometries(geoms, false);
        if (!merged) continue;

        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = true;
        mesh.matrixAutoUpdate = false;
        mesh.matrix.identity();
        mergedMeshes.push(mesh);

        for (const g of geoms) g.dispose();
    }

    for (const mesh of meshesToRemove) {
        mesh.parent?.remove(mesh);
        mesh.geometry.dispose();
    }

    for (const mesh of mergedMeshes) root.add(mesh);

    return mergedMeshes.length;
}