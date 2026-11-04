import {
    Element,
    MetaData,
    MuralBase,
    Rect,
    Size,
    Visual,
    type ICommand,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { PresentationTarget } from '../../visual-engine/index.js';
import { Border } from '../../basic/border.js';
import { ClickAwayScrim } from '../../basic/click-away-scrim.js';
import { ControlTemplate } from '../../basic/templates/control-template.js';
import { Gallery } from '../gallery/gallery.js';
import { MenuPopupHost, MenuAnchorSide } from '../menu/menu-strip.js';
import { CommandSourceHelper, type ICommandSource } from '../commands/command-source.js';
import { ToolBarPosition } from './tool-bar-items.js';

// ToolBarSplitButton — a connected-bar split button: a primary half that
// fires `Command`, and a chevron half that opens a dropdown of the button's
// MenuItem children. It rounds out the tool-bar family (ToolBarButton /
// ToolBarToggleButton) with the "one default action + a menu of variants"
// affordance, in the SAME flat connected-bar chrome rather than the M3 pill
// SplitButton or the ribbon-styled RibbonSplitButton.
//
// It marries two existing patterns:
//   * items + popup + auto-close from the Gallery base — the primary Template
//     is the popup chrome (MenuPopupHost > Scrim + Border > ItemsPresenter),
//     and Gallery closes the popup when any item activates. The popup layout
//     is whatever the ItemsPanel is: the default vertical panel is the *menu*
//     variant (MenuItem children); set `ItemsPanel = UniformGrid[Columns=3]`
//     with icon ToolBarButton children for an *icon-grid* variant.
//   * flat Border halves with press-here-release-here click gating from the
//     general SplitButton (PART_Primary / PART_Arrow are plain Borders so the
//     template's state-layer triggers ride on IsMouseOver / IsPressed without
//     bringing in Button's own chrome).
//
// The visible trigger lives in a second template DP (TriggerTemplate) because
// the control's primary Template slot hosts the popup ItemsPresenter — same
// split MenuButton / RibbonPopupButton use.
export class ToolBarSplitButton extends Gallery implements ICommandSource
{
    public static readonly CommandKey          = MuralBase.RegisterProperty<ICommand | undefined>(
        ToolBarSplitButton, 'Command', undefined, MetaData.None);
    public static readonly CommandParameterKey = MuralBase.RegisterProperty<unknown>(
        ToolBarSplitButton, 'CommandParameter', undefined, MetaData.None);
    // RoutedCommand dispatch target override; unused for a plain ICommand.
    public static readonly CommandTargetKey    = MuralBase.RegisterProperty<Visual | undefined>(
        ToolBarSplitButton, 'CommandTarget', undefined, MetaData.None);
    // Primary content — the icon / label Visual shown in the primary half.
    public static readonly ContentKey          = MuralBase.RegisterProperty<Visual | undefined>(
        ToolBarSplitButton, 'Content', undefined, MetaData.Measure);
    public static readonly IsOpenKey           = MuralBase.RegisterProperty<boolean>(
        ToolBarSplitButton, 'IsOpen', false, MetaData.None);
    // Where the button sits inside a ToolBar group — drives the corner
    // rounding of the OUTER pill via the template, exactly like ToolBarButton.
    public static readonly PositionKey         = MuralBase.RegisterProperty<ToolBarPosition>(
        ToolBarSplitButton, 'Position', ToolBarPosition.Only, MetaData.None);
    // Trigger chrome — the visible split button. Can't share ItemsControl's
    // primary Template slot (that hosts the popup ItemsPresenter), so it
    // lives in a second template DP the default Style sets. The default Style
    // swaps this to a single-chrome dropdown template via a
    // `when ( Command is unset )` trigger; the control re-adopts on change.
    public static readonly TriggerTemplateKey  = MuralBase.RegisterProperty<ControlTemplate | undefined>(
        ToolBarSplitButton, 'TriggerTemplate', undefined, MetaData.Measure);

    static
    {
        MuralBase.OverrideMetadata(ToolBarSplitButton, Element.DefaultStyleKeyKey, { default_value: ToolBarSplitButton });
    }

    public get Command(): ICommand | undefined  { return this.get_property_value(ToolBarSplitButton.CommandKey); }
    public set Command(v: ICommand | undefined) { this.set_property_value(ToolBarSplitButton.CommandKey, v); }

    public get CommandParameter(): unknown  { return this.get_property_value(ToolBarSplitButton.CommandParameterKey); }
    public set CommandParameter(v: unknown) { this.set_property_value(ToolBarSplitButton.CommandParameterKey, v); }

    public get CommandTarget(): Visual | undefined  { return this.get_property_value(ToolBarSplitButton.CommandTargetKey); }
    public set CommandTarget(v: Visual | undefined) { this.set_property_value(ToolBarSplitButton.CommandTargetKey, v); }

    public get Content(): Visual | undefined  { return this.get_property_value(ToolBarSplitButton.ContentKey); }
    public set Content(v: Visual | undefined) { this.set_property_value(ToolBarSplitButton.ContentKey, v); }

    public get IsOpen(): boolean  { return this.get_property_value(ToolBarSplitButton.IsOpenKey); }
    public set IsOpen(v: boolean) { this.set_property_value(ToolBarSplitButton.IsOpenKey, v); }

    public get Position(): ToolBarPosition  { return this.get_property_value(ToolBarSplitButton.PositionKey); }
    public set Position(v: ToolBarPosition) { this.set_property_value(ToolBarSplitButton.PositionKey, v); }

    public get TriggerTemplate(): ControlTemplate | undefined  { return this.get_property_value(ToolBarSplitButton.TriggerTemplateKey); }
    public set TriggerTemplate(v: ControlTemplate | undefined) { this.set_property_value(ToolBarSplitButton.TriggerTemplateKey, v); }

    // Same rule as Button: the command's CanExecute vetoes IsEnabled, but on
    // the primary half only (the half that runs the command), so a split
    // button whose command cannot run dims and blocks its primary while the
    // arrow keeps the dropdown of variants reachable.
    private readonly _cmdHelper: CommandSourceHelper = new CommandSourceHelper(this, () => this.ApplyPrimaryCanExecute());

    private _trigger:     Visual | undefined;
    private _primary:     Border | undefined;
    private _arrow:       Border | undefined;
    private _contentHost: Border | undefined;

    private _popupHost:      MenuPopupHost  | undefined;
    private _scrim:          ClickAwayScrim | undefined;
    private _popupContainer: Border         | undefined;

    private _primaryPressed = false;
    private _arrowPressed   = false;

    private _popupMounted = false;
    private _lastKnownTarget: PresentationTarget | undefined;
    // The dropdown's item containers (MenuItems / grid buttons) are built
    // lazily on first open — a command bar with dozens of split buttons would
    // otherwise realize hundreds of menu items that are never opened. Flipped
    // true (and never back) the first time IsOpen goes true.
    private _everOpened = false;

    constructor()
    {
        super();
        this.applyDefaultStyle();
        this.adoptPopupTemplate();
        this.adoptTriggerTemplate();
    }

    // Find the popup parts (MenuPopupHost > Scrim + PART_PopupContainer),
    // wire the scrim's outside-click to close, and detach the popup root so
    // the OverlayLayer can adopt it on open without tripping the single-parent
    // guard. Same shape MenuButton / RibbonPopupButton use.
    private adoptPopupTemplate(): void
    {
        const root = super.visualChildren[0];
        if (!(root instanceof MenuPopupHost)) return;
        this._popupHost      = root;
        this._scrim          = root.FindName('PART_Scrim')          as ClickAwayScrim;
        this._popupContainer = root.FindName('PART_PopupContainer') as Border;
        this._popupHost.popup = this._popupContainer;
        this._scrim.onClick   = (): void => { this.IsOpen = false; };
        this.DetachVisual(this._popupHost);
    }

    private adoptTriggerTemplate(): void
    {
        // The chrome is chosen declaratively by the default Style: a
        // `when ( Command is unset )` trigger swaps TriggerTemplate to the
        // single-chrome dropdown template, else it's the split chrome. This
        // just adopts whatever TriggerTemplate currently is; it re-runs when
        // that DP changes (see OnPropertyChanged), so a Command assigned /
        // cleared later flips the chrome with no code decision here.
        const tpl = this.TriggerTemplate;
        if (tpl === undefined)
        {
            throw new Error(
                'ToolBarSplitButton.TriggerTemplate is undefined. The default Style '
                + 'in tool-bar.template.mu must set TriggerTemplate. Activate a theme '
                + 'that adopts MuralFramework before constructing the control.');
        }
        // Re-adopt (TriggerTemplate swapped): tear down the old chrome. Clear
        // the old content host FIRST so the Content visual is unparented — it
        // survives the swap and is re-slotted into the new host below;
        // otherwise `slotContent` would throw (Content still has the old
        // host as its visual parent). The wired listeners on the old parts
        // die with the discarded Borders.
        if (this._contentHost !== undefined) this._contentHost.SetChild(undefined);
        if (this._trigger !== undefined) this.DetachVisual(this._trigger);

        const inst = tpl.Apply(this);
        this._trigger = inst.root;
        this._primary     = inst.root.FindName('PART_Primary') as Border | undefined;
        this._arrow       = inst.root.FindName('PART_Arrow')   as Border | undefined;
        this._contentHost = inst.root.FindName('PART_Content') as Border | undefined;
        // Press-here-release-here gate per half — fires only on a matching
        // down/up pair with no intervening leave. Same contract Button uses;
        // wired manually because the halves are plain Borders. In dropdown
        // mode PART_Arrow is absent, so its wireClickable no-ops.
        this.wireClickable(
            this._primary,
            pressed => { this._primaryPressed = pressed; },
            () => this._primaryPressed,
            () => {
                // No Command assigned → the whole button is a plain dropdown:
                // the primary half opens the popup (a click anywhere on the
                // chrome opens it). With a Command, the primary fires it and
                // only the arrow opens the popup. Decided at click time
                // because Command is a DP that may be bound / set late.
                if (this.Command === undefined) this.IsOpen = !this.IsOpen;
                else this._cmdHelper.Execute();
            });
        this.wireClickable(
            this._arrow,
            pressed => { this._arrowPressed = pressed; },
            () => this._arrowPressed,
            () => { this.IsOpen = !this.IsOpen; });
        this.AttachVisual(this._trigger);
        this.slotContent();
        this.ApplyPrimaryCanExecute();
    }

    // Feed CanExecute into the primary half's IsEnabledCore. A disabled
    // primary also forgets a press in flight: its PointerUp would be
    // swallowed by the disabled-route gate and leave the pressed chrome on.
    private ApplyPrimaryCanExecute(): void
    {
        const primary = this._primary;
        if (primary === undefined) return;
        const canExecute = this._cmdHelper.CanExecute;
        this.SetTemplatePartIsEnabledCore(primary, canExecute);
        if (!canExecute && this._primaryPressed)
        {
            this._primaryPressed = false;
            primary._setIsPressed(false);
        }
    }

    private wireClickable(
        part:    Border | undefined,
        setFlag: (pressed: boolean) => void,
        wasPressed: () => boolean,
        onFire:  () => void,
    ): void
    {
        if (part === undefined) return;
        part.AddRoutedEventListener('PointerDown', (() => {
            setFlag(true);
            part._setIsPressed(true);
        }) as (a: unknown) => void);
        part.AddRoutedEventListener('PointerUp', (() => {
            const fire = wasPressed();
            setFlag(false);
            part._setIsPressed(false);
            if (fire) onFire();
        }) as (a: unknown) => void);
        part.AddRoutedEventListener('PointerLeave', (() => {
            setFlag(false);
            part._setIsPressed(false);
        }) as (a: unknown) => void);
    }

    private slotContent(): void
    {
        if (this._contentHost === undefined) return;
        this._contentHost.SetChild(this.Content);
    }

    public override get visualChildren(): readonly Visual[]
    {
        return this._trigger !== undefined ? [this._trigger] : [];
    }

    public override get logicalChildren(): readonly Visual[] { return []; }

    // Gallery's activation-close contract dismisses THIS split button's popup.
    // Item-container wiring (MenuItem / Button / PointerDown) lives in the base.
    protected override RequestClose(): void { this.IsOpen = false; }

    // Defer building the dropdown's item containers until the popup is first
    // opened (see _everOpened). Until then the split button shows only its
    // trigger chrome; its MenuItems / grid buttons aren't realized.
    protected override shouldRealizeContainers(): boolean { return this._everOpened; }

    protected override MeasureOverride(availableSize: Size): Size
    {
        if (this._trigger === undefined) return Size.Zero;
        this._trigger.Measure(availableSize);
        return this._trigger.DesiredSize;
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        this._trigger?.Arrange(new Rect(0, 0, finalSize.Width, finalSize.Height));
        return finalSize;
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Owner !== ToolBarSplitButton) return;
        const name = descriptor.Name;
        if (name === 'IsOpen' && this._popupHost !== undefined)
        {
            if (newValue === true)
            {
                // First open: build the dropdown's items now (they were deferred
                // while closed), then mount so the popup measures with content.
                if (!this._everOpened)
                {
                    this._everOpened = true;
                    this.flushDeferredRealization();
                }
                this.mountPopup();
            }
            else this.unmountPopup();
        }
        else if (name === 'Content')
        {
            this.slotContent();
        }
        else if (name === 'TriggerTemplate')
        {
            // The default Style swaps this via `when ( Command is unset )`
            // (split ↔ single-chrome dropdown). Re-adopt the new chrome — but
            // only after the ctor's first adopt, so the initial Style-driven
            // sets during applyDefaultStyle don't double-build the trigger.
            if (this._trigger !== undefined)
            {
                this.adoptTriggerTemplate();
                this.InvalidateMeasure();
            }
        }
        else if (name === 'Command')
        {
            this._cmdHelper.OnCommandChanged(oldValue as ICommand | undefined, newValue as ICommand | undefined);
        }
        else if (name === 'CommandParameter' || name === 'CommandTarget')
        {
            this._cmdHelper.OnParameterOrTargetChanged();
        }
    }

    // The CanExecuteChanged subscription follows the tree, as on Button.
    protected override SetVisualParent(p: Visual | undefined): void
    {
        super.SetVisualParent(p);
        if (p !== undefined) this._cmdHelper.OnAttachedToTree();
        else this._cmdHelper.OnDetachedFromTree();
    }

    protected override propagate_target_to_visual_children(): void
    {
        const newTarget = (this as unknown as { target: PresentationTarget | undefined }).target;
        const oldTarget = this._lastKnownTarget;
        if (oldTarget !== undefined && oldTarget !== newTarget && this._popupMounted)
        {
            if (this._popupHost !== undefined) oldTarget.DetachOverlay(this._popupHost);
            this._popupMounted = false;
        }
        this._lastKnownTarget = newTarget;
        super.propagate_target_to_visual_children();
        (this._trigger as unknown as { SetTarget?: (t: PresentationTarget | undefined) => void } | undefined)
            ?.SetTarget?.(newTarget);
        if (newTarget !== undefined && this.IsOpen) this.mountPopup();
        if (newTarget !== undefined) this._cmdHelper.OnAttachedToTree();
        else this._cmdHelper.OnDetachedFromTree();
    }

    private mountPopup(): void
    {
        if (this._popupMounted || this._popupHost === undefined) return;
        if (this._lastKnownTarget === undefined) return;
        // Anchor the popup below the primary half so it hangs under the button.
        if (this._primary !== undefined) this._popupHost.anchor = this._primary;
        else if (this._trigger !== undefined) this._popupHost.anchor = this._trigger;
        this._popupHost.anchorSide = MenuAnchorSide.Below;
        this.AttachOverlayChild(this._popupHost);
        this._popupMounted = true;
    }

    private unmountPopup(): void
    {
        if (!this._popupMounted || this._popupHost === undefined) return;
        this.DetachOverlayChild(this._popupHost);
        this._popupMounted = false;
    }
}
