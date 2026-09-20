import {
    DoubleAnimation,
    MetaData,
    MuralBase,
    ObservableCollection,
    Panel,
    Point,
    Rect,
    Size,
    Storyboard,
    Thickness,
    Element, Visual,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import type { PresentationTarget } from '../../visual-engine/index.js';
import { RotateTransform } from '../../visual-engine/index.js';
import { ClickAwayScrim } from '../../basic/click-away-scrim.js';
import { StackPanel } from '../../basic/panels/stack-panel.js';
import { Orientation } from '../../basic/panels/orientation.js';
import { TextBlock } from '../../basic/text-block.js';
import { FloatingActionButton } from './fab.js';

// M3 FAB Menu — a primary FAB that, on press, reveals a vertical stack
// of secondary action surfaces (typically mini-FABs) above itself. Tap
// the FAB again (or click anywhere outside) to dismiss.
//
// FabMenu extends FloatingActionButton — chrome, click protocol,
// ICommandSource wiring all inherit. The Click override toggles IsOpen
// rather than firing a Command (a normal FAB's primary contract); the
// `OnClick`-Command path is replaced by IsOpen because the FAB-menu
// pattern conventionally has no "primary action" — the FAB exists
// only to reveal the items. Set `MenuMode = false` (TODO) when M3
// later defines a hybrid that needs both.
//
// Motion: per M3 2024 spec, opening the menu staggers the appearance
// of each item with a small offset (DurationMs / Items.Count over the
// open animation). v1 implementation:
//   * Each item animates Opacity 0 → 1 with BeginTime = i · StaggerMs.
//   * Each item animates Margin (top inset) from +HiddenOffset to 0,
//     producing a slide-up reveal.
//   * Item BeginTime ordering: bottom item first so the menu "grows"
//     toward the FAB top.
//   * Closing reverses: each item fades 1 → 0 with the same stagger
//     but counted from the top so the menu collapses toward the FAB.
//
// Icon rotation (M3 spec: FAB icon flips 45° on open). The owned
// TextBlock holding the glyph carries a RotateTransform as its
// RenderTransform, pivoted at the icon center via
// RenderTransformOrigin = (0.5, 0.5). On IsOpen flip, a Storyboard
// tweens the transform's Angle 0 ↔ 45° over RotationDurationMs. The
// glyph also swaps from ClosedIcon → OpenIcon at the END of the
// animation so the rest state always reads as the correct character
// (a default "+" rotates to look like "×" mid-animation regardless,
// since both are rotationally symmetric — consumers that pass a
// non-symmetric pair like "menu" / "close" get a quick swap at
// completion).
export class FabMenu extends FloatingActionButton
{
    public static readonly ItemsKey       = MuralBase.RegisterProperty<ObservableCollection<Visual> | undefined>(
        FabMenu, 'Items', undefined, MetaData.None);
    public static readonly IsOpenKey      = MuralBase.RegisterProperty<boolean>(FabMenu, 'IsOpen',      false, MetaData.None);
    public static readonly StaggerMsKey   = MuralBase.RegisterProperty<number>( FabMenu, 'StaggerMs',   50,    MetaData.None);
    public static readonly DurationMsKey  = MuralBase.RegisterProperty<number>( FabMenu, 'DurationMs',  200,   MetaData.None);
    public static readonly HiddenOffsetKey= MuralBase.RegisterProperty<number>( FabMenu, 'HiddenOffset', 12,   MetaData.None);
    public static readonly ClosedIconKey  = MuralBase.RegisterProperty<string>( FabMenu, 'ClosedIcon',  '+',   MetaData.None);
    public static readonly OpenIconKey    = MuralBase.RegisterProperty<string>( FabMenu, 'OpenIcon',    '×',   MetaData.None);
    // Duration of the icon rotation tween (0 → 45° on open, back on
    // close). 150 ms matches M3 motion-emphasized-short — short enough
    // to feel snappy, long enough to read as a deliberate flip.
    public static readonly RotationDurationMsKey = MuralBase.RegisterProperty<number>(
        FabMenu, 'RotationDurationMs', 150, MetaData.None);

    public get Items():       ObservableCollection<Visual> | undefined { return this.get_property_value(FabMenu.ItemsKey); }
    public set Items(v:       ObservableCollection<Visual> | undefined) { this.set_property_value(FabMenu.ItemsKey, v); }

    public get IsOpen():      boolean { return this.get_property_value(FabMenu.IsOpenKey); }
    public set IsOpen(v:      boolean) { this.set_property_value(FabMenu.IsOpenKey, v); }

    public get StaggerMs():   number { return this.get_property_value(FabMenu.StaggerMsKey); }
    public set StaggerMs(v:   number) { this.set_property_value(FabMenu.StaggerMsKey, v); }

    public get DurationMs():  number { return this.get_property_value(FabMenu.DurationMsKey); }
    public set DurationMs(v:  number) { this.set_property_value(FabMenu.DurationMsKey, v); }

    public get HiddenOffset():number { return this.get_property_value(FabMenu.HiddenOffsetKey); }
    public set HiddenOffset(v:number) { this.set_property_value(FabMenu.HiddenOffsetKey, v); }

    public get ClosedIcon():  string { return this.get_property_value(FabMenu.ClosedIconKey); }
    public set ClosedIcon(v:  string) { this.set_property_value(FabMenu.ClosedIconKey, v); }

    public get OpenIcon():    string { return this.get_property_value(FabMenu.OpenIconKey); }
    public set OpenIcon(v:    string) { this.set_property_value(FabMenu.OpenIconKey, v); }

    public get RotationDurationMs(): number { return this.get_property_value(FabMenu.RotationDurationMsKey); }
    public set RotationDurationMs(v: number) { this.set_property_value(FabMenu.RotationDurationMsKey, v); }

    private _menuHost:    StackPanel | undefined;
    private _scrim:       ClickAwayScrim | undefined;
    // Single overlay child: a positioning host that fills the surface,
    // arranges the scrim edge-to-edge, and places the item stack ABOVE
    // the FAB. The OverlayLayer arranges every overlay child at the full
    // surface slot, so a bare StackPanel attached directly would stack
    // its items from (0,0) — see FabMenuHost.
    private _host:        FabMenuHost | undefined;
    private _mounted = false;
    private _openStoryboard:  Storyboard | undefined;
    // The in-flight close Storyboard. Its completion drives the chrome
    // detach; tracked so a rapid close→open→close only lets the LATEST
    // close tear down (a stale close's completion is ignored).
    private _closeStoryboard: Storyboard | undefined;
    // Persistent TextBlock holding the FAB icon glyph + its
    // RotateTransform. Held across IsOpen toggles so the rotation
    // storyboard targets a stable instance (recreating it every flip
    // would race the tween with a fresh transform). Undefined until
    // first refreshContentIcon, or when a consumer overrode Content
    // with their own non-string Visual.
    private _iconHost:    TextBlock  | undefined;
    private _iconRotate:  RotateTransform | undefined;
    private _rotationStoryboard: Storyboard | undefined;

    static
    {
        MuralBase.OverrideMetadata(FabMenu, Element.DefaultStyleKeyKey,
            { default_value: FabMenu });
    }

    constructor()
    {
        super();
        // Click toggles IsOpen instead of firing a Command. Inherits the
        // Button click protocol — Click isn't a routed event (it's a
        // post-press-edge synthesis on Button), so register via the
        // Button-specific AddClickHandler.
        this.AddClickHandler(() => {
            this.IsOpen = !this.IsOpen;
        });
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Owner !== FabMenu) return;
        if (descriptor.Name === 'IsOpen')
        {
            // Icon rotation runs unconditionally on every IsOpen flip
            // so the FAB gives visual feedback even when Items is empty
            // (the popup-mount branch is what gates on Items / target).
            this.refreshContentIcon();
            this.animateIconRotation(newValue === true);
            if (newValue === true) this.openMenu();
            else                    this.closeMenu();
        }
    }

    private openMenu(): void
    {
        if (this._mounted) return;
        const t     = targetOf(this);
        const items = this.Items;
        if (t === undefined || items === undefined || items.Count === 0) return;

        // Scrim: a hit-testable transparent absorber that catches any
        // click OUTSIDE the menu → clears IsOpen. A plain Border doesn't
        // reliably absorb a click over its transparent area (and so the
        // menu could never be dismissed — the "stays forever" symptom);
        // ClickAwayScrim is the shared popup dismissal surface used by
        // ComboBox / ContextMenu / pickers.
        this._scrim = new ClickAwayScrim();
        this._scrim.onClick = (): void => { this.IsOpen = false; };

        // Menu host: vertical StackPanel of the consumer's items. The
        // items start hidden (Opacity=0, Margin pushed below); the reveal
        // Storyboard animates them in.
        this._menuHost = new StackPanel();
        this._menuHost.Orientation = Orientation.Vertical;
        const hiddenOffset = this.HiddenOffset;
        for (let i = 0; i < items.Count; i++)
        {
            const v = items.Get(i);
            if (v === undefined) continue;
            v.Opacity = 0;
            v.Margin  = new Thickness(0, hiddenOffset, 0, 0);
            this._menuHost.AddChild(v);
        }

        // Positioning host: fills the overlay slot, arranges the scrim
        // edge-to-edge and the item stack anchored ABOVE this FAB. Without
        // it the StackPanel would be arranged at the full slot and stack
        // its items from the top-left (0,0) of the surface.
        this._host = new FabMenuHost();
        this._host.anchor = this;
        this._host.menu   = this._menuHost;
        this._host.AddChild(this._scrim);
        this._host.AddChild(this._menuHost);

        // AttachOverlayChild: visual hop → target's OverlayLayer; logical
        // hop → THIS FabMenu so items inherit resources / DataContext /
        // inheritable DPs from us, not from the OverlayLayer.
        this.AttachOverlayChild(this._host);

        // Reveal Storyboard — per-item fade-in + slide-up, staggered.
        // Bottom item starts first so the menu reads as "growing toward
        // the FAB". Walk items in reverse for BeginTime offsetting.
        const sb        = new Storyboard();
        const duration  = Math.max(50, this.DurationMs);
        const stagger   = Math.max(0, this.StaggerMs);
        const n         = items.Count;
        for (let i = 0; i < n; i++)
        {
            const v = items.Get(i);
            if (v === undefined) continue;
            const beginTime = (n - 1 - i) * stagger;
            sb.Add(v, 'Opacity', new DoubleAnimation({
                From: 0, To: 1, Duration: duration, BeginTime: beginTime,
            }));
        }
        sb.Begin();
        this._openStoryboard = sb;

        this._mounted = true;
    }

    private closeMenu(): void
    {
        if (!this._mounted) return;
        const items = this.Items;
        const n     = items?.Count ?? 0;
        const duration  = Math.max(50, this.DurationMs);
        const stagger   = Math.max(0, this.StaggerMs);

        // Stop any in-flight open animation so a rapid open→close
        // doesn't double-bind targets.
        this._openStoryboard?.Stop();
        this._openStoryboard = undefined;

        // Closing Storyboard — fade each item out, top-first so the
        // menu collapses toward the FAB.
        const sb = new Storyboard();
        let animated = 0;
        if (items !== undefined)
        {
            for (let i = 0; i < n; i++)
            {
                const v = items.Get(i);
                if (v === undefined) continue;
                sb.Add(v, 'Opacity', new DoubleAnimation({
                    From: 1, To: 0, Duration: duration, BeginTime: i * stagger,
                }));
                animated++;
            }
        }
        // Nothing to fade (empty menu) → the storyboard would never reach
        // a completion tick; tear the chrome down straight away.
        if (animated === 0)
        {
            this.detachMenuChrome();
            return;
        }
        sb.Begin();
        this._closeStoryboard = sb;
        // Chain the unmount off the close storyboard's completion (§18.4)
        // rather than a wall-clock setTimeout. AwaitCompleted settles on
        // the animation clock — a browser RafClock frame, or a test's
        // ManualClock advance — so the detach is deterministic in both
        // contexts. The identity guard drops a stale close's completion
        // if the menu was reopened (or re-closed) in the meantime.
        void sb.AwaitCompleted().then(() =>
        {
            if (this._closeStoryboard === sb) this.detachMenuChrome();
        });
    }

    private detachMenuChrome(): void
    {
        this._closeStoryboard = undefined;
        // Release the consumer's item Visuals from the menu stack first.
        // They're re-added to a FRESH stack on the next open, and
        // AttachVisual throws on a child that still has a visual parent —
        // so leaving them parented here would break reopening.
        const menu  = this._menuHost;
        const items = this.Items;
        if (menu !== undefined && items !== undefined)
        {
            for (let i = 0; i < items.Count; i++)
            {
                const v = items.Get(i);
                if (v !== undefined) menu.RemoveChild(v);
            }
        }
        if (this._host !== undefined) this.DetachOverlayChild(this._host);
        this._host     = undefined;
        this._menuHost = undefined;
        this._scrim    = undefined;
        this._mounted  = false;
    }

    // Lazy-mount the FAB icon: a persistent owned TextBlock carrying a
    // RotateTransform centered on the glyph. The icon's Text is fixed
    // at ClosedIcon (the rest-state glyph); the open-state visual
    // comes from the 45° rotation applied by animateIconRotation, not
    // from a text swap. This is the M3 design intent for symmetric
    // glyph pairs like '+' / '×' — a single rotating glyph reads as
    // both states. Consumers who set Content to their own Visual opt
    // out entirely.
    //
    // OpenIcon is kept as a public DP for back-compat but has no
    // effect on the owned-glyph rendering in this version — the
    // rotation IS the state transition. A future asymmetric-icon
    // mode (e.g., "menu" → "close" labels) would crossfade two
    // TextBlocks instead of using OpenIcon as a snap-swap target.
    private refreshContentIcon(): void
    {
        const current = this.Content;
        const owned = current instanceof TextBlock
            && (current as unknown as { _fabMenuOwned?: boolean })._fabMenuOwned === true;
        if (current !== undefined && !owned) return;

        if (this._iconHost === undefined)
        {
            const tb = new TextBlock();
            (tb as unknown as { _fabMenuOwned: boolean })._fabMenuOwned = true;
            const rotate = new RotateTransform();
            tb.RenderTransform        = rotate;
            tb.RenderTransformOrigin  = new Point(0.5, 0.5);
            this._iconHost   = tb;
            this._iconRotate = rotate;
            this.Content     = tb;
        }
        // ClosedIcon is the rest-state glyph; the rotation conveys
        // open/closed state. Re-applied on every IsOpen flip so a
        // late ClosedIcon write still reaches the visible TextBlock.
        this._iconHost.Text = this.ClosedIcon;
    }

    // Tween the icon rotation 0 ↔ 45° driven by the current IsOpen
    // state. Called from openMenu / closeMenu after the chrome is
    // wired. The end-state glyph is set via refreshContentIcon at
    // animation completion — for "+" / "×" the swap is invisible
    // (both look like × at 22.5°, both are rotationally symmetric);
    // for custom glyph pairs the swap is a brief snap at the end of
    // the rotation, which reads as a deliberate state transition.
    private animateIconRotation(toOpen: boolean): void
    {
        if (this._iconRotate === undefined) return;
        const duration = Math.max(0, this.RotationDurationMs);
        // Stop any in-flight rotation so a rapid open→close→open
        // doesn't double-target Angle.
        this._rotationStoryboard?.Stop();
        if (duration === 0)
        {
            this._iconRotate.Angle = toOpen ? 45 : 0;
            this._rotationStoryboard = undefined;
            return;
        }
        const from = this._iconRotate.Angle;
        const to   = toOpen ? 45 : 0;
        const sb   = new Storyboard();
        sb.Add(this._iconRotate, 'Angle', new DoubleAnimation({
            From: from, To: to, Duration: duration,
        }));
        sb.Begin();
        this._rotationStoryboard = sb;
    }
}

