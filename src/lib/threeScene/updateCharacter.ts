import * as THREE from 'three';
import { getFootOffset } from './alignCharacterToFloor';
import { findFloorY } from './floorQuery';
import { getCollisionBvh } from './characterCollision';
import type { PlayerPhysics } from './playerPhysics';

const MOVE_SPEED = 2.0;
const RUN_SPEED = 3.0;
const MOVE_ACCEL = 10;
const RUN_ACCEL = 10;
const MOVE_DECEL = 7;
// const ROT_IN_PLACE_RATE = 1.92;
const ROT_BACKUP_RATE = 16;
const MAX_MOVE_DT = 0.025;
const JUMP_VELOCITY = 3.05;
const CLIMB_VELOCITY = 1.6;
const SHIMMY_SPEED = 0.9;
const CLIMB_TIMESCALE = 2.3;

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
      ctx.playAnimation("climb", CLIMB_TIMESCALE);
    }
  } else if (speed > 0.1) {
    if (ctx.currentAction?.getClip().name !== "walk") {
      ctx.playAnimation("walk", 1.4 * (speed / MOVE_SPEED));
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
    pos.x - 0.15,
    pos.y,
    pos.z - 0.2
  );

  ctx.playerBox.max.set(
      pos.x + 0.15,
      pos.y + 0.6,
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

  const turning = Math.abs(inputTurn) > 1e-6;
  const hasForwardInput = Math.abs(inputForward) > 1e-6;
  const diagonalMove = hasForwardInput && turning;

  ctx.camera.getWorldDirection(_camForward);
  _camForward.y = 0;

  if (_camForward.lengthSq() < 1e-6) {
    _camForward.set(0, 0, -1);
  }

  _camForward.normalize();
  _camRight.crossVectors(_camForward, _up).normalize();

  // make the move direction relative to the camera orientation
  // so moving left/right walks sideways
  _moveDir
    .set(0, 0, 0)
    .addScaledVector(_camForward, inputForward)
    .addScaledVector(_camRight, -inputTurn);

  const hasMoveInput = _moveDir.lengthSq() > 1e-6;

  if (hasMoveInput) {
    _moveDir.normalize();
  }

  let [vx, vz] = physics.getHorizontalVelocity();

  const wasGrounded = physics.grounded;
  const inAir = !wasGrounded;

  if (!ctx.isClimbing) {
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
  }
  else {
    // shimmy left/right while climbing, relative to the locked ladder-facing yaw
    const yaw = ctx.climbYaw ?? (ctx.character.rotation?.y ?? 0);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const targetVx = rightX * inputTurn * SHIMMY_SPEED;
    const targetVz = rightZ * inputTurn * SHIMMY_SPEED;
    const maxDelta = MOVE_ACCEL * moveDt;
    vx = moveToward(vx, targetVx, maxDelta);
    vz = moveToward(vz, targetVz, maxDelta);
  }

  physics.setHorizontalVelocity(vx, vz);

  ctx.wasBackingUp = ctx.isBackingUp;
  ctx.isBackingUp = false;

  ctx.isClimbing = ctx.playerBox.intersectsBox(ctx.ladderBox) || ctx.playerBox.intersectsBox(ctx.bedLadderBox);
  ctx.climbYaw = undefined;

  if (ctx.jumpPressed) {
    if (ctx.isClimbing) {
      // jump off lader
      physics.stopClimbing();
      ctx.isClimbing = false;
      physics.jump(JUMP_VELOCITY);
    } else if (physics.isGrounded(queryFloor, footOffset)) {
      // normal jump from ground
      const jumpVelocity =
      THREE.MathUtils.lerp(
          JUMP_VELOCITY,
          JUMP_VELOCITY * 1.25,
          ctx.currentSpeed / RUN_SPEED // jump boost if moving fast
      );
      physics.jump(jumpVelocity);
    }
    ctx.jumpPressed = false;
  }

  // ladder climbing logic
  if (ctx.isClimbing) {
    if (ctx.climbYaw === undefined) {
      // lock character rotation to camera direction when first entering ladder
      ctx.climbYaw = ctx.character.rotation?.y ?? 0;
    }

    ctx.character.rotation.y = ctx.climbYaw; // keep facing ladder

    if (ctx.keys["w"]) {
      physics.climb(CLIMB_VELOCITY);
    } else if (ctx.keys["s"]) {
      physics.climb(-CLIMB_VELOCITY);
    } else {
      physics.climb(0); // freeze on ladder if no input
    }
  } else {
    physics.stopClimbing();
    ctx.climbYaw = undefined;
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
  // save current speed into context for camera yaw smoothing
  ctx.currentSpeed = currentSpeed;

  if (!ctx.isClimbing && (currentSpeed > 1e-4 || hasMoveInput)) { // only update facing direction if moving or has input, not when climbing
    if (hasMoveInput) {
      _faceDir.copy(_moveDir);
      ctx.isBackingUp = inputForward < 0 && Math.abs(inputForward) >= Math.abs(inputTurn);
    } else {
      _faceDir.set(actualVx, 0, actualVz).normalize();
    }

    const targetYaw = Math.atan2(_faceDir.x, _faceDir.z);
    const currentYaw = ctx.character.rotation?.y ?? 0;
    const yawDelta = (targetYaw - currentYaw + Math.PI) % (Math.PI * 2) - Math.PI;
    const normalTurn = THREE.MathUtils.lerp(12, 20,  ctx.currentSpeed / RUN_SPEED);
    const diagonalTurn = THREE.MathUtils.lerp(18, 28,  ctx.currentSpeed / RUN_SPEED);

    const turnRate = ctx.isBackingUp
      ? ROT_BACKUP_RATE
      : diagonalMove
        ? diagonalTurn
        : normalTurn;
    const turnBlend = 1 - Math.exp(-turnRate * moveDt);
    ctx.character.rotation.y = currentYaw + yawDelta * turnBlend;
  }

  checkInteractableContact(ctx);

  updateAnimation(ctx, currentSpeed, ctx.isClimbing, ctx.isGrounded);
}
