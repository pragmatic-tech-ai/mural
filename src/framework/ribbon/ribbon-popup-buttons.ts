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
import { Button } from '../buttons/button.js';
import { ControlTemplate } from '../../basic/templates/control-template.js';
import { ItemsControl } from '../base/items-control.js';
import { StackPanel } from '../../basic/panels/stack-panel.js';
import { MenuItem, MenuPopupHost, MenuAnchorSide } from '../menu/menu-strip.js';
import { ClickAwayScrim } from '../tool-bar/tool-bar.js';
import {
    CommandSourceHelper,
    type ICommandSource,
} from '../commands/command-source.js';
import { RibbonButtonSize, fillRibbonStack } from './ribbon-buttons.js';

// ─────────────────────────────────────────────────────────────────────
// RibbonPopupButton — shared base for the two ribbon dropdown invokers:
//
//   * RibbonDropDownButton — the WHOLE button opens a Menu popup of
//     secondary commands. No primary action.
//   * RibbonSplitButton    — a primary action region (invokes Command)
//     plus a small arrow region that opens the same popup.
//
// The popup mechanics mirror MenuButton exactly: ItemsControl's primary
// Template is the popup chrome (MenuPopupHost > [Scrim, Border >
// ItemsPresenter]); a separate TriggerTemplate DP carries the visible
// trigger chrome. The popup root is detached from our visual subtree in
// the ctor so the OverlayLayer can adopt it on open without tripping the
// single-parent guard.
//
// Subclasses differ only in their TriggerTemplate (set by their default
// Style) and in wireTrigger(), which finds the trigger's PART_* click
// regions and hooks them up.
export abstract class RibbonPopupButton extends ItemsControl
{
    public static readonly IsOpenKey    = MuralBase.RegisterProperty<boolean>(
        RibbonPopupButton, 'IsOpen', false, MetaData.None);
    public static readonly LargeIconKey = MuralBase.RegisterProperty<Visual | undefined>(
        RibbonPopupButton, 'LargeIcon', undefined, MetaData.Measure);
    public static readonly SmallIconKey = MuralBase.RegisterProperty<Visual | undefined>(
        RibbonPopupButton, 'SmallIcon', undefined, MetaData.Measure);
    public static readonly TextKey      = MuralBase.RegisterProperty<string | undefined>(
        RibbonPopupButton, 'Text', undefined, MetaData.Measure | MetaData.Render);
    public static readonly SizeKey      = MuralBase.RegisterProperty<RibbonButtonSize>(
        RibbonPopupButton, 'Size', RibbonButtonSize.Large, MetaData.Measure);
    // Trigger chrome — the visible button. Can't share ItemsControl's
    // primary Template slot (that hosts the popup ItemsPresenter), so it
    // lives in a second template DP the default Style sets.
    public static readonly TriggerTemplateKey = MuralBase.RegisterProperty<ControlTemplate | undefined>(
        RibbonPopupButton, 'TriggerTemplate', undefined, MetaData.Measure);

    public get IsOpen():  boolean { return this.get_property_value(RibbonPopupButton.IsOpenKey); }
    public set IsOpen(v: boolean) { this.set_property_value(RibbonPopupButton.IsOpenKey, v); }

    public get LargeIcon(): Visual | undefined  { return this.get_property_value(RibbonPopupButton.LargeIconKey); }
    public set LargeIcon(v: Visual | undefined) { this.set_property_value(RibbonPopupButton.LargeIconKey, v); }

    public get SmallIcon(): Visual | undefined  { return this.get_property_value(RibbonPopupButton.SmallIconKey); }
    public set SmallIcon(v: Visual | undefined) { this.set_property_value(RibbonPopupButton.SmallIconKey, v); }

    public get Text(): string | undefined  { return this.get_property_value(RibbonPopupButton.TextKey); }
    public set Text(v: string | undefined) { this.set_property_value(RibbonPopupButton.TextKey, v); }

