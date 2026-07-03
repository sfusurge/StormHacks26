import * as THREE from 'three';

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3(0, -1, 0);
const _normal = new THREE.Vector3();

/** Minimum face normal Y to count as walkable (allows ~65° ramps/stairs). */
const MIN_WALKABLE_NORMAL_Y = 0.42;

function isWalkableHit(hit: THREE.Intersection): boolean {
    if (!hit.face) return false;
    _normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    return _normal.y >= MIN_WALKABLE_NORMAL_Y;
}

/**
 * Walkable surface closest to the expected foot height.
 * Penalizes surfaces well above the reference so roof hits lose to the floor.
 */
export function pickClosestWalkableFloorY(
    hits: THREE.Intersection[],
    referenceY: number,
    roomMinY = -Infinity
): number | null {
    let best: number | null = null;
    let bestScore = Infinity;

    for (const hit of hits) {
        if (!isWalkableHit(hit)) continue;
        const y = hit.point.y;
        if (y < roomMinY - 0.05) continue;

        const dy = y - referenceY;
        const score = dy > 0.5 ? dy + 10 : Math.abs(dy);

        if (score < bestScore) {
            bestScore = score;
            best = y;
        }
    }

    return best;
}

/**
 * Ground directly under the feet — short downward ray so stairs resolve to the
 * current tread instead of a lower floor hit from a top-down cast.
 */
export function findFloorY(
    ctx: {
        collidableMeshes?: THREE.Mesh[];
        raycaster?: THREE.Raycaster;
        roomBox?: THREE.Box3 | null;
        collisionBounds?: THREE.Box3 | null;
    },
    x: number,
    z: number,
    feetY: number
): number | null {
    if (!ctx.collidableMeshes?.length || !ctx.raycaster) return null;

    _origin.set(x, feetY + 0.25, z);
    ctx.raycaster.set(_origin, _dir);
    ctx.raycaster.far = 2.5;
    const hits = ctx.raycaster.intersectObjects(ctx.collidableMeshes, true);
    for (const hit of hits) {
        if (isWalkableHit(hit)) return hit.point.y;
    }

    return findSpawnFloorY(ctx, x, z, feetY);
}

export function findSpawnFloorY(
    ctx: {
        collidableMeshes?: THREE.Mesh[];
        raycaster?: THREE.Raycaster;
        roomBox?: THREE.Box3 | null;
        collisionBounds?: THREE.Box3 | null;
    },
    x: number,
    z: number,
    referenceY?: number
): number | null {
    const roomMinY = ctx.collisionBounds?.min.y ?? ctx.roomBox?.min.y ?? 0;
    const ref = referenceY ?? roomMinY + 0.5;
    const rayTop = (ctx.collisionBounds?.max.y ?? ctx.roomBox?.max.y ?? 10) + 2;
    const maxDist = rayTop - roomMinY + 2;

    if (!ctx.collidableMeshes?.length || !ctx.raycaster) return null;

    _origin.set(x, rayTop, z);
    ctx.raycaster.set(_origin, _dir);
    ctx.raycaster.far = maxDist;
    const hits = ctx.raycaster.intersectObjects(ctx.collidableMeshes, true);
    return pickClosestWalkableFloorY(hits, ref, roomMinY);
}
