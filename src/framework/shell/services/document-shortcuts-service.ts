import type { ICommand, IDisposable } from '../../../runtime/index.js'

// The bits of the document host the shortcuts drive.
export interface IDocumentShortcutCommands
{
    readonly SaveActiveCommand: ICommand
    readonly SaveAllCommand: ICommand
    // Closes the active document THROUGH the close guard (prompts if dirty). Bound
    // to Ctrl+W. Supplied by the caller since the host's own CloseDocumentCommand
    // is keyed by document id, not "the active one".
    readonly CloseActiveCommand: ICommand
}

// Wires Ctrl+S (Save active) / Ctrl+Shift+S (Save All) / Ctrl+W (Close active) at
// the target, CAPTURE phase. Capture is deliberate: it fires before Monaco's own
// handlers AND before the code-editor host's key-swallow boundary, so Ctrl+S works
// even while the editor is focused — the case that matters most. Cmd (metaKey) is
// accepted too for parity. Only these chords are intercepted (everything else
// passes through untouched); a chord fires only when its command CanExecute, so
// nothing is swallowed when there is nothing to do.
export class DocumentShortcutsService
{
    private static readonly KeyDownEvent = 'keydown'
    private static readonly CloseKey = 'w'
    private static readonly SaveKey = 's'

    // Attach to `target` (typically the window). Returns a disposable
    // that detaches the listener.
    public Attach(target: EventTarget, commands: IDocumentShortcutCommands): IDisposable
    {
        const onKeyDown = (e: Event): void => this.OnKeyDown(commands, e as KeyboardEvent)
        target.addEventListener(DocumentShortcutsService.KeyDownEvent, onKeyDown, { capture: true })
        return {
            dispose: (): void =>
            {
                target.removeEventListener(DocumentShortcutsService.KeyDownEvent, onKeyDown, { capture: true } as EventListenerOptions)
            },
        }
    }

    private OnKeyDown(commands: IDocumentShortcutCommands, e: KeyboardEvent): void
    {
        const mod = e.ctrlKey || e.metaKey
        if (!mod) return
        const key = e.key.toLowerCase()
        if (key === DocumentShortcutsService.CloseKey)
        {
            this.Run(commands.CloseActiveCommand, e)
            return
        }
        if (key !== DocumentShortcutsService.SaveKey) return
        this.Run(e.shiftKey ? commands.SaveAllCommand : commands.SaveActiveCommand, e)
    }

    private Run(command: ICommand, e: KeyboardEvent): void
    {
        if (!command.CanExecute(undefined)) return
        e.preventDefault()
        e.stopPropagation()
        command.Execute(undefined)
    }
}
