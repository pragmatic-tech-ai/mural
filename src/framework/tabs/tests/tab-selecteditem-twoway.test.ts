import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    MuralBase, MetaData, PointerButton, NoModifiers,
    DataContextBinding, ObservableCollection,
    type PointerEventInit,
} from '../../../runtime/index.js';
import { HeadlessTarget, SvgDrawingContext } from '../../../visual-engine/index.js';
import { InputManager } from '../../index.js';
import { TabControl, TabItem } from '../tabs.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { TextBlock } from '../../../basic/text-block.js';
import { initTestApp } from '../../../basic/tests/test-app.js';

// Regression: clicking a tab must WRITE BACK through a TwoWay
// `SelectedItem=$ActiveDocument` binding to the bound source. tab-click-select
// proves the DP itself moves; this proves the DataContext source moves too —
// the exact Plexus shape (shell tab strip's SelectedItem TwoWay-bound to
// DocumentsContentHostService.ActiveDocument). If the write-back is missing,
// the highlight moves but the content region (driven by ActiveDocument) never
// switches — the reported symptom.

class Doc extends MuralBase
{
    public static readonly TitleKey = MuralBase.RegisterProperty<string>(Doc, 'Title', '', MetaData.None);
    public get Title(): string { return this.get_property_value(Doc.TitleKey); }
    public set Title(v: string) { this.set_property_value(Doc.TitleKey, v); }
}

// Stand-in for DocumentsContentHostService: holds the ActiveDocument the tab
// strip's SelectedItem is TwoWay-bound to.
class Shell extends MuralBase
{
    public static readonly ActiveDocumentKey = MuralBase.RegisterProperty<Doc | undefined>(
        Shell, 'ActiveDocument', undefined, MetaData.None);
    // A stable open-document collection the tab strip binds ItemsSource to
    // (mirrors DocumentsContentHostService.OpenDocuments — the reference never
    // changes; only its contents mutate on Open/Close).
    public static readonly OpenDocsKey = MuralBase.RegisterProperty<ObservableCollection<Doc>>(
        Shell, 'OpenDocs', undefined as unknown as ObservableCollection<Doc>, MetaData.None);
    constructor() { super(); this.set_property_value(Shell.OpenDocsKey, new ObservableCollection<Doc>()); }
    public get ActiveDocument(): Doc | undefined { return this.get_property_value(Shell.ActiveDocumentKey); }
    public set ActiveDocument(v: Doc | undefined) { this.set_property_value(Shell.ActiveDocumentKey, v); }
    public get OpenDocs(): ObservableCollection<Doc> { return this.get_property_value(Shell.OpenDocsKey); }
}

function pointer(o: Partial<PointerEventInit> = {}): PointerEventInit
{
    return {
        HostX: 0, HostY: 0, Button: PointerButton.Primary, Buttons: 1,
        Modifiers: NoModifiers, PointerId: 0, Pressure: 0, PointerType: 'mouse', ...o,
    };
}

function click(im: InputManager, container: TabItem): void
{
    im.InjectPointerMove(container, pointer());
    im.InjectPointerDown(container, pointer());
    im.InjectPointerUp(container, pointer());
}

