import * as THREE from 'three';
import { getFootOffset } from './alignCharacterToFloor';
import { findFloorY } from './floorQuery';
import { getCollisionBvh } from './characterCollision';
import type { PlayerPhysics } from './playerPhysics';

const MOVE_SPEED = 2.0;
const RUN_SPEED = 3.0;
const GROUND_ACCEL_RATE = 10.0;
const RUN_ACCEL_RATE = 13.0;
const AIR_ACCEL_RATE = 2.5;
const GROUND_DRAG = 6.0;
const AIR_DRAG = 0.5;
const MAX_MOVE_DT = 0.025;
const JUMP_VELOCITY = 3.00;
const CLIMB_VELOCITY = 1.6;
const SHIMMY_SPEED = 0.9;
const CLIMB_TIMESCALE = 2.3;
const LADDER_DETACH_TIME = 0.3;

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
      ctx.currentAction.paused = !ctx.climbInput;
    } else {
      // freeze idle/walk animation if not grounded
      ctx.currentAction.paused = !isGrounded;
    }
  }
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

  // Horizontal movement (exponential acceleration / decay)
  if (!ctx.isClimbing) {
    if (hasMoveInput) {
    _moveDir.normalize();
    const accelRate = wasGrounded 
      ? (ctx.keys['shift'] ? RUN_ACCEL_RATE : GROUND_ACCEL_RATE)
      : AIR_ACCEL_RATE;
    const targetVx = _moveDir.x * moveSpeed;
    const targetVz = _moveDir.z * moveSpeed;
    vx += (targetVx - vx) * (1 - Math.exp(-accelRate * moveDt));
    vz += (targetVz - vz) * (1 - Math.exp(-accelRate * moveDt));
  }
  else {
    const drag = wasGrounded ? GROUND_DRAG : AIR_DRAG;
    vx += (0 - vx) * (1 - Math.exp(-drag * moveDt));
    vz += (0 - vz) * (1 - Math.exp(-drag * moveDt));
    
    if (Math.hypot(vx, vz) < 0.05) {
      vx = 0;
      vz = 0;
    }
  }
  }
  else {
    // shimmy left/right while climbing, relative to the locked ladder-facing yaw
    const yaw = ctx.climbYaw ?? (ctx.character.rotation?.y ?? 0);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const targetVx = rightX * inputTurn * SHIMMY_SPEED;
    const targetVz = rightZ * inputTurn * SHIMMY_SPEED;
    // const maxDelta = GROUND_ACCEL_RATE * moveDt;
    vx += (targetVx - vx) * (1 - Math.exp(-GROUND_ACCEL_RATE * moveDt));
    vz += (targetVz - vz) * (1 - Math.exp(-GROUND_ACCEL_RATE * moveDt));
  }

  physics.setHorizontalVelocity(vx, vz);

  ctx.wasBackingUp = ctx.isBackingUp;
  ctx.isBackingUp = false;

  const isCurrentlyGrounded = physics.isGrounded(queryFloor, footOffset);

  const inLadderVolume =
    ctx.playerBox.intersectsBox(ctx.ladderBox) || ctx.playerBox.intersectsBox(ctx.bedLadderBox);

  // only climb if by ladder and pressing up, or if already climbing and not grounded
  const wantsClimb = !!ctx.keys['w'] || !!ctx.keys['arrowup'] || inputForward > 0.5;

  ctx.ladderDetachTimer = Math.max(0, (ctx.ladderDetachTimer ?? 0) - moveDt);

  if (!inLadderVolume || ctx.ladderDetachTimer > 0) {
    ctx.isClimbing = false;
  } else if (!ctx.isClimbing) {
    ctx.isClimbing = wantsClimb;
  } else {
    // let go once we're back on solid ground and no longer climbing up
    ctx.isClimbing = !(isCurrentlyGrounded && !wantsClimb);
  }

  // Jump buffering & coyote time updates
  if (ctx.jumpPressed) {
    physics.jumpBufferTimer = 0.15; // 150ms buffer window
    ctx.jumpPressed = false;
  } else {
    physics.jumpBufferTimer = Math.max(0, physics.jumpBufferTimer - moveDt);
  }

  if (isCurrentlyGrounded) {
    physics.coyoteTimer = 0.15; // 150ms coyote time window
  } else {
    physics.coyoteTimer = Math.max(0, physics.coyoteTimer - moveDt);
  }

  if (physics.jumpBufferTimer > 0) {
    if (ctx.isClimbing) {
      // jump off ladder
      physics.stopClimbing();
      ctx.isClimbing = false;
      ctx.climbYaw = undefined;
      // keep the ladder volume from re-latching mid-jump while up is still held
      ctx.ladderDetachTimer = LADDER_DETACH_TIME;
      physics.jump(JUMP_VELOCITY);
      physics.jumpBufferTimer = 0;
    } else if (physics.coyoteTimer > 0) {
      const jumpVelocity =
      THREE.MathUtils.lerp(
          JUMP_VELOCITY,
          JUMP_VELOCITY * 1.25,
          ctx.currentSpeed / RUN_SPEED // jump boost if moving fast
      );
      physics.jump(jumpVelocity);
      physics.jumpBufferTimer = 0;
      physics.coyoteTimer = 0;
    }
  }

  // ladder climbing logic
  if (ctx.isClimbing) {
    if (ctx.climbYaw === undefined) {
      // lock character rotation to camera direction when first entering ladder
      ctx.climbYaw = ctx.character.rotation?.y ?? 0;
    }
    ctx.character.rotation.y = ctx.climbYaw; // keep facing ladder

    const climbingUp = wantsClimb;
    const climbingDown = !!ctx.keys['s'] || !!ctx.keys['arrowdown'] || inputForward < -0.5;
    ctx.climbInput = climbingUp ? 1 : climbingDown ? -1 : 0;

    physics.climb(ctx.climbInput * CLIMB_VELOCITY); // 0 freezes on the ladder
  } else {
    ctx.climbInput = 0;
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
      const characterForward = new THREE.Vector3(
        Math.sin(ctx.character.rotation.y),
        0,
        Math.cos(ctx.character.rotation.y)
      );

      ctx.isBackingUp = hasMoveInput && _faceDir.dot(characterForward) < -0.3;
    } else {
      _faceDir.set(actualVx, 0, actualVz).normalize();
    }

    const targetYaw = Math.atan2(_faceDir.x, _faceDir.z);
    const currentYaw = ctx.character.rotation?.y ?? 0;
    const yawDelta = (targetYaw - currentYaw + Math.PI) % (Math.PI * 2) - Math.PI;

    const turnRate = THREE.MathUtils.lerp(
      12,
      24,
      ctx.currentSpeed / RUN_SPEED
    );
    const turnBlend = 1 - Math.exp(-turnRate * moveDt);
    ctx.character.rotation.y = currentYaw + yawDelta * turnBlend;
  }

  checkInteractableContact(ctx);

  updateAnimation(ctx, currentSpeed, ctx.isClimbing, ctx.isGrounded);
}
