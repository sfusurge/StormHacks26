import * as THREE from 'three';

const CAMERA_POSITION_RATE = 3.7;
const CAMERA_LOOK_RATE = 10;
const CAMERA_COLLISION_LERP = 0.1;
const CAMERA_RETURN_SPEED = 0.4;
const MAX_CAMERA_DT = 0.033;
const MAX_OFFCENTER_FRAC = 0.35;

// Reusable temporaries — avoids ~480 Vector3 allocations per second at 60fps
const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _offset = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _dirNorm = new THREE.Vector3();
const _vMin = new THREE.Vector3();
const _vMax = new THREE.Vector3();
const _newPos = new THREE.Vector3();
const _lookLag = new THREE.Vector3();
const _headOffset = new THREE.Vector3(0, 0.45, 0);

// stiffness and damping ramp with the size of the yaw error
// small corrections stay soft
// large ones (a sharp turn, stepping off a ladder) catch up quickly
function springCameraYaw(
  ctx: any,
  targetYaw: number,
  stiffMin: number,
  stiffMax: number,
  dampMin: number,
  dampMax: number
) {
  const cameraDiff =
    THREE.MathUtils.euclideanModulo(
      targetYaw - ctx.cameraYaw + Math.PI,
      Math.PI * 2
    ) - Math.PI;

  const angle = THREE.MathUtils.smoothstep(Math.abs(cameraDiff), 0, Math.PI);
  const stiffness = THREE.MathUtils.lerp(stiffMin, stiffMax, angle);
  const damping = THREE.MathUtils.lerp(dampMin, dampMax, angle);

  // clamp dt so a large catchup frame doesn't overshoot the spring and cause camera to oscillate wildly
  const dt = Math.min(ctx.dt ?? 0, MAX_CAMERA_DT);

  const accel = stiffness * cameraDiff - damping * ctx.cameraYawVelocity;
  ctx.cameraYawVelocity += accel * dt;
  ctx.cameraYaw += ctx.cameraYawVelocity * dt;
}

