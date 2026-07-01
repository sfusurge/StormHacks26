import * as THREE from 'three';
import { clampCharacterToRoom, getFootOffset } from './alignCharacterToFloor';
import {
  depenetrateWithBvh,
  getCollisionBvh,
  isHorizontalMoveBlocked,
  sweepWithBvh,
} from './characterCollision';

const MOVE_SPEED = 2.0;
const RUN_SPEED = 4.5;
const TURN_SPEED = 4.0;
const STRAFE_PIVOT_SPEED = 2.2;
const MAX_MOVE_DT = 0.025;
const PLAYER_RADIUS = 0.10;
const SKIN = 0.02;
const MOVE_SUBSTEP = 0.025;
const RAY_HEIGHTS = [0.42, 0.72];
const RAY_OFFSETS: [number, number][] = [
  [0, 0],
  [PLAYER_RADIUS * 0.55, 0],
  [-PLAYER_RADIUS * 0.55, 0],
  [0, PLAYER_RADIUS * 0.55],
  [0, -PLAYER_RADIUS * 0.55],
];

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _push = new THREE.Vector3();
const _escapeDirs = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
});

type MoveHit = { distance: number; normal: THREE.Vector3 };

function findFloorY(ctx: any, x: number, z: number, maxY: number): number | null {
  if (!ctx.roomBox || ctx.collidableMeshes.length === 0) return ctx.roomBox?.min.y ?? 0;

  _origin.set(x, maxY + 0.5, z);
  ctx.raycaster.set(_origin, new THREE.Vector3(0, -1, 0));
  ctx.raycaster.far = maxY - (ctx.roomBox.min.y - 1);
  const hits = ctx.raycaster.intersectObjects(ctx.collidableMeshes, true);
  return hits.length ? hits[0].point.y : ctx.roomBox.min.y;
}

function worldHitNormal(hit: THREE.Intersection): THREE.Vector3 {
  if (hit.face) {
    _normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
  } else {
    _normal.set(0, 1, 0);
  }
  _normal.y = 0;
  if (_normal.lengthSq() < 1e-8) _normal.set(0, 0, 1);
  else _normal.normalize();
  return _normal;
}

function probeMove(
  ctx: any,
  x: number,
  y: number,
  z: number,
  dx: number,
  dz: number,
  footOffset: number
): MoveHit | null {
  if (ctx.collidableMeshes.length === 0) return null;

  const dist = Math.hypot(dx, dz);
  if (dist < 1e-8) return null;

  _dir.set(dx / dist, 0, dz / dist);
  const base = y - footOffset;
  let closest = dist + PLAYER_RADIUS;
  let hitNormal: THREE.Vector3 | null = null;

  for (const h of RAY_HEIGHTS) {
    for (const [ox, oz] of RAY_OFFSETS) {
      _origin.set(x + ox, base + h, z + oz);
      ctx.raycaster.set(_origin, _dir);
      ctx.raycaster.far = dist + PLAYER_RADIUS + SKIN;
      const hits = ctx.raycaster.intersectObjects(ctx.collidableMeshes, true);
      if (!hits.length) continue;

      const d = hits[0].distance - PLAYER_RADIUS * 0.55;
      if (d < closest) {
        closest = d;
        hitNormal = worldHitNormal(hits[0]).clone();
      }
    }
  }

  if (hitNormal && closest < dist) {
    return { distance: Math.max(0, closest), normal: hitNormal };
  }
  return null;
}

function slideVector(dx: number, dz: number, normal: THREE.Vector3): { dx: number; dz: number } {
  const dot = dx * normal.x + dz * normal.z;
  return { dx: dx - dot * normal.x, dz: dz - dot * normal.z };
}

function sweepHorizontalRaycast(
  ctx: any,
  x: number,
  y: number,
  z: number,
  dx: number,
  dz: number,
  footOffset: number
): { dx: number; dz: number } {
  let px = x;
  let py = y;
  let pz = z;
  let remainX = dx;
  let remainZ = dz;
  let totalDx = 0;
  let totalDz = 0;
  let slides = 0;

  while (Math.hypot(remainX, remainZ) > 1e-6 && slides < 4) {
    const len = Math.hypot(remainX, remainZ);
    const step = Math.min(MOVE_SUBSTEP, len);
    const sx = (remainX / len) * step;
    const sz = (remainZ / len) * step;

    const hit = probeMove(ctx, px, py, pz, sx, sz, footOffset);
    if (!hit) {
      px += sx;
      pz += sz;
      totalDx += sx;
      totalDz += sz;
      remainX -= sx;
      remainZ -= sz;
      continue;
    }

    const safe = Math.min(step, hit.distance);
    if (safe > 1e-5) {
      const ux = (sx / step) * safe;
      const uz = (sz / step) * safe;
      px += ux;
      pz += uz;
      totalDx += ux;
      totalDz += uz;
    }

    const afterX = remainX - (sx / step) * safe;
    const afterZ = remainZ - (sz / step) * safe;
    const slid = slideVector(afterX, afterZ, hit.normal);
    remainX = slid.dx;
    remainZ = slid.dz;
    slides++;
  }

  return { dx: totalDx, dz: totalDz };
}

function depenetrateRaycast(ctx: any, pos: THREE.Vector3, footOffset: number) {
  if (ctx.collidableMeshes.length === 0) return;
  const base = pos.y - footOffset + 0.55;

  for (let iter = 0; iter < 5; iter++) {
    _push.set(0, 0, 0);
    for (const dir of _escapeDirs) {
      _origin.set(pos.x, base, pos.z);
      ctx.raycaster.set(_origin, dir);
      ctx.raycaster.far = PLAYER_RADIUS + SKIN * 2;
      const hits = ctx.raycaster.intersectObjects(ctx.collidableMeshes, true);
      if (hits.length > 0 && hits[0].distance < PLAYER_RADIUS) {
        _push.addScaledVector(dir, PLAYER_RADIUS - hits[0].distance + SKIN);
      }
    }
    if (_push.lengthSq() < 1e-8) break;
    pos.x += _push.x;
    pos.z += _push.z;
  }
}

