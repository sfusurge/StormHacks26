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
