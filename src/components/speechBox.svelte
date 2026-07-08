<script lang="ts">
  import { onMount } from "svelte";
  
  const boxImage = new URL('../../assets/ui/speechBoxContainer.png', import.meta.url).href;
  export let title = "";
  export let text = "";
  export let portalUrl = "";

  let displayedText = "";
  let typing = false;

  //Typewriter effect
  async function typeText() {
    typing = true;
    displayedText = "";

    for (const char of text) {
      displayedText += char;
      await new Promise((r) => setTimeout(r, 20));
    }

    typing = false;
  }

  $: if (text) {
    typeText();
  }

  function skipTyping() {
    displayedText = text;
    typing = false;
  }

  function handleNext() {
    if (portalUrl) {
      window.location.href = portalUrl;
    }
  }

  function handleClose() {
    window.dispatchEvent(new CustomEvent('hide-speech'));
  }
</script>

<div class="speech-box" style={`background-image: url(${boxImage});`}>
  <div class="header">
    {title}
  </div>

  <button class="close" on:click={handleClose}>X</button>

  <div
    class="content"
    on:click={skipTyping}
  >
    {displayedText}
  </div>

  {#if portalUrl}
    <button class="next" on:click={handleNext}>
      ->
    </button>
  {/if}
</div>

<style>
  .speech-box {
    position: relative;
    width: 880px;
    /*background: white;
    border: 2px solid black;
    border-radius: 12px;
    padding: 40px;*/
  }

  .header {
    position: absolute;
    top: -35px;
    left: -20px;
    z-index: 1;

    background: orange;
    border: 2px solid black;
    border-radius: 10px;

    padding: 15px 25px;
    font-weight: bold;
  }

  .close {
    position: absolute;
    top: -20px;
    right: -20px;
    z-index: 1;

    width: 50px;
    height: 50px;

    background: orange;
    border: 2px solid black;
    border-radius: 50%;
  }

  .content {
    position: relative;

    min-height: 120px;
    padding: 2rem;

    background: white;
    border: 2px solid black;
    border-radius: 12px;

    clip-path: polygon(0 5%, 100% 0, 100% 100%, 0 83%);
  }

  .next {
    position: absolute;
    right: 20px;
    bottom: 20px;

    width: 60px;
    height: 60px;
    border-radius: 10px;
  }
</style>