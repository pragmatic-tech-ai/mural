import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Binding, BindingMode } from '../binding.js';
import { MuralBase } from '../../model.js';
import { TextBlock } from '../../../basic/text-block.js';
import { resolveKey } from '../../model-internals.js';

// A MuralBase subclass that exposes state WITHOUT registering dependency
// properties — a plain readonly field plus a getter/setter that fires the
// Observable INPC (`RaisePropertyChanged`). MuralBase extends Observable, so a
// binding should read these plain members and subscribe to their INPC exactly
// as it does for a plain Observable VM. (Before the fix the binding's MuralBase
// branch returned undefined the moment a name wasn't a registered DP.)
class MbVM extends MuralBase
{
    private _label: string;
    public readonly tag: string;

    constructor(initial: string, tag: string)
    {
        super();
        this._label = initial;
        this.tag = tag;
    }

    public get label(): string { return this._label; }
    public set label(v: string)
    {
        const old = this._label;
        if (old === v) return;
        this._label = v;
        this.RaisePropertyChanged('label', old, v);
    }
}

describe('Binding reads plain properties on a MuralBase source', () => {
    test('one-way: reads a plain readonly field that is not a dependency property', () => {
        const vm = new MbVM('start', 'the-tag');
        const tb = new TextBlock();
        tb.set_property_value(resolveKey(tb, undefined, 'Text'), new Binding(vm as unknown as never, 'tag'));
        assert.equal(tb.Text, 'the-tag');
    });

    test('one-way: a getter/setter that raises INPC pushes to the target', () => {
        const vm = new MbVM('start', 't');
        const tb = new TextBlock();
        let pushes = 0;
        let lastText: unknown;
        tb.AddPropertyChangedListener(resolveKey(tb, undefined, 'Text'), (_o, _p, _old, n) => { pushes++; lastText = n; });
        tb.set_property_value(resolveKey(tb, undefined, 'Text'), new Binding(vm as unknown as never, 'label'));

        assert.equal(tb.Text, 'start');
        const after = pushes;
        vm.label = 'updated';
        assert.equal(tb.Text, 'updated');
        assert.ok(pushes > after, 'target received a push notification');
        assert.equal(lastText, 'updated');
    });

    test('two-way: a target-side edit writes back through the plain setter', () => {
        const vm = new MbVM('start', 't');
        const changes: Array<[unknown, unknown]> = [];
        vm.AddPropertyChangedListener('label', (_o, _p, o, n) => { changes.push([o, n]); });

        const tb = new TextBlock();
        tb.set_property_value(resolveKey(tb, undefined, 'Text'), new Binding(vm as unknown as never, 'label', BindingMode.TwoWay));
        assert.equal(tb.Text, 'start');

        tb.set_property_value(resolveKey(tb, undefined, 'Text'), 'edited');
        assert.equal(vm.label, 'edited');
        assert.deepEqual(changes[changes.length - 1], ['start', 'edited']);
    });

    test('detach: a disposed binding stops receiving INPC notifications', () => {
        const vm = new MbVM('start', 't');
        const binding = new Binding(vm as unknown as never, 'label');
        let last: unknown;
        binding.setOnValueChanged((_o, n) => { last = n; });

        vm.label = 'first';
        assert.equal(last, 'first');

        binding.dispose();
        vm.label = 'second';
        assert.equal(last, 'first');
    });

    test('AddPropertyChangedListener on a plain name no longer throws (falls back to Observable INPC)', () => {
        const vm = new MbVM('start', 't');
        let seen: unknown;
        assert.doesNotThrow(() => vm.AddPropertyChangedListener('label', (_o, _p, _old, n) => { seen = n; }));
        vm.label = 'x';
        assert.equal(seen, 'x');
        vm.RemovePropertyChangedListener('label', () => {});   // wrong cb → no-op, must not throw
    });
});
