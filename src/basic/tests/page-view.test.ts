import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from './test-app.js';

import { Application, MuralBase, Rect, Size, Visual } from '../../runtime/index.js';
import { HeadlessTarget } from '../../visual-engine/index.js';
import { Border } from '../border.js';
import { PageView } from '../page-view.js';
import { TextBlock } from '../text-block.js';
import { DataTemplate } from '../templates/data-template.js';
import { ContentControl } from '../../framework/base/content-control.js';

// Locate the title TextBlock inside the page's header strip. Saves
// every test reaching the same five accessors deep.
function titleOf(pv: PageView): TextBlock
{
    const dock = pv.visualChildren[0]!;            // DockPanel
    const header = dock.visualChildren[0]!;        // Border
    const stack  = header.visualChildren[0]!;      // StackPanel
    return stack.visualChildren[0] as TextBlock;
}

function subtitleStack(pv: PageView)
{
    const dock = pv.visualChildren[0]!;
    const header = dock.visualChildren[0]!;
    return header.visualChildren[0]!;
}

describe('PageView — basic shape', () => {
    beforeEach(() => { initTestApp(); });

    test('Title text propagates into the header title TextBlock', () => {
        const pv = new PageView();
        pv.Title = 'TreeView';
        assert.equal(titleOf(pv).Text, 'TreeView');
    });

    test('Subtitle is omitted from the header stack when empty', () => {
        const pv = new PageView();
        const stack = subtitleStack(pv);
        // Only the title TextBlock — no subtitle row.
        assert.equal(stack.visualChildren.length, 1);
    });

    test('Setting Subtitle adds it to the header; clearing it removes it', () => {
        const pv = new PageView();
        const stack = subtitleStack(pv);

        pv.Subtitle = 'Composed-markup tree with multi-select';
        assert.equal(stack.visualChildren.length, 2,
            'subtitle row attached on first non-empty write');

        pv.Subtitle = '';
        assert.equal(stack.visualChildren.length, 1,
            'subtitle row removed on clear');
    });

    test('logicalChildren includes Content but not the template parts', () => {
        const pv = new PageView();
        const body = new Border();
        pv.Content = body;
        assert.deepEqual(pv.logicalChildren, [body]);
    });
});

describe('PageView — Content swap', () => {
    beforeEach(() => { initTestApp(); });

    test('swapping Content detaches the old logical parent and attaches the new', () => {
        const pv = new PageView();
        const a = new Border();
        const b = new Border();

        pv.Content = a;
        assert.deepEqual(pv.logicalChildren, [a]);

        pv.Content = b;
        assert.deepEqual(pv.logicalChildren, [b]);

        // The old content should now be detachable from a different host
        // without the "already has a logical parent" trip.
        const other = new PageView();
        other.Content = a;
        assert.deepEqual(other.logicalChildren, [a]);
    });

    test('Content fills the area below the header strip via DockPanel LastChildFill', () => {
        const pv = new PageView();
        pv.Title = 'Demo';
        const body = new Border();
        pv.Content = body;

        const target = new HeadlessTarget(400, 300);
        target.Content = pv;
        target.Flush();

        // Title strip has Padding(20, 16, 20, 12) = 16 + ~title_height + 12 + 1 (divider).
        // The exact title height depends on font metrics, but the body's
        // top edge MUST sit below the divider's bottom, and the body's
        // bottom edge MUST be the target's bottom.
        const dock = pv.visualChildren[0]!;
        const header = dock.visualChildren[0]!;
        const divider = dock.visualChildren[1]!;
        const contentHost = dock.visualChildren[2]!;

        const headerBottom = header.ArrangedRect.Y + header.ArrangedRect.Height;
        assert.ok(headerBottom > 0, 'header should have non-zero arranged height');
        assert.equal(divider.ArrangedRect.Y, headerBottom);
        assert.equal(divider.ArrangedRect.Height, 1);
        assert.equal(contentHost.ArrangedRect.Y, headerBottom + 1);
        assert.equal(contentHost.ArrangedRect.X, 0);
        assert.equal(contentHost.ArrangedRect.Width, 400);
        // Content host fills the remainder vertically:
        assert.equal(contentHost.ArrangedRect.Y + contentHost.ArrangedRect.Height, 300);
    });

    test('Content swap survives a re-render — the new body paints into the arranged content slot', () => {
        const pv = new PageView();
        const body1 = new Border();
        pv.Content = body1;

        const target = new HeadlessTarget(400, 300);
        target.Content = pv;
        target.Flush();
        assert.ok(body1.ArrangedRect.Width > 0);

        const body2 = new Border();
        pv.Content = body2;
        target.Flush();
        assert.ok(body2.ArrangedRect.Width > 0, 'new body arranged after the swap');
    });
});

