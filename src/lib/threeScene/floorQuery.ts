import type { RapierContext } from './rapierPhysics';
import { castFloorY } from './rapierPhysics';

export function findFloorY(
  rapier: RapierContext | null,
  roomMinY: number,
  x: number,
  z: number,
  rayStartY: number
): number | null {
  if (!rapier) return roomMinY;
  const maxDist = Math.max(rayStartY - roomMinY + 2, 1);
  return castFloorY(rapier, x, z, rayStartY + 0.5, maxDist);
}
