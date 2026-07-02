import * as THREE from 'three';
import { findSpawnFloorY } from './floorQuery';

export function alignCharacterToFloor(character: THREE.Object3D | null, roomBox: THREE.Box3 | null) {
  if (!character) return;
  const charBox = new THREE.Box3().setFromObject(character);
  const floorY = roomBox ? roomBox.min.y : 0;
  character.position.y += floorY - charBox.min.y;
}

export function clampCharacterToRoom(
    character: THREE.Object3D,
    roomBox: THREE.Box3,
    margin = 0.35
) {
  character.position.x = THREE.MathUtils.clamp(
      character.position.x,
      roomBox.min.x + margin,
      roomBox.max.x - margin
  );
  character.position.z = THREE.MathUtils.clamp(
      character.position.z,
      roomBox.min.z + margin,
      roomBox.max.z - margin
  );
}

export function getFootOffset(character: THREE.Object3D): number {
  const charBox = new THREE.Box3().setFromObject(character);
  return character.position.y - charBox.min.y;
}

/** Place character feet on the walkable floor at x/z. Returns false if no hit. */
export function snapCharacterToFloor(
    character: THREE.Object3D,
    x: number,
    z: number,
    ctx: {
      collidableMeshes: THREE.Mesh[];
      raycaster: THREE.Raycaster;
      roomBox?: THREE.Box3 | null;
      collisionBounds?: THREE.Box3 | null;
    }
): boolean {
  character.updateMatrixWorld(true);
  const footOffset = getFootOffset(character);
  const feetY = character.position.y - footOffset;
  const floorY = findSpawnFloorY(ctx, x, z, feetY);
  if (floorY === null) return false;

  character.position.set(x, floorY + footOffset, z);
  return true;
}