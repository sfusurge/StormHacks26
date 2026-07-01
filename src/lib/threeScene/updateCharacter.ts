import * as THREE from 'three';
import { getFootOffset } from './alignCharacterToFloor';
import { findFloorY } from './floorQuery';
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
const MAX_STEP_HEIGHT = 0.35;
const MAX_DROP = 0.4;
const FLOOR_FOLLOW = 14;

const _origin = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function followFloor(
  pos: THREE.Vector3,
  footOffset: number,
  floorY: number,
  moveSpeed: number,
  dt: number
): boolean {
  const targetY = floorY + footOffset;
  const dy = targetY - pos.y;

  if (dy > MAX_STEP_HEIGHT || dy < -MAX_DROP) return false;

  if (dy > 0.01) {
    const maxRise = moveSpeed * dt * 1.1;
    pos.y += Math.min(dy, maxRise);
  } else if (dy < -0.01) {
    pos.y += dy * Math.min(1, FLOOR_FOLLOW * dt);
  }

  return true;
}

export function updateCharacter(ctx: any, dt: number) {
  if (!ctx.character || !ctx.roomLoaded || !ctx.roomBox) return;

  const bvh = getCollisionBvh(ctx);
  if (!bvh) return;

  const moveDt = Math.min(dt, MAX_MOVE_DT);
  const pos = ctx.character.position;
  const footOffset = getFootOffset(ctx.character);
  const moveSpeed = ctx.keys['shift'] ? RUN_SPEED : MOVE_SPEED;

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
      move.normalize().multiplyScalar(moveSpeed * moveDt);
      strafeMove = move;

      if (strafeOnly && isHorizontalMoveBlocked(bvh, pos, footOffset, move.x, move.z)) {
        ctx.cameraYaw += inputX * STRAFE_PIVOT_SPEED * moveDt;
        pivotStrafe = true;
      }
    }
  }

  ctx.strafeCameraPivot = pivotStrafe;

  if (pivotStrafe) return;

  if (strafeMove) {
    const move = strafeMove;
    const swept = sweepWithBvh(bvh, pos, footOffset, move.x, move.z);
    pos.x += swept.dx;
    pos.z += swept.dz;

    const angle = Math.atan2(swept.dx || move.x, swept.dz || move.z);
    const current = ctx.character.rotation?.y ?? 0;
    if (!(inputZ < 0 && Math.abs(inputZ) >= Math.abs(inputX))) {
      const angleDiff = (angle - current + Math.PI) % (Math.PI * 2) - Math.PI;
      ctx.character.rotation.y = current + angleDiff * Math.min(1, TURN_SPEED * moveDt);
    }
  }

  depenetrateWithBvh(bvh, pos, footOffset);

  const feetY = pos.y - footOffset;
  const floorY = findFloorY(ctx, pos.x, pos.z, feetY);
  const airborne = (ctx.verticalVelocity ?? 0) > 0.05;

  if (!airborne && floorY !== null) {
    const supported = followFloor(pos, footOffset, floorY, moveSpeed, moveDt);
    ctx.isGrounded = supported;

    if (supported) {
      ctx.verticalVelocity = 0;
      if (ctx.keys[' ']) {
        ctx.verticalVelocity = 5;
        ctx.isGrounded = false;
      }
    }
  } else {
    ctx.isGrounded = false;
  }

  if (!ctx.isGrounded) {
    const prevY = pos.y;
    ctx.verticalVelocity = (ctx.verticalVelocity ?? 0) - 9.82 * dt;
    pos.y += ctx.verticalVelocity * dt;

    if (ctx.verticalVelocity > 0) {
      _origin.set(pos.x, prevY - footOffset + 1.2, pos.z);
      ctx.raycaster.set(_origin, _up);
      ctx.raycaster.far = pos.y - prevY + 0.15;
      const hits = ctx.raycaster.intersectObjects(ctx.collidableMeshes, true);
      if (hits.length > 0) {
        pos.y = hits[0].point.y - 1.2 + footOffset;
        ctx.verticalVelocity = 0;
        ctx.isGrounded = true;
      }
    } else if (floorY !== null) {
      const targetY = floorY + footOffset;
      if (pos.y <= targetY + 0.05) {
        pos.y = targetY;
        ctx.verticalVelocity = 0;
        ctx.isGrounded = true;
      }
    }
  }
}
