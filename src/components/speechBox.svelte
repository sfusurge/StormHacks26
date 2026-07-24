<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import imgRectangle74 from '../assets/svg/speechShape.svg';
  import imgRectangle73 from '../assets/svg/orangeBox.svg';
  import imgGroup29 from '../assets/svg/whiteBox.svg';
  import imgGroup30 from '../assets/svg/blackBox.svg';
  import imgArrowButton from '../assets/svg/arrowButton.svg';

  export let title: string = "Name of Location";
  export let text: string | string[] = "This is the short text description that is associated with each section of the website. Have it look like it gets typed in each time animated in.";
  export let portalUrl: string = "";

  const dispatch = createEventDispatcher();

  // Normalize text into an array of sentences
  $: sentences = Array.isArray(text)
    ? text
    : text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);

  let currentSentenceIndex = 0;
  let displayedText = "";
  let isTyping = false;
  let timer: any = null;
  let isNextHovered = false;

  $: currentSentence = sentences[currentSentenceIndex] || "";

  // Start typing when sentence changes
  $: if (currentSentence) {
    typeSentence(currentSentence);
  }

  function typeSentence(targetText: string) {
    if (timer) clearInterval(timer);
    isTyping = true;
    displayedText = "";
    let idx = 0;

    timer = setInterval(() => {
      if (idx < targetText.length) {
        displayedText += targetText[idx];
        idx++;
      } else {
        isTyping = false;
        clearInterval(timer);
        timer = null;
      }
    }, 22);
  }

  function handleContentClick() {
    if (isTyping) {
      if (timer) clearInterval(timer);
      displayedText = currentSentence;
      isTyping = false;
    } else {
      handleNext();
    }
  }

  function handleNext() {
    if (isTyping) {
      if (timer) clearInterval(timer);
      displayedText = currentSentence;
      isTyping = false;
      return;
    }

    if (currentSentenceIndex < sentences.length - 1) {
      currentSentenceIndex++;
    } else {
      if (portalUrl) {
        window.location.href = portalUrl;
      } else {
        handleClose();
      }
    }
  }

  function handleClose() {
    if (timer) clearInterval(timer);
    dispatch('close');
    window.dispatchEvent(new CustomEvent('hide-speech'));
  }
</script>

<div class="speech-box-wrapper">
  <!-- 1. Location Name Badge (Node 2285:668) -->
  <div class="badge-container">
    <img src={imgRectangle73} alt="" class="badge-svg-bg" />
    <div class="badge-content">
      <span class="badge-title">{title}</span>
    </div>
  </div>

  <!-- 2. Close Button 'X' (Node 2285:679) -->
  <button class="close-button" on:click={handleClose} aria-label="Close dialogue">
    <span class="close-x">X</span>
  </button>

  <!-- 3. Main Dialogue Box Frame (Node 2285:667) -->
  <div
    class="main-frame"
    role="button"
    tabindex="0"
    on:click={handleContentClick}
    on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && handleContentClick()}
  >
    <img src={imgRectangle74} alt="" class="main-svg-bg" />

    <!-- 4. Text Paragraph (Node 2285:672) -->
    <div class="text-container">
      <p class="dialogue-text">
        {displayedText}
        {#if isTyping}
          <span class="cursor-blink">|</span>
        {/if}
      </p>
    </div>

    <!-- 5. Next Button (Node 2285:673) -->
    <button
      class="next-button"
      on:mouseenter={() => isNextHovered = true}
      on:mouseleave={() => isNextHovered = false}
      on:click|stopPropagation={handleNext}
      aria-label="Next sentence"
    >
      <img src={isNextHovered ? imgGroup30 : imgGroup29} alt="" class="next-bg-svg" />
      <img src={imgArrowButton} alt="" class="next-icon-svg" class:inverted={isNextHovered} />
    </button>
  </div>
</div>

<style>
  .speech-box-wrapper {
    position: relative;
    width: 880px;
    max-width: calc(100vw - 32px);
    margin: 0 auto;
    box-sizing: border-box;
  }

  /* 1. Location Name Badge (Node 2285:668) */
  .badge-container {
    position: absolute;
    top: -46px;
    left: -8px;
    width: 256px;
    height: 77px;
    z-index: 10;
    pointer-events: none;
  }

  .badge-svg-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: fill;
  }

  .badge-content {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 16px;
    box-sizing: border-box;
  }

  .badge-title {
    font-family: 'Exposure', sans-serif;
    font-variation-settings: 'EXPO' -60;
    font-weight: -60;
    font-size: 22px;
    color: #101a21;
    white-space: nowrap;
    letter-spacing: -0.01em;
    text-align: center;
  }

  /* 2. Close Button 'X' (Node 2285:679) */
  .close-button {
    position: absolute;
    top: -38px;
    right: 12px;
    z-index: 15;
    width: 50px;
    height: 50px;
    border-radius: 68px;
    background-color: #fc7900;
    border: 3px solid #101a21;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 2px 3px 0px #101a21;
    transition: transform 0.1s ease;
  }

  .close-button:active {
    transform: translate(2px, 2px);
    box-shadow: 0px 1px 0px #101a21;
  }

  .close-x {
    font-size: 24px;
    font-weight: 900;
    color: #101a21;
    line-height: 1;
  }

  /* 3. Main Frame (Node 2285:667) */
  .main-frame {
    position: relative;
    width: 100%;
    min-height: 210px;
    cursor: pointer;
    user-select: none;
    display: flex;
    align-items: center;
  }

  .main-svg-bg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: fill;
    pointer-events: none;
  }

  /* 4. Text Paragraph (Node 2285:672) */
  .text-container {
    position: relative;
    z-index: 5;
    padding: 40px 115px 36px 115px;
    width: 100%;
    box-sizing: border-box;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .dialogue-text {
    margin: 0;
    font-size: 22px;
    line-height: 1.45;
    color: #101a21;
    font-weight: 600;
    letter-spacing: -0.01em;
    text-align: center;
  }

  .cursor-blink {
    display: inline-block;
    color: #fc7900;
    font-weight: bold;
    animation: blink 0.7s infinite;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }

  /* 5. Next Arrow Button (Node 2285:673) */
  .next-button {
    position: absolute;
    bottom: 14px;
    right: 28px;
    z-index: 10;
    width: 89px;
    height: 72px;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    /* Instant switch on hover - NO CSS TRANSITION! */
    transition: none;
  }

  .next-bg-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: fill;
  }

  .next-icon-svg {
    position: absolute;
    top: 13px;
    left: 6px;
    width: 77.186px;
    height: 46px;
    object-fit: fill;
  }

  .next-icon-svg.inverted {
    filter: invert(1);
  }

  /* Mobile Responsive Scaling */
  @media (max-width: 640px) {
    .speech-box-wrapper {
      width: 94vw;
    }

    .badge-container {
      top: -36px;
      left: -6px;
      width: 190px;
      height: 56px;
    }

    .badge-content {
      padding: 0 10px;
    }

    .badge-title {
      font-size: 16px;
    }

    .close-button {
      top: -30px;
      right: 8px;
      width: 40px;
      height: 40px;
    }

    .close-x {
      font-size: 18px;
    }

    .main-frame {
      min-height: 170px;
    }

    .text-container {
      padding: 28px 80px 28px 80px;
    }

    .dialogue-text {
      font-size: 16px;
      line-height: 1.4;
    }

    .next-button {
      bottom: 10px;
      right: 14px;
      width: 70px;
      height: 56px;
    }

    .next-icon-svg {
      top: 10px;
      left: 5px;
      width: 60px;
      height: 36px;
    }
  }
</style>