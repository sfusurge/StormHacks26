import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { alignCharacterToFloor } from './threeScene/alignCharacterToFloor';
import { updateCharacter as updateCharacterInternal } from './threeScene/updateCharacter';
import { updateCamera as updateCameraInternal } from './threeScene/updateCamera';
import {
  createCameraCollisionMesh,
  normalizeRoomObject,
} from './threeScene/collisionMap';
import { buildCollisionFromRoom } from './threeScene/buildCollisionFromRoom';
import { mergeRoomMeshesByMaterial } from './threeScene/mergeRoomMeshes';
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
  roomLoaded = false;
  isLoading = writable(true);

  collidableMeshes: THREE.Mesh[] = [];
  cameraCollisionMesh: THREE.Mesh | null = null;

  cameraYaw = 0;
  cameraPitch = 0;
  cameraDistance = 1.4;
  minCameraDistance = 1.3;
  maxCameraDistance = 2.5;
  characterMargin = 0.35;
  cameraMargin = 0.5;
  cameraVerticalMargin = 0.1;
  verticalVelocity = 0;
  isGrounded = true;
  isPointerDown = false;
  strafeCameraPivot = false;
  lastPointer = new THREE.Vector2();
  pointerId: number | null = null;

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

        const mergedCount = mergeRoomMeshesByMaterial(obj);
        console.log(`Merged room into ${mergedCount} draw calls`);

        this._syncPlayerToFloor();
        this.roomLoaded = true;
        window.dispatchEvent(new CustomEvent('loading-progress', { detail: { progress: 100, stage: 'Complete!' } }));
        this.isLoading.set(false);

        // BVH build is heavy — run after gameplay is enabled; uses same meshes as visuals.
        setTimeout(() => {
          try {
            const collisionData = buildCollisionFromRoom(obj);
            this.cameraCollisionMesh = createCameraCollisionMesh(collisionData);
            this.scene.add(this.cameraCollisionMesh);
            this.collidableMeshes = [this.cameraCollisionMesh];
          } catch (err) {
            console.warn('Collision mesh build failed; using room bounds only', err);
          }
        }, 0);
      },
      (progress) => {
        const percent = (progress.loaded / progress.total) * 70;
        window.dispatchEvent(new CustomEvent('loading-progress', { detail: { progress: percent, stage: 'Downloading model...' } }));
      },
      (err) => {
        console.error('Failed to load room', err);
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
      this._alignCharacterToFloor();
    }, undefined, (err) => {
      console.warn('Failed to load character glb, using placeholder', err);
    });
  }

  _syncPlayerToFloor() {
    if (!this.character) return;
    if (this.roomBox) {
      this.character.position.x = (this.roomBox.min.x + this.roomBox.max.x) / 2 ;
      this.character.position.z = (this.roomBox.min.z + this.roomBox.max.z) / 2 - 6.1;
    }
    this._alignCharacterToFloor();
  }

  _alignCharacterToFloor() {
    alignCharacterToFloor(this.character, this.roomBox);
  }

  makeInteractable() {
    const geom = new THREE.BoxGeometry(0.8, 0.8, 0.2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffaa00 });
    const obj = new THREE.Mesh(geom, mat);
    obj.position.set(1, -1, 1);
    (obj as any).userData = { component: 'InfoPanel' };
    this.scene.add(obj);
    this.interactables.push(obj);
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

  _onPointerDown(ev: PointerEvent) {
    if (this.pointerId !== null) return;
    this.pointerId = ev.pointerId;
    (ev.target as Element).setPointerCapture && (ev.target as Element).setPointerCapture(ev.pointerId);
    this.isPointerDown = true;
    this.lastPointer.set(ev.clientX, ev.clientY);
  }

  updateCharacter(dt: number) {
    updateCharacterInternal(this, dt);
  }

  updateCamera(dt: number) {
    updateCameraInternal(this, dt);
  }

  animate() {
    const clock = new THREE.Clock();
    const tick = () => {
      if (this.disposed) return;
      const dt = clock.getDelta();
      this.updateCharacter(dt);
      this.updateCamera(dt);
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
