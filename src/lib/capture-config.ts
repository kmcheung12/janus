export interface CaptureConfig {
  click: boolean
  keyboard: boolean
  navigation: boolean
  api: boolean
  scroll: boolean
  drag: boolean
  console_error: boolean
  console_warn: boolean
}

export const CAPTURE_CONFIG_LABELS: Record<keyof CaptureConfig, string> = {
  click: 'Click',
  keyboard: 'Keyboard input',
  navigation: 'Navigation',
  api: 'API / Network',
  scroll: 'Scroll',
  drag: 'Drag',
  console_error: 'Console errors',
  console_warn: 'Console warnings',
}

const STORAGE_KEY = 'janus_capture_config'

const DEFAULTS: CaptureConfig = {
  click: true,
  keyboard: true,
  navigation: true,
  api: true,
  scroll: true,
  drag: true,
  console_error: true,
  console_warn: true,
}

export async function loadCaptureConfig(): Promise<CaptureConfig> {
  const result = await browser.storage.local.get(STORAGE_KEY)
  return { ...DEFAULTS, ...result[STORAGE_KEY] }
}

export async function saveCaptureConfig(config: CaptureConfig): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: config })
}