export function updateCharacter(ctx: any, dt: number) {
  if (!ctx.character || !ctx.roomLoaded || !ctx.roomBox) return;

  const moveDt = Math.min(dt, MAX_MOVE_DT);
  const pos = ctx.character.position;
  const footOffset = getFootOffset(ctx.character);
  const bvh = getCollisionBvh(ctx);

  let inputX = 0;
  let inputZ = 0;
  if (ctx.keys['w'] || ctx.keys['arrowup']) inputZ += 1;
  if (ctx.keys['s'] || ctx.keys['arrowdown']) inputZ -= 1;
  if (ctx.keys['a'] || ctx.keys['arrowleft']) inputX -= 1;
  if (ctx.keys['d'] || ctx.keys['arrowright']) inputX += 1;

  const strafeOnly = inputX !== 0 && inputZ === 0;
  let pivotStrafe = false;

  const camForward = new THREE.Vector3();
  ctx.camera.getWorldDirection(camForward);
  camForward.y = 0;
  if (camForward.lengthSq() < 1e-6) camForward.set(0, 0, -1);
  camForward.normalize();
  const camRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();

  let strafeMove: THREE.Vector3 | null = null;
  if (inputX !== 0 || inputZ !== 0) {
    const move = new THREE.Vector3()
      .addScaledVector(camForward, inputZ)
      .addScaledVector(camRight, inputX * 0.35);
    if (move.lengthSq() > 1e-6) {
      const speed = ctx.keys['shift'] ? RUN_SPEED : MOVE_SPEED;
      move.normalize().multiplyScalar(speed * moveDt);
      strafeMove = move;

      if (strafeOnly && ctx.collidableMeshes.length > 0) {
        const blocked = bvh
          ? isHorizontalMoveBlocked(bvh, pos, footOffset, move.x, move.z)
          : probeMove(ctx, pos.x, pos.y, pos.z, move.x, move.z, footOffset) !== null;
        if (blocked) {
          ctx.cameraYaw += inputX * STRAFE_PIVOT_SPEED * moveDt;
          pivotStrafe = true;
        }
      }
    }
  }

  ctx.strafeCameraPivot = pivotStrafe;

  if (!pivotStrafe) {
    if (bvh) depenetrateWithBvh(bvh, pos, footOffset);
    else depenetrateRaycast(ctx, pos, footOffset);
  }

  if (strafeMove && !pivotStrafe) {
    const move = strafeMove;
    const swept = bvh
      ? sweepWithBvh(bvh, pos, footOffset, move.x, move.z)
      : sweepHorizontalRaycast(ctx, pos.x, pos.y, pos.z, move.x, move.z, footOffset);
    pos.x += swept.dx;
    pos.z += swept.dz;

    const angle = Math.atan2(swept.dx || move.x, swept.dz || move.z);
    const current = ctx.character.rotation?.y ?? 0;
    if (!(inputZ < 0 && Math.abs(inputZ) >= Math.abs(inputX))) {
      const angleDiff = (angle - current + Math.PI) % (Math.PI * 2) - Math.PI;
      ctx.character.rotation.y = current + angleDiff * Math.min(1, TURN_SPEED * moveDt);
    }
  }

  if (!pivotStrafe) {
    if (bvh) depenetrateWithBvh(bvh, pos, footOffset);
    else depenetrateRaycast(ctx, pos, footOffset);
  }

  if (ctx.collidableMeshes.length === 0) {
    clampCharacterToRoom(ctx.character, ctx.roomBox, ctx.characterMargin ?? 0.35);
  }

  const groundY = findFloorY(ctx, pos.x, pos.z, pos.y - footOffset + 0.05);
  const floorY = groundY ?? ctx.roomBox.min.y;
  const feetY = pos.y - footOffset;
  const onGround = feetY <= floorY + 0.08 && (ctx.verticalVelocity ?? 0) <= 0;

  if (onGround) {
    ctx.isGrounded = true;
    ctx.verticalVelocity = 0;
    if (ctx.keys[' ']) {
      ctx.verticalVelocity = 5;
      ctx.isGrounded = false;
    }
  } else {
    ctx.isGrounded = false;
  }

  if (!ctx.isGrounded) {
    const prevY = pos.y;
    ctx.verticalVelocity = (ctx.verticalVelocity ?? 0) - 9.82 * dt;
    pos.y += ctx.verticalVelocity * dt;

    if (ctx.collidableMeshes.length > 0 && ctx.verticalVelocity > 0) {
      _origin.set(pos.x, prevY - footOffset + 1.2, pos.z);
      ctx.raycaster.set(_origin, new THREE.Vector3(0, 1, 0));
      ctx.raycaster.far = pos.y - prevY + 0.15;
      const hits = ctx.raycaster.intersectObjects(ctx.collidableMeshes, true);
      if (hits.length > 0) {
        pos.y = hits[0].point.y - 1.2 + footOffset;
        ctx.verticalVelocity = 0;
      }
    }
  }

  const supportY = findFloorY(ctx, pos.x, pos.z, pos.y);
  if (supportY !== null) {
    const targetY = supportY + footOffset;
    if (pos.y < targetY && (ctx.verticalVelocity ?? 0) <= 0) {
      pos.y = targetY;
      ctx.verticalVelocity = 0;
      ctx.isGrounded = true;
    }
  }
}
