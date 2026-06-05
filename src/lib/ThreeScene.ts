import * as THREE from 'three';

export class ThreeScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  character: THREE.Mesh;
  interactables: THREE.Mesh[] = [];
  keys: Record<string, boolean> = {};
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x20232a);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.position.set(0, 2.5, 5);

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
    this.scene.add(dir);
  }

  makeRoom() {
    // simple box room (inverted)
    const size = 10;
    const geom = new THREE.BoxGeometry(size, size, size);
    // flip normals by negative scale
    const mat = new THREE.MeshStandardMaterial({ color: 0x808080, side: THREE.BackSide });
    const room = new THREE.Mesh(geom, mat);
    room.position.y = size / 2 - 1;
    this.scene.add(room);
  }

  makeCharacter() {
    const geom = new THREE.BoxGeometry(0.6, 1.6, 0.6);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3377ff });
    this.character = new THREE.Mesh(geom, mat);
    this.character.position.set(0, 0.8, 0);
    this.scene.add(this.character);
  }

  makeInteractable() {
    const geom = new THREE.BoxGeometry(0.8, 0.8, 0.2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffaa00 });
    const obj = new THREE.Mesh(geom, mat);
    obj.position.set(2, 1, -1);
    // attach a component name to render from the app
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

  updateCharacter(dt: number) {
    const speed = 2.5;
    let inputX = 0;
    let inputZ = 0;
    // Camera-relative controls: W moves forward, S backward
    if (this.keys['w'] || this.keys['arrowup']) inputZ += 1;
    if (this.keys['s'] || this.keys['arrowdown']) inputZ -= 1;
    if (this.keys['a'] || this.keys['arrowleft']) inputX -= 1;
    if (this.keys['d'] || this.keys['arrowright']) inputX += 1;

    // compute movement only when there's input
    if (inputX !== 0 || inputZ !== 0) {
      // camera's forward (where it's looking) projected to XZ
      const camForward = new THREE.Vector3();
      this.camera.getWorldDirection(camForward);
      camForward.y = 0;
      if (camForward.lengthSq() < 1e-6) camForward.set(0, 0, -1);
      camForward.normalize();
      const camRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();

      const move = new THREE.Vector3();
      move.addScaledVector(camForward, inputZ);
      move.addScaledVector(camRight, inputX);

      if (move.lengthSq() > 0) {
        move.normalize();
        this.character.position.addScaledVector(move, speed * dt);
        const angle = Math.atan2(move.x, move.z);
        this.character.rotation.y = angle;
      }
    }

    // clamp character inside the room bounds (room size 10)
    const half = 10 / 2 - 0.5;
    this.character.position.x = THREE.MathUtils.clamp(this.character.position.x, -half, half);
    this.character.position.z = THREE.MathUtils.clamp(this.character.position.z, -half, half);

    // simple camera follow (third-person) using camera forward to compute a stable offset behind the character
    const camForwardAfter = new THREE.Vector3();
    this.camera.getWorldDirection(camForwardAfter);
    camForwardAfter.y = 0;
    if (camForwardAfter.lengthSq() < 1e-6) camForwardAfter.set(0, 0, -1);
    camForwardAfter.normalize();

    const desiredPos = new THREE.Vector3().copy(this.character.position)
      .add(new THREE.Vector3(0, 2.0, 0))
      .add(camForwardAfter.clone().negate().multiplyScalar(5));

    this.camera.position.lerp(desiredPos, 0.12);

    // look at character
    const lookAt = new THREE.Vector3().copy(this.character.position).add(new THREE.Vector3(0, 1.0, 0));
    this.camera.lookAt(lookAt);
  }

  animate() {
    const clock = new THREE.Clock();
    const tick = () => {
      if (this.disposed) return;
      const dt = clock.getDelta();
      this.updateCharacter(dt);
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
