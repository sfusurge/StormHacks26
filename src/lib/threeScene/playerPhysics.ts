import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
import { depenetrateWithBvh, sweepWithBvh } from './characterCollision';

export const PLAYER_PHYSICS_RADIUS = 0.15;
const GRAVITY = -9.82;
const MAX_STEP_HEIGHT = 0.4;
const MAX_DROP = 0.4;
const FLOOR_FOLLOW = 14;

const _pos = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Cannon-es kinematic body holds player velocity and state. Collision against
 * the room uses the BVH (cannon trimesh contact is too slow on the full mesh).
 */
export class PlayerPhysics {
  world: CANNON.World;
  body: CANNON.Body;
  readonly radius = PLAYER_PHYSICS_RADIUS;
  isClimbing = false;
  coyoteTimer = 0;
  jumpBufferTimer = 0;
  isJumping = false;
  visualYOffset = 0;

  constructor() {
    this.world = new CANNON.World();
    this.world.gravity.set(0, GRAVITY, 0);

    this.body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.KINEMATIC,
      fixedRotation: true,
      linearDamping: 0,
      allowSleep: false,
    });
    this.body.addShape(new CANNON.Sphere(this.radius));
    this.world.addBody(this.body);

    
  }

  getHorizontalVelocity(): [number, number] {
    return [this.body.velocity.x, this.body.velocity.z];
  }

  setHorizontalVelocity(vx: number, vz: number) {
    this.body.velocity.x = vx;
    this.body.velocity.z = vz;
  }

  resetFromCharacter(position: THREE.Vector3, footOffset: number) {
    this.body.position.set(
      position.x,
      position.y - footOffset + this.radius,
      position.z
    );
    this.body.velocity.set(0, 0, 0);
    this.body.wakeUp();
    this.visualYOffset = 0;
  }

  syncToCharacter(position: THREE.Vector3, footOffset: number) {
    position.set(
      this.body.position.x,
      this.body.position.y - this.radius + footOffset + this.visualYOffset,
      this.body.position.z
    );
  }

  jump(velocity: number) {
    this.body.velocity.y = velocity;
    this.body.wakeUp();
    this.isJumping = true;
    this.visualYOffset = 0; // Reset visual offset on jump to avoid visual delay on launch
  }

  climb(velocity: number) {
    this.isClimbing = true;
    this.body.velocity.y = velocity;
    this.body.wakeUp();
  }

  stopClimbing() {
    this.isClimbing = false;
  }

  isGrounded(
    findFloorY: (x: number, z: number, feetY: number) => number | null,
    footOffset: number
  ): boolean {
    if (this.body.velocity.y > 0.12) return false;
    const feetY = this.body.position.y - this.radius;
    const floorY = findFloorY(this.body.position.x, this.body.position.z, feetY);
    if (floorY === null) return false;
    const dy = floorY + footOffset - (this.body.position.y - this.radius + footOffset);
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
    const vel = this.body.velocity;
    const prevY = this.body.position.y - this.radius + footOffset;

    _pos.set(
      this.body.position.x,
      this.body.position.y - this.radius + footOffset,
      this.body.position.z
    );

    const swept = sweepWithBvh(bvh, _pos, footOffset, vel.x * dt, vel.z * dt);
    _pos.x += swept.dx;
    _pos.z += swept.dz;
    depenetrateWithBvh(bvh, _pos, footOffset);

    const feetY = _pos.y - footOffset;
    const floorY = findFloorY(_pos.x, _pos.z, feetY);
    const airborne = vel.y > 0.05;
    let grounded = false;

    if (!airborne && floorY !== null) {
      grounded = followFloor(_pos, footOffset, floorY, moveSpeed, dt);
      if (grounded && vel.y < 0) vel.y = 0;
    }

    if (!grounded) {
      if (this.isClimbing) {
        _pos.y += vel.y * dt;
      } else {
        let gravityScale = 1.0;
        if (vel.y > 0) {
          // Normal rise: make it bouncier/loftier near the apex
          if (vel.y < 1.5) {
            gravityScale = 0.6; // Hang time at apex
          } else {
            gravityScale = 0.95; // Slightly lower gravity for bouncier rise
          }
        } else {
          // Falling: snappy descent, but smooth near the apex transition
          if (vel.y > -1.5) {
            gravityScale = 0.6; // Hang time at apex
          } else {
            gravityScale = 1.5; // Snappy falling descent
          }
        }

        vel.y += GRAVITY * gravityScale * dt;

        // Terminal velocity clamp to prevent falling through floor
        if (vel.y < -12.0) {
          vel.y = -12.0;
        }

        _pos.y += vel.y * dt;
      }

      if (vel.y > 0) {
        const prevY = _pos.y - vel.y * dt;
        _origin.set(_pos.x, prevY - footOffset + 1.2, _pos.z);
        raycaster.set(_origin, _up);
        raycaster.far = _pos.y - prevY + 0.15;
        const hits = raycaster.intersectObjects(collidableMeshes, true);
        if (hits.length > 0) {
          _pos.y = hits[0].point.y - 1.2 + footOffset;
          vel.y = 0;
        }
      } else {
        const landFloor = findFloorY(_pos.x, _pos.z, _pos.y - footOffset);
        if (landFloor !== null) {
          const targetY = landFloor + footOffset;
          if (_pos.y <= targetY + 0.05) {
            _pos.y = targetY;
            vel.y = 0;
            grounded = true;
            this.isJumping = false;
          }
        }
      }
    }

    this._grounded = grounded;
    this.body.position.set(
      _pos.x,
      _pos.y - footOffset + this.radius,
      _pos.z
    );

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
    this.world.removeBody(this.body);
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