export function updateCamera(ctx: any) {
  const isFocused = !!ctx.focusTarget;

  // target is the focused object position or character head position
  if (isFocused) {
    _target.copy(ctx.focusTarget.lookAt || ctx.focusTarget.position);
  } else if (ctx.character) {
    _target.copy((ctx.character as any).position || _target.set(0, 0, 0));
    _target.add(_headOffset);
  } else {
    _target.set(0, 0, 0);
    _target.add(_headOffset);
  }

  // When focused on an object, zoom in to a closer distance (e.g. 0.95m)
  const followDist = isFocused
      ? 0.95
      : THREE.MathUtils.clamp(ctx.cameraDistance, ctx.minCameraDistance, ctx.maxCameraDistance);

  ctx.cameraYawVelocity ??= 0;
  ctx.cameraYaw ??= 0;
  ctx.desiredCameraYaw ??= ctx.cameraYaw;

// orbit mode: compute spherical offset from yaw/pitch when dragging
  if (ctx.isPointerDown) {
    const yaw = ctx.cameraYaw;
    const pitch = THREE.MathUtils.clamp(ctx.cameraPitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    const cosP = Math.cos(pitch);
    _offset.set(
      followDist * cosP * Math.sin(yaw),
      followDist * Math.sin(pitch),
      followDist * cosP * Math.cos(yaw)
    );
    _desired.copy(_target).add(_offset);
// third-person follow: settle the camera behind the character with a damped spring
  } else {
    if (isFocused) {
      // hold the current angle/velocity while zoomed onto a marker
      // releasing velocity/angle resumes from a calm spring instead of a snap
      ctx.cameraYawVelocity = 0;
    } else if (ctx.isClimbing && ctx.character) {
      // always keep camera behind character while climbing
      ctx.desiredCameraYaw = ctx.character.rotation.y;
      springCameraYaw(ctx, ctx.desiredCameraYaw, 7, 22, 6, 9);
    } else if (ctx.character) {
      // compute the direction the camera should eventually face
      _forward.set(0, 0, 0);
      ctx.character.getWorldDirection(_forward);
      _forward.y = 0;
      if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, 1);
      _forward.normalize();

      const followYaw = Math.atan2(_forward.x, _forward.z);

      if (!ctx.isBackingUp) {
        const desiredDiff =
          THREE.MathUtils.euclideanModulo(
            followYaw - ctx.desiredCameraYaw + Math.PI,
            Math.PI * 2
          ) - Math.PI;

        // move target slowly toward the character's forward direction so camera doesn't swing too far inward
        const dt = Math.min(ctx.dt ?? 0, MAX_CAMERA_DT);
        ctx.desiredCameraYaw += desiredDiff * (1 - Math.exp(-CAMERA_RETURN_SPEED * dt));

        springCameraYaw(ctx, ctx.desiredCameraYaw, 7, 30, 9, 12);
      } else {
        // kill spring momentum when backing up so camera doesn't swing too far inward
        ctx.cameraYawVelocity = 0;
      }
    }

    // Orbit at the smoothed camera yaw so turning does not swing collision rays inward.
    _desired.set(
      _target.x - Math.sin(ctx.cameraYaw) * followDist,
      _target.y + Math.max(0.1, followDist * 0.12),
      _target.z - Math.cos(ctx.cameraYaw) * followDist
    );
  }

  if (ctx.roomBox) {
    const margin = ctx.cameraMargin;
    _vMin.set(ctx.roomBox.min.x + margin, ctx.roomBox.min.y + ctx.cameraVerticalMargin, ctx.roomBox.min.z + margin);
    _vMax.set(ctx.roomBox.max.x - margin, ctx.roomBox.max.y - ctx.cameraVerticalMargin, ctx.roomBox.max.z - margin);

// compute ray direction from target to desired to check bounds and collisions
    _dir.subVectors(_desired, _target);
    let alpha = 1;
    if (_dir.x !== 0) {
      if (_dir.x > 0) alpha = Math.min(alpha, (_vMax.x - _target.x) / _dir.x);
      else alpha = Math.min(alpha, (_vMin.x - _target.x) / _dir.x);
    }
    if (_dir.y !== 0) {
      if (_dir.y > 0) alpha = Math.min(alpha, (_vMax.y - _target.y) / _dir.y);
      else alpha = Math.min(alpha, (_vMin.y - _target.y) / _dir.y);
    }
    if (_dir.z !== 0) {
      if (_dir.z > 0) alpha = Math.min(alpha, (_vMax.z - _target.z) / _dir.z);
      else alpha = Math.min(alpha, (_vMin.z - _target.z) / _dir.z);
    }
    alpha = Math.max(0, Math.min(1, alpha));

    const dirLen = _dir.length();
    if (dirLen > 1e-6) {
      _dirNorm.copy(_dir).normalize();
      const clampedDist = dirLen * alpha;

      let targetDist = clampedDist;
// raycast toward desired position and shorten if a wall is hit
      try {
        ctx.raycaster.set(_target, _dirNorm);
        ctx.raycaster.far = clampedDist;
        const hits = ctx.raycaster.intersectObjects(ctx.collidableMeshes, true);
        if (hits && hits.length) {
          const hitDist = hits[0].distance;
          targetDist = Math.min(targetDist, Math.max(0.05, hitDist - 0.05));
        }
      } catch {}

      // Keep full follow distance when nothing is blocking; only pull in for real obstructions.
      if (targetDist >= followDist - 0.02) targetDist = followDist;

      if (ctx.smoothCameraDist == null) ctx.smoothCameraDist = followDist;
      const distLerp = targetDist >= followDist - 0.01 ? 0.2 : CAMERA_COLLISION_LERP;
      ctx.smoothCameraDist = THREE.MathUtils.lerp(ctx.smoothCameraDist, targetDist, distLerp);

// move camera inward along the ray to the smoothed distance
      _newPos.copy(_target).addScaledVector(_dirNorm, ctx.smoothCameraDist);
      _desired.copy(_newPos);
    } else {
      _desired.copy(_target);
    }
  }

// final per-axis clamp to ensure camera stays inside room
  if (ctx.roomBox) {
    const margin = ctx.cameraMargin;
    _vMin.set(ctx.roomBox.min.x + margin, ctx.roomBox.min.y + ctx.cameraVerticalMargin, ctx.roomBox.min.z + margin);
    _vMax.set(ctx.roomBox.max.x - margin, ctx.roomBox.max.y - ctx.cameraVerticalMargin, ctx.roomBox.max.z - margin);
    _desired.x = THREE.MathUtils.clamp(_desired.x, _vMin.x, _vMax.x);
    _desired.y = THREE.MathUtils.clamp(_desired.y, _vMin.y, _vMax.y);
    _desired.z = THREE.MathUtils.clamp(_desired.z, _vMin.z, _vMax.z);
  }

// smooth camera movement toward desired and look at target
  const smoothDt = Math.min(ctx.dt ?? 0, MAX_CAMERA_DT);

  ctx.camera.position.lerp(_desired, 1 - Math.exp(-CAMERA_POSITION_RATE * smoothDt));

  if (!ctx.smoothCameraLookTarget) {
    ctx.smoothCameraLookTarget = _target.clone();
  }
  ctx.smoothCameraLookTarget.lerp(_target, 1 - Math.exp(-CAMERA_LOOK_RATE * smoothDt));

  // limit how far the camera look target can move from the center
  // use the current camera distance, FOV, and aspect ratio so it stays correct when the camera moves or the screen size changes
  const hHalfFov = Math.atan(
    Math.tan(THREE.MathUtils.degToRad(ctx.camera.fov) * 0.5) * ctx.camera.aspect
  );
  const maxLag = (ctx.smoothCameraDist ?? followDist) * Math.tan(hHalfFov) * MAX_OFFCENTER_FRAC;

  _lookLag.subVectors(_target, ctx.smoothCameraLookTarget);
  if (_lookLag.lengthSq() > maxLag * maxLag) {
    ctx.smoothCameraLookTarget.copy(_target).addScaledVector(_lookLag.normalize(), -maxLag);
  }

  ctx.camera.lookAt(ctx.smoothCameraLookTarget);
}
