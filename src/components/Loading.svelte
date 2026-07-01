<script lang="ts">
  import { onMount } from 'svelte';

  let isVisible = true;
  let progress = 0;
  let stage = 'Initializing...';

  onMount(() => {
    // Prevent scrolling while loading
    document.body.style.overflow = 'hidden';

    // Listen for loading progress events
    const handleProgress = (e: any) => {
      progress = e.detail.progress;
      stage = e.detail.stage;
    };

    window.addEventListener('loading-progress', handleProgress);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('loading-progress', handleProgress);
    };
  });
</script>

<style>
  .loading-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(32, 35, 42, 0.95);
    backdrop-filter: blur(2px);
    z-index: 9999;
  }

  .loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2rem;
  }

  .spinner {
    width: 60px;
    height: 60px;
    border: 4px solid rgba(255, 255, 255, 0.2);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .loading-text {
    color: #ffffff;
    font-size: 1.125rem;
    font-weight: 500;
    letter-spacing: 0.05em;
  }

  .loading-subtext {
    color: rgba(255, 255, 255, 0.6);
    font-size: 0.875rem;
    text-align: center;
  }

  .progress-bar {
    width: 200px;
    height: 4px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #60a5fa, #3b82f6);
    transition: width 0.2s ease;
  }

  .progress-text {
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.75rem;
    margin-top: 0.5rem;
  }
</style>

{#if isVisible}
  <div class="loading-overlay">
    <div class="loading-container">
      <div class="spinner" />
      <div>
        <div class="loading-text">Loading Environment...</div>
        <div class="loading-subtext">{stage}</div>
        <div class="progress-bar" style="margin-top: 1rem;">
          <div class="progress-fill" style="width: {progress}%" />
        </div>
        <div class="progress-text">{Math.round(progress)}%</div>
      </div>
    </div>
  </div>
{/if}
