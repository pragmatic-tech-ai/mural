import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { MuralBase, MetaData } from '../../../runtime/index.js';
import { GridProperty, PropertyKind } from '../grid-property.js';

// ---------------------------------------------------------------------------
// Probe class for describeDpTarget tests
// ---------------------------------------------------------------------------
class Probe extends MuralBase
{
    static readonly LabelKey = MuralBase.RegisterProperty<string>(Probe, 'Label', 'hello', MetaData.None);
    get Label(): string { return this.get_property_value(Probe.LabelKey); }
    set Label(v: string) { this.set_property_value(Probe.LabelKey, v); }

    static readonly CountKey = MuralBase.RegisterProperty<number>(Probe, 'Count', 0, MetaData.None);
    get Count(): number { return this.get_property_value(Probe.CountKey); }
    set Count(v: number) { this.set_property_value(Probe.CountKey, v); }

    static readonly EnabledKey = MuralBase.RegisterProperty<boolean>(Probe, 'Enabled', false, MetaData.None);
    get Enabled(): boolean { return this.get_property_value(Probe.EnabledKey); }
    set Enabled(v: boolean) { this.set_property_value(Probe.EnabledKey, v); }

    static readonly ReadOnlyKey = MuralBase.RegisterReadOnlyProperty<string>(Probe, 'ReadOnly', 'fixed', MetaData.None);
    get ReadOnly(): string { return this.get_property_value(Probe.ReadOnlyKey); }
}

// ---------------------------------------------------------------------------
// PropertyKind enum
// ---------------------------------------------------------------------------
describe('PropertyKind enum values', () => {
    test('Text has value "text"', () => {
        assert.equal(PropertyKind.Text, 'text');
    });

    test('MultilineText has value "multiline"', () => {
        assert.equal(PropertyKind.MultilineText, 'multiline');
    });

    test('Number has value "number"', () => {
        assert.equal(PropertyKind.Number, 'number');
    });

    test('Boolean has value "boolean"', () => {
        assert.equal(PropertyKind.Boolean, 'boolean');
    });

    test('Enum has value "enum"', () => {
        assert.equal(PropertyKind.Enum, 'enum');
    });

    test('Color has value "color"', () => {
        assert.equal(PropertyKind.Color, 'color');
    });
});

// ---------------------------------------------------------------------------
// GridProperty.text factory
// ---------------------------------------------------------------------------
describe('GridProperty.text factory', () => {
    test('sets Kind to Text', () => {
        const p = GridProperty.text('MyProp');
        assert.equal(p.Kind, PropertyKind.Text);
    });

    test('sets Name from argument', () => {
        const p = GridProperty.text('Title');
        assert.equal(p.Name, 'Title');
    });

    test('DisplayName defaults to Name when not supplied', () => {
        const p = GridProperty.text('Title');
        assert.equal(p.DisplayName, 'Title');
    });

    test('DisplayName can be overridden via opts', () => {
        const p = GridProperty.text('name', { displayName: 'Full Name' });
        assert.equal(p.DisplayName, 'Full Name');
    });

    test('Category defaults to "General"', () => {
        const p = GridProperty.text('x');
        assert.equal(p.Category, 'General');
    });

    test('Category can be overridden via opts', () => {
        const p = GridProperty.text('x', { category: 'Appearance' });
        assert.equal(p.Category, 'Appearance');
    });

    test('IsReadOnly defaults to false', () => {
        const p = GridProperty.text('x');
        assert.equal(p.IsReadOnly, false);
    });

    test('IsReadOnly can be set to true via opts', () => {
        const p = GridProperty.text('x', { readOnly: true });
        assert.equal(p.IsReadOnly, true);
    });

    test('Description is undefined by default', () => {
        const p = GridProperty.text('x');
        assert.equal(p.Description, undefined);
    });

    test('Description can be set via opts', () => {
        const p = GridProperty.text('x', { description: 'A label' });
        assert.equal(p.Description, 'A label');
    });

    test('EnumOptions is undefined', () => {
        const p = GridProperty.text('x');
        assert.equal(p.EnumOptions, undefined);
    });

    test('Min is undefined', () => {
        const p = GridProperty.text('x');
        assert.equal(p.Min, undefined);
    });

    test('Max is undefined', () => {
        const p = GridProperty.text('x');
        assert.equal(p.Max, undefined);
    });

    test('EditorTemplateKey is undefined by default', () => {
        const p = GridProperty.text('x');
        assert.equal(p.EditorTemplateKey, undefined);
    });

    test('EditorTemplateKey can be set via opts', () => {
        const p = GridProperty.text('x', { editorTemplateKey: 'custom' });
        assert.equal(p.EditorTemplateKey, 'custom');
    });
});

