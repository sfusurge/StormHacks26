import * as THREE from 'three';
import { getFootOffset } from './alignCharacterToFloor';
import { findFloorY } from './floorQuery';
import {
  depenetrateWithBvh,
  getCollisionBvh,
  sweepWithBvh,
} from './characterCollision';

const MOVE_SPEED = 2.0;
const RUN_SPEED = 3.6;
const MOVE_ACCEL = 10;
const RUN_ACCEL = 14;
const MOVE_DECEL = 12;
const ROT_TURN_RATE = 12;
const ROT_DIAGONAL_TURN_RATE = 24;
const ROT_IN_PLACE_RATE = 3.6;
const ROT_BACKUP_RATE = 16;
const MAX_MOVE_DT = 0.025;
const MAX_STEP_HEIGHT = 0.35;
const MAX_DROP = 0.4;
const FLOOR_FOLLOW = 14;
const JUMP_VELOCITY = 3.5;

const _origin = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _moveDir = new THREE.Vector3();
const _faceDir = new THREE.Vector3();
const _move = new THREE.Vector3();
const _charPos = new THREE.Vector3();
const _portalPos = new THREE.Vector3();

function checkInteractableContact(ctx: {
  character?: THREE.Object3D;
  interactables?: THREE.Object3D[];
  portalRedirectTriggered?: boolean;
}) {
  if (!ctx.character || !ctx.interactables?.length || ctx.portalRedirectTriggered) return;

  ctx.character.updateMatrixWorld(true);
  ctx.character.getWorldPosition(_charPos);

  for (const obj of ctx.interactables) {
    const url = (obj as THREE.Object3D & { userData: { url?: string } }).userData?.url;
    if (!url) continue;

    obj.updateMatrixWorld(true);
    obj.getWorldPosition(_portalPos);

    const dx = _charPos.x - _portalPos.x;
    const dz = _charPos.z - _portalPos.z;
    const dy = Math.abs(_charPos.y - _portalPos.y);

    if (dx * dx + dz * dz <= 0.64 && dy <= 1.2) {
      ctx.portalRedirectTriggered = true;
      window.location.replace(url);
      return;
    }
  }
}

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

function moveToward(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

function decelerate(vx: number, vz: number, decel: number, dt: number): [number, number] {
  const speed = Math.hypot(vx, vz);
  if (speed < 1e-6) return [0, 0];

  const newSpeed = Math.max(0, speed - decel * dt);
  const scale = newSpeed / speed;
  return [vx * scale, vz * scale];
}

export function updateCharacter(ctx: any, dt: number) {
  if (!ctx.character || !ctx.roomLoaded || !ctx.roomBox) return;

  const bvh = getCollisionBvh(ctx);
  if (!bvh) return;

  const moveDt = Math.min(dt, MAX_MOVE_DT);
  const pos = ctx.character.position;
  const footOffset = getFootOffset(ctx.character);
  const moveSpeed = ctx.keys['shift'] ? RUN_SPEED : MOVE_SPEED;

  // WASD: W/S move toward/away from camera; A/D rotate in place.
  let inputForward = 0;
  let inputTurn = 0;
  if (ctx.keys['w'] || ctx.keys['arrowup']) inputForward += 1;
  if (ctx.keys['s'] || ctx.keys['arrowdown']) inputForward -= 1;
  if (ctx.keys['a'] || ctx.keys['arrowleft']) inputTurn += 1;
  if (ctx.keys['d'] || ctx.keys['arrowright']) inputTurn -= 1;

  const movingForward = inputForward > 0;
  const turning = Math.abs(inputTurn) > 1e-6;
  const diagonalMove = movingForward && turning;

  if (turning && !diagonalMove) {
    const currentYaw = ctx.character.rotation?.y ?? 0;
    ctx.character.rotation.y = currentYaw + inputTurn * ROT_IN_PLACE_RATE * moveDt;
  }

  // Camera-relative movement: W/S along camera forward; W+A/D move on ~45° diagonals.
  ctx.camera.getWorldDirection(_camForward);
  _camForward.y = 0;
  if (_camForward.lengthSq() < 1e-6) _camForward.set(0, 0, -1);
  _camForward.normalize();
  _camRight.crossVectors(_camForward, _up).normalize();

  if (diagonalMove) {
    _moveDir
      .copy(_camForward)
      .addScaledVector(_camRight, -inputTurn);
  } else {
    _moveDir.set(0, 0, 0).addScaledVector(_camForward, inputForward);
  }

  const hasMoveInput = _moveDir.lengthSq() > 1e-6;
  let vx = ctx.moveVelocityX ?? 0;
  let vz = ctx.moveVelocityZ ?? 0;

  if (hasMoveInput) {
    _moveDir.normalize();
    const accel = ctx.keys['shift'] ? RUN_ACCEL : MOVE_ACCEL;
    const targetVx = _moveDir.x * moveSpeed;
    const targetVz = _moveDir.z * moveSpeed;
    const maxDelta = accel * moveDt;
    vx = moveToward(vx, targetVx, maxDelta);
    vz = moveToward(vz, targetVz, maxDelta);
  } else {
    [vx, vz] = decelerate(vx, vz, MOVE_DECEL, moveDt);
  }

  ctx.moveVelocityX = vx;
  ctx.moveVelocityZ = vz;

  const currentSpeed = Math.hypot(vx, vz);
  ctx.isBackingUp = false;

  if (currentSpeed > 1e-4) {
    _move.set(vx * moveDt, 0, vz * moveDt);

    const swept = sweepWithBvh(bvh, pos, footOffset, _move.x, _move.z);
    pos.x += swept.dx;
    pos.z += swept.dz;

    // Turn toward movement; on S the camera stays fixed so you see the character face you.
    if (hasMoveInput) {
      _faceDir.copy(_moveDir);
      ctx.isBackingUp = inputForward < 0 && Math.abs(inputForward) >= Math.abs(inputTurn);
    } else {
      _faceDir.set(vx, 0, vz).normalize();
    }

    const targetYaw = Math.atan2(_faceDir.x, _faceDir.z);
    const currentYaw = ctx.character.rotation?.y ?? 0;
    const yawDelta = (targetYaw - currentYaw + Math.PI) % (Math.PI * 2) - Math.PI;
    const turnRate = ctx.isBackingUp
      ? ROT_BACKUP_RATE
      : diagonalMove
        ? ROT_DIAGONAL_TURN_RATE
        : ROT_TURN_RATE;
    const turnBlend = 1 - Math.exp(-turnRate * moveDt);
    ctx.character.rotation.y = currentYaw + yawDelta * turnBlend;
  }

  depenetrateWithBvh(bvh, pos, footOffset);

  const feetY = pos.y - footOffset;
  const floorY = findFloorY(ctx, pos.x, pos.z, feetY);
  const airborne = (ctx.verticalVelocity ?? 0) > 0.05;

  if (!airborne && floorY !== null) {
    const supported = followFloor(pos, footOffset, floorY, currentSpeed, moveDt);
    ctx.isGrounded = supported;

    if (supported) {
      ctx.verticalVelocity = 0;
      if (ctx.jumpPressed) {
        ctx.verticalVelocity = JUMP_VELOCITY;
        //TEST
        const p = ctx.character.position;
        console.log('Jump start:', { x: p.x, y: p.y, z: p.z });
        ctx.isGrounded = false;
        ctx.jumpPressed = false;
      }
    }
  } else {
    ctx.isGrounded = false;
    if (ctx.jumpPressed) ctx.jumpPressed = false;
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

  checkInteractableContact(ctx);
}
