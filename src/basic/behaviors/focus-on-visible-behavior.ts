import {
    Behavior,
    MetaData,
    MuralBase,
    Visibility,
    Visual,
    type Disposable,
} from '../../runtime/index.js';

// FocusOnVisibleBehavior — moves keyboard focus to its host the instant the
// host becomes visible, and (by default) selects the host's text if it is an
// editor. Purpose: declarative auto-focus for an inline editor that lives in
// the tree permanently but toggles Visibility — e.g. a rename TextBox revealed
// by an `IsEditing` binding. Without it the editor appears unfocused and the
// user has to click before typing.
//
// It focuses the host if the host itself is focusable, otherwise its first
// focusable descendant — so it can attach either directly to a focusable editor
// or to a non-focusable wrapper that toggles visibility (e.g. a Border around an
// inline TextBox, since a TextBox has no content model to host a Behaviors block):
//   Border [ Visibility = $IsEditing << ToVisibility ] {
//       Behaviors { FocusOnVisibleBehavior }
//       TextBox [ Text = $EditingName, Variant = Plain ]
//   }
//
// It watches the host's Visibility DP; every transition to Visible re-focuses
// (and re-selects), so re-entering edit mode on the same row works too. It also
// re-focuses on every MOUNT edge (AddAttachedListener) — the crucial case for
// an editor STAMPED on demand (e.g. swapped in by a ContentTemplate trigger
// rather than toggled in place): at AddBehavior time the host has no children
// yet and isn't in the live tree, so the immediate focus attempt below finds
// nothing; the attach edge fires once the subtree is built and mounted, when
// the editor is present and the input manager is reachable.
//
// SelectAll (default true) selects the whole text on focus so the first
// keystroke replaces it — the standard rename-field behaviour. It is a no-op
// on targets that expose no SelectAll() method.
// The Element mount-edge surface the behavior needs — duck-typed so a
// FocusOnVisibleBehavior can attach to any Visual without a hard Element import.
// A plain Visual that isn't an Element simply lacks these methods and the
// behavior falls back to the Visibility-listener + immediate-focus paths.
interface ElementAttachSurface
{
    AddAttachedListener?:    (listener: () => void) => void;
    RemoveAttachedListener?: (listener: () => void) => void;
}

export class FocusOnVisibleBehavior extends Behavior
{
    public static readonly SelectAllKey = MuralBase.RegisterProperty<boolean>(
        FocusOnVisibleBehavior, 'SelectAll', true, MetaData.None);

    public get SelectAll(): boolean { return this.get_property_value(FocusOnVisibleBehavior.SelectAllKey); }
    public set SelectAll(v: boolean) { this.set_property_value(FocusOnVisibleBehavior.SelectAllKey, v); }

    private _visual:   Visual | undefined;
    private _sub:      Disposable | undefined;
    private _attached: (() => void) | undefined;

    public override OnAttached(visual: Visual): void
    {
        this._visual = visual;
        this._sub = visual.PropertyChanged(Visual.VisibilityKey).subscribe(() => this.focusIfVisible());
        // Focus on every MOUNT edge — covers the stamped-on-demand editor,
        // whose host has no children and no live target at AddBehavior time.
        // Duck-typed (like SelectAll below) so the behavior stays decoupled from
        // Element; AddAttachedListener fires synchronously when already attached,
        // so the already-mounted case is covered here too.
        const el = visual as unknown as ElementAttachSurface;
        if (typeof el.AddAttachedListener === 'function')
        {
            const attached = (): void => this.focusIfVisible();
            this._attached = attached;
            el.AddAttachedListener(attached);
        }
        // Cover the case where the host is already visible at attach time.
        this.focusIfVisible();
    }

    public override OnDetached(visual: Visual): void
    {
        this._sub?.dispose();
        const el = visual as unknown as ElementAttachSurface;
        if (this._attached !== undefined && typeof el.RemoveAttachedListener === 'function')
        {
            el.RemoveAttachedListener(this._attached);
        }
        this._sub      = undefined;
        this._attached = undefined;
        this._visual   = undefined;
    }

    private focusIfVisible(): void
    {
        const host = this._visual;
        if (host === undefined || host.Visibility !== Visibility.Visible) return;
        const target = firstFocusable(host);
        if (target === undefined) return;
        // Visual.Focus() routes through the element's own InputManager bridge —
        // exactly what Keyboard.Focus(target) does, minus the Element-typed param.
        target.Focus();
        if (this.SelectAll)
        {
            // Duck-typed so the behavior stays decoupled from TextBox — any
            // editor exposing SelectAll() (TextBox, RichTextBox) is selected.
            const editor = target as unknown as { SelectAll?: () => void };
            if (typeof editor.SelectAll === 'function') editor.SelectAll();
        }
    }
}

// The host if it's focusable, else the first focusable Visual in its subtree
// (depth-first). Lets the behavior attach to a non-focusable wrapper around the
// real editor.
function firstFocusable(v: Visual): Visual | undefined
{
    if (v.Focusable) return v;
    for (const child of v.visualChildren)
    {
        const found = firstFocusable(child);
        if (found !== undefined) return found;
    }
    return undefined;
}
