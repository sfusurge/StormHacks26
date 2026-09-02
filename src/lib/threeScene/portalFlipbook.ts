import * as THREE from 'three';

const PORTAL_FRAME_PREFIX = 'PortalFrame_';
export const PORTAL_FLIPBOOK_FPS = 24;
export const PORTAL_FLIPBOOK_FRAME_COUNT = 150;
export const PORTAL_ATLAS_COLS = 15;
export const PORTAL_ATLAS_ROWS = 10;

const PORTAL_ATLAS_URL = new URL(
  '../../../assets/models/PortalAnimAtlas.webp',
  import.meta.url,
).href;

let cachedFramesMap = new WeakMap<THREE.Object3D, THREE.Mesh[]>();
let cachedAtlasPlanesMap = new WeakMap<THREE.Object3D, THREE.Mesh[]>();
let atlasTexture: THREE.Texture | null = null;
let atlasLoadPromise: Promise<THREE.Texture> | null = null;

export function isPortalMesh(node: THREE.Object3D): boolean {
  return /portal/i.test(node.name);
}

function isPortalFrameMesh(node: THREE.Object3D): boolean {
  return (node as THREE.Mesh).isMesh && node.name.startsWith(PORTAL_FRAME_PREFIX);
}

function isPortalPlaneMesh(node: THREE.Object3D): boolean {
  return (node as THREE.Mesh).isMesh && isPortalMesh(node) && !node.name.startsWith(PORTAL_FRAME_PREFIX);
}

export function loadPortalAtlas(): Promise<THREE.Texture> {
  if (atlasTexture) return Promise.resolve(atlasTexture);
  if (atlasLoadPromise) return atlasLoadPromise;

  atlasLoadPromise = new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      PORTAL_ATLAS_URL,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
        atlasTexture = texture;
        setAtlasFrame(0);
        resolve(texture);
      },
      undefined,
      (err) => reject(err),
    );
  });

  return atlasLoadPromise;
}

function setAtlasFrame(index: number): void {
  if (!atlasTexture) return;
  const frame = ((index % PORTAL_FLIPBOOK_FRAME_COUNT) + PORTAL_FLIPBOOK_FRAME_COUNT) % PORTAL_FLIPBOOK_FRAME_COUNT;
  const col = frame % PORTAL_ATLAS_COLS;
  const row = Math.floor(frame / PORTAL_ATLAS_COLS);
  atlasTexture.repeat.set(1 / PORTAL_ATLAS_COLS, 1 / PORTAL_ATLAS_ROWS);
  // Row 0 is the top of the image (high V with flipY=false, matching the GLB UVs).
  atlasTexture.offset.set(col / PORTAL_ATLAS_COLS, 1 - (row + 1) / PORTAL_ATLAS_ROWS);
}

function getPortalFlipbookFrames(root: THREE.Object3D): THREE.Mesh[] {
  if (cachedFramesMap.has(root)) {
    return cachedFramesMap.get(root)!;
  }

  const frames: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (isPortalFrameMesh(node)) {
      frames.push(node as THREE.Mesh);
    }
  });
  frames.sort((a, b) => a.name.localeCompare(b.name));
  cachedFramesMap.set(root, frames);
  return frames;
}

function getPortalAtlasPlanes(root: THREE.Object3D): THREE.Mesh[] {
  if (cachedAtlasPlanesMap.has(root)) {
    return cachedAtlasPlanesMap.get(root)!;
  }

  const planes: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (isPortalPlaneMesh(node)) {
      planes.push(node as THREE.Mesh);
    }
  });
  cachedAtlasPlanesMap.set(root, planes);
  return planes;
}

function applyAtlasMaterial(mesh: THREE.Mesh, texture: THREE.Texture): void {
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    emissiveMap: texture,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 1,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: 0,
    roughness: 1,
    metalness: 0,
  });
  mat.name = 'Portal Animated';
  mesh.material = mat;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
}

/**
 * Bake the portal plane into the same world space as merged room meshes.
 * Excluded meshes keep their local transform, so without this they sit in the
 * un-normalized GLB pose while the room is baked at identity.
 */
function bakePortalPlaneForMergedSpace(mesh: THREE.Mesh): void {
  if (!mesh.geometry?.attributes?.position) return;

  mesh.updateMatrix();
  mesh.updateWorldMatrix(true, false);

  const geom = mesh.geometry.clone();
  geom.applyMatrix4(mesh.matrixWorld);
  geom.computeBoundingSphere();
  mesh.geometry.dispose();
  mesh.geometry = geom;

  mesh.position.set(0, 0, 0);
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1);
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
}

/**
 * Replaces the yellow placeholder portal plane with the atlas-driven flipbook
 * used by room_foundation (PortalAnimAtlas, 15x10, 150 frames).
 */
export async function attachPortalAtlasAnimation(root: THREE.Object3D): Promise<void> {
  const planes = getPortalAtlasPlanes(root);
  if (planes.length === 0) return;

  const texture = await loadPortalAtlas();
  for (const mesh of planes) {
    applyAtlasMaterial(mesh, texture);
    bakePortalPlaneForMergedSpace(mesh);
  }
  setAtlasFrame(0);
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

  if (frames.length === 0) {
    setAtlasFrame(0);
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
  const activeIndex = Math.floor(time * PORTAL_FLIPBOOK_FPS) % PORTAL_FLIPBOOK_FRAME_COUNT;

  if (frames.length > 0) {
    const frameCount = frames.length;
    const index = activeIndex % frameCount;
    for (let i = 0; i < frameCount; i++) {
      frames[i].visible = i === index;
      frames[i].scale.set(1, 1, 1);
    }
    return;
  }

  if (getPortalAtlasPlanes(root).length > 0) {
    setAtlasFrame(activeIndex);
  }
}

export function resetPortalFlipbookCache(): void {
  cachedFramesMap = new WeakMap<THREE.Object3D, THREE.Mesh[]>();
  cachedAtlasPlanesMap = new WeakMap<THREE.Object3D, THREE.Mesh[]>();
}
