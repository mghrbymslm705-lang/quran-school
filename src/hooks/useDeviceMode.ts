import { useState, useEffect, useCallback } from 'react'

const DEVICE_KEY = 'school_device_mode'
type DeviceMode = 'auto' | 'mobile' | 'desktop'

function applyDeviceMode(mode: DeviceMode) {
  const html = document.documentElement
  if (mode === 'auto') {
    html.removeAttribute('data-device-mode')
  } else {
    html.dataset.deviceMode = mode
  }
}

function readStored(): DeviceMode {
  const v = localStorage.getItem(DEVICE_KEY)
  if (v === 'mobile' || v === 'desktop') return v
  return 'auto'
}

export function useDeviceMode() {
  const [mode, setMode] = useState<DeviceMode>(readStored)

  useEffect(() => {
    applyDeviceMode(mode)
    localStorage.setItem(DEVICE_KEY, mode)
  }, [mode])

  const set = useCallback((m: DeviceMode) => setMode(m), [])

  return { mode, set } as const
}
