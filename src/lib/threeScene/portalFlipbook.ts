import * as THREE from 'three';

const PORTAL_FRAME_PREFIX = 'PortalFrame_';
export const PORTAL_FLIPBOOK_FPS = 24;
export const PORTAL_FLIPBOOK_FRAME_COUNT = 150;

let cachedFrames: THREE.Mesh[] | null = null;

function getPortalFlipbookFrames(root: THREE.Object3D): THREE.Mesh[] {
  if (cachedFrames) return cachedFrames;

  cachedFrames = [];
  root.traverse((node) => {
    if ((node as THREE.Mesh).isMesh && node.name.startsWith(PORTAL_FRAME_PREFIX)) {
      cachedFrames!.push(node as THREE.Mesh);
    }
  });
  cachedFrames.sort((a, b) => a.name.localeCompare(b.name));
  return cachedFrames;
}

export function initPortalFlipbookVisibility(root: THREE.Object3D): void {
  const frames = getPortalFlipbookFrames(root);
  for (let i = 0; i < frames.length; i++) {
    frames[i].visible = i === 0;
    frames[i].scale.set(1, 1, 1);
  }
}

export function syncPortalFlipbookFromTime(root: THREE.Object3D | null, time: number): void {
  if (!root) return;

  const frames = getPortalFlipbookFrames(root);
  if (frames.length === 0) return;

  const activeIndex = Math.floor(time * PORTAL_FLIPBOOK_FPS) % frames.length;

  for (let i = 0; i < frames.length; i++) {
    frames[i].visible = i === activeIndex;
    frames[i].scale.set(1, 1, 1);
  }
}

export function resetPortalFlipbookCache(): void {
  cachedFrames = null;
}
