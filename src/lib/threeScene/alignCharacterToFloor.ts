import * as THREE from 'three';

export function alignCharacterToFloor(character: THREE.Object3D | null, roomBox: THREE.Box3 | null, characterMargin = 1.5) {
  if (!character) return;
  try {
    const charBox = new THREE.Box3().setFromObject(character);
    if (roomBox) {
      const floorY = roomBox.min.y;
      const delta = floorY - charBox.min.y;
      character.position.y += delta;

      const margin = characterMargin;
      const minX = roomBox.min.x + margin;
      const maxX = roomBox.max.x - margin;
      const minZ = roomBox.min.z + margin;
      const maxZ = roomBox.max.z - margin;
      character.position.x = THREE.MathUtils.clamp(character.position.x, minX, maxX);
      character.position.z = THREE.MathUtils.clamp(character.position.z, minZ, maxZ);
    } else {
      const delta = 0 - charBox.min.y;
      character.position.y += delta;
    }
  } catch (e) {
    console.warn('alignCharacterToFloor failed', e);
  }
}
