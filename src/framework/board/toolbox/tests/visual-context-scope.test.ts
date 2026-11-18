import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Panel, PropertyValueSource } from '../../../../runtime/index.js';
import { VisualContext } from '../toolbox-visual-resolver.js';
import { VisualContextScope } from '../visual-context-scope.js';

describe('VisualContextScope attached property', () =>
{
    test('GetContext returns the default (Figure) when unset', () =>
    {
        assert.equal(VisualContextScope.GetContext(new Panel()), VisualContext.Figure);
    });

    test('SetContext round-trips on the same element', () =>
    {
        const el = new Panel();
        VisualContextScope.SetContext(el, VisualContext.Tile);
        assert.equal(VisualContextScope.GetContext(el), VisualContext.Tile);
    });

    test('inherits to a child from a parent local override', () =>
    {
        const parent = new Panel();
        const child = new Panel();
        parent.AddChild(child);

        // Arm inheritance for the child.
        const sub = child.PropertyChanged(VisualContextScope.ContextKey).subscribe(() => { /* arm */ });
        try
        {
            VisualContextScope.SetContext(parent, VisualContext.Tile);
            assert.equal(VisualContextScope.GetContext(child), VisualContext.Tile,
                'child must inherit the parent context');
            assert.equal(
                child.GetValueSource(VisualContextScope.ContextKey),
                PropertyValueSource.InheritedValue,
                'child source must be InheritedValue when inheriting from parent',
            );
        }
        finally
        {
            sub.dispose();
        }
    });
});
