import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { CollisionMapData } from './collisionMap';
import { getFootOffset } from './alignCharacterToFloor';

export const PLAYER_RADIUS = 0.10;
export const CAPSULE_HALF_HEIGHT = 0.22;

export type RapierContext = {
  world: RAPIER.World;
  controller: RAPIER.KinematicCharacterController;
  characterBody: RAPIER.RigidBody;
  characterCollider: RAPIER.Collider;
  capsuleCenterOffset: number;
};

let rapierReady: Promise<void> | null = null;

export function ensureRapier(): Promise<void> {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

export async function createRapierWorld(collision: CollisionMapData): Promise<RapierContext> {
  await ensureRapier();

  const world = new RAPIER.World({ x: 0, y: -9.82, z: 0 });
  const vertices = collision.positions;
  const indices = collision.indices;

  const staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices), staticBody);

  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 0);
  const characterBody = world.createRigidBody(bodyDesc);

  const capsuleCenterOffset = CAPSULE_HALF_HEIGHT + PLAYER_RADIUS;
  const colliderDesc = RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, PLAYER_RADIUS)
    .setTranslation(0, capsuleCenterOffset, 0);
  const characterCollider = world.createCollider(colliderDesc, characterBody);

  const controller = world.createCharacterController(0.02);
  controller.enableAutostep(0.35, 0.2, true);
  controller.enableSnapToGround(0.2);
  controller.setMaxSlopeClimbAngle(Math.PI / 3);

  return { world, controller, characterBody, characterCollider, capsuleCenterOffset };
}

export function syncRapierFromCharacter(ctx: RapierContext, character: THREE.Object3D) {
  const footOffset = getFootOffset(character);
  const t = character.position;
  const feetY = t.y - footOffset;
  ctx.characterBody.setTranslation(
    { x: t.x, y: feetY + ctx.capsuleCenterOffset, z: t.z },
    true
  );
  ctx.characterCollider.setTranslationWrtParent({ x: 0, y: 0, z: 0 });
}

export function syncCharacterFromRapier(ctx: RapierContext, character: THREE.Object3D) {
  const footOffset = getFootOffset(character);
  const t = ctx.characterBody.translation();
  character.position.set(t.x, t.y - ctx.capsuleCenterOffset + footOffset, t.z);
}

export function castFloorY(
  ctx: RapierContext,
  x: number,
  z: number,
  rayStartY: number,
  maxDist: number
): number | null {
  const ray = new RAPIER.Ray({ x, y: rayStartY, z }, { x: 0, y: -1, z: 0 });
  const hit = ctx.world.castRay(ray, maxDist, true, undefined, undefined, ctx.characterCollider);
  if (!hit) return null;
  return rayStartY - hit.timeOfImpact;
}

export function disposeRapier(ctx: RapierContext | null) {
  if (!ctx) return;
  ctx.world.removeCharacterController(ctx.controller);
  ctx.world.free();
}
