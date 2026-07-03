<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Overlay from './components/Overlay.svelte';
  import InfoPanel from './components/InfoPanel.svelte';
  import SpeechBox from './components/speechBox.svelte';
  import { ThreeScene } from './lib/ThreeScene';

  let show = false;
  let currentComponent: any = null;
  let scene: ThreeScene | null = null;

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
</style>

<div class="fullscreen-canvas">
  <canvas id="three-canvas" />
</div>

<div class="speech-box-container" style="position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%);">
  {#if showSpeech}
    <SpeechBox
      title={speechData.title}
      text={speechData.text}
    />
  {/if}
</div>

{#if show}
  <Overlay title="In-Scene Component" on:close={close}>
    {#if currentComponent}
      <svelte:component this={currentComponent} on:close={close} />
    {/if}
  </Overlay>
{/if}
