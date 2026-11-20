import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { instantiate } from '../../compiler/compile.js';
import { DEFAULT_SYMBOLS } from '../../compiler/symbol-table.js';
import * as runtime from '../../runtime/index.js';
import * as controls from '../../basic/index.js';
import * as engine from '../../visual-engine/index.js';
import * as framework from '../index.js';
import { Application, MuralBase, MetaData, Observable, ServiceKey, Visual } from '../../runtime/index.js';
import { ContentPresenter, TextBlock } from '../../basic/index.js';
import { HeadlessTarget } from '../../visual-engine/index.js';
import { ContentControl } from '../index.js';
import { initTestApp } from '../../basic/tests/test-app.js';

// Regression: a ContentControl used as a .mu view's `x:root` rendered
// NOTHING. The root of a presentation has no logical parent, so it never
// went through AttachLogical — the only place an Element resolves its
// implicit / theme Style. ContentControl (a base class) gets its Template
// solely from that theme Style, so as a root it stayed un-templated: no
// ContentPresenter, the implicit DataTemplate's view (which DID resolve)
// had nowhere to slot, and the control measured to nothing. Wrapping it in
// a Border made it work because the ContentControl then had a parent.
// Mirrors pragmatic-ledger's sign-in.mu (`ContentControl x:root [Content =
// $service(Host).Page]`, the page's DataTemplate in the app resources).

class SignInPage extends Observable
{
}

class PageHost extends MuralBase
{
    public static readonly Key = new ServiceKey<PageHost>('PageHost');
    public static readonly PageKey = MuralBase.RegisterProperty<SignInPage | undefined>(
        PageHost, 'Page', undefined, MetaData.None);

    public constructor()
    {
        super();
        this.Page = new SignInPage();
    }

    public get Page(): SignInPage | undefined { return this.get_property_value(PageHost.PageKey); }
    public set Page(v: SignInPage | undefined) { this.set_property_value(PageHost.PageKey, v); }
}

const CTX: Record<string, unknown> = { ...runtime, ...controls, ...engine, ...framework, SignInPage, PageHost };
const SYMS = new Map([...DEFAULT_SYMBOLS, ['SignInPage', 'test'], ['PageHost', 'test']]);
const PAGE_TEXT = 'Sign in, please';

class RootProbe
{
    public static VisualParentOf(v: Visual | undefined): Visual | undefined
    {
        return (v as unknown as { visualParent: Visual | undefined } | undefined)?.visualParent;
    }

    public static FindText(v: Visual, text: string): TextBlock | undefined
    {
        if (v instanceof TextBlock && v.Text === text) return v;
        for (const c of (v as unknown as { visualChildren: readonly Visual[] }).visualChildren)
        {
            const hit = RootProbe.FindText(c, text);
            if (hit !== undefined) return hit;
        }
        return undefined;
    }

    public static Mount(app: Application): HeadlessTarget
    {
        const target = new HeadlessTarget(300, 200);
        app.initialize(target as never);
        target.Flush();
        return target;
    }

    public static AssertRendered(root: Visual): void
    {
        const tb = RootProbe.FindText(root, PAGE_TEXT);
        assert.ok(tb !== undefined, 'the implicit DataTemplate view is in the root\'s visual tree');
        assert.ok(RootProbe.VisualParentOf(tb) instanceof ContentPresenter,
            'the view is slotted into the ContentControl\'s ContentPresenter');
        assert.ok(tb.RenderSize.Width > 0 && tb.RenderSize.Height > 0, 'the view was laid out');
    }
}

describe('ContentControl as x:root — implicit DataTemplate renders', () =>
{
    beforeEach(() => { initTestApp(); });

    test('Content bound to a service page renders its implicit DataTemplate', () =>
    {
        const app = instantiate(`Application{
            .services: { PageHost }
            resources: {
                DataTemplate [DataType=SignInPage] { TextBlock [Text="${PAGE_TEXT}"] }
                ContentControl x:root [Content=$service(PageHost).Page] { }
            }
        }`, CTX, { symbols: SYMS }) as Application;
        const root = app.Resources.Root;
        assert.ok(root instanceof ContentControl);

        RootProbe.Mount(app);

        assert.ok(root.Template !== undefined, 'the root ContentControl got its theme Template');
        RootProbe.AssertRendered(root);
    });

    test('Content bound through the root\'s own DataContext renders', () =>
    {
        const app = instantiate(`Application{
            .services: { PageHost }
            resources: {
                DataTemplate [DataType=SignInPage] { TextBlock [Text="${PAGE_TEXT}"] }
                ContentControl x:root [DataContext=$service(PageHost), Content=$Page] { }
            }
        }`, CTX, { symbols: SYMS }) as Application;
        const root = app.Resources.Root as Visual;

        RootProbe.Mount(app);

        RootProbe.AssertRendered(root);
    });

    test('a code-built ContentControl set directly as a target Content is templated', () =>
    {
        const app = instantiate(`Application{
            resources: {
                DataTemplate [DataType=SignInPage] { TextBlock [Text="${PAGE_TEXT}"] }
            }
        }`, CTX, { symbols: SYMS }) as Application;
        app.initialize();
        const cc = new ContentControl();
        cc.Content = new SignInPage();
        const target = new HeadlessTarget(300, 200);
        target.Content = cc;
        target.Flush();
        RootProbe.AssertRendered(cc);
    });
});
