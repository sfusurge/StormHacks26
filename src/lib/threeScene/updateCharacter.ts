import * as THREE from 'three';
import { getFootOffset } from './alignCharacterToFloor';
import { findFloorY } from './floorQuery';
import { getCollisionBvh } from './characterCollision';
import type { PlayerPhysics } from './playerPhysics';

const MOVE_SPEED = 2.0;
const RUN_SPEED = 3.6;
const MOVE_ACCEL = 10;
const RUN_ACCEL = 14;
const MOVE_DECEL = 12;
const ROT_TURN_RATE = 12;
const ROT_DIAGONAL_TURN_RATE = 18;
const ROT_IN_PLACE_RATE = 2;
const ROT_BACKUP_RATE = 16;
const MAX_MOVE_DT = 0.025;
const JUMP_VELOCITY = 3.5;
const CLIMB_VELOCITY = 1.7;

const _up = new THREE.Vector3(0, 1, 0);
const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _moveDir = new THREE.Vector3();
const _faceDir = new THREE.Vector3();
const _charPos = new THREE.Vector3();
const _portalPos = new THREE.Vector3();

function checkInteractableContact(ctx: {
  character?: THREE.Object3D;
  interactables?: THREE.Object3D[];
  portalInRange?: boolean;
}) {
  if (!ctx.character || !ctx.interactables?.length) return;

  ctx.character.updateMatrixWorld(true);
  ctx.character.getWorldPosition(_charPos);

  let nearestDistance = Infinity;
  let nearestPortal: { object: THREE.Object3D; url: string; name: string } | null = null;

  for (const obj of ctx.interactables) {
    const url = (obj as THREE.Object3D & { userData: { url?: string; name?: string } }).userData?.url;
    const name = (obj as THREE.Object3D & { userData: { name?: string } }).userData?.name || 'Portal';
    if (!url) continue;

    obj.updateMatrixWorld(true);
    obj.getWorldPosition(_portalPos);

    const dx = _charPos.x - _portalPos.x;
    const dz = _charPos.z - _portalPos.z;
    const dy = Math.abs(_charPos.y - _portalPos.y);
    const distanceSq = dx * dx + dz * dz;

    // In range if within 0.8 units horizontally and 1.2 units vertically
    const inRange = distanceSq <= 0.64 && dy <= 1.2;

    if (distanceSq < nearestDistance) {
      nearestDistance = distanceSq;
      if (inRange) {
        nearestPortal = { object: obj, url, name };
      }
    }
  }

  // Check if we've just entered portal range
  if (nearestPortal && !ctx.portalInRange) {
    ctx.portalInRange = true;
    window.dispatchEvent(new CustomEvent('show-speech', {
      detail: {
        title: nearestPortal.name,
        text: 'Click the arrow to enter this location.',
        portalUrl: nearestPortal.url
      }
    }));
  } else if (!nearestPortal && ctx.portalInRange) {
    ctx.portalInRange = false;
    window.dispatchEvent(new CustomEvent('hide-speech'));
  }
}