// ---------------------------------------------------------------------------
// GridProperty.multiline factory
// ---------------------------------------------------------------------------
describe('GridProperty.multiline factory', () => {
    test('sets Kind to MultilineText', () => {
        const p = GridProperty.multiline('Notes');
        assert.equal(p.Kind, PropertyKind.MultilineText);
    });

    test('DisplayName defaults to Name', () => {
        const p = GridProperty.multiline('Notes');
        assert.equal(p.DisplayName, 'Notes');
    });

    test('Category defaults to "General"', () => {
        const p = GridProperty.multiline('Notes');
        assert.equal(p.Category, 'General');
    });
});

// ---------------------------------------------------------------------------
// GridProperty.number factory
// ---------------------------------------------------------------------------
describe('GridProperty.number factory', () => {
    test('sets Kind to Number', () => {
        const p = GridProperty.number('Width');
        assert.equal(p.Kind, PropertyKind.Number);
    });

    test('DisplayName defaults to Name', () => {
        const p = GridProperty.number('Width');
        assert.equal(p.DisplayName, 'Width');
    });

    test('Min defaults to undefined', () => {
        const p = GridProperty.number('Width');
        assert.equal(p.Min, undefined);
    });

    test('Max defaults to undefined', () => {
        const p = GridProperty.number('Width');
        assert.equal(p.Max, undefined);
    });

    test('Min can be set via opts', () => {
        const p = GridProperty.number('Width', { min: 0 });
        assert.equal(p.Min, 0);
    });

    test('Max can be set via opts', () => {
        const p = GridProperty.number('Width', { max: 100 });
        assert.equal(p.Max, 100);
    });

    test('both Min and Max can be set together', () => {
        const p = GridProperty.number('Width', { min: -10, max: 10 });
        assert.equal(p.Min, -10);
        assert.equal(p.Max, 10);
    });
});

// ---------------------------------------------------------------------------
// GridProperty.bool factory
// ---------------------------------------------------------------------------
describe('GridProperty.bool factory', () => {
    test('sets Kind to Boolean', () => {
        const p = GridProperty.bool('IsVisible');
        assert.equal(p.Kind, PropertyKind.Boolean);
    });

    test('DisplayName defaults to Name', () => {
        const p = GridProperty.bool('IsVisible');
        assert.equal(p.DisplayName, 'IsVisible');
    });

    test('Category defaults to "General"', () => {
        const p = GridProperty.bool('IsVisible');
        assert.equal(p.Category, 'General');
    });
});

// ---------------------------------------------------------------------------
// GridProperty.enumOf factory
// ---------------------------------------------------------------------------
describe('GridProperty.enumOf factory', () => {
    test('sets Kind to Enum', () => {
        const p = GridProperty.enumOf('Align', ['left', 'center', 'right']);
        assert.equal(p.Kind, PropertyKind.Enum);
    });

    test('stores options as EnumOptions', () => {
        const opts = ['left', 'center', 'right'];
        const p = GridProperty.enumOf('Align', opts);
        assert.deepEqual(p.EnumOptions, opts);
    });

    test('DisplayName defaults to Name', () => {
        const p = GridProperty.enumOf('Align', ['a']);
        assert.equal(p.DisplayName, 'Align');
    });

    test('Category defaults to "General"', () => {
        const p = GridProperty.enumOf('Align', ['a']);
        assert.equal(p.Category, 'General');
    });

    test('opts.displayName overrides DisplayName', () => {
        const p = GridProperty.enumOf('Align', ['a'], { displayName: 'Alignment' });
        assert.equal(p.DisplayName, 'Alignment');
    });

    test('opts.readOnly overrides IsReadOnly', () => {
        const p = GridProperty.enumOf('Align', ['a'], { readOnly: true });
        assert.equal(p.IsReadOnly, true);
    });
});

// ---------------------------------------------------------------------------
// GridProperty.color factory
// ---------------------------------------------------------------------------
describe('GridProperty.color factory', () => {
    test('sets Kind to Color', () => {
        const p = GridProperty.color('Background');
        assert.equal(p.Kind, PropertyKind.Color);
    });

    test('DisplayName defaults to Name', () => {
        const p = GridProperty.color('Background');
        assert.equal(p.DisplayName, 'Background');
    });

    test('Category defaults to "General"', () => {
        const p = GridProperty.color('Background');
        assert.equal(p.Category, 'General');
    });
});

