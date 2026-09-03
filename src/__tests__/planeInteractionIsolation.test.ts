import { createCrystalStore } from '../orchestration/crystalStore'
import { assertEqual, assertTrue } from '../testing/assert'

const store = createCrystalStore()

store.setState({ periodic: false })
store.getState().constructPlaneFromMiller(1, 0, 0)
assertEqual(store.getState().constructedPlane, null, 'Miller planes must be unavailable for non-periodic structures')

store.setState({ periodic: true })
store.getState().constructPlaneFromMiller(1, 0, 0)
const millerPlane = store.getState().constructedPlane
assertTrue(millerPlane !== null, 'a valid periodic Miller plane must be constructed')
assertEqual(millerPlane?.method, 'miller', 'Miller construction must retain its real provenance')
assertEqual(millerPlane?.points.length, 0, 'Miller planes must not create fake source-atom markers')
assertTrue(Math.abs((millerPlane?.normal[0] ?? 0) - 1) < 1e-9, '(100) normal must align with reciprocal a')
assertTrue(Math.abs((store.getState().clippingNormal?.[0] ?? 0) - 1) < 1e-9, 'a new plane must become the default clip direction')

store.setState({
  clippingEnabled: true,
  clippingNormal: millerPlane?.normal ?? null,
  show2DPlaneView: true,
})
store.getState().clearConstructedPlane()
assertEqual(store.getState().constructedPlane, null, 'Clear must remove the reference plane')
assertEqual(store.getState().show2DPlaneView, false, 'Clear must close the plane 2D view')
assertEqual(store.getState().clippingEnabled, false, 'Clear must stop plane clipping')
assertEqual(store.getState().clippingNormal, null, 'Clear must remove the old clipping normal')

store.setState({
  atoms: [
    { id: 'a', element: 'C', position: [0, 0, 0], cartesian: [0, 0, 0] },
    { id: 'b', element: 'C', position: [1, 0, 0], cartesian: [1, 0, 0] },
    { id: 'c', element: 'C', position: [2, 0, 0], cartesian: [2, 0, 0] },
  ],
})
store.getState().constructPlaneFromAtoms(['a', 'b', 'c'])
assertEqual(store.getState().constructedPlane, null, 'three collinear atoms must not create a degenerate plane')

console.log('plane interaction isolation tests passed')
