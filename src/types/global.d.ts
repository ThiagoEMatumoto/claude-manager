import type { Api } from '../../shared/types/ipc'

declare global {
  interface Window {
    api: Api
  }
}

export {}
