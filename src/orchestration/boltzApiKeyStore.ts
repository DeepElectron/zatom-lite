import { create } from 'zustand'
import { readBoltzApiKey, writeBoltzApiKey } from '../services/boltz-client'

/**
 * Shared reactive key state for Settings and the Boltz panel. Session storage
 * keeps both surfaces synchronized across remounts without retaining a secret
 * after the browser tab closes.
 */
interface BoltzApiKeyState {
  apiKey: string
  setApiKey: (next: string) => void
}

export const useBoltzApiKeyStore = create<BoltzApiKeyState>((set) => ({
  apiKey: readBoltzApiKey(),
  setApiKey: (next) => {
    set({ apiKey: next })
    writeBoltzApiKey(next)
  },
}))
