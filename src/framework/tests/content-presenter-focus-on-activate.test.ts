import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application, MuralBase, Size, Element, type DrawingContext } from '../../runtime/index.js';
import { Border, ContentPresenter, DataTemplate } from '../../basic/index.js';

// A focusable leaf whose Focus() we spy — asserts the INTENT (focus requested)
// without wiring a real InputManager/target.
class FocusableLeaf extends Element
{
    public focusCount = 0;
    constructor() { super(); this.Focusable = true; }
    protected override MeasureOverride(_a: Size): Size { return new Size(10, 10); }
    protected override RenderOverride(_dc: DrawingContext): void { }
    public override Focus(): void { this.focusCount++; }
}

class DocVM extends MuralBase { }

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('ContentPresenter.FocusContentOnActivate', () => {
    test('focuses the first focusable descendant when content changes', async () => {
        Application.current = null; new Application();
        let leaf: FocusableLeaf | undefined;
        const cp = new ContentPresenter();
        cp.FocusContentOnActivate = true;
        // A DocVM renders through a template whose root is a non-focusable Border
        // wrapping a focusable leaf — the "root control" the pane should focus.
        cp.ContentTemplate = new DataTemplate(() => {
            const b = new Border(); leaf = new FocusableLeaf(); b.SetChild(leaf); return b;
        }, DocVM);

        cp.Content = new DocVM();
        assert.ok(leaf !== undefined, 'content resolved + slotted');
        await flush();
        assert.equal(leaf!.focusCount, 1, 'the first focusable descendant was focused');
    });

    test('does nothing when the opt-in is off (default)', async () => {
        Application.current = null; new Application();
        let leaf: FocusableLeaf | undefined;
        const cp = new ContentPresenter();
        cp.ContentTemplate = new DataTemplate(() => {
            const b = new Border(); leaf = new FocusableLeaf(); b.SetChild(leaf); return b;
        }, DocVM);

        cp.Content = new DocVM();
        await flush();
        assert.equal(leaf!.focusCount, 0, 'no focus stolen without the opt-in');
    });
});
