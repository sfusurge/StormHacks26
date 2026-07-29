<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Overlay from './components/Overlay.svelte';
  import InfoPanel from './components/InfoPanel.svelte';
  import SpeechBox from './components/speechBox.svelte';
  import Loading from './components/Loading.svelte';
  import MobileJoystick from './components/MobileJoystick.svelte';
  import InteractionMarkers from './components/InteractionMarkers.svelte';
  import { activeDialogueStore } from './stores/markers';
  import { ThreeScene } from './lib/ThreeScene';

  let show = false;
  let currentComponent: any = null;
  let scene: ThreeScene | null = null;
  let isLoading = true;
  let isMobile = false;

  let showSpeech = false;
  let speechData = { title: '', text: '' as string | string[], portalUrl: '' };

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

  function showSpeechHandler(e: CustomEvent) {
    speechData = e.detail;
    showSpeech = true;
  }

  function hideSpeechHandler() {
    showSpeech = false;
    activeDialogueStore.set(null);
  }

  onMount(() => {
    // Detect mobile
    isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    window.addEventListener('open-webview', openHandler as EventListener);
    window.addEventListener('show-speech', showSpeechHandler as EventListener);
    window.addEventListener('hide-speech', hideSpeechHandler as EventListener);
    const canvas = document.getElementById('three-canvas') as HTMLCanvasElement;
    scene = new ThreeScene(canvas);

    scene.isLoading.subscribe(value => {
      isLoading = value;
    });

    return () => { scene?.dispose(); };
  });
  
  onDestroy(() => {
    window.removeEventListener('open-webview', openHandler as EventListener);
    window.removeEventListener('show-speech', showSpeechHandler as EventListener);
    window.removeEventListener('hide-speech', hideSpeechHandler as EventListener);
  });
</script>

<style>
  .fullscreen-canvas { position: fixed; inset: 0; width: 100%; height: 100%; }

  .speech-layer {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    z-index: 50;
    width: 100%;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }

  .speech-layer :global(> *) {
    pointer-events: auto;
  }
</style>

<div class="fullscreen-canvas">
  <canvas id="three-canvas" />
</div>

{#if isMobile}
  <MobileJoystick />
{/if}

{#if isLoading}
  <Loading />
{/if}

{#if !isLoading}
  <InteractionMarkers />
{/if}

{#if show && !isLoading}
  <Overlay title="In-Scene Component" on:close={close}>
    {#if currentComponent}
      <svelte:component this={currentComponent} on:close={close} />
    {/if}
  </Overlay>
{/if}

{#if $activeDialogueStore && !isLoading}
  <div class="speech-layer">
    <SpeechBox
      title={$activeDialogueStore.title}
      text={$activeDialogueStore.sentences}
      portalUrl={$activeDialogueStore.portalUrl || ''}
      on:close={hideSpeechHandler}
    />
  </div>
{:else if showSpeech && !isLoading}
  <div class="speech-layer">
    <SpeechBox
      title={speechData.title}
      text={speechData.text}
      portalUrl={speechData.portalUrl}
      on:close={hideSpeechHandler}
    />
  </div>
{/if}


