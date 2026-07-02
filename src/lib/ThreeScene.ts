import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { alignCharacterToFloor, clampCharacterToRoom, snapCharacterToFloor } from './threeScene/alignCharacterToFloor';
import { updateCharacter as updateCharacterInternal } from './threeScene/updateCharacter';
import { updateCamera as updateCameraInternal } from './threeScene/updateCamera';
import { buildCollisionFromRoom } from './threeScene/buildCollisionFromRoom';
import { createCameraCollisionMesh, normalizeRoomObject } from './threeScene/collisionMap';
import { mergeRoomMeshesByMaterial } from './threeScene/mergeRoomMeshes';
import { findSpawnFloorY } from './threeScene/floorQuery';
import { writable } from 'svelte/store';

export class ThreeScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  character: THREE.Object3D | undefined;
  interactables: THREE.Object3D[] = [];
  keys: Record<string, boolean> = {};
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  disposed = false;
  loader: GLTFLoader;
  roomBox: THREE.Box3 | null = null;
  collisionBounds: THREE.Box3 | null = null;
  roomLoaded = false;
  isLoading = writable(true);

  collidableMeshes: THREE.Mesh[] = [];
  cameraCollisionMesh: THREE.Mesh | null = null;

  cameraYaw = 0;
  cameraPitch = 0;
  cameraDistance = 1.0;
  minCameraDistance = 0.9;
  maxCameraDistance = 1.8;
  characterMargin = 0.35;
  cameraMargin = 0.5;
  cameraVerticalMargin = 0.1;
  jumpPressed = false;
  isPointerDown = false;
  isBackingUp = false;
  moveVelocityX = 0;
  moveVelocityZ = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;

    this.loader = new GLTFLoader();

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    this.loader.setDRACOLoader(dracoLoader);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x20232a);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 4, 1.1);

    this.setupLights();
    this.makeRoom();
    this.makeCharacter();
    this.makeInteractable();

    this.bind();
    this.onResize();
    this.animate();
  }

  setupLights() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
    hemi.position.set(0, 20, 0);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(3, 10, 10);
    dir.castShadow = false;
    this.scene.add(dir);
  }

  makeRoom() {
    const glbUrl = new URL('../../assets/models/room_foundation.glb', import.meta.url).href;

    this.loader.load(
        glbUrl,
        (g) => {
          window.dispatchEvent(new CustomEvent('loading-progress', { detail: { progress: 70, stage: 'Processing geometry...' } }));

          const obj = (g.scene || g.scenes?.[0] || g) as THREE.Object3D;
          this.roomBox = normalizeRoomObject(obj);
          this.scene.add(obj);
          this._alignCharacterToFloor();
          this._positionInteractable();

          window.dispatchEvent(new CustomEvent('loading-progress', { detail: { progress: 80, stage: 'Optimizing meshes...' } }));

          obj.traverse((node) => {
            if (!(node as THREE.Mesh).isMesh) return;
            const m = node as THREE.Mesh;
            m.castShadow = false;
            m.receiveShadow = false;
            m.frustumCulled = true;
            m.matrixAutoUpdate = false;
            if (m.geometry?.attributes.normal === undefined) {
              m.geometry.computeVertexNormals();
            }
          });

          mergeRoomMeshesByMaterial(obj);

          this._syncPlayerToFloor();
          void this._initCollision(obj);
        },
        (progress) => {
          const percent = (progress.loaded / progress.total) * 70;
          window.dispatchEvent(new CustomEvent('loading-progress', { detail: { progress: percent, stage: 'Downloading model...' } }));
        },
        () => {
          this.isLoading.set(false);
        }
    );
  }

  makeCharacter() {
    const placeholderGeom = new THREE.BoxGeometry(0.3, 0.64, 0.3);
    const placeholderMat = new THREE.MeshStandardMaterial({ color: 0x3377ff });
    const placeholder = new THREE.Mesh(placeholderGeom, placeholderMat);
    placeholder.position.set(0, 0.32, 0);
    this.character = placeholder;
    this.scene.add(placeholder);
    this._alignCharacterToFloor();

    const url = new URL('../../assets/models/CesiumMan.glb', import.meta.url).href;
    this.loader.load(url, (g) => {
      const obj = (g.scene || g.scenes?.[0] || g) as THREE.Object3D;
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0) {
        const s = (1.4 / maxDim) * 0.5;
        obj.scale.setScalar(s);
      }
      box.setFromObject(obj);
      const center = new THREE.Vector3();
      box.getCenter(center);
      obj.position.sub(center);
      box.setFromObject(obj);
      obj.position.y += Math.abs(box.min.y);

      this.scene.remove(placeholder);
      this.character = obj;
      this.scene.add(obj);
      this._snapToFloor();
    });
  }

  _syncPlayerToFloor() {
    if (!this.character) return;
    const box = this.collisionBounds ?? this.roomBox;
    if (box) {
      this.character.position.x = (box.min.x + box.max.x) / 2;
      this.character.position.z = (box.min.z + box.max.z) / 2 - 5.5;
      clampCharacterToRoom(this.character, box, this.characterMargin);
    }
    this._snapToFloor();
    this._frameCameraOnCharacter();
  }

  _frameCameraOnCharacter() {
    if (!this.character) return;
    const lookAt = this.character.position.clone().add(new THREE.Vector3(0, 0.6, 0));
    this.camera.lookAt(lookAt);
  }

  _snapToFloor() {
    if (!this.character) return;

    const x = this.character.position.x;
    const z = this.character.position.z;

    if (
        this.collidableMeshes.length > 0 &&
        snapCharacterToFloor(this.character, x, z, this)
    ) {
      return;
    }

    this._alignCharacterToFloor();
  }

  _alignCharacterToFloor() {
    alignCharacterToFloor(this.character, this.roomBox);
  }

  async _initCollision(room: THREE.Object3D) {
    try {
      window.dispatchEvent(new CustomEvent('loading-progress', { detail: { progress: 90, stage: 'Building collision mesh...' } }));
      const collisionData = buildCollisionFromRoom(room);
      this.collisionBounds = collisionData.bounds;

      this.cameraCollisionMesh = await createCameraCollisionMesh(collisionData, (p) => {
        const progress = 90 + Math.round(p * 8);
        window.dispatchEvent(new CustomEvent('loading-progress', { detail: { progress, stage: 'Building collision tree...' } }));
      });
      this.scene.add(this.cameraCollisionMesh);
      this.collidableMeshes = [this.cameraCollisionMesh];

      this._syncPlayerToFloor();
      this._positionInteractable();

      this.roomLoaded = true;
      window.dispatchEvent(new CustomEvent('loading-progress', { detail: { progress: 100, stage: 'Complete!' } }));
      this.isLoading.set(false);
    } catch {
      this.roomLoaded = true;
      this.isLoading.set(false);
    }
  }

  makeInteractable() {
    const geom = new THREE.BoxGeometry(0.8, 0.8, 0.2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffaa00 });
    const obj = new THREE.Mesh(geom, mat);
    (obj as any).userData = { url: 'https://portal.sfusurge.com' };
    this.scene.add(obj);
    this.interactables.push(obj);
  }

  _positionInteractable() {
    const mesh = this.interactables[0] as THREE.Mesh | undefined;
    if (!mesh) return;

    const box = this.collisionBounds ?? this.roomBox;
    if (!box) return;

    const x = (box.min.x + box.max.x) / 2;
    const z = (box.min.z + box.max.z) / 2 - 1.25;
    const floorY = findSpawnFloorY(this, x, z) ?? box.min.y;
    const halfHeight = (mesh.geometry as THREE.BoxGeometry).parameters.height / 2;
    mesh.position.set(x, floorY + halfHeight + 0.25, z);
  }

  bind() {
    this.canvas.tabIndex = 0;
    this.canvas.style.outline = 'none';

    window.addEventListener('resize', this.onResize.bind(this));

    const setKey = (key: string, down: boolean) => {
      this.keys[key] = down;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      setKey('shift', e.shiftKey);
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        e.preventDefault();
      }
      setKey(key, true);
      if (key === ' ' && !e.repeat) {
        this.jumpPressed = true;
      }
      // e.code fallback (more reliable when layout / focus is odd)
      const codeMap: Record<string, string> = {
        KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd',
        ArrowUp: 'arrowup', ArrowDown: 'arrowdown',
        ArrowLeft: 'arrowleft', ArrowRight: 'arrowright',
      };
      const mapped = codeMap[e.code];
      if (mapped) setKey(mapped, true);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      setKey('shift', e.shiftKey);
      const key = e.key.toLowerCase();
      setKey(key, false);
      const codeMap: Record<string, string> = {
        KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd',
        ArrowUp: 'arrowup', ArrowDown: 'arrowdown',
        ArrowLeft: 'arrowleft', ArrowRight: 'arrowright',
      };
      const mapped = codeMap[e.code];
      if (mapped) setKey(mapped, false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    this.canvas.addEventListener('click', (ev) => {
      this.canvas.focus();
      this.onClick(ev);
    });
  }

  onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  onClick(ev: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.interactables, false);
    if (hits.length) {
      const picked = hits[0].object as any;
      const component = picked.userData?.component;
      if (component) {
        window.dispatchEvent(new CustomEvent('open-webview', { detail: { component } }));
      }
    }
  }

  updateCharacter(dt: number) {
    updateCharacterInternal(this, dt);
  }

  updateCamera() {
    updateCameraInternal(this);
  }

  animate() {
    const clock = new THREE.Clock();
    const tick = () => {
      if (this.disposed) return;
      const dt = clock.getDelta();
      this.updateCharacter(dt);
      this.updateCamera();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  dispose() {
    this.disposed = true;
    this.renderer.dispose();
    (this.canvas as any).remove();
  }
}