import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';

import { Application, RelayCommand, Size, Style, Setter, PropertyTrigger, TriggerUnset, Visual, Visibility, NoModifiers, PointerButton, type PointerEventInit } from '../../../runtime/index.js';
import { CornerRadius } from '../../../visual-engine/index.js';
import { ControlTemplate } from '../../../basic/templates/control-template.js';
import { ToolBar, ToolBarPanel } from '../tool-bar.js';
import { ToolBarButton, ToolBarSeparator, ToolBarPosition } from '../tool-bar-items.js';
import { ToolBarSplitButton } from '../tool-bar-split-button.js';
import { MenuItem } from '../../menu/menu-strip.js';
import { InputManager } from '../../index.js';
import { DataTemplate } from '../../../basic/templates/data-template.js';
import { Border } from '../../../basic/border.js';
import { HeadlessTarget } from '../../../visual-engine/index.js';

describe('ToolBar — items + overflow', () => {
    beforeEach(() => { initTestApp(); });

    test('ToolBar instantiates with an empty Items collection', () => {
        const tb = new ToolBar();
        const items = tb.Items;
        const count = items === undefined
            ? 0
            : Array.isArray(items) ? items.length : (items as { Count: number }).Count;
        assert.equal(count, 0);
    });

    test('HasOverflowItems defaults to false', () => {
        const tb = new ToolBar();
        assert.equal(tb.HasOverflowItems, false);
    });

    test('IsOverflowOpen toggles via DP', () => {
        const tb = new ToolBar();
        assert.equal(tb.IsOverflowOpen, false);
        tb.IsOverflowOpen = true;
        assert.equal(tb.IsOverflowOpen, true);
        tb.IsOverflowOpen = false;
        assert.equal(tb.IsOverflowOpen, false);
    });

    test('ToolBarButton.create populates Icon + Content + Command', () => {
        let executed = 0;
        const btn = ToolBarButton.create({
            icon: '💾',
            text: 'Save',
            showText: true,
            command: new RelayCommand(() => { executed++; }),
        });
        assert.ok(btn instanceof ToolBarButton);
        assert.ok(btn.Icon !== undefined);
        assert.ok(btn.Content !== undefined);
        assert.equal(btn.ShowText, true);
        // Command is wired but not invoked by create itself.
        assert.equal(executed, 0);
    });

    test('ToolBarButton flips Icon / Text / ShowText dynamically — Content re-stacks', () => {
        const btn = ToolBarButton.create({ icon: '💾', text: 'Save', showText: true });
        const stack0 = btn.Content;
        assert.ok(stack0 !== undefined);
        // Same stack instance is reused across rebuilds so the Icon
        // Visual's single-parent invariant holds.
        btn.ShowText = false;
        assert.equal(btn.Content, stack0, 'reused stack survives ShowText flip');
        btn.Text = 'Save As';
        assert.equal(btn.Content, stack0, 'reused stack survives Text flip');
        // Flipping Icon to undefined removes it from the stack; the
        // label still renders because showText would re-enable display
        // (toggle it on again for the next assertion).
        btn.ShowText = true;
        btn.Icon = undefined;
        assert.equal(btn.Content, stack0, 'reused stack survives Icon clear');
    });

    test('ToolBarSeparator measures to its Width + the available height', () => {
        const sep = new ToolBarSeparator();
        sep.Measure(new Size(100, 24));
        const ds = sep.DesiredSize;
        assert.equal(ds.Width, 9);
        assert.equal(ds.Height, 24);
    });
});

