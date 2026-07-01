import * as THREE from 'three';
import { getFootOffset } from './alignCharacterToFloor';
import { findFloorY } from './floorQuery';
import {
  syncCharacterFromRapier,
  syncRapierFromCharacter,
  type RapierContext,
} from './rapierPhysics';

const MOVE_SPEED = 2.0;
const RUN_SPEED = 4.5;
const TURN_SPEED = 4.0;
const STRAFE_PIVOT_SPEED = 2.2;
const MAX_MOVE_DT = 0.025;
const BLOCKED_MOVE_RATIO = 0.12;

export function updateCharacter(ctx: any, dt: number) {
  if (!ctx.character || !ctx.roomLoaded || !ctx.roomBox) return;

  const rapier = ctx.rapier as RapierContext | null;
  if (!rapier) return;

  const moveDt = Math.min(dt, MAX_MOVE_DT);
  const pos = ctx.character.position;
  const footOffset = getFootOffset(ctx.character);

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

  let moveX = 0;
  let moveZ = 0;
  let hasMove = false;

  if (inputX !== 0 || inputZ !== 0) {
    const move = new THREE.Vector3()
      .addScaledVector(camForward, inputZ)
      .addScaledVector(camRight, inputX * 0.35);
    if (move.lengthSq() > 1e-6) {
      const speed = ctx.keys['shift'] ? RUN_SPEED : MOVE_SPEED;
      move.normalize().multiplyScalar(speed * moveDt);
      moveX = move.x;
      moveZ = move.z;
      hasMove = true;

      if (strafeOnly) {
        const desiredLen = Math.hypot(moveX, moveZ);
        rapier.controller.computeColliderMovement(
          rapier.characterCollider,
          { x: moveX, y: 0, z: moveZ }
        );
        const actual = rapier.controller.computedMovement();
        const actualLen = Math.hypot(actual.x, actual.z);
        if (desiredLen > 1e-6 && actualLen / desiredLen < BLOCKED_MOVE_RATIO) {
          ctx.cameraYaw += inputX * STRAFE_PIVOT_SPEED * moveDt;
          pivotStrafe = true;
        }
      }
    }
  }

  ctx.strafeCameraPivot = pivotStrafe;

  if (!pivotStrafe) {
    let verticalDelta = 0;
    const grounded = ctx.isGrounded ?? true;

    if (grounded) {
      ctx.verticalVelocity = 0;
      if (ctx.keys[' ']) {
        ctx.verticalVelocity = 5;
        ctx.isGrounded = false;
      }
    } else {
      ctx.verticalVelocity = (ctx.verticalVelocity ?? 0) - 9.82 * dt;
    }

    if (!ctx.isGrounded) {
      verticalDelta = ctx.verticalVelocity * dt;
    }

    if (hasMove) {
      rapier.controller.computeColliderMovement(
        rapier.characterCollider,
        { x: moveX, y: verticalDelta, z: moveZ }
      );
    } else if (verticalDelta !== 0 || !grounded) {
      rapier.controller.computeColliderMovement(
        rapier.characterCollider,
        { x: 0, y: verticalDelta, z: 0 }
      );
    } else {
      rapier.controller.computeColliderMovement(
        rapier.characterCollider,
        { x: 0, y: -0.05, z: 0 }
      );
    }

    const movement = rapier.controller.computedMovement();
    const t = rapier.characterBody.translation();
    rapier.characterBody.setNextKinematicTranslation({
      x: t.x + movement.x,
      y: t.y + movement.y,
      z: t.z + movement.z,
    });
    rapier.world.step();

    ctx.isGrounded = rapier.controller.computedGrounded();
    if (ctx.isGrounded) ctx.verticalVelocity = 0;

    syncCharacterFromRapier(rapier, ctx.character);

    if (hasMove) {
      const angle = Math.atan2(movement.x || moveX, movement.z || moveZ);
      const current = ctx.character.rotation?.y ?? 0;
      if (!(inputZ < 0 && Math.abs(inputZ) >= Math.abs(inputX))) {
        const angleDiff = (angle - current + Math.PI) % (Math.PI * 2) - Math.PI;
        ctx.character.rotation.y = current + angleDiff * Math.min(1, TURN_SPEED * moveDt);
      }
    }

    const supportY = findFloorY(rapier, ctx.roomBox.min.y, pos.x, pos.z, pos.y);
    if (supportY !== null) {
      const targetY = supportY + footOffset;
      if (pos.y < targetY && (ctx.verticalVelocity ?? 0) <= 0) {
        pos.y = targetY;
        ctx.verticalVelocity = 0;
        ctx.isGrounded = true;
        syncRapierFromCharacter(rapier, ctx.character);
      }
    }
  }
}
