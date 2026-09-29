import { ObservableCollection, RelayCommand, type ICommand } from '../../runtime/index.js';
import type { HierarchyItemVM } from './hierarchy-item-vm.js';

// The context a HierarchyAction handler receives: the right-clicked/focused row (Anchor)
// and the full selection. Each VM exposes Data (the ExtObject), so handlers reach the
// engine object without new plumbing.
export interface HierarchyActionContext
{
    readonly Anchor: HierarchyItemVM;
    readonly Selection: readonly HierarchyItemVM[];
}

// One context-menu entry. `Invoke` is a no-arg ICommand that captures the context passed
// at build time (ActionsFor runs when the menu opens, so the selection snapshot is live).
// `Children` is observable so a dynamic submenu renders immediately and fills in async.
export class HierarchyAction
{
    private static readonly SeparatorLabel = '-';

    public readonly Children = new ObservableCollection<HierarchyAction>();

    private constructor(
        public readonly Label: string,
        public readonly Invoke: ICommand,
        public readonly IsSeparator: boolean,
        public readonly IconKey: string | undefined,
    )
    {
    }

    public static Command(
        label: string,
        run: (context: HierarchyActionContext) => void | Promise<void>,
        opts?: { context?: HierarchyActionContext; canExecute?: (context: HierarchyActionContext) => boolean; iconKey?: string },
    ): HierarchyAction
    {
        const ctx = opts?.context;
        const invoke = new RelayCommand(
            () => { void run(ctx as HierarchyActionContext); },
            () => (opts?.canExecute === undefined ? true : opts.canExecute(ctx as HierarchyActionContext)),
        );
        return new HierarchyAction(label, invoke, false, opts?.iconKey);
    }

    public static Separator(): HierarchyAction
    {
        return new HierarchyAction(HierarchyAction.SeparatorLabel, new RelayCommand(() => {}, () => false), true, undefined);
    }
}