describe('TabItem — click writes back through a TwoWay SelectedItem binding', () => {
    beforeEach(() => { initTestApp(); });

    test('clicking a tab updates the DataContext-bound ActiveDocument', () => {
        const shell = new Shell();
        const a = new Doc(); a.Title = 'A';
        const b = new Doc(); b.Title = 'B';
        shell.ActiveDocument = a;

        const tc = new TabControl();
        tc.ItemTemplate = new DataTemplate((d) => new TextBlock((d as Doc).Title), Doc);
        tc.ItemsSource = [a, b];
        // The shell tab strip's exact binding: SelectedItem=$ActiveDocument.
        // SelectedItem BindsTwoWayByDefault, so this is a TwoWay binding.
        tc.set_property_value(TabControl.SelectedItemKey, DataContextBinding(tc, 'ActiveDocument'));
        tc.DataContext = shell;

        const target = new HeadlessTarget(600, 400);
        target.Content = tc;
        target.Flush();

        // Source → target flowed on activation.
        assert.equal(tc.SelectedItem, a, 'binding seeds SelectedItem from ActiveDocument');

        const containerB = tc.logicalChildren[1] as TabItem;
        click(new InputManager(), containerB);

        // The write-back: target → source.
        assert.equal(tc.SelectedItem, b, 'clicking tab B moves SelectedItem');
        assert.equal(shell.ActiveDocument, b, 'clicking tab B writes back to the bound ActiveDocument');
    });

    test('opening a document (adding to a BOUND collection) does not blip ActiveDocument to undefined', () => {
        const shell = new Shell();
        const a = new Doc(); a.Title = 'A';
        const b = new Doc(); b.Title = 'B';
        shell.OpenDocs.Add(a);
        shell.ActiveDocument = a;

        const tc = new TabControl();
        tc.ItemTemplate = new DataTemplate((d) => new TextBlock((d as Doc).Title), Doc);
        // The exact Plexus shape: BOTH ItemsSource and SelectedItem are bound,
        // the source being a stable ObservableCollection the shell mutates on Open.
        tc.set_property_value(TabControl.ItemsSourceKey, DataContextBinding(tc, 'OpenDocs'));
        tc.set_property_value(TabControl.SelectedItemKey, DataContextBinding(tc, 'ActiveDocument'));
        tc.DataContext = shell;

        const target = new HeadlessTarget(600, 400);
        target.Content = tc;
        target.Flush();
        assert.equal(tc.SelectedItem, a, 'seeded from ActiveDocument');

        // Record every value the bound ActiveDocument takes on from here.
        const seen: (Doc | undefined)[] = [];
        shell.PropertyChanged(Shell.ActiveDocumentKey).subscribe(() => seen.push(shell.ActiveDocument));

        // Mimic host.Open(b): add to the bound collection, then activate it. The
        // Add re-pushes the SAME collection instance through the ItemsSource
        // binding — which must NOT full-rebuild the tab strip and transiently
        // clear the selection (the ActiveDocument=undefined blip that made the
        // toolbar/content thrash on every open).
        shell.OpenDocs.Add(b);
        shell.ActiveDocument = b;
        target.Flush();

        assert.ok(!seen.includes(undefined),
            `ActiveDocument must never blip to undefined during Open (saw: ${seen.map(d => d?.Title ?? '<none>').join(', ')})`);
        assert.equal(shell.ActiveDocument, b, 'active document ends on the newly-opened B');
        assert.equal(tc.logicalChildren.length, 2, 'both tabs realized via incremental insert');
    });

    test('clicking a tab swaps the rendered content slot (SelectedContent)', () => {
        const app = initTestApp();
        // The content slot (PART_ContentSlot) presents SelectedContent — the
        // selected data row — dispatched through its DataType template. Register
        // one that renders a distinct body marker per document (mirrors Plexus'
        // DataTemplate[DiagramDocument] → canvas).
        app.Resources.Set(Doc, new DataTemplate(
            (d) => new TextBlock('BODY:' + (d as Doc).Title), Doc));

        const a = new Doc(); a.Title = 'A';
        const b = new Doc(); b.Title = 'B';

        const tc = new TabControl();
        tc.ItemTemplate = new DataTemplate((d) => new TextBlock((d as Doc).Title), Doc);
        tc.ItemsSource = [a, b];

        const target = new HeadlessTarget(600, 400);
        target.Content = tc;
        target.Flush();
        tc.SelectedItem = a;
        target.Flush();

        const svgA = svgOf(target);
        assert.ok(svgA.includes('BODY:A'), 'content slot renders the selected doc body');

        const containerB = tc.logicalChildren[1] as TabItem;
        click(new InputManager(), containerB);
        target.Flush();

        const svgB = svgOf(target);
        assert.ok(svgB.includes('BODY:B'), 'clicking tab B swaps the content slot to B');
        assert.ok(!svgB.includes('BODY:A'), 'the previous body is gone');
    });
});

function svgOf(t: HeadlessTarget): string
{
    const dc = new SvgDrawingContext();
    t.Render(dc);
    return dc.ToSvg(600, 400);
}