    public get Size(): RibbonButtonSize  { return this.get_property_value(RibbonPopupButton.SizeKey); }
    public set Size(v: RibbonButtonSize) { this.set_property_value(RibbonPopupButton.SizeKey, v); }

    public get TriggerTemplate():  ControlTemplate | undefined { return this.get_property_value(RibbonPopupButton.TriggerTemplateKey); }
    public set TriggerTemplate(v: ControlTemplate | undefined) { this.set_property_value(RibbonPopupButton.TriggerTemplateKey, v); }

    protected _trigger:     Visual     | undefined;
    protected _contentHost: StackPanel | undefined;

    private _popupHost:      MenuPopupHost  | undefined;
    private _scrim:          ClickAwayScrim | undefined;
    private _popupContainer: Border         | undefined;

    private _popupMounted = false;
    private _lastKnownTarget: PresentationTarget | undefined;

    protected constructor()
    {
        super();
        this.applyDefaultStyle();
        this.adoptPopupTemplate();
        this.adoptTriggerTemplate();
        this.updateTriggerContent();
    }

    // Find popup parts, wire scrim close + host.popup, detach the popup
    // root so the OverlayLayer can adopt it on open. Same shape MenuButton
    // uses.
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
        const tpl = this.TriggerTemplate;
        if (tpl === undefined)
        {
            throw new Error(
                `${this.constructor.name}.TriggerTemplate is undefined. The default `
                + 'Style in ribbon.template.mu must set TriggerTemplate. Activate a theme '
                + 'that adopts MuralFramework before constructing the control.');
        }
        const inst = tpl.Apply(this);
        this._trigger = inst.root;
        const host = inst.root.FindName('PART_ContentHost');
        if (host instanceof StackPanel) this._contentHost = host;
        this.wireTrigger(inst.root);
        this.AttachVisual(this._trigger);
    }

    /** Subclass hook: find the trigger's click regions (PART_Primary /
     *  PART_Arrow / PART_Trigger) and wire their handlers. */
    protected abstract wireTrigger(triggerRoot: Visual): void;

    /** Open (or toggle) the dropdown popup. Called by subclass click
     *  wiring on the arrow / whole-trigger region. */
    protected toggleOpen(): void { this.IsOpen = !this.IsOpen; }

    // (Re-)compose the trigger's content host from Size / icons / Text via
    // the shared three-tier layout (Large vertical icon+label, Medium
    // horizontal icon+label, Small icon-only). A trailing ▾ arrow glyph is
    // part of the trigger TEMPLATE (not composed here) so subclasses can
    // position it per their layout.
    protected updateTriggerContent(): void
    {
        const host = this._contentHost;
        if (host === undefined) return;
        fillRibbonStack(this, host);
    }

    public override get visualChildren(): readonly Visual[]
    {
        return this._trigger !== undefined ? [this._trigger] : [];
    }

    public override get logicalChildren(): readonly Visual[] { return []; }

    protected override validateDeclarativeChild(_child: Visual): void { }

    public override IsItemItsOwnContainerOverride(item: unknown): boolean
    {
        return item instanceof Visual;
    }

    public override PrepareContainerForItemOverride(container: Visual, item: unknown, index: number): void
    {
        super.PrepareContainerForItemOverride(container, item, index);
        if (container instanceof MenuItem)
        {
            container._onActivated = (): void => { this.IsOpen = false; };
        }
    }

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
        const name = descriptor.Name;
        if (name === 'IsOpen' && this._popupHost !== undefined)
        {
            if (newValue === true) this.mountPopup();
            else                   this.unmountPopup();
        }
        if (name === 'LargeIcon' || name === 'SmallIcon' || name === 'Text' || name === 'Size')
        {
            this.updateTriggerContent();
        }
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
    }

    private mountPopup(): void
    {
        if (this._popupMounted || this._popupHost === undefined) return;
        if (this._lastKnownTarget === undefined) return;
        if (this._trigger !== undefined) this._popupHost.anchor = this._trigger;
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

// RibbonDropDownButton — the whole trigger opens the dropdown. No primary
// action. Its trigger template's root is named PART_Trigger (a Button).
export class RibbonDropDownButton extends RibbonPopupButton
{
    static
    {
        MuralBase.OverrideMetadata(RibbonDropDownButton, Element.DefaultStyleKeyKey, { default_value: RibbonDropDownButton });
    }

    public constructor() { super(); }

    protected override wireTrigger(triggerRoot: Visual): void
    {
        const trigger = triggerRoot instanceof Button ? triggerRoot : triggerRoot.FindName('PART_Trigger');
        if (trigger instanceof Button)
        {
            trigger.AddClickHandler(() => this.toggleOpen());
        }
    }
}

// RibbonSplitButton — a primary action region (PART_Primary, invokes
// Command) plus an arrow region (PART_Arrow) that opens the dropdown.
// The primary is an ICommandSource: Command / CommandParameter drive the
// auto-disable chrome via CommandSourceHelper, same rule as Button /
// MenuItem — but on PART_Primary only, so a command that cannot run dims
// and blocks the primary region while the arrow keeps the dropdown usable.
export class RibbonSplitButton extends RibbonPopupButton implements ICommandSource
{
    public static readonly CommandKey          = MuralBase.RegisterProperty<ICommand | undefined>(
        RibbonSplitButton, 'Command', undefined, MetaData.None);
    public static readonly CommandParameterKey = MuralBase.RegisterProperty<unknown>(
        RibbonSplitButton, 'CommandParameter', undefined, MetaData.None);
    // RoutedCommand dispatch target override; unused for plain ICommand.
    public static readonly CommandTargetKey    = MuralBase.RegisterProperty<Visual | undefined>(
        RibbonSplitButton, 'CommandTarget', undefined, MetaData.None);

    static
    {
        MuralBase.OverrideMetadata(RibbonSplitButton, Element.DefaultStyleKeyKey, { default_value: RibbonSplitButton });
    }

    private readonly _cmdHelper: CommandSourceHelper = new CommandSourceHelper(this, () => this.ApplyPrimaryCanExecute());

    public constructor()
    {
        super();
        this.ApplyPrimaryCanExecute();
    }

    // Feed CanExecute into PART_Primary's IsEnabledCore (the split button
    // owns that veto; the primary Button has no Command of its own). Looked
    // up from the trigger rather than cached in wireTrigger, which runs in
    // the base constructor before this class's fields are initialised.
    private ApplyPrimaryCanExecute(): void
    {
        const primary = this._trigger?.FindName('PART_Primary');
        if (primary instanceof Button) Element.SetPartIsEnabledCore(primary, this._cmdHelper.CanExecute);
    }

    public get Command(): ICommand | undefined  { return this.get_property_value(RibbonSplitButton.CommandKey); }
    public set Command(v: ICommand | undefined) { this.set_property_value(RibbonSplitButton.CommandKey, v); }

    public get CommandParameter(): unknown  { return this.get_property_value(RibbonSplitButton.CommandParameterKey); }
    public set CommandParameter(v: unknown) { this.set_property_value(RibbonSplitButton.CommandParameterKey, v); }

    public get CommandTarget(): Visual | undefined  { return this.get_property_value(RibbonSplitButton.CommandTargetKey); }
    public set CommandTarget(v: Visual | undefined) { this.set_property_value(RibbonSplitButton.CommandTargetKey, v); }

    protected override wireTrigger(triggerRoot: Visual): void
    {
        const primary = triggerRoot.FindName('PART_Primary');
        const arrow   = triggerRoot.FindName('PART_Arrow');
        if (primary instanceof Button) primary.AddClickHandler(() => this._cmdHelper.Execute());
        if (arrow   instanceof Button) arrow.AddClickHandler(() => this.toggleOpen());
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        const name = descriptor.Name;
        if (name === 'Command')
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
        super.propagate_target_to_visual_children();
        const attached = (this as unknown as { target: PresentationTarget | undefined }).target !== undefined;
        if (attached) this._cmdHelper.OnAttachedToTree();
        else this._cmdHelper.OnDetachedFromTree();
    }
}
