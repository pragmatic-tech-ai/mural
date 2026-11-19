import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from './test-app.js';
import { Application, MuralBase } from '../../runtime/index.js';
import type { Visual } from '../../runtime/index.js';
import { HeadlessTarget } from '../../visual-engine/index.js';
import { ContentPresenter } from '../templates/content-presenter.js';
import { DataTemplate } from '../templates/data-template.js';
import { TextBlock } from '../text-block.js';

// ReuseContentViews makes a ContentPresenter hand back the SAME view when the
// same content object is presented again (a tab re-activation) instead of
// rebuilding it. Critical for a body that owns shared Visuals — a Board whose
// items are its document's Figures: a rebuilt Board would re-parent already-
// parented Figures and crash ("Visual already has a visual parent").
class Doc extends MuralBase
{
    public mounted = 0;
    public OnViewMounted(_v: Visual): void { this.mounted++; }
}

describe('ContentPresenter — ReuseContentViews', () => {
    beforeEach(() => { initTestApp(); });

    function mount(reuse: boolean): { cp: ContentPresenter; present: (c: unknown) => Visual | undefined }
    {
        Application.current?.Resources.Set(Doc, new DataTemplate((_d) => new TextBlock('x'), Doc));
        const cp = new ContentPresenter();
        cp.ReuseContentViews = reuse;
        const target = new HeadlessTarget(200, 100);
        target.Content = cp as never;
        target.Flush();
        return {
            cp,
            present: (c: unknown) => { cp.Content = c; target.Flush(); return cp.visualChildren[0]; },
        };
    }

    test('off (default): re-presenting the same content rebuilds its view', () => {
        const { present } = mount(false);
        const a = new Doc();
        const b = new Doc();
        const v1 = present(a);
        present(b);
        const v2 = present(a);
        assert.notEqual(v2, v1, 'rebuilt, not reused');
        assert.equal(a.mounted, 2, 'OnViewMounted fired per presentation');
    });

    test('on: re-presenting the same content reuses its view and mounts once', () => {
        const { present } = mount(true);
        const a = new Doc();
        const b = new Doc();
        const v1 = present(a);
        present(b);
        const v2 = present(a);
        assert.equal(v2, v1, 'same view instance reused');
        assert.equal(a.mounted, 1, 'OnViewMounted fired once');
    });

    test('on: distinct content objects still get distinct views', () => {
        const { present } = mount(true);
        const va = present(new Doc());
        const vb = present(new Doc());
        assert.notEqual(va, vb);
    });
});
