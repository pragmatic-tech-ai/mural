import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';

import { MuralBase, MetaData, ObservableCollection, Panel, Visual } from '../../../runtime/index.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { DataContextBinding } from '../../../runtime/binding/data-context-binding.js';
import { resolveKey } from '../../../runtime/model-internals.js';
import { ComboBox } from '../combo-box.js';
import { Selector } from '../selector.js';
import { ItemsControl } from '../../base/items-control.js';
import { TextBlock } from '../../../basic/text-block.js';

// A VM shaped like ChatSession / the MCP editor VM: an items collection and a
// current selection that IS one of the collection's members (by identity).
class PickerVM extends MuralBase
{
    public static readonly OptionsKey = MuralBase.RegisterProperty<ObservableCollection<string>>(
        PickerVM, 'Options', undefined as unknown as ObservableCollection<string>, MetaData.None);
    public static readonly CurrentKey = MuralBase.RegisterProperty<string>(
        PickerVM, 'Current', undefined as unknown as string, MetaData.None);

    constructor(options: string[], current: string)
    {
        super();
        this.set_property_value(PickerVM.OptionsKey, new ObservableCollection<string>(options));
        this.set_property_value(PickerVM.CurrentKey, current);
    }

    public get Options(): ObservableCollection<string> { return this.get_property_value(PickerVM.OptionsKey); }
    public get Current(): string { return this.get_property_value(PickerVM.CurrentKey); }
    public set Current(v: string) { this.set_property_value(PickerVM.CurrentKey, v); }
}

class Root extends Panel { }

function selectionTextOf(cb: ComboBox): string
{
    const selBox = cb.visualChildren[0] as unknown as { FindName(n: string): Visual | undefined };
    return (selBox.FindName('PART_SelectionText') as TextBlock).Text;
}

// Reproduce the compiled `.mu`:  ComboBox [ ItemsSource = $Options, SelectedItem = $Current ]
// The template installs both bindings on the element (source order:
// ItemsSource first) BEFORE the DataContext inherits down.
function bindComboLikeMarkup(cb: ComboBox): void
{
    cb.set_property_value(resolveKey(cb, undefined, 'ItemsSource'),  DataContextBinding(cb, 'Options'));
    cb.set_property_value(resolveKey(cb, undefined, 'SelectedItem'), DataContextBinding(cb, 'Current'));
}

describe('ComboBox restores a bound selection (ItemsSource + SelectedItem)', () => {
    beforeEach(() => { initTestApp(); });

    test('DataContext set AFTER bindings installed: shows the current value, not the placeholder', () => {
        const vm = new PickerVM(['Default', 'Opus', 'Sonnet'], 'Opus');
        const cb = new ComboBox();
        cb.Placeholder = 'Select value';
        bindComboLikeMarkup(cb);

        const root = new Root();
        root.AddChild(cb);
        // DataContext inherits down now — mirrors a DataTemplate whose root
        // DataContext arrives after the child tree is built.
        root.set_property_value(resolveKey(root, undefined, 'DataContext'), vm);

        const target = new HeadlessTarget(400, 300);
        target.Content = root;
        target.Flush();

        assert.equal(cb.SelectedItem, 'Opus', 'combo SelectedItem resolves to the bound current value');
        assert.equal(selectionTextOf(cb), 'Opus', 'selection box shows the value, not the placeholder');
        assert.equal(vm.Current, 'Opus', 'the two-way binding did not wipe the VM selection');
    });

    test('SelectedItem bound BEFORE ItemsSource still restores (order-independent)', () => {
        const vm = new PickerVM(['Default', 'Opus', 'Sonnet'], 'Opus');
        const cb = new ComboBox();
        cb.Placeholder = 'Select value';
        // Reversed source order — the selection binding installs first.
        cb.set_property_value(resolveKey(cb, undefined, 'SelectedItem'), DataContextBinding(cb, 'Current'));
        cb.set_property_value(resolveKey(cb, undefined, 'ItemsSource'),  DataContextBinding(cb, 'Options'));

        const root = new Root();
        root.AddChild(cb);
        root.set_property_value(resolveKey(root, undefined, 'DataContext'), vm);

        const target = new HeadlessTarget(400, 300);
        target.Content = root;
        target.Flush();

        assert.equal(selectionTextOf(cb), 'Opus');
        assert.equal(cb.SelectedIndex, 1, 'index resolves once items are present');
        assert.equal(vm.Current, 'Opus');
    });

    test('DataContext present BEFORE bindings installed: also restores', () => {
        const vm = new PickerVM(['Default', 'Opus', 'Sonnet'], 'Sonnet');
        const root = new Root();
        root.set_property_value(resolveKey(root, undefined, 'DataContext'), vm);
        const cb = new ComboBox();
        cb.Placeholder = 'Select value';
        root.AddChild(cb);
        bindComboLikeMarkup(cb);

        const target = new HeadlessTarget(400, 300);
        target.Content = root;
        target.Flush();

        assert.equal(selectionTextOf(cb), 'Sonnet');
        assert.equal(vm.Current, 'Sonnet');
    });
});
