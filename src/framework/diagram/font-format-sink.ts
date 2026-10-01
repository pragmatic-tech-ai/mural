import type { ICommand } from '../../runtime/index.js';

// IFontFormatSink — the font-format editing surface a document exposes to the
// shell toolbar's font-format editor control. The parallel of ICommandDispatcher
// for VALUE editing: where ICommandDispatcher.Resolve is dispatched to
// (Execute/CanExecute on the resolved command), a font sink is BOUND to — a
// picker two-way binds `$FontFamily` / `$FontSize` /
// `$FontColorHex` against the active document, and the size steppers bind the two
// step commands.
//
// A document opts in by backing each member with a DP (so `$path` bindings
// resolve and write back) and keeping them synced with wherever the state truly
// lives — for a diagram, the live Diagram control's Selection* DPs (see
// DiagramDocument, which mirrors them two-way through its published ActiveView).
//
// The interface is the compile-checked contract between the app's editor template
// and its document; the generic shell never sees it (the toolbar hosts the
// module's template with the document as DataContext — see ShellControlDefinition).
export interface IFontFormatSink
{
    // The selection's font family / size / colour. Two-way: a write applies to
    // the current selection; a selection change refreshes the value.
    FontFamily:   string;
    FontSize:     number;
    FontColorHex: string;

    // Grow / shrink the selection's font by one step. Exposed as commands so a
    // stepper button binds `Command = $IncreaseFontSizeCommand` and gets its
    // enablement for free. undefined when nothing can be formatted (no view).
    readonly IncreaseFontSizeCommand: ICommand | undefined;
    readonly DecreaseFontSizeCommand: ICommand | undefined;
}
