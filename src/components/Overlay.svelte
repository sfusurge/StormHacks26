<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
  function close() { dispatch('close'); }
</script>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; }
  .frame { width: 90vw; height: 80vh; background: white; border-radius:8px; overflow:hidden; display:flex; flex-direction:column; }
  .header { height:32px;background:#111;color:white;display:flex;align-items:center;padding:0 12px;justify-content:space-between; }
  .content { flex:1; overflow:auto; }
</style>

<div class="backdrop" on:click|self={close}>
  <div class="frame" on:click|stopPropagation>
    <div class="header">
      <button on:click={close} class="ml-2 px-2 py-1 bg-gray-800 text-white rounded">Close</button>
    </div>
    <div class="content">
      <slot />
    </div>
  </div>
</div>
