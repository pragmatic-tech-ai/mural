import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    Application, ObservableCollection, Visual, Size, type MountableTarget,
} from '../../runtime/index.js';
import { Border, Canvas, ItemsPanelTemplate } from '../../basic/index.js';
import { DataTemplate } from '../../basic/templates/data-template.js';
import { TextBlock } from '../../basic/text-block.js';
import { ItemsControl } from '../base/items-control.js';

class FakeTarget implements MountableTarget
{
    public Content: Visual | undefined;
    public SetFocus(_v: Visual | undefined): void {}
    public GetFocusedVisual(): Visual | undefined { return undefined; }
}

function mount(ic: ItemsControl): void
{
    const surface = new Border();
    (surface as unknown as { Child: Visual }).Child = ic;
    const target = new FakeTarget();
    target.Content = surface;
    (surface as Visual).Measure(new Size(400, 400));
    (surface as Visual).Arrange({ X: 0, Y: 0, Width: 400, Height: 400 } as never);
}

describe('ItemsControl reset handling', () => {
    beforeEach(() => { Application.current = null; new Application(); });

    test('a Batch on the bound Items rebuilds containers to match final contents', () => {
        const items = new ObservableCollection<string>(['a', 'b']);
        const ic = new ItemsControl();
        ic.ItemsPanel = new ItemsPanelTemplate(() => new Canvas());
        ic.ItemTemplate = new DataTemplate((d: unknown) => new TextBlock(String(d)));
        ic.Items = items;
        mount(ic);
        const panel = ic.ItemsPanelInstance!;
        assert.equal(panel.Children.Count, 2);

        items.Batch(() => {
            items.Clear();
            for (const s of ['x', 'y', 'z']) items.Add(s);
        });

        assert.equal(panel.Children.Count, 3, 'panel reflects the post-batch contents');
    });
});