function targetOf(host: Visual): PresentationTarget | undefined
{
    const back = host as unknown as { ['target']?: PresentationTarget };
    return back['target'];
}

// Sum a Visual's ArrangedRect chain up to the surface root — the visual's
// absolute position in target-surface coordinates. Same walk ComboBox's
// popup host uses to anchor its dropdown.
function absoluteOrigin(v: Visual): { x: number; y: number }
{
    let x = 0;
    let y = 0;
    let cur: Visual | undefined = v;
    while (cur !== undefined)
    {
        x += cur.ArrangedRect.X;
        y += cur.ArrangedRect.Y;
        cur = cur.GetVisualParent();
    }
    return { x, y };
}

// Overlay positioning host for the FAB menu. The OverlayLayer arranges
// every overlay child at the full surface slot (0,0,W,H); this host
// consumes that slot and re-positions its two children inside it:
//   * the scrim (child 0) fills the slot edge-to-edge so any outside
//     click is caught;
//   * the item stack (child 1) is anchored ABOVE the FAB — horizontally
//     centred on it, its bottom edge `Gap` above the FAB's top — and
//     clamped to stay on-surface.
//
// Re-reads the FAB's absolute origin on every arrange so a layout shift
// (resize, scroll) repositions an open menu automatically. Mirrors
// ComboBoxPopupHost. Module-private — no markup references it.
class FabMenuHost extends Panel
{
    public anchor: Visual | undefined;   // the FAB this menu belongs to
    public menu:   Visual | undefined;   // the item StackPanel (child 1)
    // Space between the FAB's top edge and the menu's bottom edge.
    public Gap = 12;

