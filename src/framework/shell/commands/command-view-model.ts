import {
    Observable,
    type IDisposable,
    Disposable,
    CompositeDisposable,
    ObservableCollection,
    type ICommand,
} from '../../../runtime/index.js';
import type { Geometry } from '../../../visual-engine/index.js';
import type { CommandDefinition } from './command-definition.js';
import type { ICommandChildRealizer } from './command-child-realizer.js';
import type { ExpandableMenuData } from '../../menu/expandable-menu-data.js';

// One bindable command view-model for every surface (toolbar button, menu row).
// Observable (not MuralBase) — a menu rebuilds this per open and a tree can be
// deep. Children is empty for a flat toolbar item, populated for a menu node.
export class CommandViewModel extends Observable implements IDisposable, ExpandableMenuData
{
    private static readonly IsCheckedPropertyName = 'IsChecked';
    private static readonly IsEnabledPropertyName = 'IsEnabled';

    private readonly subscriptions = new CompositeDisposable();
    private checked = false;

    // The strategy that populates Children on first expand (set by whatever
    // builder constructed this VM for a menu surface — a flat toolbar VM never
    // gets one). Realized at most once; see EnsureExpanded.
    private realizer: ICommandChildRealizer | undefined;
    private realized = false;

    public readonly Children: ObservableCollection<CommandViewModel> = new ObservableCollection<CommandViewModel>();

    constructor(
        public readonly Definition: CommandDefinition,
        public readonly Command: ICommand,
        public readonly IsToggle: boolean = false,
    )
    {
        super();
        // Live-dims the rendered row: a command's executability can change
        // independently of any toggle state (selection cleared, document
        // read-only, …), so every VM — not just toggles — listens for the
        // pulse and re-raises. Command may be undefined at runtime despite
        // the non-optional type (CommandMenuBuilder resolves it with an
        // `as ICommand` cast that can still yield undefined), so guard here
        // exactly as the IsEnabled getter below does.
        if (this.Command !== undefined)
        {
            const onCanExecuteChanged = (): void =>
            {
                this.RaisePropertyChanged(CommandViewModel.IsEnabledPropertyName, undefined, undefined);
            };
            this.Command.AddCanExecuteChangedListener(onCanExecuteChanged);
            this.subscriptions.add(new Disposable(() => this.Command.RemoveCanExecuteChangedListener(onCanExecuteChanged)));
        }
    }

    public get Title(): string { return this.Definition.Title; }
    public get Icon(): Geometry | undefined { return this.Definition.Icon; }
    public get SeparatorBefore(): boolean { return this.Definition.SeparatorBefore; }
    public get HasChildren(): boolean
    {
        return this.Children.Count > 0
            || this.Definition.Children.Count > 0
            || this.Definition.ChildrenContributor !== undefined;
    }

    // Live-read, not cached — the menu row re-queries this on every
    // CanExecuteChanged pulse (see ctor) rather than tracking a shadow field,
    // since the command itself is the single source of truth. Guards an
    // undefined Command (see ctor comment) by treating it as always enabled.
    public get IsEnabled(): boolean { return this.Command === undefined ? true : this.Command.CanExecute(); }

    public get IsChecked(): boolean { return this.checked; }
    public set IsChecked(v: boolean)
    {
        if (this.checked === v)
        {
            return;
        }
        const old = this.checked;
        this.checked = v;
        this.RaisePropertyChanged(CommandViewModel.IsCheckedPropertyName, old, v);
    }

    // Registers the strategy EnsureExpanded delegates to. Set by the builder
    // that constructed this VM (a menu node whose definition has static
    // children or a ChildrenContributor); left unset for a flat toolbar VM.
    public SetChildRealizer(realizer: ICommandChildRealizer): void
    {
        this.realizer = realizer;
    }

    // Registers a teardown the builder wants run when THIS VM disposes — e.g.
    // the live IsChecked-sync listener CommandMenuBuilder.Build attaches to a
    // toggle's resolved ICheckableCommand. Released by dispose() below, so a
    // menu rebuilt per-open (CommandContextMenu) or per-root (MainMenuService)
    // never accumulates listeners on the underlying command.
    public AddSubscription(subscription: IDisposable): void
    {
        this.subscriptions.add(subscription);
    }

    // Populate Children on first call (menu submenu-open). Idempotent — a
    // second call is a no-op, which is why a self-referential
    // ChildrenContributor cannot loop (each level expands only when its own
    // submenu opens). No realizer, or already realized, → nothing to do.
    public EnsureExpanded(): void
    {
        if (this.realized)
        {
            return;
        }
        this.realized = true;
        this.realizer?.RealizeChildren(this);
    }

    // ExpandableMenuData — the Menu family calls this the first time this node's
    // submenu opens. Idempotent via EnsureExpanded, so re-opens are cheap and a
    // ChildrenContributor's rows populate exactly once.
    public OnSubmenuOpen(): void
    {
        this.EnsureExpanded();
    }

    public dispose(): void
    {
        for (const child of this.Children)
        {
            child.dispose();
        }
        this.Children.Clear();
        this.subscriptions.dispose();
    }
}

// RULING (kept deliberately — the shell renders the flat toolbar stream by
// implicit DataTemplate-by-TYPE, so a toggle button needs its OWN type to
// resolve DataTemplate[CommandToggleViewModel] instead of the plain
// DataTemplate[CommandViewModel]; findDataTemplateForType walks the prototype
// chain, so without a distinct type it would fall back to the plain button.
// Carries no logic — toggle STATE lives in CommandViewModel.IsChecked.)
export class CommandToggleViewModel extends CommandViewModel { }
