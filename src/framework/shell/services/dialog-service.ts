import {
    DynamicResource,
    type IServiceProvider,
    MuralBase,
    RelayCommand,
    ServiceBase,
    ServiceKey,
    Visual,
} from '../../../runtime/index.js';
import {
    HorizontalAlignment,
    VerticalAlignment,
    type Brush,
} from '../../../visual-engine/index.js';
import { Border } from '../../../basic/border.js';
import { TextBlock, TextWrapping } from '../../../basic/text-block.js';
import { ButtonVariant } from '../../buttons/button.js';
import { Dialog } from '../../surfaces/dialog.js';
import { DialogAction } from '../../surfaces/dialog-action.js';
import { ScrimSurface } from '../../surfaces/drawer.js';
import { showDialog } from '../../overlay-helpers.js';

// What to show in a modal dialog. `Content` is the body — a MuralBase (rendered by
// its own DataTemplate, e.g. a SettingsPage) or a ready-made Visual. `Actions` is
// the optional trailing action row — an array of DialogAction view-models the
// Dialog template stamps into Buttons. Sizing is optional; unset lets the dialog
// size to its content (with the surface centred over the scrim).
export interface DialogOptions {
    readonly Title?: string;
    readonly Content: MuralBase | Visual;
    readonly Actions?: readonly DialogAction[];
    // Fixed body width / max height for large content (a settings page): the
    // content's own ScrollViewer scrolls within the bounded surface. Omit for
    // small prompts that should size to their text.
    readonly Width?: number;
    readonly MaxHeight?: number;
    // Clicking the scrim (or Escape) cancels — resolving Show() with undefined.
    // Default true; set false for a dialog that must be dismissed via an action.
    readonly DismissOnScrimClick?: boolean;
}

// A yes/no confirmation: a wrapped message body plus a Cancel / Confirm action
// row. The confirming action is Filled (the primary affordance); the cancel
// action is text. Labels and body width fall back to sensible defaults.
export interface ConfirmOptions {
    readonly Title: string;
    readonly Message: string;
    readonly ConfirmLabel?: string; // default "OK"
    readonly CancelLabel?: string; // default "Cancel"
    readonly Width?: number; // default 380
}

// The app's modal-dialog surface. A single place to open a Dialog over everything
// (settings, confirms, pickers) without every call site hand-building the surface,
// scrim, and overlay wiring.
//
// It builds an M3 Dialog + a dimming ScrimSurface and mounts them on the shell
// host's PresentationTarget overlay layer via `showDialog` (which already traps
// focus and closes on Escape); this service adds the standard scrim-click dismiss,
// the @Scrim backdrop tint, and a Promise-returning `Show`. Shell-scoped and
// auto-registered by EditorShell, which hands it the host Visual (`SetHost`) so
// the service — which owns no Visual of its own — can reach the overlay layer.
export class DialogService extends ServiceBase {
    public static readonly Key = new ServiceKey<DialogService>('DialogService');

    // The live Visual whose PresentationTarget owns the overlay layer the dialog
    // mounts onto. The shell sets this once its tree exists. `showDialog` reads the
    // target off it lazily (at Show time), so an early SetHost before the shell has
    // a target is fine — the target resolves by the time a dialog is opened.
    private _host: Visual | undefined;
    // Close thunk for the currently-open dialog (single active dialog at a time).
    private _close: ((value?: unknown) => void) | undefined;

    constructor(provider: IServiceProvider) {
        super(provider);
    }

    // Register the anchor Visual (the shell root). Reachable-overlay is resolved
    // from it at Show time.
    public SetHost(host: Visual): void {
        this._host = host;
    }

    // True while a dialog is open.
    public get IsOpen(): boolean {
        return this._close !== undefined;
    }

    // Open a modal dialog. Resolves with the value passed to Close() (an action's
    // result), or undefined when cancelled via the scrim / Escape. A second Show
    // while one is open closes the first.
    public Show<T = unknown>(options: DialogOptions): Promise<T | undefined> {
        const host = this._host;
        if (host === undefined) return Promise.resolve(undefined);
        // One dialog at a time — supersede any open one.
        this._close?.(undefined);

        const scrim = new ScrimSurface();
        // Theme backdrop tint (@Scrim — the modal overlay token) via DynamicResource
        // so it tracks light/dark. Installed as a binding on Fill.
        scrim.set_property_value(
            Border.FillKey,
            DynamicResource(scrim, 'Scrim') as unknown as Brush,
        );

        const dialog = new Dialog();
        if (options.Title !== undefined) dialog.Title = options.Title;
        (dialog as unknown as { Content: MuralBase | Visual }).Content = options.Content;
        if (options.Actions !== undefined) dialog.Actions = options.Actions;
        // Centre the surface within the full-surface overlay slot (OverlayLayer
        // arranges children at the whole surface; Center makes the dialog sit at
        // its DesiredSize in the middle instead of stretching edge-to-edge).
        dialog.HorizontalAlignment = HorizontalAlignment.Center;
        dialog.VerticalAlignment = VerticalAlignment.Center;
        if (options.Width !== undefined) dialog.Width = options.Width;
        if (options.MaxHeight !== undefined) dialog.MaxHeight = options.MaxHeight;

        const { closed, close } = showDialog<T>(host, dialog, scrim);
        const myClose = close as (value?: unknown) => void;
        this._close = myClose;
        if (options.DismissOnScrimClick !== false) {
            scrim.onClick = (): void => close(undefined);
        }
        // Clear the handle when THIS dialog closes — but only if a newer Show
        // hasn't already replaced it (supersede path), else the superseded
        // dialog's resolution would wipe the live one's close handle.
        void closed.then(() => {
            if (this._close === myClose) this._close = undefined;
        });
        return closed;
    }

    // Open a modal yes/no confirmation and resolve to the user's choice: true
    // when the confirming action is chosen, false on cancel or a scrim / Escape
    // dismissal. A convenience over Show() for the common two-button prompt — it
    // builds the wrapped message body and the Cancel / Confirm action row.
    public async Confirm(options: ConfirmOptions): Promise<boolean> {
        const body = new TextBlock();
        body.Text = options.Message;
        body.TextWrapping = TextWrapping.Wrap;

        const result = await this.Show<boolean>({
            Title: options.Title,
            Content: body,
            Width: options.Width ?? 380,
            Actions: [
                new DialogAction(
                    options.CancelLabel ?? 'Cancel',
                    new RelayCommand(() => this.Close(false)),
                ),
                new DialogAction(
                    options.ConfirmLabel ?? 'OK',
                    new RelayCommand(() => this.Close(true)),
                    ButtonVariant.Filled,
                ),
            ],
        });
        return result === true;
    }

    // Close the open dialog (if any), resolving Show() with `result`.
    public Close(result?: unknown): void {
        this._close?.(result);
    }

    public override dispose(): void {
        this._close?.(undefined);
        super.dispose();
    }
}