    protected override MeasureOverride(availableSize: Size): Size
    {
        for (const c of this.visualChildren) c.Measure(availableSize);
        const w = Number.isFinite(availableSize.Width)  ? availableSize.Width  : 0;
        const h = Number.isFinite(availableSize.Height) ? availableSize.Height : 0;
        return new Size(w, h);
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        const children = this.visualChildren;
        // Scrim (child 0 by attach order) fills the whole overlay slot.
        children[0]?.Arrange(new Rect(0, 0, finalSize.Width, finalSize.Height));

        const menu   = this.menu;
        const anchor = this.anchor;
        if (menu === undefined || anchor === undefined) return finalSize;

        const origin = absoluteOrigin(anchor);
        const fab    = anchor.ArrangedRect;
        const mw     = menu.DesiredSize.Width;
        const mh     = menu.DesiredSize.Height;

        // Centre the stack on the FAB horizontally; place it above the FAB.
        let mx = origin.x + (fab.Width - mw) / 2;
        let my = origin.y - mh - this.Gap;
        // Clamp on-surface so the menu never spills off the top/edges.
        if (mx + mw > finalSize.Width) mx = Math.max(0, finalSize.Width - mw);
        if (mx < 0) mx = 0;
        if (my < 0) my = 0;

        menu.Arrange(new Rect(mx, my, mw, mh));
        return finalSize;
    }
}
