import * as THREE from 'three';

export function updateCamera(ctx: any, dt: number) {
// target is the character head position (used as camera focus)
  const target = new THREE.Vector3();
  if (ctx.character) target.copy((ctx.character as any).position || new THREE.Vector3());
  target.add(new THREE.Vector3(0, 0.6, 0));

  let desired = new THREE.Vector3();

// orbit mode: compute spherical offset from yaw/pitch when dragging
  if (ctx.isPointerDown) {
    const yaw = ctx.cameraYaw;
    const pitch = THREE.MathUtils.clamp(ctx.cameraPitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    const r = THREE.MathUtils.clamp(ctx.cameraDistance, ctx.minCameraDistance, ctx.maxCameraDistance);
    const cosP = Math.cos(pitch);
    const offset = new THREE.Vector3(
      r * cosP * Math.sin(yaw),
      r * Math.sin(pitch),
      r * cosP * Math.cos(yaw)
    );
    desired.copy(target).add(offset);
// third-person follow: position camera behind character based on facing
  } else {
    const followDist = THREE.MathUtils.clamp(ctx.cameraDistance, ctx.minCameraDistance, ctx.maxCameraDistance);
    const forward = new THREE.Vector3();
    ctx.character.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
    forward.normalize();
    desired.copy(target).addScaledVector(forward, -followDist);
// raise camera above target slightly for better view
    desired.y += Math.max(0.1, followDist * 0.12);
// smoothly align camera yaw toward character facing
    const desiredYaw = Math.atan2(forward.x, forward.z);
    const yawDiff = (desiredYaw - ctx.cameraYaw + Math.PI) % (Math.PI * 2) - Math.PI;
    ctx.cameraYaw += yawDiff * 0.35;
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
      const smoothDist = THREE.MathUtils.lerp(dirLen, clampedDist, 0.9);

      let finalDist = smoothDist;
// raycast toward desired position and shorten if a wall is hit
      try {
        ctx.raycaster.set(target, dirNorm);
        ctx.raycaster.far = smoothDist;
        const hits = ctx.raycaster.intersectObjects(ctx.collidableMeshes, true);
        if (hits && hits.length) {
          const hitDist = hits[0].distance;
          finalDist = Math.min(finalDist, Math.max(0.05, hitDist - 0.05));
        }
      } catch (e) {}

// move camera inward along the ray to finalDist
      const newPos = new THREE.Vector3().copy(target).addScaledVector(dirNorm, finalDist);
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
  ctx.camera.position.lerp(desired, 0.18);
  ctx.camera.lookAt(target);
}
