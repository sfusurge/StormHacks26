import * as THREE from 'three';

const CAMERA_POSITION_LERP = 0.06;
const CAMERA_YAW_FOLLOW = 0.08;
const CAMERA_LOOK_LERP = 0.04;
const CAMERA_COLLISION_LERP = 0.1;

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
const _headOffset = new THREE.Vector3(0, 0.45, 0);

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
// third-person follow: position camera behind target without changing camera angle if focused
  } else {
    if (!isFocused && !ctx.isBackingUp && ctx.character) {
      _forward.set(0, 0, 0);
      ctx.character.getWorldDirection(_forward);
      _forward.y = 0;
      if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, 1);
      _forward.normalize();
      const followYaw = Math.atan2(_forward.x, _forward.z);
      const yawDiff = (followYaw - ctx.cameraYaw + Math.PI) % (Math.PI * 2) - Math.PI;
      ctx.cameraYaw += yawDiff * CAMERA_YAW_FOLLOW;
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
  ctx.camera.position.lerp(_desired, CAMERA_POSITION_LERP);
  if (!ctx.smoothCameraLookTarget) {
    ctx.smoothCameraLookTarget = _target.clone();
  }
  ctx.smoothCameraLookTarget.lerp(_target, CAMERA_LOOK_LERP);
  ctx.camera.lookAt(ctx.smoothCameraLookTarget);
}
