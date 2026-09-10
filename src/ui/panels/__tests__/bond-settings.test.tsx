// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createCrystalStore } from '../../../orchestration/crystalStore'
import type { CrystalStore } from '../../../orchestration/crystal-store-types'

const harness = vi.hoisted(() => ({ store: null as ReturnType<typeof createCrystalStore> | null }))
vi.mock('../../../orchestration/ViewportContext', () => ({
  useActiveCrystalStore: (selector: (state: CrystalStore) => unknown) => selector(harness.store!.getState()),
}))
import { BondSettings } from '../bond-settings'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  harness.store = createCrystalStore()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })

async function show(elements: string[]) {
  harness.store!.setState({ atoms: elements.map((element, i) => ({
    id: String(i), element, position: [0, 0, 0], cartesian: [0, 0, 0],
  })) })
  await act(async () => root.render(<BondSettings />))
}
const select = (label: string) => container.querySelector<HTMLSelectElement>(`[aria-label="${label} element"]`)!
const distance = () => container.querySelector<HTMLInputElement>('[aria-label="Maximum distance in angstrom"]')!
const add = () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Add')!

it('defaults Mg to Mg–Mg using the current criterion and adds that override', async () => {
  await show(['Mg', 'Mg'])
  expect(select('First').value).toBe('Mg')
  expect(select('Second').value).toBe('Mg')
  expect([...select('First').options].map(option => option.value)).toEqual(['Mg'])
  expect(Number(distance().value)).toBe(3)
  await act(async () => add().click())
  expect(harness.store!.getState().bondSettings.elementPairRadii).toEqual({ 'Mg-Mg': 3 })
})

it('replaces an edited Cu–O draft on composition change and disables empty structures', async () => {
  harness.store!.setState({ bondSettings: {
    ...harness.store!.getState().bondSettings, elementPairRadii: { 'Cu-O': 2.2, 'O-O': 1.8 },
  } })
  await show(['Cu', 'O'])
  expect(distance().value).toBe('2.2')
  await act(async () => {
    select('First').value = 'O'
    select('First').dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(distance().value).toBe('1.8')
  await show(['Mg', 'Mg'])
  expect(select('First').value).toBe('Mg')
  expect(select('Second').value).toBe('Mg')
  expect(distance().value).toBe('3')
  await show([])
  expect(select('First').value).toBe('')
  expect(distance().value).toBe('')
  expect(add().disabled).toBe(true)
})

it('commits step buttons immediately while deferring range changes until release', async () => {
  await show(['Mg', 'Mg'])
  const increase = container.querySelector<HTMLButtonElement>('[aria-label="Increase Hard distance limit"]')!
  await act(async () => increase.click())
  expect(harness.store!.getState().bondSettings.defaultRadius).toBe(3.1)
  await show(['Mg', 'Mg'])
  expect(container.textContent).toContain('max 3.1 Å')
  const range = container.querySelector<HTMLInputElement>('[aria-label="Hard distance limit"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(range, '3.5')
    range.dispatchEvent(new Event('input', { bubbles: true }))
  })
  expect(harness.store!.getState().bondSettings.defaultRadius).toBe(3.1)
  await act(async () => range.dispatchEvent(new Event('pointerup', { bubbles: true })))
  expect(harness.store!.getState().bondSettings.defaultRadius).toBe(3.5)
})
