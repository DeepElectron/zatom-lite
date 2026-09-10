// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { createCrystalStore } from '../orchestration/crystalStore'
import { ViewportStoreProvider, useViewportStore } from '../orchestration/ViewportContext'
import { useThemeStore } from '../host/themeStore'

it('updates every rendered pane with System changes while preserving saved Shader colors and atoms', async () => {
  const stores = [createCrystalStore(), createCrystalStore()]
  stores[0].setState({ background: '#ffffff', cellColor: '#000000' })
  stores[1].setState({ background: '#22352c', cellColor: '#ff0000' })
  const originals = stores.map(store => store.getState())
  function Probe() {
    const state = useViewportStore()
    return <output>{state.background}/{state.cellColor}</output>
  }
  const container = document.createElement('div')
  const root = createRoot(container)
  const initial = useThemeStore.getState()
  try {
    await act(async () => {
      initial.setAppearance('system')
      initial.setSystemTheme('dark')
      root.render(<>{stores.map((store, index) => <ViewportStoreProvider key={index} value={store}><Probe /></ViewportStoreProvider>)}</>)
    })
    const colors = () => [...container.querySelectorAll('output')].map(node => node.textContent)
    expect(colors()).toEqual(['#101014/#e6e6ea', '#101014/#ff0000'])
    await act(async () => initial.setSystemTheme('light'))
    expect(colors()).toEqual(['#ffffff/#000000', '#ffffff/#ff0000'])
    await act(async () => initial.setAppearance('dark'))
    expect(colors()).toEqual(['#101014/#e6e6ea', '#101014/#ff0000'])
    await act(async () => initial.setSystemTheme('light'))
    expect(colors()[0]).toBe('#101014/#e6e6ea')
    await act(async () => initial.setAppearance('viewport'))
    expect(colors()).toEqual(['#ffffff/#000000', '#22352c/#ff0000'])
    stores.forEach((store, index) => expect(store.getState()).toBe(originals[index]))
  } finally {
    await act(async () => root.unmount())
    initial.setSystemTheme(initial.systemTheme)
    initial.setAppearance(initial.appearance)
  }
})
