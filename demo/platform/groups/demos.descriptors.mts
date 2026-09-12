import type { DemoDescriptor } from '../demo-descriptor.mjs';
import bouncingBallDemo from '../../demos/bouncing-ball/bouncing-ball.descriptor.mjs';
import colorPickerDemo from '../../demos/color-picker/color-picker.descriptor.mjs';
import commandsDemo from '../../demos/commands/commands.descriptor.mjs';
import diagramDemo from '../../demos/diagram/diagram.descriptor.mjs';
import dragDropDemo from '../../demos/drag-drop/drag-drop.descriptor.mjs';
import dragDropExtendedDemo from '../../demos/drag-drop-extended/drag-drop-extended.descriptor.mjs';
import fillEditorDemo from '../../demos/fill-editor/fill-editor.descriptor.mjs';
import hitTestDemo from '../../demos/hit-test/hit-test.descriptor.mjs';
import penEditorDemo from '../../demos/pen-editor/pen-editor.descriptor.mjs';
import ribbonDemo from '../../demos/ribbon/ribbon.descriptor.mjs';
import richTextBlockDemo from '../../demos/rich-text-block/rich-text-block.descriptor.mjs';
import richTextEditorDemo from '../../demos/rich-text-editor/rich-text-editor.descriptor.mjs';
import textFormatDemo from '../../demos/text-format/text-format.descriptor.mjs';
import textOnPathDemo from '../../demos/text-on-path/text-on-path.descriptor.mjs';
import wordToolboxDemo from '../../demos/word-toolbox/word-toolbox.descriptor.mjs';

// Static composition — the demos this group's rail item exposes. Replaces the
// old registry snapshot (allDemos() filtered by group). Order is irrelevant;
// DemoGroupService sorts by title.
export const demosDescriptors: readonly DemoDescriptor[] = [
    bouncingBallDemo,
    colorPickerDemo,
    commandsDemo,
    diagramDemo,
    dragDropDemo,
    dragDropExtendedDemo,
    fillEditorDemo,
    hitTestDemo,
    penEditorDemo,
    ribbonDemo,
    richTextBlockDemo,
    richTextEditorDemo,
    textFormatDemo,
    textOnPathDemo,
    wordToolboxDemo,
];
