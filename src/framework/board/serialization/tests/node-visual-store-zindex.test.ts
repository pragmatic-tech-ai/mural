import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Panel } from '../../../../runtime/index.js';
import { Figure } from '../../figure.js';
import { NodeVisualStore } from '../node-visual-store.js';

function fig(): Figure
{
    const f = new Figure();
    f.Left = 0; f.Top = 0; f.Width = 10; f.Height = 10;
    return f;
}

describe('NodeVisual zIndex round-trip', () => {
    const store = new NodeVisualStore();

    test('Read omits zIndex when 0', () => {
        const f = fig();
        const v = store.Read(f);
        assert.equal('zIndex' in v, false);
    });

    test('Read captures a non-zero ZIndex; Apply restores it', () => {
        const f = fig();
        Panel.SetZIndex(f, 7);
        const v = store.Read(f);
        assert.equal(v.zIndex, 7);

        const g = fig();
        store.Apply(v, g);
        assert.equal(Panel.GetZIndex(g), 7);
    });

    test('Apply of a record without zIndex leaves ZIndex at 0', () => {
        const g = fig();
        store.Apply({ left: 0, top: 0, w: 10, h: 10 }, g);
        assert.equal(Panel.GetZIndex(g), 0);
    });
});
