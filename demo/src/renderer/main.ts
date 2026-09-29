import { app } from '../../platform/platform.mu.js'
import { HtmlTarget } from '@pragmatic-tech-ai/mural/visual-engine'
import { ThemeManager, Density } from '@pragmatic-tech-ai/mural/runtime'
import { Pragmatic, PragmaticLight, PragmaticDark } from '@pragmatic-tech-ai/mural/resources/pragmatic'

// Expose the initialized Application for the Playwright smoke to assert module
// composition end-to-end in the real renderer.
;(globalThis as unknown as { __demoApp: unknown }).__demoApp = app

const status = document.getElementById('status') as HTMLPreElement

app.initialize({ theme: Pragmatic, autoScheme: { light: PragmaticLight, dark: PragmaticDark } })
ThemeManager.Density = Density.Compact

async function mount(): Promise<void>
{
  try
  {
    await document.fonts.load('24px "Material Symbols Outlined"')
    app.initialize(new HtmlTarget(document.getElementById('app') as HTMLElement))
  }
  catch (e)
  {
    status.textContent = 'Error: ' + ((e as Error)?.message ?? String(e))
    console.error(e)
  }
}
void mount()
