import {
    CompositeDisposable,
    Element,
    Key,
    MetaData,
    MuralBase,
    Rect,
    Signal,
    Single,
    Size,
    type IDisposable,
    type KeyEventArgs,
} from '../runtime/index.js';
import { TextBlock } from './text-block.js';
import { TextBox } from './text-box.js';

// EditableTextBlock — a generic inline-edit cell: a read-only label that
// swaps to a focused TextBox on demand. Composed as a `Single` (Border's
// base — one child slot, swapped via SetChild) rather than a
// Control/TemplatedControl: there is no ControlTemplate / theme resource
// to author for this control, it just owns its two children directly,
// the same way TextBlock/RichTextBlock own their embedded content.
//
// Deliberately generic — it knows nothing about a hierarchy node, a
// rename command, or any other domain concept. A consumer (e.g. a
// HierarchyItem-bound tree cell) seeds EditingText, flips IsEditing, and
// reacts to Committed / Cancelled; this control only toggles between its
// two children and dispatches Enter / Escape / blur.
//
// DPs:
//   Text        — the display value shown while IsEditing is false.
//   IsEditing   — false (showing Text) / true (showing the inner TextBox,
//                 focused). Toggling attaches/detaches the inner TextBox.
//   EditingText — the in-progress edited value, two-way synced with the
//                 inner TextBox's Text.
//
// Events:
//   Committed — fires on Enter, or on the inner TextBox losing focus
//               while editing, carrying the current EditingText. Edit
//               mode is left FIRST, then the event fires.
//   Cancelled — fires on Escape. Edit mode is left; Text / EditingText
//               are left exactly as they were — the caller discards.
export class EditableTextBlock extends Single implements IDisposable
{
    public static readonly TextKey = MuralBase.RegisterProperty<string>(
        EditableTextBlock, 'Text', '', MetaData.None);
    public static readonly IsEditingKey = MuralBase.RegisterProperty<boolean>(
        EditableTextBlock, 'IsEditing', false, MetaData.None);
    public static readonly EditingTextKey = MuralBase.RegisterProperty<string>(
        EditableTextBlock, 'EditingText', '', MetaData.BindsTwoWayByDefault);

    public readonly Committed: Signal<string> = new Signal<string>();
    public readonly Cancelled: Signal<void>   = new Signal<void>();

    private readonly _display: TextBlock;
    private readonly _editor:  TextBox;
    private readonly _subscriptions = new CompositeDisposable();

    // Re-entry guard: EditingText -> _editor.Text (host-driven writes) and
    // _editor.Text -> EditingText (user typing) are two ends of the same
    // sync; without the guard, writing one would bounce back through the
    // other's listener. Mirrors SpinEdit's `_suppressTextSync`.
    private _suppressEditingTextSync = false;

    constructor(text?: string)
    {
        super();
        this._display = new TextBlock();
        this._editor  = new TextBox();
        this.SetChild(this._display);

        this._subscriptions.add(this.PropertyChanged(EditableTextBlock.TextKey).subscribe(({ newValue }) =>
        {
            // A binding whose source path isn't reachable yet (e.g. applied
            // before the host sets DataContext — the normal
            // Apply()-then-DataContext ordering every container generator
            // uses) pushes `undefined` here even though Text is declared
            // `string`. Fall back to the DP's own default rather than
            // propagating it — TextBlock.Text tolerates undefined, but
            // nothing downstream should have to.
            this._display.Text = (newValue as string | undefined) ?? EditableTextBlock.TextKey.descriptor.DefaultValue;
        }));
        this._subscriptions.add(this.PropertyChanged(EditableTextBlock.EditingTextKey).subscribe(({ newValue }) =>
        {
            if (this._suppressEditingTextSync) return;
            // Same guard as above — TextBox.Text actively computes
            // `value.length` in its setter and throws on undefined, so an
            // unresolved initial binding push must not reach it.
            this._editor.Text = (newValue as string | undefined) ?? EditableTextBlock.EditingTextKey.descriptor.DefaultValue;
        }));
        this._subscriptions.add(this._editor.PropertyChanged(TextBox.TextKey).subscribe(({ newValue }) =>
        {
            this._suppressEditingTextSync = true;
            this.EditingText = newValue as string;
            this._suppressEditingTextSync = false;
        }));
        this._subscriptions.add(this.PropertyChanged(EditableTextBlock.IsEditingKey).subscribe(({ newValue }) =>
        {
            this.applyEditingState(newValue as boolean);
        }));
        // Losing focus commits — same as Enter. Guarded by IsEditing so a
        // blur that arrives after Commit()/Cancel() already left edit mode
        // (e.g. focus teardown on detach) can't double-fire.
        this._subscriptions.add(this._editor.PropertyChanged(Element.IsFocusedKey).subscribe(({ newValue }) =>
        {
            if (newValue === false && this.IsEditing) this.Commit();
        }));

        if (text !== undefined) this.Text = text;
    }

    public get Text(): string { return this.get_property_value(EditableTextBlock.TextKey); }
    public set Text(value: string) { this.set_property_value(EditableTextBlock.TextKey, value); }

    public get IsEditing(): boolean { return this.get_property_value(EditableTextBlock.IsEditingKey); }
    public set IsEditing(value: boolean) { this.set_property_value(EditableTextBlock.IsEditingKey, value); }

    public get EditingText(): string { return this.get_property_value(EditableTextBlock.EditingTextKey); }
    public set EditingText(value: string) { this.set_property_value(EditableTextBlock.EditingTextKey, value); }

    // Enter commits; Escape cancels. The inner TextBox leaves Key.Return
    // unhandled while AcceptsReturn is false (its default — we never set
    // it) and has no case for Key.Escape at all, so both bubble up here
    // from the focused editor without any Preview/tunnel interception.
    protected override OnKeyDown(args: KeyEventArgs): void
    {
        if (args.Handled || !this.IsEditing) return;
        switch (args.Key)
        {
            case Key.Return:
                this.Commit();
                args.Handled = true;
                return;
            case Key.Escape:
                this.Cancel();
                args.Handled = true;
                return;
        }
    }

    // Commits the in-progress EditingText: leaves edit mode, then raises
    // Committed with the value. A no-op when not currently editing.
    public Commit(): void
    {
        if (!this.IsEditing) return;
        const value = this.EditingText;
        this.IsEditing = false;
        this.Committed.emit(value);
    }

    // Discards the in-progress edit: leaves edit mode and raises
    // Cancelled. Text / EditingText are left exactly as they were.
    public Cancel(): void
    {
        if (!this.IsEditing) return;
        this.IsEditing = false;
        this.Cancelled.emit(undefined);
    }

    // Releases the internal Text/EditingText/focus subscriptions wired in
    // the constructor. Lowercase `dispose` — implements todl-runtime's
    // `IDisposable`, not a PascalCase public method of our own.
    public dispose(): void
    {
        this._subscriptions.dispose();
    }

    protected override MeasureOverride(availableSize: Size): Size
    {
        if (this.child === undefined) return Size.Zero;
        this.child.Measure(availableSize);
        return this.child.DesiredSize;
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        if (this.child !== undefined)
        {
            this.child.Arrange(new Rect(0, 0, finalSize.Width, finalSize.Height));
        }
        return finalSize;
    }

    private applyEditingState(isEditing: boolean): void
    {
        if (isEditing)
        {
            this.SetChild(this._editor);
            this._editor.Focus();
        }
        else
        {
            this.SetChild(this._display);
        }
    }
}
