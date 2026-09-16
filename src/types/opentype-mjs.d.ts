// opentype.js ships a CJS `main` (dist/opentype.js — a UMD whose
// module.exports exposes members ONLY via a default export) and an ESM
// `module` (dist/opentype.mjs — named exports only, NO default). Node resolves
// the bare specifier to the CJS main (so only a default import binds the
// members) while bundlers resolve it to the ESM (so only a namespace/named
// import binds them) — opposite, irreconcilable forms. Importing the ESM
// bundle path directly is the one specifier Node and bundlers both treat as
// real ESM with named exports, which is why mural imports
// `opentype.js/dist/opentype.mjs` everywhere instead of the bare name.
//
// The published @types/opentype.js declares only the bare `opentype.js`
// module, so re-map the deep ESM path onto it to keep the namespace import
// fully typed.
declare module 'opentype.js/dist/opentype.mjs' {
    export * from 'opentype.js';
}
