import * as THREE from 'three';

const PORTAL_FRAME_PREFIX = 'PortalFrame_';
export const PORTAL_FLIPBOOK_FPS = 24;
export const PORTAL_FLIPBOOK_FRAME_COUNT = 150;

let cachedFramesMap = new WeakMap<THREE.Object3D, THREE.Mesh[]>();

function getPortalFlipbookFrames(root: THREE.Object3D): THREE.Mesh[] {
  if (cachedFramesMap.has(root)) {
    return cachedFramesMap.get(root)!;
  }

  const frames: THREE.Mesh[] = [];
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh && node.name.startsWith(PORTAL_FRAME_PREFIX)) {
      frames.push(node as THREE.Mesh);
    }
  });
  frames.sort((a, b) => a.name.localeCompare(b.name));
  cachedFramesMap.set(root, frames);
  return frames;
}

export function initPortalFlipbookVisibility(root: THREE.Object3D): void {
  if ((root as any).isLOD) {
    const lod = root as THREE.LOD;
    for (const level of lod.levels) {
      initPortalFlipbookVisibility(level.object);
    }
    return;
  }

  const frames = getPortalFlipbookFrames(root);
  for (let i = 0; i < frames.length; i++) {
    frames[i].visible = i === 0;
    frames[i].scale.set(1, 1, 1);
  }
}

/**
 * Dispose geometry of inactive flipbook frames to save ~80-150MB.
 *
 * Each of the 150 PortalFrame_ meshes carries its own geometry.
 * Only 1 frame is visible at any time, but all 150 geometries sit in RAM.
 * This function keeps the geometry of the first frame (needed for bounding
 * and UV reference) and disposes the rest.  The meshes stay in the tree so
 * syncPortalFlipbookFromTime can still toggle visibility.
 *
 * Because all frames share the same screen-space position, we reuse the
 * first frame's geometry for every visible frame at render time.
 */
export function disposeInactiveFlipbookFrames(root: THREE.Object3D | null): void {
  if (!root) return;

  const frames = getPortalFlipbookFrames(root);
  if (frames.length <= 1) return;

  const sharedGeometry = frames[0].geometry;
  if (!sharedGeometry) return;

  for (let i = 1; i < frames.length; i++) {
    const frame = frames[i];
    if (frame.geometry && frame.geometry !== sharedGeometry) {
      frame.geometry.dispose();
      // Replace with shared geometry so toggling visibility still works
      frame.geometry = sharedGeometry;
    }
  }
}

export function syncPortalFlipbookFromTime(root: THREE.Object3D | null, time: number): void {
  if (!root) return;

  if ((root as any).isLOD) {
    const lod = root as THREE.LOD;
    for (const level of lod.levels) {
      syncPortalFlipbookFromTime(level.object, time);
    }
    return;
  }

  const frames = getPortalFlipbookFrames(root);
  if (frames.length === 0) return;

  const activeIndex = Math.floor(time * PORTAL_FLIPBOOK_FPS) % frames.length;

  for (let i = 0; i < frames.length; i++) {
    frames[i].visible = i === activeIndex;
    frames[i].scale.set(1, 1, 1);
  }
}

export function resetPortalFlipbookCache(): void {
  cachedFramesMap = new WeakMap<THREE.Object3D, THREE.Mesh[]>();
}
