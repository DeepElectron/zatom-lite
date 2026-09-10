(function () {
  var firstPaintStyle = document.createElement('style')
  firstPaintStyle.textContent = 'html { background-color: #ffffff; } html.dark { background-color: #06080a; }'
  document.head.appendChild(firstPaintStyle)

  var appearance = 'system'
  try {
    var stored = localStorage.getItem('zatom-appearance-v3')
    if (stored === 'system' || stored === 'viewport' || stored === 'light' || stored === 'dark') {
      appearance = stored
    }
  } catch (_error) {
    // Storage denial keeps the system default.
  }
  var systemIsDark = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
  // Auto starts with the default light VESTA background. React refines it from
  // the active Shader as soon as the modeler mounts.
  var theme = appearance === 'system'
    ? (systemIsDark ? 'dark' : 'light')
    : appearance === 'viewport'
      ? 'light'
      : appearance
  document.documentElement.dataset.appearance = appearance
  if (theme === 'dark') document.documentElement.classList.add('dark')
  document.documentElement.style.colorScheme = theme
})()
