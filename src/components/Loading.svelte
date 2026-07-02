<script lang="ts">
    import { onMount } from 'svelte';

    onMount(() => {
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
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
        background: rgb(0 0 0 / 0.95);
        backdrop-filter: blur(2px);
        z-index: 9999;
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
</style>

<div class="loading-overlay">
    <div class="spinner" />
</div>
