// commands demo bootstrap — wires the framework Diagram's selection
// state through to the VM (CommandsVM.HasSelection drives the gated
// commands' CanExecute) and seeds the canvas with a few starter
// Figures.
//
// Items are framework Figures themselves now; `ReflectSelectionToItems`
// on the Diagram does the IsSelected mirroring the old bridge used to do
// in JS. This bootstrap just publishes the aggregate HasSelection state
// to the VM.
import { Application } from '@pragmatic-tech-ai/mural/runtime';
import { Diagram, DiagramStorageKey } from '@pragmatic-tech-ai/mural/framework';
import { CommandsVM } from './commands-vm.mjs';

let vmInstance;

function attachBehaviors(view, vm) {
    const nodes = view.FindName('nodes');
    if (!(nodes instanceof Diagram)) throw new Error('commands.mu missing x:name="nodes" Diagram');

    // Same framework-command proxy wire-up as the diagram demo. The
    // commands demo's markup binds to $AlignLeftCommand etc. on the VM;
    // each proxy DP is populated from the framework Diagram's own
    // RelayCommand instance here.
    {
        const Diagram_ = Diagram;
        const VM       = vm.constructor;
        const COMMANDS = [
            'AlignLeftCommandKey', 'AlignRightCommandKey', 'AlignTopCommandKey',
            'AlignMiddleCommandKey', 'AlignCenterCommandKey',
            'DistributeHorizontalCommandKey', 'DistributeVerticalCommandKey',
            'GroupCommandKey', 'UngroupCommandKey',
            'CombineUnionCommandKey', 'CombineIntersectCommandKey',
            'CombineSubtractCommandKey', 'CombineExcludeCommandKey',
        ];
        for (const key of COMMANDS) {
            vm.set_property_value(VM[key], nodes.get_property_value(Diagram_[key]));
        }
    }

    // SelectionChanged → publish HasSelection. ReflectSelectionToItems
    // on the Diagram (set in markup) already mirrors selection onto
    // each Figure.IsSelected — the Style triggers fire off that.
    const onSelectionChanged = () => {
        vm.PublishSelectionState(nodes.SelectedItems.length > 0);
    };
    nodes.AddSelectionChangedListener(onSelectionChanged);

    // Keyboard: Delete / Backspace removes selected nodes.
    view.AddRoutedEventListener('KeyDown', (args) => {
        if (args?.Key !== 'Delete' && args?.Key !== 'Backspace') return;
        const snapshot = [...nodes.SelectedItems];
        if (snapshot.length === 0) return;
        vm.DeleteCommand.Execute(snapshot);
        args.Handled = true;
    });

    // Seed the canvas so the demo opens populated.
    queueMicrotask(() => {
        vm.CreateNode('rect',    80,  80);
        vm.CreateNode('rect',    260, 80);
        vm.CreateNode('ellipse', 80,  200);
        vm.CreateNode('note',    260, 200);
        vm.Status = `Ready. ${vm.Nodes.Count} nodes. Click / Ctrl-click / marquee to select; right-click for context menu.`;
    });

    return function detachAll() {
        nodes.RemoveSelectionChangedListener(onSelectionChanged);
        vm.PublishSelectionState(false);
    };
}

export default {
    id:       'commands',
    title:    'Commands',
    subtitle: 'ToolBar + Menu + ContextMenu over a Diagram. One ICommand instance drives every surface.',
    factory: () => {
        if (vmInstance === undefined) vmInstance = new CommandsVM(Application.current?.Services.get(DiagramStorageKey));
        vmInstance.OnViewMounted = (view) => attachBehaviors(view, vmInstance);
        return vmInstance;
    },
};