function updateAnimation(ctx: any, speed: number, isClimbing: boolean, isGrounded: boolean) {
  if (isClimbing) {
    if (ctx.currentAction?.getClip().name !== "climb") {
      ctx.playAnimation("climb");
    }
  } else if (speed > 0.1) {
    if (ctx.currentAction?.getClip().name !== "walk") {
      ctx.playAnimation("walk");
    }
  } else {
    if (ctx.currentAction?.getClip().name !== "idle") {
      ctx.playAnimation("idle");
    }
  }

  // freeze animation
  if (ctx.currentAction) {
    if (isClimbing) {
      // stop climbing animation if no input
      ctx.currentAction.paused = !ctx.keys["w"] && !ctx.keys["s"];
    } else {
      // freeze idle/walk animation if not grounded
      ctx.currentAction.paused = !isGrounded;
    }
  }
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
  if (!ctx.character || !ctx.roomLoaded || !ctx.roomBox || !ctx.playerPhysics) return;
  
  // Update playerBox based on character position and size
  const pos = ctx.character.position;
  ctx.playerBox.min.set(
    pos.x - 0.25,
    pos.y,
    pos.z - 0.2
  );

  ctx.playerBox.max.set(
      pos.x + 0.25,
      pos.y + 0.65,
      pos.z + 0.2
  );

  const bvh = getCollisionBvh(ctx);
  if (!bvh) return;

  const physics = ctx.playerPhysics as PlayerPhysics;
  const moveDt = Math.min(dt, MAX_MOVE_DT);
  const footOffset = getFootOffset(ctx.character);
  const moveSpeed = ctx.keys['shift'] ? RUN_SPEED : MOVE_SPEED;

  const queryFloor = (x: number, z: number, feetY: number) => findFloorY(ctx, x, z, feetY);

  let inputForward = 0;
  let inputTurn = 0;

  // Keyboard input
  if (ctx.keys['w'] || ctx.keys['arrowup']) inputForward += 1;
  if (ctx.keys['s'] || ctx.keys['arrowdown']) inputForward -= 1;
  if (ctx.keys['a'] || ctx.keys['arrowleft']) inputTurn += 1;
  if (ctx.keys['d'] || ctx.keys['arrowright']) inputTurn -= 1;

  // Joystick input (mobile)
  if (ctx.joystickInput) {
    const joyDeadzone = 0.25;
    const joyX = Math.abs(ctx.joystickInput.x) > joyDeadzone ? ctx.joystickInput.x : 0;
    const joyY = Math.abs(ctx.joystickInput.y) > joyDeadzone ? ctx.joystickInput.y : 0;
    
    // Joystick Y is forward/backward (inverted from screen coords)
    inputForward += -joyY * 0.6;
    // Joystick X is turning left/right (negated to match keyboard)
    inputTurn += -joyX * 0.6;
  }

  // Clamp inputs to [-1, 1]
  inputForward = Math.max(-1, Math.min(1, inputForward));
  inputTurn = Math.max(-1, Math.min(1, inputTurn));

  const movingForward = inputForward > 0;
  const turning = Math.abs(inputTurn) > 1e-6;
  const diagonalMove = movingForward && turning;

  if (turning && !diagonalMove) {
    const currentYaw = ctx.character.rotation?.y ?? 0;
    ctx.character.rotation.y = currentYaw + inputTurn * ROT_IN_PLACE_RATE * moveDt;
  }

  ctx.camera.getWorldDirection(_camForward);
  _camForward.y = 0;
  if (_camForward.lengthSq() < 1e-6) _camForward.set(0, 0, -1);
  _camForward.normalize();
  _camRight.crossVectors(_camForward, _up).normalize();

  if (diagonalMove) {
    _moveDir.copy(_camForward).addScaledVector(_camRight, -inputTurn);
  } else {
    _moveDir.set(0, 0, 0).addScaledVector(_camForward, inputForward);
  }

  const hasMoveInput = _moveDir.lengthSq() > 1e-6;
  let [vx, vz] = physics.getHorizontalVelocity();

  const wasGrounded = physics.grounded;
  const inAir = !wasGrounded;

  if (hasMoveInput) {
    _moveDir.normalize();
    const baseAccel = ctx.keys['shift'] ? RUN_ACCEL : MOVE_ACCEL;
    const accel = baseAccel * (inAir ? 0.35 : 1);
    const targetVx = _moveDir.x * moveSpeed;
    const targetVz = _moveDir.z * moveSpeed;
    const maxDelta = accel * moveDt;
    vx = moveToward(vx, targetVx, maxDelta);
    vz = moveToward(vz, targetVz, maxDelta);
  } else if (wasGrounded) {
    [vx, vz] = decelerate(vx, vz, MOVE_DECEL, moveDt);
  }

  physics.setHorizontalVelocity(vx, vz);

  ctx.isBackingUp = false;

  if (ctx.playerBox.intersectsBox(ctx.ladderBox)) {
    console.log('Player is intersecting ladder box');
  }

  // ladder climbing
  ctx.isClimbing = ctx.playerBox.intersectsBox(ctx.ladderBox);
  if (ctx.isClimbing) {
    if (ctx.keys['w']) {
      physics.climb(CLIMB_VELOCITY);
    }
    else if (ctx.keys['s']) {
      physics.climb(-CLIMB_VELOCITY);
    }
    else {
      physics.climb(0); // stay still on ladder
    }

  } else {
    physics.stopClimbing();
  }

  if (physics.isGrounded(queryFloor, footOffset) && ctx.jumpPressed) {
    physics.jump(JUMP_VELOCITY);
    ctx.jumpPressed = false;

  } else if (ctx.jumpPressed) {
    ctx.jumpPressed = false;
  }

  physics.step(
    dt,
    bvh,
    footOffset,
    moveSpeed,
    queryFloor,
    ctx.raycaster,
    ctx.collidableMeshes
  );
  physics.syncToCharacter(ctx.character.position, footOffset);
  ctx.isGrounded = physics.grounded;

  const [actualVx, actualVz] = physics.getHorizontalVelocity();
  const currentSpeed = Math.hypot(actualVx, actualVz);

  if (currentSpeed > 1e-4 || hasMoveInput) {
    if (hasMoveInput) {
      _faceDir.copy(_moveDir);
      ctx.isBackingUp = inputForward < 0 && Math.abs(inputForward) >= Math.abs(inputTurn);
    } else {
      _faceDir.set(actualVx, 0, actualVz).normalize();
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

  checkInteractableContact(ctx);

  updateAnimation(ctx, currentSpeed, ctx.isClimbing, ctx.isGrounded);
}
