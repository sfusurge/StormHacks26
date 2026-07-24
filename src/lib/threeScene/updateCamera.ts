import * as THREE from 'three';

const CAMERA_POSITION_LERP = 0.06;
const CAMERA_LOOK_LERP = 0.04;
const CAMERA_COLLISION_LERP = 0.1;

export function updateCamera(ctx: any) {
// target is the character head position (used as camera focus)
  const target = new THREE.Vector3();
  if (ctx.character) target.copy((ctx.character as any).position || new THREE.Vector3());
  target.add(new THREE.Vector3(0, 0.6, 0));

  const followDist = THREE.MathUtils.clamp(ctx.cameraDistance, ctx.minCameraDistance, ctx.maxCameraDistance);
  let desired = new THREE.Vector3();

  ctx.cameraYawVelocity ??= 0;
  ctx.cameraYaw ??= 0;

// orbit mode: compute spherical offset from yaw/pitch when dragging
  if (ctx.isPointerDown) {
    const yaw = ctx.cameraYaw;
    const pitch = THREE.MathUtils.clamp(ctx.cameraPitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    const cosP = Math.cos(pitch);
    const offset = new THREE.Vector3(
      followDist * cosP * Math.sin(yaw),
      followDist * Math.sin(pitch),
      followDist * cosP * Math.cos(yaw)
    );
    desired.copy(target).add(offset);
  } else if (ctx.isClimbing) {
    // always keep camera behind character while climbing
    const followYaw = ctx.character.rotation.y;

    const yawDiff =
      THREE.MathUtils.euclideanModulo(
        followYaw - ctx.cameraYaw + Math.PI,
        Math.PI * 2
      ) - Math.PI;

    const angle = THREE.MathUtils.smoothstep(
      Math.abs(yawDiff),
      0,
      Math.PI
    );

    const stiffness = THREE.MathUtils.lerp(
      7,
      22,
      angle
    );

    const damping = THREE.MathUtils.lerp(
      6,
      9,
      angle
    );

    const accel = stiffness * yawDiff - damping * ctx.cameraYawVelocity;

    ctx.cameraYawVelocity += accel * ctx.dt;

    ctx.cameraYaw += ctx.cameraYawVelocity * ctx.dt;

    desired.set(
      target.x - Math.sin(ctx.cameraYaw) * followDist,
      target.y + Math.max(0.1, followDist * 0.12),
      target.z - Math.cos(ctx.cameraYaw) * followDist
    );
// third-person follow: position camera behind character except when backing up, then orbit at smoothed yaw
  } else {
    // compute the direction the camera should eventually face
    const forward = new THREE.Vector3();
    ctx.character.getWorldDirection(forward);
    forward.y = 0;

    if (forward.lengthSq() < 1e-6) {
      forward.set(0, 0, 1);
    }

    forward.normalize();

    const followYaw = Math.atan2(forward.x, forward.z);

    if (!ctx.isBackingUp) {
      const yawDiff =
        THREE.MathUtils.euclideanModulo(
          followYaw - ctx.cameraYaw + Math.PI,
          Math.PI * 2
        ) - Math.PI;

      const angle = THREE.MathUtils.smoothstep(
        Math.abs(yawDiff),
        0,
        Math.PI
      );

      const stiffness = THREE.MathUtils.lerp(
        7,
        30,
        angle
      );

      const damping = THREE.MathUtils.lerp(
        9,
        12,
        angle
      );

      const accel = stiffness * yawDiff - damping * ctx.cameraYawVelocity;

      ctx.cameraYawVelocity += accel * ctx.dt;

      ctx.cameraYaw += ctx.cameraYawVelocity * ctx.dt;
  } else {
    // make velocity slower when backing up so camera doesn't swing too far inward
    ctx.cameraYawVelocity *= 0.01;
  }

    // Orbit at the smoothed camera yaw so turning does not swing collision rays inward.
    desired.set(
      target.x - Math.sin(ctx.cameraYaw) * followDist,
      target.y + Math.max(0.1, followDist * 0.12),
      target.z - Math.cos(ctx.cameraYaw) * followDist
    );
  }

  if (ctx.roomBox) {
    const margin = ctx.cameraMargin;
    const vMin = new THREE.Vector3(ctx.roomBox.min.x + margin, ctx.roomBox.min.y + ctx.cameraVerticalMargin, ctx.roomBox.min.z + margin);
    const vMax = new THREE.Vector3(ctx.roomBox.max.x - margin, ctx.roomBox.max.y - ctx.cameraVerticalMargin, ctx.roomBox.max.z - margin);

// compute ray direction from target to desired to check bounds and collisions
    const dir = new THREE.Vector3().subVectors(desired, target);
    let alpha = 1;
    if (dir.x !== 0) {
      if (dir.x > 0) alpha = Math.min(alpha, (vMax.x - target.x) / dir.x);
      else alpha = Math.min(alpha, (vMin.x - target.x) / dir.x);
    }
    if (dir.y !== 0) {
      if (dir.y > 0) alpha = Math.min(alpha, (vMax.y - target.y) / dir.y);
      else alpha = Math.min(alpha, (vMin.y - target.y) / dir.y);
    }
    if (dir.z !== 0) {
      if (dir.z > 0) alpha = Math.min(alpha, (vMax.z - target.z) / dir.z);
      else alpha = Math.min(alpha, (vMin.z - target.z) / dir.z);
    }
    alpha = Math.max(0, Math.min(1, alpha));

    const dirLen = dir.length();
    if (dirLen > 1e-6) {
      const dirNorm = dir.clone().normalize();
      const clampedDist = dirLen * alpha;

      let targetDist = clampedDist;
// raycast toward desired position and shorten if a wall is hit
      try {
        ctx.raycaster.set(target, dirNorm);
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
      const newPos = new THREE.Vector3().copy(target).addScaledVector(dirNorm, ctx.smoothCameraDist);
      desired.copy(newPos);
    } else {
      desired.copy(target);
    }
  }

// final per-axis clamp to ensure camera stays inside room
  if (ctx.roomBox) {
    const margin = ctx.cameraMargin;
    const vMin = new THREE.Vector3(ctx.roomBox.min.x + margin, ctx.roomBox.min.y + ctx.cameraVerticalMargin, ctx.roomBox.min.z + margin);
    const vMax = new THREE.Vector3(ctx.roomBox.max.x - margin, ctx.roomBox.max.y - ctx.cameraVerticalMargin, ctx.roomBox.max.z - margin);
    desired.x = THREE.MathUtils.clamp(desired.x, vMin.x, vMax.x);
    desired.y = THREE.MathUtils.clamp(desired.y, vMin.y, vMax.y);
    desired.z = THREE.MathUtils.clamp(desired.z, vMin.z, vMax.z);
  }

// smooth camera movement toward desired and look at target
  ctx.camera.position.lerp(desired, CAMERA_POSITION_LERP);
  if (!ctx.smoothCameraLookTarget) {
    ctx.smoothCameraLookTarget = target.clone();
  }
  ctx.smoothCameraLookTarget.lerp(target, CAMERA_LOOK_LERP);
  ctx.camera.lookAt(ctx.smoothCameraLookTarget);
}