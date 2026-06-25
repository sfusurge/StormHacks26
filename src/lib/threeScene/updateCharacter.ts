import * as THREE from 'three';

var jumpTracker = 0;
var jumpCD = 3;

function canJump(velocityY: number) : boolean {
  if(jumpTracker <= 0){
    jumpTracker = jumpCD;
    return true;
  }
  if(velocityY >= 0 && velocityY <= 0.1){
    jumpTracker--;
  }else{
    jumpTracker = jumpCD;
  }
  return false;
}

export function updateCharacter(ctx: any, dt: number) {
  if (!ctx.playerBody || !ctx.character) return;

  const speed = 2.0; // meters per second target speed
  let inputX = 0;
  let inputZ = 0;
  if (ctx.keys['w'] || ctx.keys['arrowup']) inputZ += 1;
  if (ctx.keys['s'] || ctx.keys['arrowdown']) inputZ -= 1;
  if (ctx.keys['a'] || ctx.keys['arrowleft']) inputX -= 1;
  if (ctx.keys['d'] || ctx.keys['arrowright']) inputX += 1;

  const camForward = new THREE.Vector3();
  ctx.camera.getWorldDirection(camForward);
  camForward.y = 0;
  if (camForward.lengthSq() < 1e-6) camForward.set(0, 0, -1);
  camForward.normalize();
  const camRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();

  const lateralScale = 0.25;
  const forwardVel = new THREE.Vector3().copy(camForward).multiplyScalar(inputZ * speed);
  const lateralVel = new THREE.Vector3().copy(camRight).multiplyScalar(inputX * speed * lateralScale);
  const vel = new THREE.Vector3().addVectors(forwardVel, lateralVel);

  if (vel.lengthSq() > 1e-6) {
    ctx.playerBody.velocity.x = vel.x;
    ctx.playerBody.velocity.z = vel.z;
    const angle = Math.atan2(vel.x, vel.z);
    const current = (ctx.character.rotation && ctx.character.rotation.y) || 0;
    if (inputZ < 0 && Math.abs(inputZ) >= Math.abs(inputX)) {
      // keep facing same direction when backing up
    } else {
      let angleDiff = (angle - current + Math.PI) % (Math.PI * 2) - Math.PI;
      const rotSpeedBase = 0.12;
      const rotSpeed = (Math.abs(inputZ) > 1e-4) ? rotSpeedBase : rotSpeedBase * 0.25;
      const newYaw = current + angleDiff * rotSpeed;
      ctx.character.rotation.y = newYaw;
    }
  } else {
    ctx.playerBody.velocity.x *= 0.9;
    ctx.playerBody.velocity.z *= 0.9;
  }

  if (ctx.keys[' '] && canJump(ctx.playerBody.velocity.y)) {
    ctx.playerBody.velocity.y = 4;
  }

  const p = ctx.playerBody.position;
  const bodyRadius = (ctx.playerBody.shapes && (ctx.playerBody.shapes[0] as any).radius) || 0.16;
  ctx.character.position.set(p.x, p.y - bodyRadius, p.z);
}
