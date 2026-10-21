import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Application, DynamicResourceComposite, TokenCell } from '../../index.js';
import { ResourceDictionary } from '../../resource-dictionary.js';
import { Border } from '../../../basic/border.js';
import { HeadlessTarget, Thickness } from '../../../visual-engine/index.js';
import type { Binding } from '../binding.js';

class CompositeHarness
{
    public static readonly OffsetKey = 'FocusRingOffset';
    public static readonly SpaceKey = 'Space3';
    public static readonly OffsetValue = 2;
    public static readonly SpaceValue = 12;
    public static readonly LiteralOne = 1;
    public static readonly ExpectedSpaceHorizontal = 24;
    public static readonly ExpectedSpaceVertical = 2;
    public static readonly ExpectedOffsetHorizontal = 4;

    public readonly Host = new Border();
    public BuildCount = 0;

    public constructor()
    {
        new HeadlessTarget(200, 200).Content = this.Host;
    }

    public Bind(cells: ReadonlyArray<number | TokenCell>): Binding
    {
        const binding = DynamicResourceComposite(this.Host, cells, v =>
        {
            this.BuildCount++;
            return v.length === 1
                ? new Thickness(v[0] as number)
                : new Thickness(v[0] as number, v[1] as number, v[2] as number, v[3] as number);
        });
        this.Host.set_property_value(Border.PaddingKey, binding);
        return binding;
    }

    public MergeTokens(tokens: Record<string, number>): void
    {
        const dict = new ResourceDictionary();
        for (const [k, v] of Object.entries(tokens)) dict.Set(k, v);
        Application.current!.Resources.AddMergedDictionary(dict);
    }
}

describe('DynamicResourceComposite', () =>
{
    beforeEach(() => { Application.current = null; new Application(); });

    test('composite re-resolves token cells when the dictionary is merged after construction', () =>
    {
        const h = new CompositeHarness();
        h.Bind([new TokenCell(CompositeHarness.OffsetKey)]);
        assert.equal(h.Host.Padding.Left, undefined);

        h.MergeTokens({ [CompositeHarness.OffsetKey]: CompositeHarness.OffsetValue });

        assert.equal(h.Host.Padding.Left, CompositeHarness.OffsetValue);
        assert.equal(h.Host.Padding.Horizontal, CompositeHarness.ExpectedOffsetHorizontal);
    });

    test('literals pass through unchanged alongside token cells', () =>
    {
        const h = new CompositeHarness();
        const space = new TokenCell(CompositeHarness.SpaceKey);
        h.Bind([space, CompositeHarness.LiteralOne, space, CompositeHarness.LiteralOne]);
        h.MergeTokens({ [CompositeHarness.SpaceKey]: CompositeHarness.SpaceValue });

        assert.equal(h.Host.Padding.Horizontal, CompositeHarness.ExpectedSpaceHorizontal);
        assert.equal(h.Host.Padding.Vertical, CompositeHarness.ExpectedSpaceVertical);
    });

    test('dispose() removes all subscriptions', () =>
    {
        const h = new CompositeHarness();
        const binding = h.Bind([new TokenCell(CompositeHarness.OffsetKey)]);
        const before = h.BuildCount;
        binding.dispose();

        h.MergeTokens({ [CompositeHarness.OffsetKey]: CompositeHarness.OffsetValue });

        assert.equal(h.BuildCount, before);
    });
});