// A demo VM that OWNS a persistent Visual (mirrors DiagramDocument
// holding the shared toolbox preview Visual Figures / fused canvas Figures). The
// matching DataTemplate slots that very Visual as Content — so naively
// re-applying the template on nav-back would re-attach an
// already-parented Visual and throw "already has a logical parent".
class PersistentOwner extends MuralBase
{
    public readonly node = new Border();   // built ONCE, lives on the VM
}

describe('PageView — MuralBase content memoisation (nav-away-and-back)', () => {
    let applies = 0;

    beforeEach(() => {
        initTestApp();
        applies = 0;
        const tpl = new DataTemplate((data) => {
            applies++;
            const cc = new ContentControl();
            cc.Content = (data as PersistentOwner).node;   // mimics a shared Visual as Content
            return cc;
        }, PersistentOwner);
        // Type key (keyless implicit template) — a string/x:key'd template is not
        // resolved implicitly by type.
        Application.current!.Resources.Set(PersistentOwner, tpl);
    });

    test('navigating away from a MuralBase demo and back reuses the view — no re-attach throw', () => {
        const pv    = new PageView();
        const model = new PersistentOwner();

        pv.Content = model;                       // first mount — resolves + attaches node
        assert.equal(applies, 1, 'template applied once on first mount');
        const firstParent = model.node.GetLogicalParent();
        assert.notEqual(firstParent, undefined, 'persistent node attached on first mount');

        pv.Content = undefined;                   // navigate away (unslot, keep cache)

        // Navigate back. Without memoisation this re-applies the template,
        // building a fresh ContentControl that calls AttachLogical(node)
        // on the still-parented node → throws. Memoisation must reuse the
        // cached tree instead.
        assert.doesNotThrow(() => { pv.Content = model; },
            'nav-back must not re-attach the persistent node');
        assert.equal(applies, 1, 'cached view reused — template NOT re-applied');
        assert.equal(model.node.GetLogicalParent(), firstParent,
            'node keeps its original logical parent (same tree reused)');
    });

    test('a DIFFERENT MuralBase instance still resolves its own fresh view', () => {
        const pv = new PageView();
        const a  = new PersistentOwner();
        const b  = new PersistentOwner();

        pv.Content = a;
        assert.equal(applies, 1);
        pv.Content = b;                           // distinct identity → fresh resolve
        assert.equal(applies, 2, 'a different MuralBase gets its own view');
        pv.Content = a;                           // back to a → cached, no re-apply
        assert.equal(applies, 2, 'returning to the first MuralBase reuses its cached view');
    });
});

describe('Visual.Tag DP', () => {
    beforeEach(() => { initTestApp(); });

    test('Tag is undefined by default and round-trips through the setter', () => {
        const v = new Border();
        assert.equal(v.Tag, undefined);
        const payload = { id: 'demo-x' };
        v.Tag = payload;
        assert.equal(v.Tag, payload);
    });

    test('Tag does NOT trigger measure/arrange/render invalidation (MetaData.None)', () => {
        const v = new Border();
        v.Measure(new Size(10, 10));
        v.Arrange(new Rect(0, 0, 10, 10));
        // After arrange both caches are valid. Writing Tag must not
        // invalidate either — pure storage.
        v.Tag = { foo: 'bar' };
        // Internal flags aren't public; the observable signal is that
        // a subsequent same-size Measure short-circuits (no override
        // call). Probe by replacing Border with a counter subclass.
        class Counted extends Border
        {
            public measures = 0;
            protected override MeasureOverride(a: Size): Size
            {
                this.measures++;
                return super.MeasureOverride(a);
            }
        }
        const c = new Counted();
        c.Measure(new Size(50, 50));
        assert.equal(c.measures, 1);
        c.Tag = 'arbitrary';
        c.Measure(new Size(50, 50));
        assert.equal(c.measures, 1, 'Tag write must not invalidate measure');
    });
});
