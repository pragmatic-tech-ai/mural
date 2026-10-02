// Shared node-key identity strings tying the demo's `Hierarchy { }` DSL
// (hierarchy-tree.module.mu), its Contributors (hierarchy-tree-contributors.mts),
// and its VM's SeedRoot call (hierarchy-tree-vm.mts) together — one TS-side
// home for each key so the three can't drift apart from each other.
//
// hierarchy-tree.module.mu's own `Under = "..."` / `Context = "..."`
// attributes stay literal strings regardless — the DSL grammar takes no
// other value shape for them (confirmed against src/compiler/tests/
// hierarchy-block.test.ts, which hardcodes its own node keys the same way)
// — so this class only de-dupes the TS-side usages; the cross-language
// duplication against the .mu source is structural, not an oversight.
export class HierarchyTreeDemoKeys {
    static NotebookRoot = 'notebook';
    static Section = 'section';
    static Note = 'note';
}
