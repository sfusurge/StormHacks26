import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import * as CANNON from 'cannon-es';
import { addStaticColliderFromMesh, addStaticTrimeshFromMesh } from './threeScene/physicsHelpers';
import { alignCharacterToFloor } from './threeScene/alignCharacterToFloor';
import { updateCharacter as updateCharacterInternal } from './threeScene/updateCharacter';
import { updateCamera as updateCameraInternal } from './threeScene/updateCamera';

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

  // list of meshes used for camera collision checks
  collidableMeshes: THREE.Mesh[] = [];

  // physics
  world: CANNON.World;
  playerBody: CANNON.Body | null = null;

  // camera orbit controls state
  cameraYaw = 0; // radians around Y
  cameraPitch = 0; // radians up/down
  cameraDistance = 1.4; // even closer behind the character's head
  minCameraDistance = 1.3;
  maxCameraDistance = 2.5;
  // tighter bounds settings
  characterMargin = 1.5; // meters from walls for character
  cameraMargin = 0.5; // horizontal margin for camera inside room
  cameraVerticalMargin = 0.1; // vertical margin from floor/ceiling for camera (keep small so camera can be low)
  isPointerDown = false;
  lastPointer = new THREE.Vector2();
  pointerId: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // loader must be available before makeRoom/makeCharacter
    this.loader = new GLTFLoader();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x20232a);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    // start camera lower so view is closer to the character
    this.camera.position.set(0, 4, 1.1);

    this.initPhysics();

    this.setupLights();
    this.makeRoom();
    this.makeCharacter();
    this.makeInteractable();

    this.bind();
    this.onResize();
    this.animate();
  }

  initPhysics() {
    this.world = new CANNON.World();
    this.world.gravity.set(0, -9.82, 0);
    this.world.broadphase = new CANNON.NaiveBroadphase();
  }

  setupLights() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
    hemi.position.set(0, 20, 0);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(3, 10, 10);
    this.scene.add(dir);
  }

  makeRoom() {
    // try to load a full glTF room model
    const url = new URL('../../assets/models/room_foundation.glb', import.meta.url).href;
    this.loader.load(url, (g) => {
      const obj = (g.scene || g.scenes?.[0] || g) as THREE.Object3D;
      // normalize scale/position
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3(); box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0) {
        const s = 8.0 / maxDim;
        obj.scale.setScalar(s);
      }
      box.setFromObject(obj);
      const center = new THREE.Vector3(); box.getCenter(center);
      obj.position.sub(center);
      // ensure room sits on floor roughly
      obj.position.y += Math.abs(box.min.y);
      this.scene.add(obj);

      // compute world-space bounds for the room and align character if present
      const worldBox = new THREE.Box3().setFromObject(obj);
      this.roomBox = worldBox;
      this._alignCharacterToFloor();

      // Setup physics bodies for the room: look for COLLIDER_ prefixed meshes; if none, build trimeshes from geometry
      const collidersFound = [] as THREE.Mesh[];
      obj.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) {
          const m = node as THREE.Mesh;
          // collect meshes for camera collision checks
          this.collidableMeshes.push(m);
          if (m.name && m.name.startsWith('COLLIDER_')) collidersFound.push(m);
        }
      });

      if (collidersFound.length > 0) {
        collidersFound.forEach((m) => this._addStaticColliderFromMesh(m));
      } else {
        // fallback: make static trimesh bodies for all meshes under the room
        obj.traverse((node) => {
          if ((node as THREE.Mesh).isMesh) {
            this._addStaticTrimeshFromMesh(node as THREE.Mesh);
          }
        });
      }

    });
  }

  makeCharacter() {
    // create a placeholder character so update loop can run immediately
    // scale up the placeholder to better match a larger character
    const placeholderGeom = new THREE.BoxGeometry(0.3, 0.64, 0.3);
    const placeholderMat = new THREE.MeshStandardMaterial({ color: 0x3377ff });
    const placeholder = new THREE.Mesh(placeholderGeom, placeholderMat);
    // place placeholder slightly above floor (half height)
    placeholder.position.set(0, 0.32, 0);
    this.character = placeholder;
    this.scene.add(placeholder);
    this._alignCharacterToFloor();

    // nudge the character slightly backward so it doesn't start too far forward
    try { this.character.position.z += 1.0; } catch(e) {}

    // create physics body for the player (simple capsule approximation using a sphere for now)
    const pos = this.character.position;
    const radius = 0.16; // larger radius to match scaled character
    const mass = 1;
    const sphereShape = new CANNON.Sphere(radius);
    const body = new CANNON.Body({ mass });
    body.addShape(sphereShape);
    // position the physics body so its bottom rests on the floor
    body.position.set(pos.x, pos.y + radius, pos.z);
    body.linearDamping = 0.9;
    this.world.addBody(body);
    this.playerBody = body;

    // try loading the CesiumMan glb and replace the placeholder when ready
    const url = new URL('../../assets/models/CesiumMan.glb', import.meta.url).href;
    this.loader.load(url, (g) => {
      const obj = (g.scene || g.scenes?.[0] || g) as THREE.Object3D;
      // normalize scale
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3(); box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0) {
        const s = (1.4 / maxDim) * 0.5;
        obj.scale.setScalar(s);
      }
      box.setFromObject(obj);
      const center = new THREE.Vector3(); box.getCenter(center);
      obj.position.sub(center);
      // lift so feet are at y=0 relative to its bounds
      box.setFromObject(obj);
      obj.position.y += Math.abs(box.min.y);

      // replace placeholder
      this.scene.remove(placeholder);
      this.character = obj;
      this.scene.add(obj);
      this._alignCharacterToFloor();

      // nudge loaded character slightly backward instead
      try { this.character.position.z += 1.0; } catch(e) {}

      // reposition physics body to match new character bounds
      if (this.playerBody) {
      const p = new THREE.Vector3();
      p.copy((this.character as any).position || new THREE.Vector3());
      // keep physics body sitting on top of feet using same radius
      const bodyRadius = (this.playerBody.shapes && (this.playerBody.shapes[0] as any).radius) || 0.16;
      this.playerBody.position.set(p.x, p.y + bodyRadius, p.z);
      }
    }, undefined, (err) => {
      // keep placeholder on error
      console.warn('Failed to load character glb, using placeholder', err);
    });
  }

  _addStaticColliderFromMesh(mesh: THREE.Mesh) {
    addStaticColliderFromMesh(this.world, mesh);
  }

  _addStaticTrimeshFromMesh(mesh: THREE.Mesh) {
    addStaticTrimeshFromMesh(this.world, mesh);
  }

  _alignCharacterToFloor() {
    alignCharacterToFloor(this.character, this.roomBox, this.characterMargin);
  }

  makeInteractable() {
    const geom = new THREE.BoxGeometry(0.8, 0.8, 0.2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffaa00 });
    const obj = new THREE.Mesh(geom, mat);
    // move the box lower so it's near the room floor (was y=1)
    obj.position.set(1, -1, 1);
    // attach a component name to render from the app when clicked
    (obj as any).userData = { component: 'InfoPanel' };
    this.scene.add(obj);
    this.interactables.push(obj);
  }

  bind() {
    window.addEventListener('resize', this.onResize.bind(this));
    window.addEventListener('keydown', (e) => (this.keys[e.key.toLowerCase()] = true));
    window.addEventListener('keyup', (e) => (this.keys[e.key.toLowerCase()] = false));
    this.canvas.addEventListener('click', this.onClick.bind(this));
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

  // pointer handlers for camera orbit
  _onPointerDown(ev: PointerEvent) {
    if (this.pointerId !== null) return; // already tracking
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
      try {
        this.world.step(1 / 60, dt, 3);
      } catch (e) {
        // world may be undefined briefly
      }
      this.updateCharacter(dt);
      this.updateCamera(dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  dispose() {
    this.disposed = true;
    // basic cleanup
    this.renderer.dispose();
    (this.canvas as any).remove();
  }
}
