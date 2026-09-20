import {
    MetaData,
    MuralBase,
    Element, Visual,
    type PointerEventArgs,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import type { ICommand } from '../../runtime/index.js';
import type { PresentationTarget } from '../../visual-engine/index.js';
import { Border } from '../../basic/border.js';
import { ControlTemplate } from '../../basic/templates/control-template.js';
import { ContentControl } from '../base/content-control.js';
import { MenuPopupHost, MenuAnchorSide } from '../menu/menu-strip.js';
import { ClickAwayScrim } from '../../basic/click-away-scrim.js';

// M3 Split button — a primary action + an adjacent chevron trigger
// that opens a dropdown. Two distinct click targets share one chrome.
//
// Anatomy:
//   * Primary half (left): Button-equivalent that fires `Command`
//     with `CommandParameter`. Carries the consumer-supplied
//     `Content` Visual / string. Rounded-left corners.
//   * Chevron half (right): toggle button that flips `IsOpen`. Mounts
//     `MenuContent` onto the host's OverlayLayer when IsOpen → true,
//     detaches when IsOpen → false (or when a click lands outside,
//     handled by the consumer if they want — the bundled scrim
//     covers the M3 default).
//
// Consumer surface:
//   * Content        — primary label / icon Visual (or string).
//   * Command        — primary action ICommand.
//   * CommandParameter — passed to Command.Execute.
//   * MenuContent    — the popup body (usually a StackPanel of menu
//                      items — keep it lean; consumers wanting full M3
//                      menu chrome can host a MenuButton inside).
//   * IsOpen         — popup state; toggle externally or via the
//                      chevron click.
//
// Stroke / focus / press visuals live in the default chrome (template
// triggers); SplitButton itself owns only the popup mount/unmount.
//
// Outside-click dismiss: a transparent Border-as-scrim mounts on the
// OverlayLayer alongside the popup and routes PointerDown to clear
// IsOpen. Mirrors the ContextMenu / MenuButton convention.
// Extends ContentControl so `Content` is the primary label / icon
// Visual (ContentControl provides the DP + ContentPresenter slotting)
// and GetTemplateChild is inherited.
export class SplitButton extends ContentControl
{
    public static readonly CommandKey          = MuralBase.RegisterProperty<ICommand | undefined>(       SplitButton, 'Command',           undefined, MetaData.None);
    public static readonly CommandParameterKey = MuralBase.RegisterProperty<unknown>(                     SplitButton, 'CommandParameter',  undefined, MetaData.None);
    public static readonly MenuContentKey      = MuralBase.RegisterProperty<Visual | undefined>(          SplitButton, 'MenuContent',       undefined, MetaData.None);
    public static readonly IsOpenKey           = MuralBase.RegisterProperty<boolean>(                     SplitButton, 'IsOpen',            false,     MetaData.None);
    // PopupTemplate — the M3 popup chrome (Border with SurfaceContainerHigh
    // fill, OutlineVariant stroke, ShapeExtraSmall corner, Elevation2 shadow)
    // wrapped around a named PART_PopupBody slot. mountPopup instantiates
    // it and slots MenuContent into PART_PopupBody so consumers ship only
    // the items list — no theme tokens in JS. Default set by the Style
    // block in framework.resources.mu to @DefaultSplitButtonPopup.
    public static readonly PopupTemplateKey    = MuralBase.RegisterProperty<ControlTemplate | undefined>(SplitButton, 'PopupTemplate',     undefined, MetaData.None);

    public get Command():          ICommand | undefined { return this.get_property_value(SplitButton.CommandKey); }
    public set Command(v:          ICommand | undefined) { this.set_property_value(SplitButton.CommandKey, v); }

    public get CommandParameter(): unknown { return this.get_property_value(SplitButton.CommandParameterKey); }
    public set CommandParameter(v: unknown) { this.set_property_value(SplitButton.CommandParameterKey, v); }

    public get MenuContent():      Visual | undefined { return this.get_property_value(SplitButton.MenuContentKey); }
    public set MenuContent(v:      Visual | undefined) { this.set_property_value(SplitButton.MenuContentKey, v); }

    public get IsOpen():           boolean { return this.get_property_value(SplitButton.IsOpenKey); }
    public set IsOpen(v:           boolean) { this.set_property_value(SplitButton.IsOpenKey, v); }

    public get PopupTemplate():    ControlTemplate | undefined { return this.get_property_value(SplitButton.PopupTemplateKey); }
    public set PopupTemplate(v:    ControlTemplate | undefined) { this.set_property_value(SplitButton.PopupTemplateKey, v); }

    static
    {
        MuralBase.OverrideMetadata(SplitButton, Element.DefaultStyleKeyKey,
            { default_value: SplitButton });
    }

    private _primary:    Border         | undefined;
    private _trigger:    Border         | undefined;
    private _popupHost:  MenuPopupHost  | undefined;
    private _popupBody:  Border         | undefined;
    private _mounted = false;
    private _primaryPressed = false;
    private _triggerPressed = false;

    constructor()
    {
        super();
        this.applyDefaultStyle();
        this.adoptTemplateParts();
    }

    private adoptTemplateParts(): void
    {
        this._primary = this.GetTemplateChild('PART_PrimaryButton') as Border | undefined;
        this._trigger = this.GetTemplateChild('PART_TriggerButton') as Border | undefined;
        // Press-here-release-here gate per half — fires only on a
        // matching down/up pair without an intervening leave. Same
        // contract Button uses; we wire it manually because the halves
        // are plain Borders (so the template's state-layer triggers
        // can ride on IsMouseOver / IsPressed without bringing in
        // Button's full chrome story).
        this.wireClickable(
            this._primary,
            pressed => { this._primaryPressed = pressed; },
            () => {
                const cmd = this.Command;
                if (cmd === undefined) return;
                const param = this.CommandParameter;
                if (cmd.CanExecute(param)) cmd.Execute(param);
            });
        this.wireClickable(
            this._trigger,
            pressed => { this._triggerPressed = pressed; },
            () => { this.IsOpen = !this.IsOpen; });
    }

    private wireClickable(
        part:    Border | undefined,
        setFlag: (pressed: boolean) => void,
        onFire:  () => void,
    ): void
    {
        if (part === undefined) return;
        part.AddRoutedEventListener('PointerDown', (() => {
            setFlag(true);
            part._setIsPressed(true);
        }) as (a: unknown) => void);
        part.AddRoutedEventListener('PointerUp', (() => {
            const wasPressed = this._primary === part ? this._primaryPressed : this._triggerPressed;
            setFlag(false);
            part._setIsPressed(false);
            if (wasPressed) onFire();
        }) as (a: unknown) => void);
        part.AddRoutedEventListener('PointerLeave', (() => {
            setFlag(false);
            part._setIsPressed(false);
        }) as (a: unknown) => void);
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Owner !== SplitButton) return;
        if (descriptor.Name === 'IsOpen')
        {
            if (newValue === true) this.mountPopup();
            else                    this.unmountPopup();
        }
        else if (descriptor.Name === 'PopupTemplate' && this._mounted)
        {
            // §18.12 — a PopupTemplate swap while the popup is open takes
            // effect immediately instead of waiting for the next
            // close→open cycle. unmountPopup re-parents MenuContent out
            // (SetChild(undefined)) and mountPopup reads MenuContent fresh,
            // so the consumer's content survives the chrome rebuild.
            this.unmountPopup();
            this.mountPopup();
        }
    }

    private mountPopup(): void
    {
        if (this._mounted) return;
        const t = targetOf(this);
        if (t === undefined) return;
        const content = this.MenuContent;
        if (content === undefined) return;

        const tpl = this.PopupTemplate;
        if (tpl === undefined)
        {
            // Theme bundle absent (test harnesses that skip Material). Fall
            // back to a content-sized Border wrapping MenuContent so the
            // overlay still mounts a sensible Visual. No anchor / scrim.
            const fallback = new Border();
            fallback.SetChild(content);
            this._popupBody = fallback;
            this.AttachOverlayChild(fallback);
            this._mounted = true;
            return;
        }

        // PopupTemplate root is a MenuPopupHost (parallel to MenuButton /
        // ContextMenu). Its arrange logic places PART_PopupBody at the
        // anchor position (default 'below') sized to the body's
        // DesiredSize — without it, the popup Border would inherit the
        // OverlayLayer's full-surface slot and fill the screen.
        //
        // Apply(this) sets templatedParent = SplitButton so DynamicResource
        // bindings inside the chrome resolve against our resource chain
        // → Material tokens flip with the theme.
        const inst       = tpl.Apply(this);
        const host       = inst.root as MenuPopupHost;
        const scrim      = host.FindName('PART_Scrim')    as ClickAwayScrim | undefined;
        const body       = host.FindName('PART_PopupBody') as Border        | undefined;
        if (body === undefined)
        {
            throw new Error(
                'SplitButton.PopupTemplate is missing PART_PopupBody. See '
                + '@DefaultSplitButtonPopup in framework.resources.mu.');
        }
        body.SetChild(content);
        // Anchor the popup body below the primary half so it visually
        // hangs under the SplitButton. Fall back to the SplitButton itself
        // if the primary part hasn't materialised (test paths).
        host.anchor     = this._primary ?? this;
        host.anchorSide = MenuAnchorSide.Below;
        host.popup      = body;
        // Scrim sits between anchor and popup body in MenuPopupHost's
        // children; arrange logic gives it the full surface slot so an
        // outside click anywhere closes the menu.
        if (scrim !== undefined) scrim.onClick = (): void => { this.IsOpen = false; };

        this._popupHost = host;
        this._popupBody = body;

        // AttachOverlayChild: visual hop → host's OverlayLayer (renderer
        // paints above main content); logical hop → THIS SplitButton (so
        // resource / DataContext / inheritable-DP cascades reach the
        // popup through us, not through the OverlayLayer — closes the
        // § 18.10 gap).
        this.AttachOverlayChild(host);
        this._mounted = true;
    }

    private unmountPopup(): void
    {
        if (!this._mounted) return;
        const root = this._popupHost ?? this._popupBody;
        if (root !== undefined) this.DetachOverlayChild(root);
        // Drop the consumer's MenuContent out of the chrome so a re-open
        // builds a fresh tree (matches the ContextMenu / MenuButton
        // lifecycle — the OverlayLayer never sees a stale visual).
        if (this._popupBody !== undefined) this._popupBody.SetChild(undefined);
        this._popupHost = undefined;
        this._popupBody = undefined;
        this._mounted   = false;
    }
}

// Walks the visual's host back-pointer to find the PresentationTarget.
// Same shape Tooltip / Snackbar / Dialog overlay-helpers use.
function targetOf(host: Visual): PresentationTarget | undefined
{
    const back = host as unknown as { ['target']?: PresentationTarget };
    return back['target'];
}

// Suppress unused-import lint — `PointerEventArgs` is part of the
// AddRoutedEventListener callback contract even though the handlers
// happen to ignore the args.
void (undefined as PointerEventArgs | undefined);
