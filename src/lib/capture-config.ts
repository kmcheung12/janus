export interface CaptureConfig {
  click: boolean
  keyboard: boolean
  keyboard_keystrokes: boolean
  navigation: boolean
  api: boolean
  scroll: boolean
  drag: boolean
  console_error: boolean
  console_warn: boolean
  console_log: boolean
  resize: boolean
}

export const CAPTURE_CONFIG_LABELS: Record<keyof CaptureConfig, string> = {
  click: 'Click',
  keyboard: 'Keyboard input',
  keyboard_keystrokes: 'Capture actual keystrokes',
  navigation: 'Navigation',
  api: 'API / Network',
  scroll: 'Scroll',
  drag: 'Drag',
  console_error: 'Console errors',
  console_warn: 'Console warnings',
  console_log: 'Console logs',
  resize: 'Resize & orientation',
}

const STORAGE_KEY = 'janus_capture_config'

export const DEFAULTS: CaptureConfig = {
  click: true,
  keyboard: true,
  keyboard_keystrokes: false,
  navigation: true,
  api: true,
  scroll: true,
  drag: true,
  console_error: true,
  console_warn: true,
  console_log: false,
  resize: true,
}

export async function loadCaptureConfig(): Promise<CaptureConfig> {
  const result = await browser.storage.local.get(STORAGE_KEY)
  return { ...DEFAULTS, ...result[STORAGE_KEY] }
}

export async function saveCaptureConfig(config: CaptureConfig): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: config })
}
