import { regionsFromGrainId } from '../lib/render/grain-regions'
import { assertEqual } from '../testing/assert'

function run() {
  const grainIds = new Uint32Array([2, 0, 2, 5, 0])
  const assignment = regionsFromGrainId(grainIds)
  assertEqual(assignment.regionIds.join(','), '0,2,5', 'grain ids remain unique and sorted')
  assertEqual(assignment.regionOf, grainIds, 'the renderer reuses the compact grain-id array')
}

run()
console.log('grain region tests passed')
