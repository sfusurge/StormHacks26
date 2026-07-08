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
  }

  syncToCharacter(position: THREE.Vector3, footOffset: number) {
    position.set(
      this.body.position.x,
      this.body.position.y - this.radius + footOffset,
      this.body.position.z
    );
  }

  jump(velocity: number) {
    this.body.velocity.y = velocity;
    this.body.wakeUp();
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
      vel.y += GRAVITY * dt;
      _pos.y += vel.y * dt;

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

  if (dy > 0.01) {
    const maxRise = moveSpeed * dt * 1.5;
    pos.y += Math.min(dy, maxRise);
  } else if (dy < -0.01) {
    pos.y += dy * Math.min(1, FLOOR_FOLLOW * dt);
  }

  return true;
}
