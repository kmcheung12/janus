import { vi } from 'vitest'

const storageMock: Record<string, unknown> = {}

global.chrome = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: storageMock[key] })),
      set: vi.fn(async (obj: Record<string, unknown>) => {
        Object.assign(storageMock, obj)
      }),
    },
  },
} as unknown as typeof chrome