describe('ToolBarSplitButton — primary + dropdown', () => {
    beforeEach(() => { initTestApp(); });

    function pointer(overrides: Partial<PointerEventInit> = {}): PointerEventInit
    {
        return {
            HostX: 0, HostY: 0, Button: PointerButton.Primary, Buttons: 1,
            Modifiers: NoModifiers, PointerId: 0, Pressure: 0, PointerType: 'mouse',
            ...overrides,
        };
    }
    // Press-here-release-here on a plain Border half (the trigger halves are
    // Borders, not Buttons, so InjectPointerDown/Up drive wireClickable).
    function pressRelease(v: Visual): void
    {
        const im = new InputManager();
        im.InjectPointerDown(v, pointer());
        im.InjectPointerUp(v, pointer());
    }
    function findNamed(root: Visual, name: string): Visual | undefined
    {
        const stack: Visual[] = [root];
        while (stack.length > 0)
        {
            const cur = stack.pop()!;
            if ((cur as unknown as { Name?: string }).Name === name) return cur;
            for (const c of (cur as unknown as { visualChildren: Iterable<Visual> }).visualChildren) stack.push(c);
        }
        return undefined;
    }
    function findType<T extends Visual>(root: Visual, ctor: new (...a: never[]) => T): T | undefined
    {
        const stack: Visual[] = [root];
        while (stack.length > 0)
        {
            const cur = stack.pop()!;
            if (cur instanceof ctor) return cur;
            for (const c of (cur as unknown as { visualChildren: Iterable<Visual> }).visualChildren) stack.push(c);
        }
        return undefined;
    }

    test('split mode (with Command): materialises primary / arrow / content parts and hosts MenuItem children', () => {
        const sb = new ToolBarSplitButton();
        sb.Command = new RelayCommand(() => {});   // Command present → split chrome
        sb.Content = new Border();
        const mi = new MenuItem(); mi.Header = 'Align Left';
        sb.AddChild(mi);
        const target = new HeadlessTarget(600, 200, sb);
        target.Flush();

        assert.ok(findNamed(sb, 'PART_Primary') !== undefined, 'has a primary half');
        assert.ok(findNamed(sb, 'PART_Arrow') !== undefined, 'has an arrow half');
        assert.ok(findNamed(sb, 'PART_Content') !== undefined, 'has a primary content host');
        assert.equal(sb.IsOpen, false, 'closed by default');
    });

    // Optimization: a command bar can carry dozens of split buttons, each with
    // a dropdown of many items. Realizing every dropdown's containers up front
    // (hundreds of MenuItems that are never opened) dominated toolbar build /
    // document-switch cost. The dropdown items must be built LAZILY — not until
    // the popup is first opened.
    test('dropdown items are realized lazily — not until the popup first opens', () => {
        const sb = new ToolBarSplitButton();
        sb.Command = new RelayCommand(() => {});
        const mi = new MenuItem(); mi.Header = 'Align Left';
        sb.AddChild(mi);
        const target = new HeadlessTarget(600, 200, sb);
        target.Flush();

        const popupHost = (sb as unknown as { _popupHost: Visual })._popupHost;
        assert.equal(findType(popupHost, MenuItem), undefined,
            'the MenuItem is NOT realized while the dropdown has never been opened');

        // First open builds the deferred containers.
        sb.IsOpen = true;
        target.Flush();
        assert.ok(findType(popupHost, MenuItem) !== undefined,
            'opening the dropdown realizes the deferred MenuItem');

        // And it stays realized across a close/re-open (no re-defer).
        sb.IsOpen = false;
        sb.IsOpen = true;
        target.Flush();
        assert.ok(findType(popupHost, MenuItem) !== undefined,
            'the MenuItem remains realized after a close/re-open');
    });

    test('primary half runs Command; arrow half toggles IsOpen', () => {
        const sb = new ToolBarSplitButton();
        let fired = 0;
        sb.Command = new RelayCommand(() => { fired++; });
        const target = new HeadlessTarget(600, 200, sb);
        target.Flush();

        pressRelease(findNamed(sb, 'PART_Primary')!);
        assert.equal(fired, 1, 'primary click ran the command');

        pressRelease(findNamed(sb, 'PART_Arrow')!);
        assert.equal(sb.IsOpen, true, 'arrow opened the dropdown');
    });

    // With no Command the split button is a single-chrome dropdown: one hit
    // region (PART_Primary, no PART_Arrow), and a click anywhere on it opens
    // the popup.
    test('no Command: single-chrome dropdown — one hit region opens the popup', () => {
        const sb = new ToolBarSplitButton();               // Command left unset
        const target = new HeadlessTarget(600, 200, sb);
        target.Flush();

        assert.ok(findNamed(sb, 'PART_Primary') !== undefined, 'has the single chrome');
        assert.ok(findNamed(sb, 'PART_Content') !== undefined, 'has a content host');
        assert.equal(findNamed(sb, 'PART_Arrow'), undefined, 'no separate arrow half in dropdown mode');
        assert.equal(sb.IsOpen, false, 'closed by default');
        pressRelease(findNamed(sb, 'PART_Primary')!);
        assert.equal(sb.IsOpen, true, 'clicking the single chrome opened the dropdown');
    });

    // Assigning a Command later flips the chrome from dropdown to split.
    test('setting Command flips single-chrome dropdown → split (arrow appears)', () => {
        const sb = new ToolBarSplitButton();
        const target = new HeadlessTarget(600, 200, sb);
        target.Flush();
        assert.equal(findNamed(sb, 'PART_Arrow'), undefined, 'dropdown chrome to start');

        sb.Command = new RelayCommand(() => {});
        target.Flush();
        assert.ok(findNamed(sb, 'PART_Arrow') !== undefined, 're-adopted the split chrome with an arrow');
    });

    // An explicit keyed Style on a no-command split button does NOT wholesale
    // replace the theme style: Seal() splices the theme in as the style's
    // implicit BasedOn base (so Template / ItemsPanel resolve). The catch is
    // that the theme's `when (Command is unset)` trigger is inherited too, and
    // — since Trigger outranks a plain Style/Local setter — it would pin
    // TriggerTemplate back to the theme's default dropdown chrome. The fix a
    // consumer needs (and the Plexus tab ⋯ button uses) is to RE-DECLARE that
    // trigger: own triggers resolve after BasedOn ones, so the last
    // Trigger-tier setter — the consumer's — wins. This also proves the
    // consumer need NOT re-supply Template / ItemsPanel (inherited from the
    // spliced base), which keeps the override minimal.
    test('explicit Style re-declaring the no-command trigger adopts its custom chrome', () => {
        const custom = new ControlTemplate((_tp) => {
            const primary = new Border();
            (primary as unknown as { Name: string }).Name = 'PART_Primary';
            return primary;
        });
        // Minimal style: no Template / ItemsPanel setters — only the trigger.
        const style = new Style(ToolBarSplitButton, [], undefined, [
            new PropertyTrigger(ToolBarSplitButton, 'Command', TriggerUnset, [
                new Setter(ToolBarSplitButton, 'TriggerTemplate', custom),
            ]),
        ]);
        const sb = new ToolBarSplitButton();   // no Command
        sb.Style = style;
        const target = new HeadlessTarget(600, 200, sb);
        target.Flush();

        assert.equal(sb.TriggerTemplate, custom, 'the re-declared trigger wins over the inherited theme trigger');
        // Template inherited from the spliced theme base → the popup still built.
        assert.ok((sb as unknown as { _popupHost?: unknown })._popupHost !== undefined,
            'popup Template inherited from the BasedOn theme base');
    });

    // Regression: the chrome swap must survive Content being set BEFORE the
    // Command resolves (the real order for a `$bound` Command that resolves
    // via DataContext after construction). The re-adopt must unparent Content
    // from the old dropdown host first — otherwise slotContent throws
    // "already has a visual parent" mid-swap and leaves a broken chrome.
    test('re-adopt survives Content-set-before-Command (no double-parent throw)', () => {
        const sb = new ToolBarSplitButton();
        const label = new Border();
        sb.Content = label;                    // Content first → hosted by dropdown chrome
        const target = new HeadlessTarget(600, 60, sb);
        target.Flush();
        assert.equal(findNamed(sb, 'PART_Arrow'), undefined, 'dropdown to start');

        assert.doesNotThrow(() => {
            sb.Command = new RelayCommand(() => {});   // flips to split → re-adopt
            target.Flush();
        }, 're-adopt must not throw when Content precedes the Command');

        const arrow = findNamed(sb, 'PART_Arrow');
        const content = findNamed(sb, 'PART_Content');
        assert.ok(arrow !== undefined, 'split chrome materialised its arrow');
        // Both halves span the full chrome height (no dead region).
        assert.equal(arrow!.ArrangedRect.Height, findNamed(sb, 'PART_Primary')!.ArrangedRect.Height,
            'arrow and primary are the same (full) height');
        // Content survived the swap, re-hosted in the split chrome.
        assert.ok(content !== undefined
            && [...(content as unknown as { visualChildren: Iterable<Visual> }).visualChildren].includes(label),
            'the Content label is re-parented into the split chrome');
    });

    // Gallery contract: the icon-grid variant hosts Buttons (not MenuItems)
    // in the popup. Clicking a Button runs its Command AND closes the popup —
    // the Gallery base wires close-on-activation for Button children via Click,
    // the same way it wires MenuItem children via _onActivated.
    test('icon-grid variant: a ToolBarButton child runs its Command and closes the popup', () => {
        const sb = new ToolBarSplitButton();
        let ran = 0;
        const btn = new ToolBarButton();
        btn.Command = new RelayCommand(() => { ran++; });
        sb.AddChild(btn);
        const target = new HeadlessTarget(600, 200, sb);
        target.Flush();

        // Open the popup so its ItemsPresenter generates the Button container.
        sb.IsOpen = true;
        target.Flush();

        // The popup is re-parented onto the overlay, so walk it from the
        // split button's own popup host rather than from sb's inline subtree.
        const popupHost = (sb as unknown as { _popupHost: Visual })._popupHost;
        const hosted = findType(popupHost, ToolBarButton);
        assert.ok(hosted !== undefined, 'the popup generated a ToolBarButton container');

        pressRelease(hosted!);
        assert.equal(ran, 1, 'the gallery button ran its command');
        assert.equal(sb.IsOpen, false, 'activating a gallery button closed the popup');
    });

    // Regression: a selection-gated (disabled-command) gallery button must
    // still dismiss the popup. Button.fireClick bails on !CanExecute, so an
    // AddClickHandler close would never fire — the popup would stick open.
    // Gallery closes such buttons on PointerUp instead.
    test('icon-grid variant: a disabled-command button still closes the popup', () => {
        const sb = new ToolBarSplitButton();
        let ran = 0;
        const btn = new ToolBarButton();
        btn.Command = new RelayCommand(() => { ran++; }, () => false); // never executable
        sb.AddChild(btn);
        const target = new HeadlessTarget(600, 200, sb);
        target.Flush();

        sb.IsOpen = true;
        target.Flush();

        const popupHost = (sb as unknown as { _popupHost: Visual })._popupHost;
        const hosted = findType(popupHost, ToolBarButton)!;
        pressRelease(hosted);
        assert.equal(ran, 0, 'the disabled command did not run');
        assert.equal(sb.IsOpen, false, 'the popup still closed despite the disabled command');
    });
});

