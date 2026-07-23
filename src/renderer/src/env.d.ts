/// <reference types="vite/client" />

import type { MinutingApi } from '../../preload'

declare global {
  interface Window {
    minuting: MinutingApi
  }
}

export {}
