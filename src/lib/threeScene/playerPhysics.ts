import * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
import { depenetrateWithBvh, sweepWithBvh } from './characterCollision';

export const PLAYER_PHYSICS_RADIUS = 0.15;
export const PLAYER_HEIGHT = 0.65;
const GRAVITY = -9.82;
const MAX_STEP_HEIGHT = 0.4;
const MAX_DROP = 0.4;
const FLOOR_FOLLOW = 14;

const _pos = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Lightweight player physics — replaces the cannon-es World + kinematic Body
 * that was only being used as a velocity holder.  Zero actual physics
 * simulation was running; the real collision logic uses BVH sweeps.
 *
 * This eliminates the ~30-50 MB cannon-es runtime overhead.
 */
export class PlayerPhysics {
  readonly radius = PLAYER_PHYSICS_RADIUS;
  isClimbing = false;
  coyoteTimer = 0;
  jumpBufferTimer = 0;
  isJumping = false;
  visualYOffset = 0;

  /** Position of the physics sphere center. */
  private posX = 0;
  private posY = 0;
  private posZ = 0;

  /** Velocity vector. */
  private velX = 0;
  private velY = 0;
  private velZ = 0;

  // ── Velocity API (replaces body.velocity) ──

  getHorizontalVelocity(): [number, number] {
    return [this.velX, this.velZ];
  }

  setHorizontalVelocity(vx: number, vz: number) {
    this.velX = vx;
    this.velZ = vz;
  }

  get velocity() {
    return { x: this.velX, y: this.velY, z: this.velZ };
  }

  // ── Position API (replaces body.position) ──

  get position() {
    return { x: this.posX, y: this.posY, z: this.posZ };
  }

  resetFromCharacter(position: THREE.Vector3, footOffset: number) {
    this.posX = position.x;
    this.posY = position.y - footOffset + this.radius;
    this.posZ = position.z;
    this.velX = 0;
    this.velY = 0;
    this.velZ = 0;
    this.visualYOffset = 0;
  }

  syncToCharacter(position: THREE.Vector3, footOffset: number) {
    position.set(
      this.posX,
      this.posY - this.radius + footOffset + this.visualYOffset,
      this.posZ
    );
  }

  jump(velocity: number) {
    this.velY = velocity;
    this.isJumping = true;
    this.visualYOffset = 0; // Reset visual offset on jump to avoid visual delay on launch
  }

  climb(velocity: number) {
    this.isClimbing = true;
    this.velY = velocity;
  }

  stopClimbing() {
    this.isClimbing = false;
  }

  isGrounded(
    findFloorY: (x: number, z: number, feetY: number) => number | null,
    footOffset: number
  ): boolean {
    if (this.velY > 0.12) return false;
    const feetY = this.posY - this.radius;
    const floorY = findFloorY(this.posX, this.posZ, feetY);
    if (floorY === null) return false;
    const dy = floorY + footOffset - (this.posY - this.radius + footOffset);
    return dy <= MAX_STEP_HEIGHT && dy >= -MAX_DROP;
  }

  step(
    dt: number,
    bvh: MeshBVH,
    footOffset: number,
    moveSpeed: number,
    findFloorY: (x: number, z: number, feetY: number) => number | null,
    raycaster: THREE.Raycaster,
    collidableMeshes: THREE.Mesh[]
  ) {
    const prevY = this.posY - this.radius + footOffset;

    _pos.set(
      this.posX,
      this.posY - this.radius + footOffset,
      this.posZ
    );

    const swept = sweepWithBvh(bvh, _pos, footOffset, this.velX * dt, this.velZ * dt);
    _pos.x += swept.dx;
    _pos.z += swept.dz;
    depenetrateWithBvh(bvh, _pos, footOffset);

    const feetY = _pos.y - footOffset;
    const floorY = findFloorY(_pos.x, _pos.z, feetY);
    const airborne = this.velY > 0.05;
    let grounded = false;

    if (!airborne && floorY !== null) {
      grounded = followFloor(_pos, footOffset, floorY, moveSpeed, dt);
      if (grounded && this.velY < 0) this.velY = 0;
    }

    if (!grounded) {
      if (this.isClimbing) {
        _pos.y += this.velY * dt;
      } else {
        let gravityScale = 1.0;
        if (this.velY > 0) {
          // Normal rise: make it bouncier/loftier near the apex
          if (this.velY < 1.5) {
            gravityScale = 0.6; // Hang time at apex
          } else {
            gravityScale = 0.95; // Slightly lower gravity for bouncier rise
          }
        } else {
          // Falling: snappy descent, but smooth near the apex transition
          if (this.velY > -1.5) {
            gravityScale = 0.6; // Hang time at apex
          } else {
            gravityScale = 1.5; // Snappy falling descent
          }
        }

        this.velY += GRAVITY * gravityScale * dt;

        // Terminal velocity clamp to prevent falling through floor
        if (this.velY < -12.0) {
          this.velY = -12.0;
        }

        _pos.y += this.velY * dt;
      }

      if (this.velY > 0) {
        const prevYPos = _pos.y - this.velY * dt;
        _origin.set(_pos.x, prevYPos - footOffset + PLAYER_HEIGHT, _pos.z);
        raycaster.set(_origin, _up);
        raycaster.far = _pos.y - prevYPos + 0.15;
        const hits = raycaster.intersectObjects(collidableMeshes, true);
        if (hits.length > 0) {
          _pos.y = hits[0].point.y - PLAYER_HEIGHT + footOffset;
          this.velY = 0;
        }
      } else {
        const landFloor = findFloorY(_pos.x, _pos.z, _pos.y - footOffset);
        if (landFloor !== null) {
          const targetY = landFloor + footOffset;
          if (_pos.y <= targetY + 0.05) {
            _pos.y = targetY;
            this.velY = 0;
            grounded = true;
            this.isJumping = false;
          }
        }
      }
    }

    this._grounded = grounded;
    this.posX = _pos.x;
    this.posY = _pos.y - footOffset + this.radius;
    this.posZ = _pos.z;

    // Visual step smoothing logic:
    if (grounded) {
      const newY = _pos.y;
      const deltaY = newY - prevY;
      if (Math.abs(deltaY) < MAX_STEP_HEIGHT + 0.1) {
        this.visualYOffset -= deltaY;
      }
      // Smoothly blend visual Y back to physics Y
      this.visualYOffset *= Math.exp(-12.0 * dt);
      if (Math.abs(this.visualYOffset) < 0.001) {
        this.visualYOffset = 0;
      }
    } else {
      // Faster decay when airborne to prevent lagging behind jumps/falls
      this.visualYOffset *= Math.exp(-24.0 * dt);
      if (Math.abs(this.visualYOffset) < 0.001) {
        this.visualYOffset = 0;
      }
    }
  }

  private _grounded = true;

  get grounded() {
    return this._grounded;
  }

  dispose() {
    // No-op — no external resources to clean up (cannon-es world removed)
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

  // Snap the physical position immediately for solid physics collision response
  pos.y = targetY;

  return true;
}
