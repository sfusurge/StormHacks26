import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader";
import {
  alignCharacterToFloor,
  clampCharacterToRoom,
  getFootOffset,
  snapCharacterToFloor,
} from "./threeScene/alignCharacterToFloor";
import { updateCharacter as updateCharacterInternal } from "./threeScene/updateCharacter";
import { updateCamera as updateCameraInternal } from "./threeScene/updateCamera";
import { buildCollisionFromRoom } from "./threeScene/buildCollisionFromRoom";
import {
  createCameraCollisionMesh,
  normalizeRoomObject,
} from "./threeScene/collisionMap";
import {
  mergeRoomMeshesByMaterial,
  bakeAnimatedMeshesForMergedSpace,
} from "./threeScene/mergeRoomMeshes";
import {
  initPortalFlipbookVisibility,
  resetPortalFlipbookCache,
  syncPortalFlipbookFromTime,
} from "./threeScene/portalFlipbook";
import {
  createSingleMergedRoom,
  disposeSceneGraph,
} from "./threeScene/lodSystem";
import { findSpawnFloorY } from "./threeScene/floorQuery";
import { PlayerPhysics } from "./threeScene/playerPhysics";
import { writable } from "svelte/store";
import { joystickData } from "../stores/joystick";
import {
  markersStore,
  activeDialogueStore,
  type MarkerData,
} from "../stores/markers";

