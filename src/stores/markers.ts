import { writable } from 'svelte/store';

export interface MarkerData {
  id: string;
  title: string;
  sentences: string[];
  position: { x: number; y: number; z: number };
  cameraTarget?: { x: number; y: number; z: number };
  screenPos: { x: number; y: number; visible: boolean };
  distance: number;
  isNear: boolean;
}

export const markersStore = writable<MarkerData[]>([]);

export interface ActiveDialogue {
  id: string;
  title: string;
  sentences: string[];
  portalUrl?: string;
}

export const activeDialogueStore = writable<ActiveDialogue | null>(null);
