// Content-VM style edits must dirty the document. A content VM (an arch node)
// carries no Fill/Stroke/geometry of its own — its card style lives on the
// container Figure and its label style on the VM's own DPs — so the standard
// _wireNodeDirty (Left/Top/Width/Height/Fill/Stroke) finds nothing to watch.
// Without this, styling such a node leaves IsDirty false → the Save command
// stays disabled and the style is never persisted.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { Application, MetaData, MuralBase, type PropertyKey } from '../../../runtime/index.js';
import { NodeViewModel } from '../node-view-model.js';
import { DiagramDocument, type DiagramStorage } from '../diagram-document.js';

class MemoryStorage implements DiagramStorage
{
    private readonly _map = new Map<string, string>();
    public GetItem(key: string): string | null { return this._map.get(key) ?? null; }
    public SetItem(key: string, value: string): void { this._map.set(key, value); }
}

// A content VM whose persisted style lives in its own DP, declared for the
// document's dirty-tracking via DirtyStyleKeys.
class StyleVM extends NodeViewModel
{
    public static readonly TintKey = MuralBase.RegisterProperty<string | undefined>(StyleVM, 'Tint', undefined, MetaData.None);
    public get Tint(): string | undefined { return this.get_property_value(StyleVM.TintKey); }
    public set Tint(v: string | undefined) { this.set_property_value(StyleVM.TintKey, v); }
    public DirtyStyleKeys(): PropertyKey<unknown>[] { return [StyleVM.TintKey as PropertyKey<unknown>]; }
}

function newDoc(): DiagramDocument
{
    Application.current = null;
    new Application();
    return new DiagramDocument(new MemoryStorage());
}

describe('DiagramDocument — content-VM style dirties the document', () => {
    test('a change to a VM-declared style DP marks the document dirty', () => {
        const doc = newDoc();
        const vm = new StyleVM();
        vm.Id = 'v1';
        doc.Nodes.Add(vm);
        doc.Save();
        assert.equal(doc.IsDirty, false, 'precondition: clean after save');

        vm.Tint = '#123456';
        assert.equal(doc.IsDirty, true, 'a content-VM style edit dirties the document');
    });
});
