<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Overlay from './components/Overlay.svelte';
  import InfoPanel from './components/InfoPanel.svelte';
  import Loading from './components/Loading.svelte';
  import { ThreeScene } from './lib/ThreeScene';

  let show = false;
  let currentComponent: any = null;
  let scene: ThreeScene | null = null;
  let isLoading = true;

  const components: Record<string, any> = {
    InfoPanel
  };

  function openHandler(e: CustomEvent) {
    const compName = e.detail?.component;
    currentComponent = components[compName] || null;
    show = !!currentComponent;
  }
  function close() {
    show = false;
    currentComponent = null;
  }

  onMount(() => {
    window.addEventListener('open-webview', openHandler as EventListener);
    const canvas = document.getElementById('three-canvas') as HTMLCanvasElement;
    scene = new ThreeScene(canvas);

    scene.isLoading.subscribe(value => {
      isLoading = value;
    });

    return () => { scene?.dispose(); };
  });
  onDestroy(() => {
    window.removeEventListener('open-webview', openHandler as EventListener);
  });
</script>

<style>
  .fullscreen-canvas { position: fixed; inset: 0; width: 100%; height: 100%; }
</style>

<div class="fullscreen-canvas">
  <canvas id="three-canvas" />
</div>

{#if isLoading}
  <Loading />
{/if}

{#if show && !isLoading}
  <Overlay title="In-Scene Component" on:close={close}>
    {#if currentComponent}
      <svelte:component this={currentComponent} on:close={close} />
    {/if}
  </Overlay>
{/if}