import { useEffect, useState } from 'react'

import zatomMarkUrl from '../assets/zatom-mark-180.png'

export type StartupStage = 'workspace' | 'task' | 'interface'

const STARTUP_COPY: Record<StartupStage, string> = {
  workspace: 'Opening local workspace and modeling history…',
  task: 'Restoring the active Agent task…',
  interface: 'Preparing the modeling interface…',
}

/**
 * A truthful startup surface, not a timed splash screen. The activity signal only
 * appears when startup lasts long enough to need feedback and never delays ready.
 */
export function StartupScreen({ stage }: { stage: StartupStage }) {
  const [showActivity, setShowActivity] = useState(false)
  const [takingLong, setTakingLong] = useState(false)

  useEffect(() => {
    const activityTimeout = window.setTimeout(() => setShowActivity(true), 180)
    const recoveryTimeout = window.setTimeout(() => setTakingLong(true), 8_000)
    return () => {
      window.clearTimeout(activityTimeout)
      window.clearTimeout(recoveryTimeout)
    }
  }, [])

  return (
    <main className="zatom-startup" aria-labelledby="zatom-startup-title">
      <div className="zatom-startup__content">
        <img
          className="zatom-startup__mark"
          src={zatomMarkUrl}
          alt=""
          draggable={false}
        />
        <div className="zatom-startup__identity">
          <h1 id="zatom-startup-title">Zatom</h1>
          <p>Atomistic modeling</p>
        </div>

        <div
          className="zatom-startup__signal"
          data-visible={showActivity}
          aria-hidden="true"
        >
          <span />
          <span />
          <span />
        </div>

        <p className="zatom-startup__status" role="status" aria-live="polite">
          {STARTUP_COPY[stage]}
        </p>

        {takingLong ? (
          <div className="zatom-startup__recovery">
            <p>This is taking longer than expected. You can keep waiting or reload Zatom.</p>
            <button type="button" onClick={() => window.location.reload()}>
              Reload Zatom
            </button>
          </div>
        ) : null}
      </div>

      <p className="zatom-startup__copyright">Copyright © 2026 zauq tech</p>
    </main>
  )
}
