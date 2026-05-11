<script lang="ts">
  async function activate() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (tab.id) {
      await browser.tabs.sendMessage(tab.id, { type: 'JANUS_ACTIVATE' })
      window.close()
    }
  }

  function openTemplates() {
    browser.tabs.create({ url: browser.runtime.getURL('/templates.html') })
  }
</script>

<div class="popup">
  <div class="header">
    <span class="logo">Janus</span>
    <span class="tagline">Annotate. Prompt. Iterate.</span>
  </div>
  <button class="primary" onclick={activate}>
    Annotate this page
    <kbd>Alt+Shift+J</kbd>
  </button>
  <button class="secondary" onclick={openTemplates}>
    Manage templates
  </button>
</div>

<style>
  .popup { width: 220px; padding: 16px; background: #1e1e2e; color: #cdd6f4; font-family: system-ui, sans-serif; display: flex; flex-direction: column; gap: 10px; }
  .header { display: flex; flex-direction: column; gap: 2px; }
  .logo { font-weight: 700; font-size: 16px; color: #cba6f7; }
  .tagline { font-size: 11px; color: #6c7086; }
  .primary { background: #cba6f7; color: #1e1e2e; border: none; border-radius: 6px; padding: 10px; font-weight: 700; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
  .primary:hover { background: #d6b9fa; }
  .secondary { background: #313244; color: #cdd6f4; border: none; border-radius: 6px; padding: 8px; cursor: pointer; font-size: 12px; }
  .secondary:hover { background: #45475a; }
  kbd { font-size: 10px; background: rgba(0,0,0,0.2); border-radius: 3px; padding: 2px 4px; font-family: monospace; }
</style>
