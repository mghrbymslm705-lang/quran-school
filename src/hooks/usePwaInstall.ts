import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export interface PwaInstall {
  canInstall: boolean
  install: () => Promise<boolean>
}

// Tracks the browser's `beforeinstallprompt` event so the UI can show an
// explicit "Install app" button. When the event is unavailable (or the app is
// already installed) `canInstall` is false and the caller should show manual
// instructions instead of erroring.
export function usePwaInstall(): PwaInstall {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const onBefore = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setDeferred(null)

    window.addEventListener('beforeinstallprompt', onBefore as EventListener)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBefore as EventListener)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = async (): Promise<boolean> => {
    if (!deferred) return false
    try {
      await deferred.prompt()
      const choice = await deferred.userChoice
      setDeferred(null)
      return choice.outcome === 'accepted'
    } catch {
      return false
    }
  }

  return { canInstall: !!deferred, install }
}
