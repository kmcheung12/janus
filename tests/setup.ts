import { vi } from 'vitest'

const storageMock: Record<string, unknown> = {}

const storageFns = {
  get: vi.fn(async (key: string) => ({ [key]: storageMock[key] })),
  set: vi.fn(async (obj: Record<string, unknown>) => {
    Object.assign(storageMock, obj)
  }),
}

global.chrome = {
  storage: { local: storageFns },
} as unknown as typeof chrome

;(global as Record<string, unknown>).browser = {
  storage: { local: storageFns },
}
