import * as THREE from 'three';

const _target = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _dirNorm = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _vMin = new THREE.Vector3();
const _vMax = new THREE.Vector3();
const _toCam = new THREE.Vector3();

function rayDistToRoomBounds(
  target: THREE.Vector3,
  dirNorm: THREE.Vector3,
  maxDist: number,
  vMin: THREE.Vector3,
  vMax: THREE.Vector3
): number {
  const dir = _dir.copy(dirNorm).multiplyScalar(maxDist);
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
  return maxDist * Math.max(0, Math.min(1, alpha));
}

function shortenAlongRay(
  ctx: any,
  target: THREE.Vector3,
  dirNorm: THREE.Vector3,
  maxDist: number,
  vMin: THREE.Vector3,
  vMax: THREE.Vector3
): number {
  let dist = rayDistToRoomBounds(target, dirNorm, maxDist, vMin, vMax);
  if (ctx.collidableMeshes?.length) {
    try {
      ctx.raycaster.set(target, dirNorm);
      ctx.raycaster.far = dist;
      const hits = ctx.raycaster.intersectObjects(ctx.collidableMeshes, true);
      if (hits?.length) {
        dist = Math.min(dist, Math.max(0.05, hits[0].distance - 0.05));
      }
    } catch {
      // keep bounds-only distance
    }
  }
  return dist;
}

function pullCameraTowardTarget(ctx: any, target: THREE.Vector3, minDist: number) {
  _toCam.subVectors(ctx.camera.position, target);
  const camDist = _toCam.length();
  if (camDist < 1e-6 || !ctx.collidableMeshes?.length) return;

  _toCam.multiplyScalar(1 / camDist);
  try {
    ctx.raycaster.set(target, _toCam);
    ctx.raycaster.far = camDist + 0.01;
    const hits = ctx.raycaster.intersectObjects(ctx.collidableMeshes, true);
    if (hits?.length) {
      const allowed = Math.max(minDist * 0.5, hits[0].distance - 0.05);
      if (allowed < camDist) {
        ctx.camera.position.copy(target).addScaledVector(_toCam, allowed);
      }
    }
  } catch {
    // ignore raycast failures
  }
}

export function updateCamera(ctx: any, dt: number) {
  const target = _target;
  if (ctx.character) target.copy((ctx.character as any).position || new THREE.Vector3());
  else target.set(0, 0, 0);
  target.add(new THREE.Vector3(0, 0.6, 0));

  const desired = _desired;

  if (ctx.isPointerDown) {
    const yaw = ctx.cameraYaw;
    const pitch = THREE.MathUtils.clamp(ctx.cameraPitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    const r = THREE.MathUtils.clamp(ctx.cameraDistance, ctx.minCameraDistance, ctx.maxCameraDistance);
    const cosP = Math.cos(pitch);
    desired.set(
      target.x + r * cosP * Math.sin(yaw),
      target.y + r * Math.sin(pitch),
      target.z + r * cosP * Math.cos(yaw)
    );
  } else {
    const followDist = THREE.MathUtils.clamp(ctx.cameraDistance, ctx.minCameraDistance, ctx.maxCameraDistance);

    ctx.character.getWorldDirection(_forward);
    _forward.y = 0;
    if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, 1);
    else _forward.normalize();

    if (!ctx.strafeCameraPivot) {
      const strafeOnly =
        (ctx.keys['a'] || ctx.keys['d'] || ctx.keys['arrowleft'] || ctx.keys['arrowright']) &&
        !(ctx.keys['w'] || ctx.keys['s'] || ctx.keys['arrowup'] || ctx.keys['arrowdown']);
      const desiredYaw = Math.atan2(_forward.x, _forward.z);
      const yawDiff = (desiredYaw - ctx.cameraYaw + Math.PI) % (Math.PI * 2) - Math.PI;
      ctx.cameraYaw += yawDiff * (strafeOnly ? 0.12 : 0.35);
    }

    const yaw = ctx.cameraYaw;
    desired.set(
      target.x - followDist * Math.sin(yaw),
      target.y + Math.max(0.1, followDist * 0.12),
      target.z - followDist * Math.cos(yaw)
    );
  }

  if (ctx.roomBox) {
    const margin = ctx.cameraMargin;
    _vMin.set(
      ctx.roomBox.min.x + margin,
      ctx.roomBox.min.y + ctx.cameraVerticalMargin,
      ctx.roomBox.min.z + margin
    );
    _vMax.set(
      ctx.roomBox.max.x - margin,
      ctx.roomBox.max.y - ctx.cameraVerticalMargin,
      ctx.roomBox.max.z - margin
    );

    _dir.subVectors(desired, target);
    const dirLen = _dir.length();
    if (dirLen > 1e-6) {
      _dirNorm.copy(_dir).multiplyScalar(1 / dirLen);
      const finalDist = shortenAlongRay(ctx, target, _dirNorm, dirLen, _vMin, _vMax);
      desired.copy(target).addScaledVector(_dirNorm, finalDist);
    } else {
      desired.copy(target);
    }
  }

  ctx.camera.position.lerp(desired, 0.18);
  pullCameraTowardTarget(ctx, target, ctx.minCameraDistance);
  ctx.camera.lookAt(target);
}
