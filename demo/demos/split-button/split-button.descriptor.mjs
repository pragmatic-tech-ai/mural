// split-button demo — M3 SplitButton primary + chevron menu trigger.
//
// MenuContent is the *items* list — a vertical StackPanel of Text-variant
// Buttons. The popup chrome (SurfaceContainerHigh fill, OutlineVariant
// stroke, ShapeExtraSmall corner, Elevation2 shadow) comes from SplitButton's
// PopupTemplate, set by the default Style in framework.resources.mu.
// The bootstrap doesn't touch M3 tokens; the framework template owns
// theme tracking via the same DynamicResource path the rest of the
// framework uses.
import { StackPanel, TextBlock, Orientation } from '@pragmatic-tech-ai/mural/basic';
import { Button, ButtonVariant }              from '@pragmatic-tech-ai/mural/framework';
import { SplitButtonVM } from './split-button-vm.mjs';

let vmInstance;

function buildMenuItems(vm) {
    const stack = new StackPanel();
    stack.Orientation = Orientation.Vertical;

    const addItem = (label, command) => {
        const btn = new Button();
        btn.Variant = ButtonVariant.Text;
        btn.Command = command;
        const tb = new TextBlock();
        tb.Text = label;
        btn.Content = tb;
        stack.AddChild(btn);
    };
    addItem('Send now',      vm.SendNowCommand);
    addItem('Schedule send', vm.ScheduleSendCommand);
    addItem('Save draft',    vm.SaveDraftCommand);
    return stack;
}

export default {
    id:       'split-button',
    title:    'SplitButton',
    subtitle: 'M3 SplitButton — primary action + chevron menu trigger.',
    factory: () => {
        if (vmInstance === undefined) {
            vmInstance = new SplitButtonVM();
            vmInstance.MenuPopup = buildMenuItems(vmInstance);
        }
        return vmInstance;
    },
};
