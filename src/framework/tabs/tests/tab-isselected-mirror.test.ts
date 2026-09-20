import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MuralBase, MetaData, ObservableCollection } from '../../../runtime/index.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { TabControl, TabItem } from '../tabs.js';
import { Selector } from '../../list/selector.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { TextBlock } from '../../../basic/text-block.js';
import { initTestApp } from '../../../basic/tests/test-app.js';

// The @DefaultTabItem selection chrome is `when (IsSelected)`, which observes
// the INSTANCE TabItem.IsSelected DP. Selection, however, is driven through the
// ATTACHED Selector.IsSelected DP. TabItem must mirror attached → instance (as
// ListBoxItem does) or the selected-tab underline/ink never paints on a
// programmatic activation (SelectedItem=$ActiveDocument) — the reported "no tab
// highlighted" symptom, where only a click seemed to highlight because a click
// also takes focus and lights the separate `when (IsFocused)` overlay.

class Doc extends MuralBase
{
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(Doc, 'Title', '', MetaData.None);
    public get Title(): string { return this.get_property_value(Doc.TitleKey); }
    public set Title(v: string) { this.set_property_value(Doc.TitleKey, v); }
}

describe('TabItem — attached⇄instance IsSelected mirror', () => {
    beforeEach(() => { initTestApp(); });

    test('the instance IsSelected DP (what the chrome watches) tracks Selector selection', () => {
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

        // Programmatic activation, as a TwoWay SelectedItem=$ActiveDocument push does.
        tc.SelectedItem = a;
        target.Flush();
        // The chrome-observed INSTANCE DP — not just the attached one — must be set.
        assert.equal(tabA.get_property_value(TabItem.IsSelectedKey), true,
            'A instance IsSelected true (chrome would paint)');
        assert.equal(tabB.get_property_value(TabItem.IsSelectedKey), false,
            'B instance IsSelected false');
        // Attached and instance agree.
        assert.equal(Selector.GetIsSelected(tabA), true);

        tc.SelectedItem = b;
        target.Flush();
        assert.equal(tabB.get_property_value(TabItem.IsSelectedKey), true,
            'B instance IsSelected true after switch');
        assert.equal(tabA.get_property_value(TabItem.IsSelectedKey), false,
            'A instance IsSelected cleared');
    });

    test('a direct instance-DP write mirrors back to the attached DP', () => {
        const ti = new TabItem();
        ti.set_property_value(TabItem.IsSelectedKey, true);
        assert.equal(Selector.GetIsSelected(ti), true, 'instance → attached mirror');
        ti.set_property_value(TabItem.IsSelectedKey, false);
        assert.equal(Selector.GetIsSelected(ti), false);
    });
});
