import * as THREE from 'three';

/** Align character feet to the room floor (Y only). */
export function alignCharacterToFloor(character: THREE.Object3D | null, roomBox: THREE.Box3 | null) {
  if (!character) return;
  try {
    const charBox = new THREE.Box3().setFromObject(character);
    const floorY = roomBox ? roomBox.min.y : 0;
    character.position.y += floorY - charBox.min.y;
  } catch (e) {
    console.warn('alignCharacterToFloor failed', e);
  }
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
