// DemosModule — the "Demos" demo group as a ShellModule. One capability
// (rail item) backed by DemosService; the group's demo view dictionaries merge here.
import DemosService from "./demos-service.mjs"
import BouncingBallDemo from "../../demos/bouncing-ball/bouncing-ball.mu.js"
import ColorPickerDemo from "../../demos/color-picker/color-picker.mu.js"
import CommandsDemo from "../../demos/commands/commands.mu.js"
import DiagramDemo from "../../demos/diagram/diagram.mu.js"
import DragDropDemo from "../../demos/drag-drop/drag-drop.mu.js"
import DragDropExtendedDemo from "../../demos/drag-drop-extended/drag-drop-extended.mu.js"
import FillEditorDemo from "../../demos/fill-editor/fill-editor.mu.js"
import HitTestDemo from "../../demos/hit-test/hit-test.mu.js"
import PenEditorDemo from "../../demos/pen-editor/pen-editor.mu.js"
import RibbonDemo from "../../demos/ribbon/ribbon.mu.js"
import RichTextBlockDemo from "../../demos/rich-text-block/rich-text-block.mu.js"
import RichTextEditorDemo from "../../demos/rich-text-editor/rich-text-editor.mu.js"
import TextFormatDemo from "../../demos/text-format/text-format.mu.js"
import TextOnPathDemo from "../../demos/text-on-path/text-on-path.mu.js"
import WordToolboxDemo from "../../demos/word-toolbox/word-toolbox.mu.js"

module DemosModule [ Name = "Demos" ] {
    .services: {
        DemosService
    }

    resources: {
        merge BouncingBallDemo
        merge ColorPickerDemo
        merge CommandsDemo
        merge DiagramDemo
        merge DragDropDemo
        merge DragDropExtendedDemo
        merge FillEditorDemo
        merge HitTestDemo
        merge PenEditorDemo
        merge RibbonDemo
        merge RichTextBlockDemo
        merge RichTextEditorDemo
        merge TextFormatDemo
        merge TextOnPathDemo
        merge WordToolboxDemo
    }

    Capability [ Name = "Demos", Icon = @DemosIcon, ServiceKey = DemosService ]
}
