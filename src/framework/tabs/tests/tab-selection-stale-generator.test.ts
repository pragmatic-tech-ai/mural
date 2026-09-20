import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MuralBase, MetaData, ObservableCollection } from '../../../runtime/index.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { TabControl, TabItem } from '../tabs.js';
import { Selector } from '../../list/selector.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { TextBlock } from '../../../basic/text-block.js';
import { initTestApp } from '../../../basic/tests/test-app.js';

// A programmatic `SelectedItem = <row>` write must highlight the row's realized
// tab even when the ItemContainerGenerator's item→container reverse map does NOT
// resolve it. That map can go stale under a retemplated presenter (Plexus'
// ExtendedTabControl wraps the ItemsPresenter), which is why clicking a tab
// highlighted (clicks act on the container directly) while activating a document
// from the project explorer (a programmatic SelectedItem write) highlighted
// nothing. TabControl resolves selection through realized containers by Tag
// (ListBox parity), so it no longer depends on the generator map.

class Doc extends MuralBase
{
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(Doc, 'Title', '', MetaData.None);
    public get Title(): string { return this.get_property_value(Doc.TitleKey); }
    public set Title(v: string) { this.set_property_value(Doc.TitleKey, v); }
}

// Evict the generator's item→container reverse map to simulate the stale-map
// condition, WITHOUT disturbing the realized containers themselves.
function clearGeneratorItemMap(tc: TabControl): void
{
    const gen = tc.Generator as unknown as { itemToContainer?: Map<unknown, unknown> };
    gen.itemToContainer?.clear();
}

describe('TabControl — programmatic selection survives a stale generator map', () => {
    beforeEach(() => { initTestApp(); });

    test('SelectedItem highlights the realized tab even when ContainerFromItem misses', () => {
        const a = new Doc(); a.Title = 'A';
        const b = new Doc(); b.Title = 'B';
        const docs = new ObservableCollection<Doc>(); docs.Add(a); docs.Add(b);

        const tc = new TabControl();
        tc.ItemTemplate = new DataTemplate((d) => new TextBlock((d as Doc).Title), Doc);
        tc.ItemsSource = docs;

        const target = new HeadlessTarget(600, 400);
        target.Content = tc;
        target.Flush();

        const tabs = tc.logicalChildren.filter((c) => c instanceof TabItem) as TabItem[];
        const tabA = tabs.find((t) => t.Tag === a)!;
        const tabB = tabs.find((t) => t.Tag === b)!;

        // Precondition: the containers are realized with the right Tag.
        assert.ok(tabA !== undefined && tabB !== undefined, 'both tabs realized');

        // Simulate the live-app failure: the generator can no longer resolve
        // item → container. Clicks would still work; programmatic selection must too.
        clearGeneratorItemMap(tc);
        assert.equal(tc.Generator.ContainerFromItem(a), undefined,
            'generator map is stale (ContainerFromItem misses)');

        // Programmatic activation, as a TwoWay SelectedItem=$ActiveDocument push does.
        tc.SelectedItem = a;
        target.Flush();
        assert.equal(Selector.GetIsSelected(tabA), true, 'A highlighted despite the stale map');
        assert.equal(Selector.GetIsSelected(tabB), false, 'B not highlighted');

        tc.SelectedItem = b;
        target.Flush();
        assert.equal(Selector.GetIsSelected(tabB), true, 'B highlighted after switching');
        assert.equal(Selector.GetIsSelected(tabA), false, 'A cleared');
    });
});
