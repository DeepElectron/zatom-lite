/** Advance the Verlet simulation from the R3F frame loop and reset on stop. */
import { useFrame } from '@react-three/fiber'
import { useViewportStore as useCrystalStore } from '../../../orchestration/ViewportContext'
import { stepVerlet, resetPhysicsState } from '../../../lib/physics/verlet'
import { useEffect, useRef } from 'react'

export function PhysicsStepper() {
  const isRunning = useCrystalStore((s) => s.isSimulationRunning)
  const speed = useCrystalStore((s) => s.simulationSpeed)
  const stiffness = useCrystalStore((s) => s.bondStiffness)
  const wasRunning = useRef(false)

  useEffect(() => {
    if (wasRunning.current && !isRunning) {
      resetPhysicsState()
    }
    wasRunning.current = isRunning
  }, [isRunning])

  useFrame((_, delta) => {
    if (!isRunning) return

    const store = useCrystalStore.getState()
    const atoms = store.atoms
    const bonds = store.bonds ?? []
    if (!atoms || atoms.length === 0) return

    const dt = Math.min(delta, 0.05) * speed
    const updated = stepVerlet(atoms, bonds, dt, stiffness)
    store.setAtomsDirectly(updated)
  })

  return null
}
