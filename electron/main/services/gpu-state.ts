// Estado de GPU decidido no boot, ANTES do app.whenReady (disableHardwareAcceleration
// e switches de ozone só valem pré-ready). O IPC gpu:status lê daqui o que está EM
// VIGOR neste processo — as prefs podem já ter mudado e só aplicam no próximo relaunch.

export interface GpuState {
  hwAccelDisabled: boolean
  ozoneWayland: boolean
}

let state: GpuState = { hwAccelDisabled: false, ozoneWayland: false }

export function setGpuState(next: GpuState): void {
  state = next
}

export function getGpuState(): GpuState {
  return state
}
