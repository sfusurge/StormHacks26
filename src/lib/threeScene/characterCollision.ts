import * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';

const PLAYER_RADIUS = 0.10;
const SKIN = 0.025;
const MOVE_SUBSTEP = 0.025;
const RAY_HEIGHTS = [0.42, 0.72];

const _sphere = new THREE.Sphere(new THREE.Vector3(), PLAYER_RADIUS);
const _closest = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };

export function getCollisionBvh(ctx: { cameraCollisionMesh?: THREE.Mesh | null; collidableMeshes?: THREE.Mesh[] }): MeshBVH | null {
    const mesh = ctx.cameraCollisionMesh ?? ctx.collidableMeshes?.[0];
    return (mesh?.geometry as THREE.BufferGeometry & { boundsTree?: MeshBVH })?.boundsTree ?? null;
}

function baseY(pos: THREE.Vector3, footOffset: number) {
    return pos.y - footOffset;
}

function spheresOverlap(bvh: MeshBVH, x: number, by: number, z: number): boolean {
    for (const h of RAY_HEIGHTS) {
        _sphere.center.set(x, by + h, z);
        if (bvh.intersectsSphere(_sphere)) return true;
    }
    return false;
}

export function depenetrateWithBvh(bvh: MeshBVH, pos: THREE.Vector3, footOffset: number) {
    const by = baseY(pos, footOffset);

    for (let iter = 0; iter < 8; iter++) {
        let moved = false;

        for (const h of RAY_HEIGHTS) {
            _sphere.center.set(pos.x, by + h, pos.z);
            const hit = bvh.closestPointToPoint(_sphere.center, _closest, 0, PLAYER_RADIUS + 0.5);
            if (!hit || hit.distance >= PLAYER_RADIUS - SKIN) continue;

            const push = PLAYER_RADIUS - hit.distance + SKIN;
            let nx = _sphere.center.x - hit.point.x;
            let nz = _sphere.center.z - hit.point.z;
            const len = Math.hypot(nx, nz);
            if (len < 1e-6) {
                nx = 0;
                nz = 1;
            } else {
                nx /= len;
                nz /= len;
            }
            pos.x += nx * push;
            pos.z += nz * push;
            moved = true;
        }

        if (!moved) break;
    }
}

function maxSafeMoveFraction(
    bvh: MeshBVH,
    x: number,
    by: number,
    z: number,
    dx: number,
    dz: number
): number {
    if (!spheresOverlap(bvh, x + dx, by, z + dz)) return 1;

    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) * 0.5;
        if (spheresOverlap(bvh, x + dx * mid, by, z + dz * mid)) hi = mid;
        else lo = mid;
    }
    return lo;
}

function surfaceNormalAt(bvh: MeshBVH, x: number, by: number, z: number): THREE.Vector3 {
    _sphere.center.set(x, by + 0.55, z);
    const hit = bvh.closestPointToPoint(_sphere.center, _closest, 0, PLAYER_RADIUS + 0.5);
    if (!hit || hit.distance < 1e-6) return new THREE.Vector3(0, 0, 1);

    const nx = (_sphere.center.x - hit.point.x) / hit.distance;
    const nz = (_sphere.center.z - hit.point.z) / hit.distance;
    const len = Math.hypot(nx, nz);
    if (len < 1e-6) return new THREE.Vector3(0, 0, 1);
    return new THREE.Vector3(nx / len, 0, nz / len);
}

export function sweepWithBvh(
    bvh: MeshBVH,
    pos: THREE.Vector3,
    footOffset: number,
    dx: number,
    dz: number
): { dx: number; dz: number } {
    const by = baseY(pos, footOffset);
    let px = pos.x;
    let pz = pos.z;
    let remainX = dx;
    let remainZ = dz;
    let totalDx = 0;
    let totalDz = 0;
    let slides = 0;

    while (Math.hypot(remainX, remainZ) > 1e-6 && slides < 6) {
        const len = Math.hypot(remainX, remainZ);
        const step = Math.min(MOVE_SUBSTEP, len);
        const sx = (remainX / len) * step;
        const sz = (remainZ / len) * step;

        const frac = maxSafeMoveFraction(bvh, px, by, pz, sx, sz);
        const ux = sx * frac;
        const uz = sz * frac;
        px += ux;
        pz += uz;
        totalDx += ux;
        totalDz += uz;

        if (frac >= 1 - 1e-4) {
            remainX -= sx;
            remainZ -= sz;
            continue;
        }

        const blockedX = sx - ux;
        const blockedZ = sz - uz;
        const normal = surfaceNormalAt(bvh, px, by, pz);
        const dot = blockedX * normal.x + blockedZ * normal.z;
        const slideX = blockedX - dot * normal.x;
        const slideZ = blockedZ - dot * normal.z;

        remainX = remainX - sx + slideX;
        remainZ = remainZ - sz + slideZ;
        slides++;
    }

    return { dx: totalDx, dz: totalDz };
}