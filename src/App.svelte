<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Overlay from './components/Overlay.svelte';
  import InfoPanel from './components/InfoPanel.svelte';
  import SpeechBox from './components/speechBox.svelte';
  import Loading from './components/Loading.svelte';
  import { ThreeScene } from './lib/ThreeScene';

  let show = false;
  let currentComponent: any = null;
  let scene: ThreeScene | null = null;
  let isLoading = true;

  let showSpeech = false;
  let speechData = { title: '', text: '' };

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
  }

  onMount(() => {
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

  /*let showSpeech = true;

  let speechData = {
    title: "Name of Location",
    text: "This is the short text description that is associated with each section of the website."
  };*/
</script>

<style>
  .fullscreen-canvas { position: fixed; inset: 0; width: 100%; height: 100%; }

  .speech-layer {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    z-index: 50;
  }
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

{#if showSpeech && !isLoading}
  <div class="speech-layer">
    <SpeechBox title={speechData.title} text={speechData.text} />
  </div>
{/if}

