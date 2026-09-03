/** Minimal in-memory tool context used only by browser-tool evaluations. */

import type { ZatomStructure, ZatomToolContext, ZatomTrajectory } from '../agent/contracts'
import { parseZatomStructure, validateStructure, ZatomStructureInputError } from '../agent/structure-validation'
import { parseZatomTrajectory } from '../agent/trajectory'

function cloneStructure(value: ZatomStructure): ZatomStructure {
  return parseZatomStructure(structuredClone(value))
}

function cloneTrajectory(value: ZatomTrajectory, structure: ZatomStructure): ZatomTrajectory {
  return parseZatomTrajectory(structuredClone(value), { structure })
}

export function createInMemoryToolContext(): ZatomToolContext {
  let structure: ZatomStructure | null = null
  let trajectory: ZatomTrajectory | null = null

  return {
    readStructure: () => structure ? cloneStructure(structure) : null,
    readTrajectory: () => structure && trajectory ? cloneTrajectory(trajectory, structure) : null,
    writeStructure: (value) => {
      const next = cloneStructure(value)
      const validation = validateStructure(next)
      if (validation.checks.some((check) => check.status === 'fail')) {
        throw new ZatomStructureInputError(
          'invalid_evaluation_structure',
          'The evaluation context accepts only structures that pass numeric validation',
        )
      }
      structure = next
      trajectory = null
    },
    writeTrajectory: (value) => {
      if (!structure) {
        throw new ZatomStructureInputError(
          'no_evaluation_structure',
          'Cannot write a trajectory before setting an evaluation structure',
        )
      }
      trajectory = cloneTrajectory(value, structure)
    },
    writeWorkspace: (structureValue, trajectoryValue) => {
      const nextStructure = cloneStructure(structureValue)
      const validation = validateStructure(nextStructure)
      if (validation.checks.some((check) => check.status === 'fail')) {
        throw new ZatomStructureInputError(
          'invalid_evaluation_structure',
          'The evaluation context accepts only structures that pass numeric validation',
        )
      }
      const nextTrajectory = cloneTrajectory(trajectoryValue, nextStructure)
      structure = nextStructure
      trajectory = nextTrajectory
    },
  }
}