export class ThreeScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  focusTarget: { position: THREE.Vector3; lookAt: THREE.Vector3 } | null = null;
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
  /** Single merged room group (replaced THREE.LOD) */
  roomGroup: THREE.Group | null = null;
  collisionData: any = null;
  portalFlipbookTime = 0;
  joystickUnsubscribe: (() => void) | null = null;
  joystickInput = { x: 0, y: 0 };
  isMobile = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.isMobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      );
    const powerPref = this.isMobile ? "low-power" : "high-performance";
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: powerPref,
      precision: this.isMobile ? "lowp" : "highp",
    });
    // Cap pixel ratio at 1.5 (was 2) — barely noticeable quality difference, saves ~50-100MB framebuffer
    this.renderer.setPixelRatio(
      this.isMobile ? 1 : Math.min(window.devicePixelRatio, 1.5),
    );
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;

    // sRGB output for correct color display (matches GLB viewer pipelines)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.loader = new GLTFLoader();

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(
      "https://www.gstatic.com/draco/versioned/decoders/1.5.7/",
    );
    this.loader.setDRACOLoader(dracoLoader);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x20232a);

    // Generate a neutral studio environment map so PBR materials (glass windows,
    // metallic surfaces) have something to reflect — without this they appear flat grey.
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();
    this.scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    pmremGenerator.dispose();

    // Far plane reduced from 1000 → 50 (room is ~20 units; 1000 wasted depth precision)
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      50,
    );
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
    // Original intensities — env map only affects glass/reflective materials
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
    hemi.position.set(0, 20, 0);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(3, 10, 10);
    dir.castShadow = false;
    this.scene.add(dir);
  }

  makeRoom() {
    const glbUrl = new URL(
      "../../assets/models/room_foundation.glb",
      import.meta.url,
    ).href;

    this.loader.load(
      glbUrl,
      (g) => {
        window.dispatchEvent(
          new CustomEvent("loading-progress", {
            detail: { progress: 70, stage: "Processing geometry..." },
          }),
        );

        const obj = (g.scene || g.scenes?.[0] || g) as THREE.Object3D;
        this.room = obj;
        this.roomBox = normalizeRoomObject(obj);

        // Identify animated nodes before merging
        const animatedNodeNames = new Set<string>();
        if (g.animations?.length) {
          for (const clip of g.animations) {
            for (const track of clip.tracks) {
              animatedNodeNames.add(track.name.split(".")[0]);
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

          const nodeNameLower = node.name.toLowerCase();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) {
            if (
              !mat ||
              !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial
            )
              continue;
            const stdMat = mat as THREE.MeshStandardMaterial;
            const matNameLower = (stdMat.name || "").toLowerCase();

            const isWindowOrGlass =
              nodeNameLower.includes("window") ||
              nodeNameLower.includes("glass") ||
              nodeNameLower.includes("pane") ||
              matNameLower.includes("window") ||
              matNameLower.includes("glass") ||
              matNameLower.includes("pane") ||
              stdMat.transparent ||
              stdMat.opacity < 0.95 ||
              (stdMat as any).transmission > 0;

            if (isWindowOrGlass) {
              // Blow out the windows with strong env map reflection and brightness (slightly lowered)
              stdMat.envMapIntensity = 3.5;
              if (stdMat.emissive) {
                stdMat.emissiveIntensity = Math.max(
                  stdMat.emissiveIntensity,
                  1.2,
                );
              }
            } else {
              // Normal indoor surfaces (stairs, bookshelves, walls, etc.) stay natural
              stdMat.envMapIntensity = 0.2;
            }
          }
        });

        // initialize bounding boxes
        this.ladderBox = new THREE.Box3().setFromCenterAndSize(
          new THREE.Vector3(4.07, 1.25, -0.56),
          new THREE.Vector3(0.1, 2, 0.6),
        );
        this.bedLadderBox = new THREE.Box3().setFromCenterAndSize(
          new THREE.Vector3(1, 3, 3.5),
          new THREE.Vector3(0.1, 0.85, 0.35),
        );
        this.playerBox = new THREE.Box3();

        window.dispatchEvent(
          new CustomEvent("loading-progress", {
            detail: { progress: 75, stage: "Creating merged room..." },
          }),
        );

        // Single merged room (replaces LOD system that cloned the scene 2-3×)
        this.roomGroup = createSingleMergedRoom(obj, animatedNodeNames);
        this.scene.add(this.roomGroup);

        this._alignCharacterToFloor();
        this._positionInteractable();

        window.dispatchEvent(
          new CustomEvent("loading-progress", {
            detail: { progress: 85, stage: "Optimizing collision..." },
          }),
        );
        this._syncPlayerToFloor();
        // Build collision from the merged mesh
        const highDetailMesh = (this.roomGroup as any).highDetailMesh || obj;
        void this._initCollision(highDetailMesh);
      },
      (progress) => {
        const percent = (progress.loaded / progress.total) * 70;
        window.dispatchEvent(
          new CustomEvent("loading-progress", {
            detail: { progress: percent, stage: "Downloading model..." },
          }),
        );
      },
      (error) => {
        console.error("Error loading room model:", error);
        this.isLoading.set(false);
      },
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

    const climbUrl = new URL(
      "../../assets/models/sparky/sparky_climb.glb",
      import.meta.url,
    ).href;
    const idleUrl = new URL(
      "../../assets/models/sparky/sparky_idle.glb",
      import.meta.url,
    ).href;
    const lookUrl = new URL(
      "../../assets/models/sparky/sparky_look.glb",
      import.meta.url,
    ).href;
    const thinkUrl = new URL(
      "../../assets/models/sparky/sparky_think.glb",
      import.meta.url,
    ).href;
    const walkUrl = new URL(
      "../../assets/models/sparky/sparky_walk.glb",
      import.meta.url,
    ).href;
    const waveUrl = new URL(
      "../../assets/models/sparky/sparky_wave.glb",
      import.meta.url,
    ).href;

    try {
      const g = await this.loader.loadAsync(idleUrl);
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
      // Dispose placeholder geometry/material
      placeholderGeom.dispose();
      placeholderMat.dispose();

      this.character = obj;
      this.scene.add(obj);
      this._snapToFloor();
      this._syncPlayerPhysics();

      // load animations into mixer with staggered loading to prevent mobile crashes
      this.mixer = new THREE.AnimationMixer(obj);

      // Stagger animation loading to prevent shader compilation spike on mobile
      const animationUrls = [
        { name: "idle", url: idleUrl },
        { name: "walk", url: walkUrl },
        { name: "climb", url: climbUrl },
        { name: "look", url: lookUrl },
        { name: "think", url: thinkUrl },
        { name: "wave", url: waveUrl },
      ];

      let loadedCount = 0;
      for (const { name, url } of animationUrls) {
        await new Promise((resolve) => {
          setTimeout(async () => {
            try {
              const anim = await this.loader.loadAsync(url);
              if (anim.animations?.length) {
                this.actions[name] = this.mixer!.clipAction(
                  anim.animations[0],
                  obj,
                );
              }
              // Dispose of unused duplicate geometries/textures to avoid memory leaks
              if (anim.scene) {
                anim.scene.traverse((node: any) => {
                  if (node.isMesh) {
                    node.geometry?.dispose();
                    if (Array.isArray(node.material)) {
                      node.material.forEach((mat) => {
                        for (const key in mat) {
                          if (mat[key] && mat[key].isTexture)
                            mat[key].dispose();
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

      this.playAnimation("idle");
    } catch (error) {
      console.error("Error loading character model:", error);
    }
  }

  _syncPlayerPhysics() {
    if (!this.character || !this.playerPhysics) return;
    this.playerPhysics.resetFromCharacter(
      this.character.position,
      getFootOffset(this.character),
    );
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
    const lookAt = this.character.position
      .clone()
      .add(new THREE.Vector3(0, 0.6, 0));
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
      window.dispatchEvent(
        new CustomEvent("loading-progress", {
          detail: { progress: 90, stage: "Building collision mesh..." },
        }),
      );
      const collisionData = buildCollisionFromRoom(room);
      this.collisionBounds = collisionData.bounds;
      this.collisionData = collisionData;

      // Build a single collision mesh (removed 3-level collision LOD system)
      const collisionMesh = await createCameraCollisionMesh(
        collisionData,
        (p) => {
          const progress = 90 + Math.round(p * 8);
          window.dispatchEvent(
            new CustomEvent("loading-progress", {
              detail: { progress, stage: "Building collision tree..." },
            }),
          );
        },
      );
      collisionMesh.visible = false;
      this.scene.add(collisionMesh);
      this.cameraCollisionMesh = collisionMesh;
      this.collidableMeshes = [collisionMesh];

      this.playerPhysics = new PlayerPhysics();

      this._syncPlayerToFloor();
      this._positionInteractable();

      // Release the original source scene graph — it's no longer needed
      // (collision data has been extracted, merged mesh is in the scene)
      if (this.room) {
        disposeSceneGraph(this.room);
        this.room = null;
      }
      // Also release the raw collision arrays (BVH has its own copy)
      this.collisionData = null;

      this.roomLoaded = true;
      window.dispatchEvent(
        new CustomEvent("loading-progress", {
          detail: { progress: 100, stage: "Complete!" },
        }),
      );
      this.isLoading.set(false);
    } catch (e) {
      console.error("Collision init error:", e);
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
    (obj as any).userData = { url: "https://portal.sfusurge.com" };
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
    const halfHeight =
      (mesh.geometry as THREE.BoxGeometry).parameters.height / 2;
    mesh.position.set(x, floorY + halfHeight + 0.25, z);
  }

  bind() {
    this.canvas.tabIndex = 0;
    this.canvas.style.outline = "none";

    window.addEventListener("resize", this.onResize.bind(this));

    const setKey = (key: string, down: boolean) => {
      this.keys[key] = down;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      setKey("shift", e.shiftKey);
      const key = e.key.toLowerCase();
      if (
        [
          "w",
          "a",
          "s",
          "d",
          " ",
          "arrowup",
          "arrowdown",
          "arrowleft",
          "arrowright",
        ].includes(key)
      ) {
        e.preventDefault();
      }
      setKey(key, true);
      if (key === " " && !e.repeat) {
        this.jumpPressed = true;
      }
      // e.code fallback (more reliable when layout / focus is odd)
      const codeMap: Record<string, string> = {
        KeyW: "w",
        KeyA: "a",
        KeyS: "s",
        KeyD: "d",
        ArrowUp: "arrowup",
        ArrowDown: "arrowdown",
        ArrowLeft: "arrowleft",
        ArrowRight: "arrowright",
      };
      const mapped = codeMap[e.code];
      if (mapped) setKey(mapped, true);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      setKey("shift", e.shiftKey);
      const key = e.key.toLowerCase();
      setKey(key, false);
      const codeMap: Record<string, string> = {
        KeyW: "w",
        KeyA: "a",
        KeyS: "s",
        KeyD: "d",
        ArrowUp: "arrowup",
        ArrowDown: "arrowdown",
        ArrowLeft: "arrowleft",
        ArrowRight: "arrowright",
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
          y: joystick.y,
        };
      } else {
        this.joystickInput = { x: 0, y: 0 };
      }
    });

    window.addEventListener("select-marker", (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        const posX = detail.position?.x ?? 0;
        const posY = detail.position?.y ?? 0;
        const posZ = detail.position?.z ?? 0;
        this.focusTarget = {
          position: new THREE.Vector3(posX, posY, posZ),
          lookAt: new THREE.Vector3(posX, posY, posZ),
        };
        activeDialogueStore.set({
          id: detail.id,
          title: detail.title,
          sentences: detail.sentences,
        });
      }
    });

    window.addEventListener("hide-speech", () => {
      this.focusTarget = null;
      activeDialogueStore.set(null);
    });

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    this.canvas.addEventListener("click", (ev) => {
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
        window.dispatchEvent(
          new CustomEvent("open-webview", { detail: { component } }),
        );
      }
    }
  }

  // dialogues and 3D map interaction markers
  speechTriggers = [
    {
      id: "surge-world",
      position: new THREE.Vector3(1.0, 0.5, -5.85),
      cameraTarget: {
        position: new THREE.Vector3(1.0, 1.8, -4.2),
        lookAt: new THREE.Vector3(1.0, 0.8, -5.85),
      },
      title: "Surge World",
      sentences: [
        "Welcome to StormHacks 2026! Explore the venue and interactive stations around the map.",
        "Walk around using WASD or arrow keys. Click on points of interest to learn more about each location!",
      ],
    },
    {
      id: "taskboard",
      position: new THREE.Vector3(1.12, 2.6, 0.11),
      cameraTarget: {
        position: new THREE.Vector3(1.12, 2.8, 1.8),
        lookAt: new THREE.Vector3(1.12, 2.6, 0.11),
      },
      title: "Taskboard",
      sentences: [
        "This is the short text description that is associated with each section of the website. Have it look like it gets typed in each time animated in.",
        "Here you can find all hackathon workshops, submission guidelines, and event schedules.",
        "Make sure to submit your projects before the hacking deadline!",
      ],
    },
    {
      id: "workshop-lab",
      position: new THREE.Vector3(-2.8, 0.8, -2.5),
      cameraTarget: {
        position: new THREE.Vector3(-1.2, 1.6, -1.5),
        lookAt: new THREE.Vector3(-2.8, 0.8, -2.5),
      },
      title: "Workshop Lab",
      sentences: [
        "Hands-on workshops on Web3, AI models, and 3D web development take place right here.",
        "Mentors are available throughout the hackathon to assist with technical questions.",
      ],
    },
    {
      id: "lounge-zone",
      position: new THREE.Vector3(3.2, 0.8, 1.5),
      cameraTarget: {
        position: new THREE.Vector3(1.8, 1.6, 2.5),
        lookAt: new THREE.Vector3(3.2, 0.8, 1.5),
      },
      title: "Lounge Zone",
      sentences: [
        "Take a break! Enjoy snacks, games, and connect with fellow hackers.",
        "Network with sponsor reps and catch lightning talks here during breaks.",
      ],
    },
  ];

  updateSpeechTriggers() {
    const playerPos = this.character ? this.character.position : null;
    const projVec = new THREE.Vector3();
    const updatedMarkers: MarkerData[] = [];

    for (const trigger of this.speechTriggers) {
      projVec.copy(trigger.position);
      projVec.project(this.camera);

      // In Three.js projection: z < 1 means in front of camera frustum
      const isVisible = projVec.z < 1 && projVec.z > -1;
      const screenX = (projVec.x * 0.5 + 0.5) * window.innerWidth;
      const screenY = (-(projVec.y * 0.5) + 0.5) * window.innerHeight;

      const distance = playerPos ? playerPos.distanceTo(trigger.position) : 999;
      // When player gets closer to points (e.g. <= 3.2m), transition into speech bubble indicator
      let isNear = distance <= 3.2;

      // Turn taskboard speech bubble into an indicator when player is on the other side of the wall
      if (trigger.id === "taskboard" && playerPos && playerPos.z > 0.4) {
        isNear = false;
      }

      updatedMarkers.push({
        id: trigger.id,
        title: trigger.title,
        sentences: trigger.sentences,
        position: {
          x: trigger.position.x,
          y: trigger.position.y,
          z: trigger.position.z,
        },
        cameraTarget: {
          x: trigger.cameraTarget.position.x,
          y: trigger.cameraTarget.position.y,
          z: trigger.cameraTarget.position.z,
        },
        screenPos: { x: screenX, y: screenY, visible: isVisible },
        distance,
        isNear,
      });
    }

    markersStore.set(updatedMarkers);
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
      syncPortalFlipbookFromTime(this.roomGroup, this.portalFlipbookTime);
      this.updateCharacter(dt);
      this.updateSpeechTriggers();
      this.updateCamera();

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

    // Aggressive cleanup — dispose all geometries, materials, AND textures
    this.scene.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const mat of materials) {
          if (!mat) continue;
          // Dispose all textures on the material
          for (const key of Object.keys(mat)) {
            const value = (mat as any)[key];
            if (value && value.isTexture) {
              value.dispose();
            }
          }
          mat.dispose();
        }
      }
    });

    // Dispose collision mesh BVH
    if (this.cameraCollisionMesh?.geometry) {
      const geom = this.cameraCollisionMesh.geometry as any;
      if (geom.boundsTree) {
        geom.boundsTree = null;
      }
      geom.dispose();
    }

    this.renderer.dispose();
    // Force GPU context loss to immediately free VRAM
    this.renderer.forceContextLoss();
    (this.canvas as any).remove();
  }
}
