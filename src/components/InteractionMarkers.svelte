<script lang="ts">
  import { markersStore, activeDialogueStore, type MarkerData } from '../stores/markers';
  import imgBouncingTri from '../assets/svg/bouncingTri.svg';
  import imgClickToExpand from '../assets/svg/clickToExpand.svg';

  function handleClick(marker: MarkerData) {
    if (!marker.isNear) return;
    // Dispatch custom event to select location and trigger camera zoom + dialogue
    window.dispatchEvent(new CustomEvent('select-marker', { detail: marker }));
  }
</script>

<div class="markers-layer">
  {#each $markersStore as marker (marker.id)}
    {#if marker.screenPos.visible && !$activeDialogueStore}
      <button
        class="marker-item"
        class:is-near={marker.isNear}
        class:is-far={!marker.isNear}
        disabled={!marker.isNear}
        style="left: {marker.screenPos.x}px; top: {marker.screenPos.y}px;"
        on:click|stopPropagation={() => handleClick(marker)}
        title={marker.isNear ? marker.title : ''}
        aria-label={marker.title}
      >
        {#if marker.isNear}
          <!-- Near State: Click to Expand SVG + 3 Animated Dots -->
          <div class="click-to-expand-container">
            <img src={imgClickToExpand} alt="Click to expand" class="click-to-expand-svg" />
            <div class="dots-container">
              <span class="dot dot-1"></span>
              <span class="dot dot-2"></span>
              <span class="dot dot-3"></span>
            </div>
          </div>
        {:else}
          <!-- Far State: Bouncing Tri SVG -->
          <div class="bouncing-tri-container">
            <img src={imgBouncingTri} alt="" class="bouncing-tri-svg" />
          </div>
        {/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .markers-layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 40;
  }

  .marker-item {
    position: absolute;
    transform: translate(-50%, -100%);
    pointer-events: auto;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    outline: none;
    transition: transform 0.15s ease-out;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .marker-item.is-far {
    pointer-events: none;
    cursor: default;
  }

  .marker-item.is-far:hover {
    transform: translate(-50%, -100%);
  }

  .marker-item:hover {
    transform: translate(-50%, -108%) scale(1.1);
  }

  .bouncing-tri-container,
  .click-to-expand-container {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    filter: drop-shadow(0px 4px 0px #101a21);
    animation: bounce 1.4s ease-in-out infinite alternate;
  }

  .bouncing-tri-svg {
    width: 60px;
    height: 60px;
    object-fit: contain;
  }

  .click-to-expand-svg {
    width: 99px;
    height: 65px;
    object-fit: contain;
  }

  .dots-container {
    position: absolute;
    top: 18px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: center;
    z-index: 2;
    pointer-events: none;
  }

  .dot {
    width: 10px;
    height: 10px;
    background-color: #fc7900;
    border-radius: 50%;
    animation: dotWave 1.2s ease-in-out infinite;
  }

  .dot-1 { animation-delay: 0s; }
  .dot-2 { animation-delay: 0.2s; }
  .dot-3 { animation-delay: 0.4s; }

  @keyframes dotWave {
    0%, 100% {
      transform: translateY(0);
      opacity: 0.5;
    }
    50% {
      transform: translateY(-4px);
      opacity: 1;
    }
  }

  @keyframes bounce {
    0% {
      transform: translateY(0);
    }
    100% {
      transform: translateY(-10px);
    }
  }
</style>
