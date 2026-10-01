import {
    Observable,
    type IDisposable,
    CompositeDisposable,
    ObservableCollection,
    type ICommand,
} from '../../../runtime/index.js';
import type { Geometry } from '../../../visual-engine/index.js';
import type { CommandDefinition } from './command-definition.js';

// One bindable command view-model for every surface (toolbar button, menu row).
// Observable (not MuralBase) — a menu rebuilds this per open and a tree can be
// deep. Children is empty for a flat toolbar item, populated for a menu node.
export class CommandViewModel extends Observable implements IDisposable
{
    private static readonly IsCheckedPropertyName = 'IsChecked';

    private readonly subscriptions = new CompositeDisposable();
    private checked = false;

    public readonly Children: ObservableCollection<CommandViewModel> = new ObservableCollection<CommandViewModel>();

    constructor(
        public readonly Definition: CommandDefinition,
        public readonly Command: ICommand,
        public readonly IsToggle: boolean = false,
    )
    {
        super();
    }

    public get Title(): string { return this.Definition.Title; }
    public get Icon(): Geometry | undefined { return this.Definition.Icon; }
    public get SeparatorBefore(): boolean { return this.Definition.SeparatorBefore; }
    public get HasChildren(): boolean { return this.Children.Count > 0 || this.Definition.ChildrenContributor !== undefined; }

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
