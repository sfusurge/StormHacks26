<script lang="ts">
	import { onMount } from 'svelte';
	import { joystickData } from '../stores/joystick';

	interface JoystickTouch {
		id: number;
		x: number;
		y: number;
		baseX: number;
		baseY: number;
		angle: number;
		distance: number;
		isActive: boolean;
	}

	interface TapState {
		id: number;
		startX: number;
		startY: number;
		startTime: number;
	}

	let joysticks: Map<number, JoystickTouch> = new Map();
	let tapStates: Map<number, TapState> = new Map();
	let rafId: number;

	const JOYSTICK_RADIUS = 50;
	const JOYSTICK_MAX_DISTANCE = 80;
	const OUTER_RADIUS = 100;
	const TAP_DISTANCE_THRESHOLD = 30; // Max pixels moved to count as tap
	const TAP_TIME_THRESHOLD = 300; // Max milliseconds for tap

	onMount(() => {
		const handleTouchStart = (e: TouchEvent) => {
			for (let i = 0; i < e.touches.length; i++) {
				const touch = e.touches[i];
				const id = touch.identifier;

				// Track tap state
				tapStates.set(id, {
					id,
					startX: touch.clientX,
					startY: touch.clientY,
					startTime: Date.now()
				});

				if (!joysticks.has(id)) {
					joysticks.set(id, {
						id,
						x: touch.clientX,
						y: touch.clientY,
						baseX: touch.clientX,
						baseY: touch.clientY,
						angle: 0,
						distance: 0,
						isActive: true
					});
				}
			}
			joysticks = joysticks;
			forceRender();
		};

		const handleTouchMove = (e: TouchEvent) => {
			for (let i = 0; i < e.touches.length; i++) {
				const touch = e.touches[i];
				const id = touch.identifier;
				const joystick = joysticks.get(id);

				if (joystick) {
					const deltaX = touch.clientX - joystick.baseX;
					const deltaY = touch.clientY - joystick.baseY;
					const distance = Math.min(
						Math.sqrt(deltaX * deltaX + deltaY * deltaY),
						JOYSTICK_MAX_DISTANCE
					);
					const angle = Math.atan2(deltaY, deltaX);

					joystick.x = joystick.baseX + Math.cos(angle) * distance;
					joystick.y = joystick.baseY + Math.sin(angle) * distance;
					joystick.angle = angle;
					joystick.distance = distance;
				}
			}
			joysticks = joysticks;
			forceRender();
		};

		const handleTouchEnd = (e: TouchEvent) => {
			const activeTouches = new Set(
				Array.from(e.touches).map((t) => t.identifier)
			);

			// Check for taps
			Array.from(e.changedTouches).forEach((touch) => {
				const tapState = tapStates.get(touch.identifier);
				if (tapState) {
					const distMoved = Math.hypot(
						touch.clientX - tapState.startX,
						touch.clientY - tapState.startY
					);
					const timeSinceStart = Date.now() - tapState.startTime;

					// If it's a tap (quick, short movement), trigger jump
					if (distMoved < TAP_DISTANCE_THRESHOLD && timeSinceStart < TAP_TIME_THRESHOLD) {
						window.dispatchEvent(new CustomEvent('joystick-jump'));
					}
				}
				tapStates.delete(touch.identifier);
			});

			joysticks.forEach((joystick, id) => {
				if (!activeTouches.has(id)) {
					joysticks.delete(id);
				}
			});
			joysticks = joysticks;
			forceRender();
		};

		// Attach listeners to window to bypass pointer-events: none
		window.addEventListener('touchstart', handleTouchStart);
		window.addEventListener('touchmove', handleTouchMove);
		window.addEventListener('touchend', handleTouchEnd);

		return () => {
			window.removeEventListener('touchstart', handleTouchStart);
			window.removeEventListener('touchmove', handleTouchMove);
			window.removeEventListener('touchend', handleTouchEnd);
			if (rafId) cancelAnimationFrame(rafId);
		};
	});

	function forceRender() {
		if (rafId) cancelAnimationFrame(rafId);
		rafId = requestAnimationFrame(() => {
			joysticks = joysticks;
			updateStore();
		});
	}

	function updateStore() {
		const data: Record<number, { id: number; x: number; y: number; angle: number; distance: number }> = {};
		joysticks.forEach((joystick, id) => {
			const normalizedDistance = Math.min(joystick.distance / JOYSTICK_MAX_DISTANCE, 1);
			data[id] = {
				id,
				x: Math.cos(joystick.angle) * normalizedDistance,
				y: Math.sin(joystick.angle) * normalizedDistance,
				angle: joystick.angle,
				distance: normalizedDistance
			};
		});
		joystickData.set(data);
	}
</script>

<div class="fixed inset-0 touch-none select-none" style="pointer-events: none; z-index: 10;">
	<!-- Joystick Indicators -->
	{#each Array.from(joysticks.values()) as joystick (joystick.id)}
		<div
			class="absolute pointer-events-none"
			style="
				left: {joystick.baseX}px;
				top: {joystick.baseY}px;
				transform: translate(-50%, -50%);
			"
		>
			<!-- Outer circle (static) -->
			<div
				class="absolute rounded-full border-2 border-blue-400/50"
				style="
					width: {OUTER_RADIUS * 2}px;
					height: {OUTER_RADIUS * 2}px;
					left: -{OUTER_RADIUS}px;
					top: -{OUTER_RADIUS}px;
				"
			/>

			<!-- Inner circle (follows touch) -->
			<div
				class="absolute rounded-full bg-blue-500/80 shadow-lg shadow-blue-500/50 transition-all"
				style="
					width: {JOYSTICK_RADIUS * 2}px;
					height: {JOYSTICK_RADIUS * 2}px;
					left: {-JOYSTICK_RADIUS + (joystick.x - joystick.baseX)}px;
					top: {-JOYSTICK_RADIUS + (joystick.y - joystick.baseY)}px;
				"
			/>

			<!-- Direction indicator -->
			<svg
				class="absolute w-12 h-12"
				style="left: -24px; top: -24px;"
				viewBox="0 0 48 48"
			>
				<line
					x1="24"
					y1="24"
					x2={24 + Math.cos(joystick.angle) * 15}
					y2={24 + Math.sin(joystick.angle) * 15}
					stroke="rgb(59, 130, 246)"
					stroke-width="2"
					opacity="0.7"
				/>
			</svg>
		</div>
	{/each}
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		overflow: hidden;
	}
</style>
