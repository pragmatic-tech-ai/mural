import {
    MetaData,
    MuralBase,
    Element, Visual,
    type ICommand,
    type KeyEventArgs,
    Key,
    type PointerEventArgs,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { CornerRadius } from '../../visual-engine/index.js';
import {
    CommandSourceHelper,
    type ICommandSource,
} from '../commands/command-source.js';
import { ContentControl } from '../base/content-control.js';
import { ToolTipService } from '../tooltips/tooltip-service.js';
import { CommandBase } from '../../runtime/index.js';

// When the Click event fires. WPF parity: Release is the default
// (visible press feedback, fire on PointerUp inside bounds), Press
// fires immediately on PointerDown (no need for matching Up), and
// Hover fires when the pointer enters the button area (toolbar-style
// hover-to-activate).
export enum ClickMode
{
    Release = 'Release',
    Press   = 'Press',
    Hover   = 'Hover',
}

// Material 3 button variants. Each variant has its own ControlTemplate
// in basic.resources.mu (DefaultFilledButton, DefaultElevatedButton, …);
// the default Button Style picks the template that matches the Variant
// DP value via a property trigger. Setting Variant at construction
// time is fully supported; setting it after the Style is already
// active retargets the Template via the trigger pipeline (same path
// the existing IsMouseOver / IsPressed triggers ride on).
//
// Filled is the M3 baseline (and the historical mural default — the
// previous single template was effectively a Filled button), so it's
// the default value.
export enum ButtonVariant
{
    Filled   = 'Filled',
    Elevated = 'Elevated',
    Tonal    = 'Tonal',
    Outlined = 'Outlined',
    Text     = 'Text',
    // Icon-button only — no chrome at rest, OnSurfaceVariant glyph
    // ink. Drives DefaultStandardIconButton; on a regular Button the
    // trigger chain falls through to Filled because no Button template
    // exists for it.
    Standard = 'Standard',
    // Pragmatic-theme variants (Wave 1). Additive — the Pragmatic Button
    // style maps both these new names and the M3 legacy names onto its
    // four templates (Primary/Secondary/Ghost/Danger). Material's Button
    // style ignores them (no matching trigger → falls through to Filled),
    // so adding them is safe for both themes.
    Primary   = 'Primary',
    Secondary = 'Secondary',
    Ghost     = 'Ghost',
    Danger    = 'Danger',
}

// Click handler signature. The originating PointerEventArgs rides
// along so handlers can branch on modifier keys, button index, or
// position without reaching back into the input device.
export type ClickHandler = (args: PointerEventArgs) => void;


// Button: a clickable ContentControl. Equivalent to WPF's Button +
// ButtonBase rolled into one class — the abstract split exists in
// WPF to share behaviour with ToggleButton / RepeatButton, neither
// of which ships in mural v1. When those land, factor this into a
// shared ButtonBase.
//
// Click protocol — fired in this order each time the button activates:
//   1. The `Command` DP (typed as `() => void` when set via binding)
//      is invoked with no arguments. This is the binding-friendly hook
//      a `.mu` source uses: `Button[Command = $onClick]`.
//   2. Every registered ClickHandler runs in registration order. The
//      handler receives the originating PointerEventArgs.
//   3. Subclasses can override the protected OnClick virtual for
//      behaviour layered on top of (1) and (2).
//
// IsPressed semantics — maintained at the Button level for WPF parity:
//   * PointerDown on the Button (or any descendant) sets IsPressed.
//   * Dragging off the Button (PointerLeave) clears IsPressed while
//     a drag is in progress, so the press visual goes off without
//     committing the click.
//   * Dragging back onto the Button (PointerEnter) restores IsPressed
//     while the same press is still active.
//   * PointerUp clears IsPressed unconditionally. If the up happens
//     inside the Button and the original PointerDown originated here
//     (ClickMode.Release path), the Click protocol fires before the
//     state clear.
//
// The internal `_pressOriginatedHere` flag tracks whether the current
// pointer interaction's PointerDown landed on this Button, which is
// what distinguishes "press + release inside" from "press elsewhere +
// drag onto + release".
export class Button extends ContentControl implements ICommandSource
{
    public static readonly CommandKey          = MuralBase.RegisterProperty<ICommand | undefined>(Button, 'Command',          undefined,         MetaData.None);
    public static readonly CommandParameterKey = MuralBase.RegisterProperty<unknown>(             Button, 'CommandParameter', undefined,         MetaData.None);
    // CommandTarget — RoutedCommand-only override of the routing dispatch
    // target. Plain ICommand ignores this DP; RoutedCommand asks
    // CommandManager.Execute against CommandTarget ?? this. The default
    // (undefined) means "dispatch from the Button itself", which is what
    // a toolbar Button typically wants.
    public static readonly CommandTargetKey    = MuralBase.RegisterProperty<Visual | undefined>(  Button, 'CommandTarget',    undefined,         MetaData.None);
    public static readonly ClickModeKey        = MuralBase.RegisterProperty<ClickMode>(           Button, 'ClickMode',        ClickMode.Release, MetaData.None);
    // Material 3 visual variant. Drives the default Style's Template-
    // picker trigger chain in basic.resources.mu. MetaData.None — the
    // trigger system reacts to DP changes via OnPropertyChanged.
    public static readonly VariantKey          = MuralBase.RegisterProperty<ButtonVariant>(       Button, 'Variant',          ButtonVariant.Filled, MetaData.None);
    // Corner shape, TemplateBound to PART_Border (and PART_StateLayer) in
    // every variant template via `$$CornerRadius`. Lets a consumer compose
    // Button parts into a larger surface with per-instance corner shape
    // (left-rounded / right-rounded segmented banks, toolbar groupings)
    // without falling back to raw Borders — the gap SplitButton hit. The
    // M3 pill default is applied by the default Style's `CornerRadius =
    // @ShapeFull` setter (theme-token reactive); this default_value is the
    // same shape as a safety net for a Button used without its Style.
    public static readonly CornerRadiusKey     = MuralBase.RegisterProperty<number | CornerRadius>(Button, 'CornerRadius',      CornerRadius.Full,    MetaData.None);

    static
    {
        // Theme-style lookup key — Button instances resolve their
        // default Style via TryFindResource(Button) on attach.
        MuralBase.OverrideMetadata(Button, Element.DefaultStyleKeyKey, { default_value: Button });
        // Ensures the consolidated controls theme — which holds the
        // Button ControlTemplate keyed by the Button class function —
        // is registered with Application exactly once.
    }

    private readonly _clickHandlers: ClickHandler[] = [];
    private _pressOriginatedHere = false;

    // ICommandSource bookkeeping — owns the cached _canExecute boolean,
    // the CanExecuteChanged subscription on the active Command, and the
    // RoutedCommand routing branch. Forwarded from OnPropertyChanged so
    // Command / CommandParameter / CommandTarget DP writes refresh the
    // cache regardless of write source (binding push, setter call,
    // compiler emission).
    private readonly _commandSource = new CommandSourceHelper(this);

    constructor(content?: Visual)
    {
        super();
        if (content !== undefined) this.Content = content;
        // Template + IsPressed / IsMouseOver swaps + per-variant
        // Foreground / FontWeight defaults all live on the default
        // Style (see basic.resources.mu, Button block). Each variant's
        // template writes `TextBlock.Foreground = @<correct M3 role>`
        // on PART_Border, which inherits down to the user-supplied
        // Content's TextBlock(s) — Filled paints OnPrimary, Elevated /
        // Outlined / Text paint Primary, Tonal paints OnSecondaryContainer.
        this.applyDefaultStyle();
    }

    public get Command(): ICommand | undefined { return this.get_property_value(Button.CommandKey); }
    public set Command(v: ICommand | undefined) { this.set_property_value(Button.CommandKey, v); }

    public get CommandParameter(): unknown { return this.get_property_value(Button.CommandParameterKey); }
    public set CommandParameter(v: unknown) { this.set_property_value(Button.CommandParameterKey, v); }

    public get CommandTarget(): Visual | undefined { return this.get_property_value(Button.CommandTargetKey); }
    public set CommandTarget(v: Visual | undefined) { this.set_property_value(Button.CommandTargetKey, v); }

    public get ClickMode(): ClickMode { return this.get_property_value(Button.ClickModeKey); }
    public set ClickMode(v: ClickMode) { this.set_property_value(Button.ClickModeKey, v); }

    public get Variant(): ButtonVariant { return this.get_property_value(Button.VariantKey); }
    public set Variant(v: ButtonVariant) { this.set_property_value(Button.VariantKey, v); }

    public get CornerRadius(): number | CornerRadius { return this.get_property_value(Button.CornerRadiusKey); }
    public set CornerRadius(v: number | CornerRadius) { this.set_property_value(Button.CornerRadiusKey, v); }

    // Register a handler invoked alongside Command on every click.
    // Returns the same handler so chaining patterns like
    // `const off = btn.AddClickHandler(...); off();` aren't tempting
    // — explicit Remove keeps lifetime ownership clear.
    public AddClickHandler(h: ClickHandler): void
    {
        this._clickHandlers.push(h);
    }

    public RemoveClickHandler(h: ClickHandler): void
    {
        const i = this._clickHandlers.indexOf(h);
        if (i >= 0) this._clickHandlers.splice(i, 1);
    }

    // ── Input virtuals ─────────────────────────────────────────────

    protected override OnPointerDown(args: PointerEventArgs): void
    {
        this._pressOriginatedHere = true;
        this._setIsPressed(true);
        if (this.ClickMode === ClickMode.Press)
        {
            this.fireClick(args);
        }
    }

    protected override OnPointerUp(args: PointerEventArgs): void
    {
        // Release-mode click fires only when the press started here
        // AND the pointer is still over the button. Drag-off + release
        // intentionally swallows the click — same as native buttons.
        const fire = this.ClickMode === ClickMode.Release
            && this._pressOriginatedHere
            && this.IsMouseOver;
        // Clear IsPressed BEFORE the click so handlers reading
        // IsPressed inside their callback see the post-release state.
        this._setIsPressed(false);
        this._pressOriginatedHere = false;
        if (fire) this.fireClick(args);
    }

    protected override OnPointerEnter(args: PointerEventArgs): void
    {
        if (this.ClickMode === ClickMode.Hover)
        {
            this.fireClick(args);
            return;
        }
        // Dragging the pointer back onto the button while the same
        // press is still active restores the IsPressed visual cue.
        if (this._pressOriginatedHere)
        {
            this._setIsPressed(true);
        }
    }

    protected override OnPointerLeave(_args: PointerEventArgs): void
    {
        // Dragging off the button while still pressed clears IsPressed
        // so the press visual reverts. `_pressOriginatedHere` stays
        // true so a drag-back-on can restore both the flag and the
        // visual without re-routing through PointerDown.
        if (this._pressOriginatedHere)
        {
            this._setIsPressed(false);
        }
    }

    // Keyboard activation — Space and Enter invoke the button when it
    // has focus. WPF parity (`ButtonBase.OnKeyDown` does the same). The
    // key is held down → IsPressed=true so the press chrome reads; on
    // release → IsPressed=false and Click fires. This bypasses the
    // InputBinding/CommandBinding pipeline entirely; activation is an
    // intrinsic Button behavior, not a re-bindable shortcut.
    //
    // Pointer ClickHandlers (AddClickHandler) are not invoked for
    // keyboard activation — their args type is PointerEventArgs. The
    // Command, OnPreClick, and OnClick subclass hooks DO fire so the
    // user-visible behavior is consistent across activation modes.
    protected override OnKeyDown(args: KeyEventArgs): void
    {
        if (args.Key !== Key.Space && args.Key !== Key.Return) return;
        args.Handled = true;
        // Match WPF: pressing Space/Enter flips IsPressed for the press
        // chrome. The matching OnKeyUp (or focus loss) clears it.
        this._setIsPressed(true);
        // For Enter, fire activation on KeyDown (Enter is a "commit" key
        // and Repeat fires Activation in WPF as well). For Space, WPF
        // fires on KeyUp to allow the user to back out by moving focus
        // off mid-hold — but cancelling focus mid-key isn't well
        // supported here yet, so we fire on Down for both. Revisit when
        // we ship space-cancel semantics.
        this.fireClickFromKey(args);
    }

    protected override OnKeyUp(args: KeyEventArgs): void
    {
        if (args.Key !== Key.Space && args.Key !== Key.Return) return;
        this._setIsPressed(false);
    }

    // Keyboard counterpart to fireClick — runs the Command + OnClick
    // virtual chain, skipping the PointerEventArgs-typed ClickHandlers
    // (their args type doesn't fit a KeyEventArgs). The CanExecute gate
    // mirrors the pointer path so a disabled Command suppresses both.
    private fireClickFromKey(args: KeyEventArgs): void
    {
        if (this.Command !== undefined && !this._commandSource.CanExecute) return;
        this.OnPreClick(args as never);
        this._commandSource.Execute();
        this.OnClick(args as never);
    }

    // Subclass hook. Default is empty. Called AFTER Command + handler
    // list have run, so a subclass override receives the same arg flow
    // as the public surface and can layer additional behaviour without
    // stepping on Command consumers.
    protected OnClick(_args: PointerEventArgs): void { /* override */ }

    // Earlier-stage subclass hook. Called BEFORE Command + handlers fire
    // (immediately after the CanExecute gate). ToggleButton overrides
    // this to flip IsChecked so its Command / ClickHandlers / OnClick
    // see the post-toggle state. Default no-op.
    protected OnPreClick(_args: PointerEventArgs): void { /* override */ }

    private fireClick(args: PointerEventArgs): void
    {
        // Helper enforces the gate: Execute returns false when
        // CanExecute is false. Skip handler dispatch in that case so the
        // Button behaves consistently whether the command is a
        // RelayCommand (CanExecute polled) or a RoutedCommand (no
        // CommandBinding caught it). When Command is undefined the
        // helper returns false but click handlers still need to run —
        // a Button-without-Command is a legitimate, common shape.
        if (this.Command !== undefined && !this._commandSource.CanExecute) return;
        this.OnPreClick(args);
        this._commandSource.Execute();
        // Snapshot the handler list so a handler that removes itself
        // mid-fire doesn't perturb the iteration. Same defensive copy
        // pattern as DOM event dispatch.
        const handlers = this._clickHandlers.slice();
        for (const h of handlers) h(args);
        this.OnClick(args);
    }

    // ── Command bookkeeping ────────────────────────────────────────

    // Forward Command / CommandParameter / CommandTarget changes to the
    // helper so the cached _canExecute boolean and the CanExecuteChanged
    // subscription stay in sync. OnPropertyChanged is the single seam
    // that fires on every write path (binding push, setter call,
    // compiler emission), so bookkeeping lives here rather than in
    // public setters.
    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Name === 'Command')
        {
            this._commandSource.OnCommandChanged(
                oldValue as ICommand | undefined,
                newValue as ICommand | undefined,
            );
            this.autoDeriveTooltipFromCommand(
                oldValue as ICommand | undefined,
                newValue as ICommand | undefined,
            );
        }
        else if (descriptor.Name === 'CommandParameter' || descriptor.Name === 'CommandTarget')
        {
            this._commandSource.OnParameterOrTargetChanged();
        }
    }

    // When Command is set to a CommandBase AND no explicit ToolTip is on
    // the button, push the command itself as the tooltip Content. The
    // default ContentPresenter dispatch picks the DataTemplate keyed by
    // DataType=CommandBase (shipped in framework.resources.mu) — the
    // user gets a rich tooltip (Text + Description + shortcut row)
    // without writing anything beyond `Button [Command=$SaveCommand]`.
    //
    // Auto-derive is gated four ways:
    //   1. New value must be a CommandBase — plain ICommand impls don't
    //      carry Text/Description, so there's nothing to display.
    //   2. At least one of Text / Description must be non-empty — a
    //      command with no display metadata would render an empty
    //      tooltip surface on hover (chrome with two zero-content
    //      TextBlocks). Most demo RelayCommands omit the metadata, so
    //      gating here keeps the auto-tooltip out of their way.
    //   3. The button must not already carry an explicit ToolTip — an
    //      author-supplied tooltip always wins.
    //   4. If the OLD command was the same CommandBase we auto-set, we
    //      clear it before setting the new value so a Command swap from
    //      A → undefined cleanly retracts the auto-tooltip.
    private _autoTooltipCommand: CommandBase | undefined;

    private autoDeriveTooltipFromCommand(
        oldCmd: ICommand | undefined,
        newCmd: ICommand | undefined,
    ): void
    {
        // Retract a prior auto-tooltip if the new command isn't going to
        // claim the slot. Explicit ToolTip writes after our auto-set go
        // through SetToolTip → our check below sees them and we don't
        // overwrite.
        if (this._autoTooltipCommand !== undefined
            && ToolTipService.GetToolTip(this) === this._autoTooltipCommand)
        {
            ToolTipService.SetToolTip(this, undefined);
            this._autoTooltipCommand = undefined;
        }
        if (!(newCmd instanceof CommandBase)) return;
        // Skip if the command has no display metadata — both Text and
        // Description empty means the rich-tooltip template would stamp
        // an empty surface; the chrome would still appear on hover with
        // no visible text, which reads as "broken tooltip".
        if ((newCmd.Text ?? '') === '' && (newCmd.Description ?? '') === '') return;
        // Don't overwrite an explicit ToolTip the author already set.
        if (ToolTipService.GetToolTip(this) !== undefined) return;
        ToolTipService.SetToolTip(this, newCmd);
        this._autoTooltipCommand = newCmd;
        void oldCmd; // silence unused — kept for symmetry with caller
    }
}
