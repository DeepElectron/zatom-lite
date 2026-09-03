import { describe, expect, it } from 'vitest'

import ATOM_LABELS_SOURCE from '../ui/components/crystal-viewer/atom-labels.tsx?raw'
import CRYSTAL_SCENE_SOURCE from '../ui/components/crystal-viewer/crystal-scene.tsx?raw'
import BIO_LAYER_SOURCE from '../ui/components/crystal-viewer/biomolecule-layer.tsx?raw'
import LABEL_SPRITE_SOURCE from '../ui/components/crystal-viewer/viewer-label-sprite.tsx?raw'
import VISUAL_SETTINGS_SOURCE from '../ui/panels/visual-settings.tsx?raw'
import { createCrystalStore } from '../orchestration/crystalStore'
import {
  DARK_ATOM_LABEL_COLOR,
  LIGHT_ATOM_LABEL_COLOR,
  atomLabelText,
  atomLabelVerticalOffset,
  resolveAtomLabelColor,
} from '../ui/components/crystal-viewer/atom-labels'


describe('ordinary atom labels', () => {
  it('uses selected numbered labels by default and clamps its visual controls', () => {
    const store = createCrystalStore()
    expect(store.getState()).toMatchObject({
      showAtomLabels: true,
      atomLabelSize: .8,
      atomLabelColor: null,
      atomLabelScope: 'selected',
      atomLabelContent: 'element-number',
      atomLabelOutline: true,
      atomLabelPosition: 'center',
      atomLabelGap: 0,
    })

    store.getState().setShowAtomLabels(true)
    store.getState().setAtomLabelSize(10)
    store.getState().setAtomLabelColor('#abcdef')
    store.getState().setAtomLabelScope('selected')
    store.getState().setAtomLabelContent('element-number')
    store.getState().setAtomLabelOutline(false)
    store.getState().setAtomLabelPosition('below')
    store.getState().setAtomLabelGap(8)
    expect(store.getState()).toMatchObject({
      showAtomLabels: true,
      atomLabelSize: 3,
      atomLabelColor: '#abcdef',
      atomLabelScope: 'selected',
      atomLabelContent: 'element-number',
      atomLabelOutline: false,
      atomLabelPosition: 'below',
      atomLabelGap: 2,
    })
  })

  it('exposes the switch and styling in the ordinary Display controls', () => {
    expect(VISUAL_SETTINGS_SOURCE).toContain('>Atom labels</span>')
    expect(VISUAL_SETTINGS_SOURCE).toContain('checked={showAtomLabels}')
    expect(VISUAL_SETTINGS_SOURCE).toContain('setShowAtomLabels(value)')
    expect(VISUAL_SETTINGS_SOURCE).toContain('label="Label size"')
    expect(VISUAL_SETTINGS_SOURCE).toContain('aria-label="Atom label color"')
    expect(VISUAL_SETTINGS_SOURCE).toContain('ariaLabel="Atom label scope"')
    expect(VISUAL_SETTINGS_SOURCE).toContain('ariaLabel="Atom label content"')
    expect(VISUAL_SETTINGS_SOURCE).toContain('ariaLabel="Atom label position"')
    expect(VISUAL_SETTINGS_SOURCE).toContain('label="Label gap"')
    expect(VISUAL_SETTINGS_SOURCE).toContain('checked={atomLabelOutline}')
    expect(VISUAL_SETTINGS_SOURCE).toContain('Large structures override All and show labels for selected atoms only.')
  })

  it('follows the viewport background until the user picks a colour', () => {
    // Dark scenes require light text for readable labels.
    expect(resolveAtomLabelColor(true, null)).toBe(DARK_ATOM_LABEL_COLOR)
    expect(resolveAtomLabelColor(false, null)).toBe(LIGHT_ATOM_LABEL_COLOR)
    // Explicit user color overrides both light and dark defaults.
    expect(resolveAtomLabelColor(true, '#ff0000')).toBe('#ff0000')
    expect(resolveAtomLabelColor(false, '#ff0000')).toBe('#ff0000')
    // Light and dark defaults remain distinct for background contrast.
    expect(DARK_ATOM_LABEL_COLOR).not.toBe(LIGHT_ATOM_LABEL_COLOR)

    const store = createCrystalStore()
    store.getState().setAtomLabelColor('#abcdef')
    expect(store.getState().atomLabelColor).toBe('#abcdef')
    store.getState().setAtomLabelColor(null)
    expect(store.getState().atomLabelColor).toBeNull()
  })

  it('formats stable one-based ordinals and relative positions', () => {
    expect(atomLabelText('O', 3, 'element')).toBe('O')
    expect(atomLabelText('O', 3, 'number')).toBe('3')
    expect(atomLabelText('O', 3, 'element-number')).toBe('O3')
    expect(atomLabelVerticalOffset(.7, 'above', .2)).toBeCloseTo(.9)
    expect(atomLabelVerticalOffset(.7, 'center', 2)).toBe(0)
    expect(atomLabelVerticalOffset(.7, 'below', .2)).toBeCloseTo(-.9)
  })

  it('uses one independent overlay in every ordinary scene branch', () => {
    // Seven scene branches each need exactly one overlay; fewer lose labels and more duplicate them.
    expect(CRYSTAL_SCENE_SOURCE.match(/<AtomLabels hiddenAtomIds=/g)).toHaveLength(7)
    // Labels share useDisplayPositions with atoms and bonds so unwrap and wrap cannot separate them.
    expect(ATOM_LABELS_SOURCE).toContain('useDisplayPositions')
    expect(ATOM_LABELS_SOURCE).toContain('applySelectionTransformPreviewToPosition')
    expect(ATOM_LABELS_SOURCE).toContain('atoms.length > ATOM_LABEL_FULL_SCENE_LIMIT')
    expect(ATOM_LABELS_SOURCE).toContain('selectedOnly && !selected')
    expect(ATOM_LABELS_SOURCE).toContain('atomIndex + 1')
    expect(ATOM_LABELS_SOURCE).toContain('positionsByText')
  })

  it('shares the biomolecule sprite style without intercepting atom picks', () => {
    expect(BIO_LAYER_SOURCE).toContain('<ViewerLabelSprite')
    expect(BIO_LAYER_SOURCE).not.toContain('function BioLabelSprite')
    expect(LABEL_SPRITE_SOURCE).toContain('depthTest: false')
    expect(LABEL_SPRITE_SOURCE).toContain('depthWrite: false')
    expect(LABEL_SPRITE_SOURCE).toContain('raycast={() => undefined}')
    expect(LABEL_SPRITE_SOURCE).toContain('if (outline) context.strokeText')
    expect(LABEL_SPRITE_SOURCE).toContain('outline = true')
    expect(LABEL_SPRITE_SOURCE).toContain('export function ViewerLabelSpriteGroup')
  })
})
