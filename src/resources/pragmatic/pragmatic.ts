// Pragmatic theme bundle — re-export shim. Theme + scheme classes are
// emitted by the .mu compiler from pragmatic.mu / light.mu / dark.mu.
// Importing the compiled pragmatic.mu.js enrols the theme via
// ThemeManager.RegisterTheme and registers it as the app default.
// Pragmatic is the only theme (the Material package was removed in
// Phase 4 SP3), and its control chrome now lives in the framework base
// (MuralBasic + MuralFramework), so there is no separate controls
// override dictionary to re-export.
export { Pragmatic }           from '../../../build/resources/pragmatic/pragmatic.mu.js';
export { PragmaticLight }      from '../../../build/resources/pragmatic/light.mu.js';
export { PragmaticDark }       from '../../../build/resources/pragmatic/dark.mu.js';
export { PragmaticTypography } from '../../../build/resources/pragmatic/typography.mu.js';
