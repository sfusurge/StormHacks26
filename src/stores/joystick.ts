import { writable } from 'svelte/store';

export interface JoystickData {
	id: number;
	x: number;
	y: number;
	angle: number;
	distance: number;
}

export const joystickData = writable<Record<number, JoystickData>>({});