describe('ToolBar — split-button group chrome', () => {
    beforeEach(() => { initTestApp(); });

    function collect(root: Visual, name: string): Visual[]
    {
        const out: Visual[] = [];
        const walk = (v: Visual): void => {
            if (v.constructor.name === name) out.push(v);
            for (const k of (v as unknown as { visualChildren: Iterable<Visual> }).visualChildren) walk(k);
        };
        walk(root);
        return out;
    }
    function findNamed(root: Visual, target: string): Visual | undefined
    {
        const stack: Visual[] = [root];
        while (stack.length > 0)
        {
            const cur = stack.pop()!;
            if ((cur as unknown as { Name?: string }).Name === target) return cur;
            for (const c of (cur as unknown as { visualChildren: Iterable<Visual> }).visualChildren) stack.push(c);
        }
        return undefined;
    }
    function radiusOf(button: Visual): CornerRadius | number
    {
        const border = findNamed(button, 'PART_Border')!;
        return (border as unknown as { CornerRadius: CornerRadius | number }).CornerRadius;
    }
    function dividerVisible(button: Visual): boolean
    {
        const divider = findNamed(button, 'PART_Divider')!;
        return (divider as unknown as { Visibility: Visibility }).Visibility === Visibility.Visible;
    }

    function threeButtonBar(): ToolBar
    {
        const tb = new ToolBar();
        tb.ItemTemplate = new DataTemplate(() => {
            const btn = new ToolBarButton();
            const icon = new Border();
            icon.Width = 20; icon.Height = 20;
            btn.Content = icon;
            return btn;
        });
        tb.ItemsSource = [{ id: 1 }, { id: 2 }, { id: 3 }];
        return tb;
    }

    // The connected group reads like a split button: interior seams carry the
    // 1dp PART_Divider hairline, and it is collapsed on the group's first
    // button (the group's own left edge is the boundary there).
    test('interior boundaries show the divider; the first button does not', () => {
        const tb = threeButtonBar();
        const target = new HeadlessTarget(600, 80, tb);
        target.Flush();

        const buttons = collect(tb, 'ToolBarButton');
        assert.equal(buttons.length, 3);
        assert.equal(dividerVisible(buttons[0]!), false, 'first button: no leading divider');
        assert.equal(dividerVisible(buttons[1]!), true,  'middle button: divider cues the seam');
        assert.equal(dividerVisible(buttons[2]!), true,  'last button: divider cues the seam');
    });

    // Regression: the divider must actually PAINT, not just be Visible. Its
    // Stroke has to be a Pen (thickness 1) — authoring it as the `(brush, 1)`
    // tuple silently makes a Thickness, so the vertical Line measures to 0 width
    // and the "separator" never shows despite Visibility=Visible.
    test('the shown divider has a real (non-zero) painted width', () => {
        const tb = threeButtonBar();
        const target = new HeadlessTarget(600, 80, tb);
        target.Flush();

        const last = collect(tb, 'ToolBarButton')[2]!;
        const divider = findNamed(last, 'PART_Divider')!;
        const w = (divider as unknown as { ArrangedRect: { Width: number; Height: number } }).ArrangedRect;
        assert.ok(w.Width >= 1, `divider paints with width >= 1 (got ${w.Width})`);
        assert.ok(w.Height > 0, `divider stretches to the button height (got ${w.Height})`);
    });

    // Group-end rounding is the split button's @ShapeSmall (8dp) capsule, NOT
    // the former full-pill (CornerRadius.Full, infinite radius). First rounds
    // its outer-left corners only, Last its outer-right only, interior square.
    test('group ends round to @ShapeSmall (8dp), not the full pill', () => {
        const tb = threeButtonBar();
        const target = new HeadlessTarget(600, 80, tb);
        target.Flush();

        const buttons = collect(tb, 'ToolBarButton');
        const first = radiusOf(buttons[0]!) as CornerRadius;
        const middle = radiusOf(buttons[1]!);
        const last = radiusOf(buttons[2]!) as CornerRadius;

        assert.equal(first.TopLeft, 8,     'first: outer-left rounded to @ShapeSmall');
        assert.equal(first.BottomLeft, 8,  'first: outer-left rounded to @ShapeSmall');
        assert.equal(first.TopRight, 0,    'first: inner-right square (flush with next)');
        assert.equal(Number.isFinite(first.TopLeft), true, 'no longer the infinite full-pill radius');

        // Interior button: uniform 0 (a plain number, square all round).
        assert.equal(middle, 0, 'middle button is square');

        assert.equal(last.TopRight, 8,     'last: outer-right rounded to @ShapeSmall');
        assert.equal(last.BottomRight, 8,  'last: outer-right rounded to @ShapeSmall');
        assert.equal(last.TopLeft, 0,      'last: inner-left square (flush with previous)');
    });

    // A lone button in its own ToolBar is Position=Only → all four corners
    // @ShapeSmall, no divider (nothing precedes it).
    test('a solo button rounds all four corners and shows no divider', () => {
        const tb = new ToolBar();
        tb.ItemTemplate = new DataTemplate(() => {
            const btn = new ToolBarButton();
            const icon = new Border();
            icon.Width = 20; icon.Height = 20;
            btn.Content = icon;
            return btn;
        });
        tb.ItemsSource = [{ id: 1 }];
        const target = new HeadlessTarget(600, 80, tb);
        target.Flush();

        const button = collect(tb, 'ToolBarButton')[0]!;
        assert.equal(button.constructor.name, 'ToolBarButton');
        assert.equal(radiusOf(button), 8, 'solo button: uniform @ShapeSmall on every corner');
        assert.equal(dividerVisible(button), false, 'solo button: no leading divider');
    });

    // Regression: with nothing overflowing, the overflow chevron must be
    // Collapsed — NOT merely zero-width. The chevron chrome doesn't clip its
    // content, so a zero-width-but-Visible chevron painted its 16dp `⋯` glyph
    // outside the empty button (the stray three-dots artifact at each toolbar
    // edge). Collapsed reserves no space and paints nothing.
    test('the overflow chevron is Collapsed when nothing overflows', () => {
        const tb = threeButtonBar();
        const target = new HeadlessTarget(600, 80, tb);
        target.Flush();

        assert.equal(tb.HasOverflowItems, false, 'wide bar: no overflow');
        const chevron = findNamed(tb, 'PART_Chevron')!;
        assert.equal(
            (chevron as unknown as { Visibility: Visibility }).Visibility,
            Visibility.Collapsed,
            'no-overflow chevron is Collapsed so its glyph never paints');
    });

    // The complement: once items overflow, the chevron returns to Visible so the
    // popup affordance is reachable.
    test('the overflow chevron is Visible once items overflow', () => {
        const tb = threeButtonBar();
        // Narrow budget → the three buttons cannot all fit → overflow.
        const target = new HeadlessTarget(48, 80, tb);
        target.Flush();

        assert.equal(tb.HasOverflowItems, true, 'narrow bar: items overflow');
        const chevron = findNamed(tb, 'PART_Chevron')!;
        assert.equal(
            (chevron as unknown as { Visibility: Visibility }).Visibility,
            Visibility.Visible,
            'overflowing chevron is Visible so the popup is reachable');
    });
});

