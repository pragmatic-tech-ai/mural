import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';

import { ObservableCollection, Panel, Visual } from '../../../runtime/index.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';
import { ComboBox } from '../combo-box.js';
import { TextBlock } from '../../../basic/text-block.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';

class Root extends Panel { }

interface Option { name: string; kind: string }

function mountInTarget(cb: ComboBox): HeadlessTarget
{
    const root = new Root();
    root.AddChild(cb);
    const target = new HeadlessTarget(400, 300);
    target.Content = root;
    target.Flush();
    return target;
}

// Walk into the popup-host subtree to retrieve the realised row containers.
function popupRows(target: HeadlessTarget): readonly Visual[]
{
    const overlay   = target.OverlayRoot!;
    const popupHost = overlay.visualChildren[0] as unknown as { FindName(n: string): Visual | undefined };
    const popupList = popupHost.FindName('PART_PopupList')!;
    const stack     = popupList.visualChildren[0] as Panel;
    return stack.visualChildren;
}

// The first descendant TextBlock's text — the rendered row label, whether
// the row holds the label directly (string items) or through a
// ContentPresenter (DisplayMemberPath / ItemTemplate items).
function rowText(row: Visual): string
{
    let found: string | undefined;
    const walk = (v: Visual): void =>
    {
        if (found !== undefined) return;
        if (v instanceof TextBlock) { found = v.Text; return; }
        for (const c of v.visualChildren) walk(c);
    };
    walk(row);
    return found ?? '';
}

function selectionText(cb: ComboBox): string
{
    const selBox = cb.visualChildren[0] as unknown as { FindName(n: string): Visual | undefined };
    return (selBox.FindName('PART_SelectionText') as TextBlock).Text;
}

describe('ComboBox — item templating', () =>
{
    beforeEach(() => { initTestApp(); });

    test('popup rows honour DisplayMemberPath for object items', () =>
    {
        const cb = new ComboBox();
        cb.DisplayMemberPath = 'name';
        cb.ItemsSource = new ObservableCollection<Option>([
            { name: 'candle',   kind: 'candle' },
            { name: 'llamacpp', kind: 'llamacpp' },
        ]);
        const target = mountInTarget(cb);
        cb.IsDropDownOpen = true;
        target.Flush();

        const rows = popupRows(target);
        assert.equal(rows.length, 2);
        assert.equal(rowText(rows[0]!), 'candle');
        assert.equal(rowText(rows[1]!), 'llamacpp');
    });

    test('popup rows honour an explicit ItemTemplate', () =>
    {
        const cb = new ComboBox();
        cb.ItemTemplate = new DataTemplate((data: unknown): Visual =>
            new TextBlock('» ' + (data as Option).name));
        cb.ItemsSource = new ObservableCollection<Option>([{ name: 'alpha', kind: 'a' }]);
        const target = mountInTarget(cb);
        cb.IsDropDownOpen = true;
        target.Flush();

        const rows = popupRows(target);
        assert.equal(rows.length, 1);
        assert.equal(rowText(rows[0]!), '» alpha');
    });

    test('selection box honours DisplayMemberPath', () =>
    {
        const cb = new ComboBox();
        cb.DisplayMemberPath = 'name';
        cb.ItemsSource = new ObservableCollection<Option>([
            { name: 'candle',   kind: 'candle' },
            { name: 'llamacpp', kind: 'llamacpp' },
        ]);
        mountInTarget(cb);
        cb.SelectedIndex = 1;
        assert.equal(selectionText(cb), 'llamacpp');
    });

    test('popup reflects items added to the bound collection after binding', () =>
    {
        const opts = new ObservableCollection<Option>([]);
        const cb = new ComboBox();
        cb.DisplayMemberPath = 'name';
        cb.ItemsSource = opts;                       // bound while still empty
        const target = mountInTarget(cb);
        // Populate AFTER the combo and its popup list are bound and mounted —
        // this is the harness's real sequence (async discovery fills the list).
        opts.Add({ name: 'candle',   kind: 'candle' });
        opts.Add({ name: 'llamacpp', kind: 'llamacpp' });
        cb.IsDropDownOpen = true;
        target.Flush();

        const rows = popupRows(target);
        assert.equal(rows.length, 2, 'popup list tracks post-bind collection mutations');
        assert.equal(rowText(rows[0]!), 'candle');
        assert.equal(rowText(rows[1]!), 'llamacpp');
    });

    test('plain string items still render (no DisplayMemberPath / ItemTemplate)', () =>
    {
        const cb = new ComboBox();
        cb.Items = ['Apple', 'Pear'];
        const target = mountInTarget(cb);
        cb.IsDropDownOpen = true;
        target.Flush();

        const rows = popupRows(target);
        assert.equal(rows.length, 2);
        assert.equal(rowText(rows[0]!), 'Apple');
        assert.equal(rowText(rows[1]!), 'Pear');
    });
});
