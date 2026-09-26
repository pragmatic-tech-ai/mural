// Pragmatic theme bundle — re-export shim. Theme + scheme classes are
// emitted by the .mu compiler from pragmatic.mu / light.mu / dark.mu.
// Importing the compiled pragmatic.mu.js enrols the theme via
// ThemeManager.RegisterTheme; this phase keeps Material as the app
// default (first import wins), so importing this module does not change
// any app's default theme.
export { Pragmatic }      from '../../../build/resources/pragmatic/pragmatic.mu.js';
export { PragmaticLight } from '../../../build/resources/pragmatic/light.mu.js';
export { PragmaticDark }  from '../../../build/resources/pragmatic/dark.mu.js';
