import { createCrystalStore } from '../orchestration/crystalStore'
import { assertEqual } from '../testing/assert'

const store = createCrystalStore()

store.getState().createBondBetweenAtoms('atom-1', 'atom-2')
assertEqual(store.getState().bonds.length, 1, 'A new atom pair must create one bond')
assertEqual(store.getState().history.length, 1, 'A new bond must create one undo step')

store.getState().setPendingBondAtom('atom-1')
store.getState().createBondBetweenAtoms('atom-2', 'atom-1')
assertEqual(store.getState().bonds.length, 1, 'The reverse atom pair must not duplicate a bond')
assertEqual(store.getState().history.length, 1, 'A duplicate bond attempt must not create undo history')
assertEqual(store.getState().pendingBondAtomId, null, 'A duplicate bond attempt must finish the pending interaction')

store.getState().undo()
assertEqual(store.getState().bonds.length, 0, 'One Undo must remove the one created bond')

console.log('bond history tests passed')

const settingsStore = createCrystalStore()
settingsStore.setState({
  atoms: [
    { id: 'cu-1', element: 'Cu', position: [0, 0, 0], cartesian: [0, 0, 0] },
    { id: 'cu-2', element: 'Cu', position: [2.8, 0, 0], cartesian: [2.8, 0, 0] },
  ],
  bonds: [{ id: 'bond-cu-1-cu-2', atom1Id: 'cu-1', atom2Id: 'cu-2', type: 'single' }],
  // This tests cutoff and undo/redo bookkeeping, not periodic bonding. Mark the injected atoms
  // nonperiodic so the store's four-angstrom placeholder cell cannot create an unphysical image bond.
  periodic: false,
})

settingsStore.getState().setBondDefaultRadius(2.5)
assertEqual(settingsStore.getState().bonds.length, 0, 'A smaller default cutoff must rebuild the bond topology')
assertEqual(settingsStore.getState().history.length, 1, 'One cutoff commit must create one undo step')

settingsStore.getState().undo()
assertEqual(settingsStore.getState().bondSettings.defaultRadius, 3, 'Undo must restore the previous cutoff')
assertEqual(settingsStore.getState().bonds.length, 1, 'Undo must restore the previous detected bonds')

settingsStore.getState().redo()
assertEqual(settingsStore.getState().bondSettings.defaultRadius, 2.5, 'Redo must restore the committed cutoff')
assertEqual(settingsStore.getState().bonds.length, 0, 'Redo must restore the rebuilt topology')

settingsStore.getState().setElementPairRadius('Cu', 'Cu', 3.1)
assertEqual(settingsStore.getState().bonds.length, 1, 'An element-pair override must replace the default cutoff for that pair')
assertEqual(settingsStore.getState().history.length, 2, 'One pair override must create one additional undo step')

settingsStore.getState().setRestrictToConfiguredPairs(true)
assertEqual(settingsStore.getState().bondSettings.restrictToConfiguredPairs, true, 'strict pair mode must be explicit store state')
settingsStore.getState().removeElementPairRadius('Cu', 'Cu')
assertEqual(settingsStore.getState().bondSettings.restrictToConfiguredPairs, false, 'removing the final pair must restore default-distance detection')

settingsStore.getState().undo()
assertEqual(settingsStore.getState().bondSettings.elementPairRadii['Cu-Cu'], 3.1, 'Undo must restore the removed pair override')
assertEqual(settingsStore.getState().bondSettings.restrictToConfiguredPairs, true, 'Undo must restore strict pair mode with the pair')

console.log('bond setting transaction tests passed')
