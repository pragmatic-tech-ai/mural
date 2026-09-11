import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Binding, BindingMode } from '../binding.js';
import { Observable } from '../../observable.js';
import { TextBlock } from '../../../basic/text-block.js';
import { resolveKey } from '../../model-internals.js';

// A plain (non-MuralBase) Observable — just a backing field plus a
// getter/setter that fires `notify` on a real change. This is exactly the
// INotifyPropertyChanged shape a hand-authored VM would use without opting
// into the whole MuralBase DP system.
class LabelVM extends Observable
{
    private _label: string;

    constructor(initial: string)
    {
        super();
        this._label = initial;
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

describe('Binding observes a plain Observable source', () => {
    test('one-way: target shows the initial value and PUSHES on setter change', () => {
        const vm = new LabelVM('start');
        const tb = new TextBlock();
        // A listener on the TARGET DP counts real pushes. `tb.Text` alone
        // would re-pull lazily through the binding on each read even with no
        // subscription, so we assert the push channel fired — the piece that
        // is missing until the Observable branch subscribes.
        let pushes = 0;
        let lastText: unknown;
        tb.PropertyChanged(resolveKey(tb, undefined, 'Text')).subscribe(({ newValue }) => { pushes++; lastText = newValue; });

        tb.set_property_value(
            resolveKey(tb, undefined, 'Text'),
            new Binding(vm as unknown as never, 'label'),
        );

        // Initial resolve (install push).
        assert.equal(tb.Text, 'start');
        const pushesAfterInstall = pushes;

        // Setter fires notify → binding push → target DP re-evaluates and
        // notifies. FAILS today: a plain Observable is never subscribed, so
        // no push arrives and pushes stays flat.
        vm.label = 'updated';
        assert.equal(tb.Text, 'updated');
        assert.ok(pushes > pushesAfterInstall, 'target received a push notification');
        assert.equal(lastText, 'updated');
    });

    test('one-way: unrelated instances do not cross-talk', () => {
        const a = new LabelVM('a0');
        const b = new LabelVM('b0');
        const ta = new TextBlock();
        const tb = new TextBlock();
        ta.set_property_value(resolveKey(ta, undefined, 'Text'), new Binding(a as unknown as never, 'label'));
        tb.set_property_value(resolveKey(tb, undefined, 'Text'), new Binding(b as unknown as never, 'label'));

        a.label = 'a1';
        assert.equal(ta.Text, 'a1');
        assert.equal(tb.Text, 'b0');
    });

    test('two-way: a target-side edit writes back through the setter', () => {
        const vm = new LabelVM('start');
        const changes: Array<[unknown, unknown]> = [];
        vm.PropertyChanged('label').subscribe(({ oldValue, newValue }) => { changes.push([oldValue, newValue]); });

        const tb = new TextBlock();
        tb.set_property_value(
            resolveKey(tb, undefined, 'Text'),
            new Binding(vm as unknown as never, 'label', BindingMode.TwoWay),
        );
        assert.equal(tb.Text, 'start');

        // Target-side write pushes back to the source; the setter runs
        // (observed via the field AND the notify listener).
        tb.set_property_value(resolveKey(tb, undefined, 'Text'), 'edited');
        assert.equal(vm.label, 'edited');
        assert.deepEqual(changes[changes.length - 1], ['start', 'edited']);
    });

    test('detach: a disposed binding stops receiving notifications', () => {
        const vm = new LabelVM('start');
        const binding = new Binding(vm as unknown as never, 'label');
        let last: unknown;
        binding.setOnValueChanged((_o, n) => { last = n; });

        vm.label = 'first';
        assert.equal(last, 'first');

        binding.dispose();
        vm.label = 'second';
        // No further pushes after dispose.
        assert.equal(last, 'first');
    });
});
