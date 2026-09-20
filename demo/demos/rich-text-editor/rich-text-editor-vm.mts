// VM for the rich-text-editor demo. The editor is self-contained — its
// FlowDocument is authored in markup and all editing state (caret,
// selection, formatting) lives on the RichTextBox itself — so the VM holds
// no document state. It exists only as the DataTemplate's DataType and to
// receive OnViewMounted, where the bootstrap wires the formatting toolbar
// to the editor's public editing commands.
import { MuralBase } from '@pragmatic-tech-ai/mural/runtime';
import type { Visual } from '@pragmatic-tech-ai/mural/runtime';

export class RichTextEditorVM extends MuralBase
{
    /** Set by the bootstrap; the platform calls it after the view
     *  materializes so the toolbar can bind to the editor. */
    OnViewMounted?: (view: Visual) => void;
}
