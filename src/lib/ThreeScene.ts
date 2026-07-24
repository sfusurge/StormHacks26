import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { alignCharacterToFloor, clampCharacterToRoom, getFootOffset, snapCharacterToFloor } from './threeScene/alignCharacterToFloor';
import { updateCharacter as updateCharacterInternal } from './threeScene/updateCharacter';
import { updateCamera as updateCameraInternal } from './threeScene/updateCamera';
import { buildCollisionFromRoom } from './threeScene/buildCollisionFromRoom';
import { createCameraCollisionMesh, normalizeRoomObject, createSimplifiedCollisionMesh } from './threeScene/collisionMap';
import { mergeRoomMeshesByMaterial, bakeAnimatedMeshesForMergedSpace } from './threeScene/mergeRoomMeshes';
import { initPortalFlipbookVisibility, resetPortalFlipbookCache, syncPortalFlipbookFromTime } from './threeScene/portalFlipbook';
import { createRoomLOD, createMobileLOD, CollisionLODManager } from './threeScene/lodSystem';
import { findSpawnFloorY } from './threeScene/floorQuery';
import { PlayerPhysics } from './threeScene/playerPhysics';
import { writable } from 'svelte/store';
import { joystickData } from '../stores/joystick';

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
  mixer: THREE.AnimationMixer | null = null;
  actions: Record<string, THREE.AnimationAction> = {};
  currentAction: THREE.AnimationAction | null = null;
  ladderBox: THREE.Box3 | null = null;
  bedLadderBox: THREE.Box3 | null = null;
  playerBox: THREE.Box3 | null = null;

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
  isGrounded = true;
  playerPhysics: PlayerPhysics | null = null;
  room: THREE.Object3D | null = null;
  roomLOD: THREE.LOD | null = null;
  collisionLODManager: CollisionLODManager | null = null;
  collisionData: any = null;
  portalFlipbookTime = 0;
  joystickUnsubscribe: (() => void) | null = null;
  joystickInput = { x: 0, y: 0 };
  isMobile = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const powerPref = this.isMobile ? 'low-power' : 'high-performance';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: powerPref, precision: this.isMobile ? 'lowp' : 'highp' });
    this.renderer.setPixelRatio(this.isMobile ? 1 : Math.min(window.devicePixelRatio, 2));
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
          this.room = obj;
          this.roomBox = normalizeRoomObject(obj);

          // Identify animated nodes before LOD creation
          const animatedNodeNames = new Set<string>();
          if (g.animations?.length) {
            for (const clip of g.animations) {
              for (const track of clip.tracks) {
                animatedNodeNames.add(track.name.split('.')[0]);
              }
            }
          }

          bakeAnimatedMeshesForMergedSpace(obj, animatedNodeNames);
          initPortalFlipbookVisibility(obj);

          obj.traverse((node) => {
            if (!(node as THREE.Mesh).isMesh) return;
            const m = node as THREE.Mesh;
            m.castShadow = false;
            m.receiveShadow = false;
            m.frustumCulled = !animatedNodeNames.has(node.name);
            if (!animatedNodeNames.has(node.name)) {
              m.matrixAutoUpdate = false;
            }
            if (m.geometry?.attributes.normal === undefined) {
              m.geometry.computeVertexNormals();
            }
          });

          // initialize bounding boxes
          this.ladderBox = new THREE.Box3().setFromCenterAndSize(
              new THREE.Vector3(4.07, 1.25, -0.56),
              new THREE.Vector3(0.1, 2, 0.6)
          );
          this.bedLadderBox = new THREE.Box3().setFromCenterAndSize(
            new THREE.Vector3(1, 3, 3.5),
            new THREE.Vector3(0.1, 0.85, 0.35)
          );
          this.playerBox = new THREE.Box3();

          window.dispatchEvent(new CustomEvent('loading-progress', { detail: { progress: 75, stage: 'Creating detail levels...' } }));

          // Create LOD system instead of single merged mesh
          if (this.isMobile) {
            this.roomLOD = createMobileLOD(obj, animatedNodeNames);
          } else {
            this.roomLOD = createRoomLOD(obj, animatedNodeNames);
          }
          
          this.scene.add(this.roomLOD);
          this._alignCharacterToFloor();
          this._positionInteractable();

          window.dispatchEvent(new CustomEvent('loading-progress', { detail: { progress: 85, stage: 'Optimizing collision...' } }));
          this._syncPlayerToFloor();
          // Build collision from the high-detail merged mesh (not original geometry)
          const highDetailMesh = (this.roomLOD as any).highDetailMesh || obj;
          void this._initCollision(highDetailMesh);
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

  async makeCharacter() {
    const placeholderGeom = new THREE.BoxGeometry(0.3, 0.64, 0.3);
    const placeholderMat = new THREE.MeshStandardMaterial({ color: 0x3377ff });
    const placeholder = new THREE.Mesh(placeholderGeom, placeholderMat);
    placeholder.position.set(0, 0.32, 0);
    this.character = placeholder;
    this.scene.add(placeholder);
    this._alignCharacterToFloor();

    const climbUrl = new URL('../../assets/models/sparky/sparky_climb.glb', import.meta.url).href;
    const idleUrl = new URL('../../assets/models/sparky/sparky_idle.glb', import.meta.url).href;
    const lookUrl = new URL('../../assets/models/sparky/sparky_look.glb', import.meta.url).href;
    const thinkUrl = new URL('../../assets/models/sparky/sparky_think.glb', import.meta.url).href;
    const walkUrl = new URL('../../assets/models/sparky/sparky_walk.glb', import.meta.url).href;
    const waveUrl = new URL('../../assets/models/sparky/sparky_wave.glb', import.meta.url).href;
    
    await this.loader.load(idleUrl, async (g) => {
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
      this._syncPlayerPhysics();

      // load animations into mixer with staggered loading to prevent mobile crashes
      this.mixer = new THREE.AnimationMixer(obj);

      // Stagger animation loading to prevent shader compilation spike on mobile
      const animationUrls = [
        { name: 'idle', url: idleUrl },
        { name: 'walk', url: walkUrl },
        { name: 'climb', url: climbUrl },
        { name: 'look', url: lookUrl },
        { name: 'think', url: thinkUrl },
        { name: 'wave', url: waveUrl }
      ];

      let loadedCount = 0;
      for (const { name, url } of animationUrls) {
        await new Promise(resolve => {
          setTimeout(async () => {
            try {
              const anim = await this.loader.loadAsync(url);
              if (anim.animations?.length) {
                this.actions[name] = this.mixer!.clipAction(anim.animations[0], obj);
              }
              // Dispose of unused duplicate geometries/textures to avoid memory leaks
              if (anim.scene) {
                anim.scene.traverse((node: any) => {
                  if (node.isMesh) {
                    node.geometry?.dispose();
                    if (Array.isArray(node.material)) {
                      node.material.forEach((mat) => {
                        for (const key in mat) {
                          if (mat[key] && mat[key].isTexture) mat[key].dispose();
                        }
                        mat.dispose();
                      });
                    } else if (node.material) {
                      const mat = node.material;
                      for (const key in mat) {
                        if (mat[key] && mat[key].isTexture) mat[key].dispose();
                      }
                      mat.dispose();
                    }
                  }
                });
              }
            } catch (error) {
              console.warn(`Failed to load animation ${name}:`, error);
            }
            loadedCount++;
            resolve(null);
          }, loadedCount * 50); // 50ms delay between each animation load
        });
      }

      this.playAnimation('idle');
    },
    undefined, 
    (error) => {
      console.error('Error loading character model:', error);
    }
    );
  }

  _syncPlayerPhysics() {
    if (!this.character || !this.playerPhysics) return;
    this.playerPhysics.resetFromCharacter(this.character.position, getFootOffset(this.character));
  }

  _syncPlayerToFloor() {
    if (!this.character) return;
    const box = this.collisionBounds ?? this.roomBox;
    if (box) {
      this.character.position.x = (box.min.x + box.max.x) / 2;
      this.character.position.z = (box.min.z + box.max.z) / 2 - 3.5;
      clampCharacterToRoom(this.character, box, this.characterMargin);
      const footOffset = getFootOffset(this.character);
      this.character.position.y = box.min.y + 1.8 + footOffset;
    }
    this._snapToFloor();
    this._syncPlayerPhysics();
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
      this.collisionData = collisionData;

      // Create collision LOD manager
      this.collisionLODManager = new CollisionLODManager(this.scene);

      // Full detail collision (always accurate near camera)
      const fullDetailMesh = await createCameraCollisionMesh(collisionData, (p) => {
        const progress = 90 + Math.round(p * 2);
        window.dispatchEvent(new CustomEvent('loading-progress', { detail: { progress, stage: 'Building collision tree (full)...' } }));
      });
      this.collisionLODManager.addLevel(fullDetailMesh, 0);

      // Medium detail collision (mid distance) - 60% polygons
      window.dispatchEvent(new CustomEvent('loading-progress', { detail: { progress: 92, stage: 'Building collision tree (medium)...' } }));
      const mediumDetailMesh = await createSimplifiedCollisionMesh(collisionData, 0.6, (p) => {
        const progress = 92 + Math.round(p * 3);
        window.dispatchEvent(new CustomEvent('loading-progress', { detail: { progress, stage: 'Building collision tree (medium)...' } }));
      });
      this.collisionLODManager.addLevel(mediumDetailMesh, this.isMobile ? 4 : 15);

      // Low detail collision (far distance) - 25% polygons  
      window.dispatchEvent(new CustomEvent('loading-progress', { detail: { progress: 95, stage: 'Building collision tree (low)...' } }));
      const lowDetailMesh = await createSimplifiedCollisionMesh(collisionData, 0.25, (p) => {
        const progress = 95 + Math.round(p * 4);
        window.dispatchEvent(new CustomEvent('loading-progress', { detail: { progress, stage: 'Building collision tree (low)...' } }));
      });
      this.collisionLODManager.addLevel(lowDetailMesh, this.isMobile ? 8 : 30);

      // Use full detail collision as current (gets updated each frame based on camera distance)
      this.cameraCollisionMesh = this.collisionLODManager.getCurrentMesh();
      this.collidableMeshes = [this.cameraCollisionMesh!];

      this.playerPhysics = new PlayerPhysics();

      this._syncPlayerToFloor();
      this._positionInteractable();

      this.roomLoaded = true;
      window.dispatchEvent(new CustomEvent('loading-progress', { detail: { progress: 100, stage: 'Complete!' } }));
      this.isLoading.set(false);
    } catch (e) {
      console.error('Collision init error:', e);
      this.roomLoaded = true;
      this.isLoading.set(false);
    }
  }

  makeInteractable() {
    const geom = new THREE.BoxGeometry(0.8, 0.8, 0.2);
    const mat = new THREE.MeshStandardMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
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

    // Subscribe to joystick input
    this.joystickUnsubscribe = joystickData.subscribe((data) => {
      const joystickEntries = Object.values(data);
      if (joystickEntries.length > 0) {
        const joystick = joystickEntries[0];
        this.joystickInput = {
          x: joystick.x,
          y: joystick.y
        };
      } else {
        this.joystickInput = { x: 0, y: 0 };
      }
    });

    // Listen for tap to jump
    window.addEventListener('joystick-jump', () => {
      this.jumpPressed = true;
    });

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

  // dialogues
  speechTriggers = [
    {
      position: new THREE.Vector3(1, 0, -5.85),
      radius: 1,
      title: 'Surge World',
      text: 'Welcome player!'
    },
    {
      position: new THREE.Vector3(1.12, 2.76, 0.11),
      radius: 1,
      title: 'Taskboard',
      text: 'This is a small text about the tasks...'
    },
  ];
  activeTrigger: any = null;

  updateSpeechTriggers() {
    if (!this.character) return;

    const playerPos = this.character.position;
    let nearTrigger = null;

    // find if player is near any trigger
    for (const trigger of this.speechTriggers) {
      const distance = playerPos.distanceTo(trigger.position);
      if (distance < trigger.radius) {
        nearTrigger = trigger;
        break;
      }
    }

    // only emit events if the active trigger changed
    if (nearTrigger !== this.activeTrigger) {
      this.activeTrigger = nearTrigger;
      if (nearTrigger) {
        window.dispatchEvent(new CustomEvent('show-speech', { detail: nearTrigger }));
      } else {
        window.dispatchEvent(new CustomEvent('hide-speech'));
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

      // update model animation
      if (this.mixer) {
        this.mixer.update(dt);
      }

      this.portalFlipbookTime += dt;
      syncPortalFlipbookFromTime(this.roomLOD || this.room, this.portalFlipbookTime);
      this.updateCharacter(dt);
      this.updateSpeechTriggers();
      this.updateCamera();
      
      // Update LOD distances based on camera position
      if (this.roomLOD) {
        this.roomLOD.update(this.camera);
      }

      // Update collision LOD based on camera distance to room
      if (this.collisionLODManager && this.room) {
        this.collisionLODManager.update(this.camera.position, this.room.position);
        const currentMesh = this.collisionLODManager.getCurrentMesh();
        if (currentMesh && currentMesh !== this.cameraCollisionMesh) {
          this.cameraCollisionMesh = currentMesh;
          this.collidableMeshes = [currentMesh];
        }
      }
      
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  playAnimation(name: string) {
    const next = this.actions[name];
    if (!next) return;

    if (this.currentAction === next) return; // Already playing this action

    this.currentAction?.fadeOut(0.4);

    next
        .reset()
        .setEffectiveTimeScale(1)
        .setEffectiveWeight(1)
        .fadeIn(0.4)
        .play();

    this.currentAction = next;
  }

  dispose() {
    this.disposed = true;
    resetPortalFlipbookCache();
    this.playerPhysics?.dispose();
    this.playerPhysics = null;
    this.joystickUnsubscribe?.();
    this.collisionLODManager?.dispose();
    this.collisionLODManager = null;
    
    // Aggressive cleanup for mobile
    this.scene.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(m => m.dispose());
        } else {
          mesh.material?.dispose();
        }
      }
    });
    this.renderer.dispose();
    (this.canvas as any).remove();
  }
}