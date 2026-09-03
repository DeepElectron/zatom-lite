import { assertTrue } from '../testing/assert'
import { resolveViewportLighting } from '../lib/lighting'

function testHyperStickLightingFollowsThemeDefaults() {
  const darkLighting = resolveViewportLighting(true, null, null, null)
  const lightLighting = resolveViewportLighting(false, null, null, null)

  assertTrue(darkLighting.ambient === 0.6, 'HyperStick restores the dark ambient default')
  assertTrue(lightLighting.ambient === 0.95, 'HyperStick restores the light ambient default')
  assertTrue(darkLighting.key < lightLighting.key, 'HyperStick key light follows dark/light defaults')
  assertTrue(darkLighting.fill === 0.4, 'HyperStick restores the dark fill default')
  assertTrue(lightLighting.fill === 0.6, 'HyperStick restores the light fill default')
}

function testHyperStickLightingUsesUserOverrides() {
  const lighting = resolveViewportLighting(false, 0.2, 0.3, 0.4)

  assertTrue(lighting.ambient === 0.2, 'HyperStick ambient uses user override')
  assertTrue(lighting.key === 0.3, 'HyperStick key uses user override')
  assertTrue(lighting.fill === 0.4, 'HyperStick fill uses user override')
}

function run() {
  testHyperStickLightingFollowsThemeDefaults()
  testHyperStickLightingUsesUserOverrides()
  console.log('hyper-stick lighting tests passed')
}

run()