describe('ToolBarPanel — overflow math', () => {
    test('LastFittingIndex = -1 with no children', () => {
        const p = new ToolBarPanel();
        p.Measure(new Size(100, 24));
        // No children, no fit/no overflow — index defaults to -1 (no items).
        assert.equal(p.LastFittingIndex, -1);
    });

    test('All items fit within budget — LastFittingIndex = count - 1', () => {
        // Three 30-wide children inside a 200-wide budget → all fit.
        const p = new ToolBarPanel();
        for (let i = 0; i < 3; i++)
        {
            const sep = new ToolBarSeparator();
            sep.Width = 30;
            p.AddChild(sep);
        }
        p.Measure(new Size(200, 24));
        assert.equal(p.LastFittingIndex, 2);
    });

    test('Tight budget — last items overflow', () => {
        // Five 30-wide children in 100-wide budget → only 3 fit
        // (3*30 = 90 ≤ 100; adding the 4th would be 120 > 100).
        const p = new ToolBarPanel();
        for (let i = 0; i < 5; i++)
        {
            const sep = new ToolBarSeparator();
            sep.Width = 30;
            p.AddChild(sep);
        }
        p.Measure(new Size(100, 24));
        assert.equal(p.LastFittingIndex, 2);
    });
});

describe('ToolBar — data-driven (ItemsSource + ItemTemplate)', () => {
    beforeEach(() => { initTestApp(); });

    function collect(root: Visual, name: string): Visual[]
    {
        const out: Visual[] = [];
        const walk = (v: Visual): void => {
            if (v.constructor.name === name) out.push(v);
            for (const k of (v as unknown as { visualChildren: Iterable<Visual> }).visualChildren) walk(k);
        };
        walk(root);
        return out;
    }

    // Regression: with ItemsSource bound, ItemsControl.Items is a
    // CollectionView (Count + Get), NOT an ObservableCollection. The panel
    // used to gate item access on `instanceof ObservableCollection`, so a
    // CollectionView was read as an array (.length = undefined), the
    // overflow math counted 0 items, and the whole strip collapsed to its
    // padding width — every data-driven ToolBarButton arranged at 0×0.
    test('data items get real widths — the strip does not collapse to 0', () => {
        const tb = new ToolBar();
        tb.ItemTemplate = new DataTemplate(() => {
            const btn = new ToolBarButton();
            const icon = new Border();
            icon.Width = 20;
            icon.Height = 20;
            btn.Content = icon;
            return btn;
        });
        tb.ItemsSource = [{ id: 1 }, { id: 2 }, { id: 3 }];

        const target = new HeadlessTarget(600, 80, tb);
        target.Flush();

        const panels  = collect(tb, 'ToolBarPanel');
        const buttons = collect(tb, 'ToolBarButton') as ToolBarButton[];
        assert.equal(buttons.length, 3, 'three data items generated three ToolBarButtons');
        assert.ok(panels[0]!.ArrangedRect.Width > 0,
            `ToolBarPanel kept a real width (got ${panels[0]!.ArrangedRect.Width})`);
        assert.ok(buttons.every(b => b.ArrangedRect.Width > 0),
            'every data-driven button arranged with a real width, not 0×0');
    });

    // Regression: connected-bar corner rounding. The ToolBar rewrites each
    // inline button's Position DP (First/Middle/Last/Only) so the strip
    // reads as one pill-shaped group. For data-driven items the buttons
    // are nested in generated containers, so the Position scan has to
    // unwrap them — otherwise every button stays Position=None (square
    // corners), visibly different from a declaratively-authored ToolBar.
    test('data-driven buttons still get connected-bar Positions', () => {
        const tb = new ToolBar();
        tb.ItemTemplate = new DataTemplate(() => {
            const btn = new ToolBarButton();
            const icon = new Border();
            icon.Width = 20; icon.Height = 20;
            btn.Content = icon;
            return btn;
        });
        tb.ItemsSource = [{ id: 1 }, { id: 2 }, { id: 3 }];
        const target = new HeadlessTarget(600, 80, tb);
        target.Flush();

        const buttons = collect(tb, 'ToolBarButton') as ToolBarButton[];
        assert.equal(buttons.length, 3);
        // First / Middle / Last across the three-button group.
        assert.equal(buttons[0]!.Position, ToolBarPosition.First,  'first button rounds its left');
        assert.equal(buttons[1]!.Position, ToolBarPosition.Middle, 'interior button is square');
        assert.equal(buttons[2]!.Position, ToolBarPosition.Last,   'last button rounds its right');
    });
});