// ---------------------------------------------------------------------------
// describeDpTarget
// ---------------------------------------------------------------------------
describe('GridProperty.describeDpTarget — DP inference', () => {
    beforeEach(() => { initTestApp(); });

    test('returns a GridProperty for each DP on the target', () => {
        const probe = new Probe();
        const props = GridProperty.describeDpTarget(probe);
        const names = props.map((p) => p.Name);
        assert.ok(names.includes('Label'), 'should include Label');
        assert.ok(names.includes('Count'), 'should include Count');
        assert.ok(names.includes('Enabled'), 'should include Enabled');
        assert.ok(names.includes('ReadOnly'), 'should include ReadOnly');
    });

    test('infers Kind=Text for a string DP (default value is string)', () => {
        const probe = new Probe();
        const props = GridProperty.describeDpTarget(probe);
        const label = props.find((p) => p.Name === 'Label')!;
        assert.equal(label.Kind, PropertyKind.Text);
    });

    test('infers Kind=Number for a number DP (default value is number)', () => {
        const probe = new Probe();
        const props = GridProperty.describeDpTarget(probe);
        const count = props.find((p) => p.Name === 'Count')!;
        assert.equal(count.Kind, PropertyKind.Number);
    });

    test('infers Kind=Boolean for a boolean DP (default value is boolean)', () => {
        const probe = new Probe();
        const props = GridProperty.describeDpTarget(probe);
        const enabled = props.find((p) => p.Name === 'Enabled')!;
        assert.equal(enabled.Kind, PropertyKind.Boolean);
    });

    test('IsReadOnly is true for a read-only DP', () => {
        const probe = new Probe();
        const props = GridProperty.describeDpTarget(probe);
        const ro = props.find((p) => p.Name === 'ReadOnly')!;
        assert.equal(ro.IsReadOnly, true);
    });

    test('IsReadOnly is false for a normal read/write DP', () => {
        const probe = new Probe();
        const props = GridProperty.describeDpTarget(probe);
        const label = props.find((p) => p.Name === 'Label')!;
        assert.equal(label.IsReadOnly, false);
    });

    test('Category defaults to "General" for inferred properties', () => {
        const probe = new Probe();
        const props = GridProperty.describeDpTarget(probe);
        for (const p of props)
        {
            assert.equal(p.Category, 'General', `expected 'General' for ${p.Name}`);
        }
    });

    test('DisplayName equals Name for inferred properties', () => {
        const probe = new Probe();
        const props = GridProperty.describeDpTarget(probe);
        for (const p of props)
        {
            assert.equal(p.DisplayName, p.Name, `expected DisplayName===Name for ${p.Name}`);
        }
    });
});

describe('GridProperty.describeDpTarget — overrides map', () => {
    beforeEach(() => { initTestApp(); });

    test('an override entry replaces the inferred GridProperty for that Name', () => {
        const probe = new Probe();
        const override = GridProperty.enumOf('Label', ['a', 'b', 'c']);
        const overrides = new Map<string, GridProperty>([['Label', override]]);
        const props = GridProperty.describeDpTarget(probe, overrides);
        const label = props.find((p) => p.Name === 'Label')!;
        assert.equal(label.Kind, PropertyKind.Enum, 'override should switch Kind to Enum');
        assert.deepEqual(label.EnumOptions, ['a', 'b', 'c']);
    });

    test('overrides do not affect unrelated entries', () => {
        const probe = new Probe();
        const override = GridProperty.enumOf('Label', ['x']);
        const overrides = new Map<string, GridProperty>([['Label', override]]);
        const props = GridProperty.describeDpTarget(probe, overrides);
        const count = props.find((p) => p.Name === 'Count')!;
        assert.equal(count.Kind, PropertyKind.Number);
    });

    test('result preserves enumeration order — Label comes before Count when enumerated that way', () => {
        const probe = new Probe();
        const props = GridProperty.describeDpTarget(probe);
        const labelIdx = props.findIndex((p) => p.Name === 'Label');
        const countIdx = props.findIndex((p) => p.Name === 'Count');
        // Both must be found
        assert.ok(labelIdx !== -1);
        assert.ok(countIdx !== -1);
        // Label was registered first on Probe so it should appear first
        assert.ok(labelIdx < countIdx, 'Label should come before Count in enumeration order');
    });
});
