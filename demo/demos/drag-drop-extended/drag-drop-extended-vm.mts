// drag-drop-extended VM — single demo covering the four §8 follow-ups
// closed in this branch: OS file drops (8.1), source-side feedback /
// continue hooks (8.3), ScrollViewer auto-scroll near edges (8.4), and
// the insertion-line adorner on ListReorderBehavior (8.5).
//
// Strictly MVVM-compliant per CLAUDE.md — data + commands only. The
// view materializes ScrollViewer, ListReorderBehavior, an OS-drop
// receiver, and the small insertion-line template; the VM holds the
// items, the dropped-files list, and the status / feedback strings.

import {
    DataObject, DragDropEffects,
    MetaData, MuralBase, ObservableCollection,
    type DragStartSpec,
} from '@pragmatic-tech-ai/mural/runtime';

// Format key for the reorderable row drag payload. The
// ListReorderBehavior queries this on DragOver / Drop to recognise its
// own drag source. Exported so the behavior-attachment glue uses the
// same constant.
export const FMT_FROM_INDEX = '@pragmatic-tech-ai/mural/reorder/from-index';

let _nextId = 1;

export class RowVM extends MuralBase
{
    static IdKey            = MuralBase.RegisterProperty(RowVM, 'Id',            '',         MetaData.None);
    static LabelKey         = MuralBase.RegisterProperty(RowVM, 'Label',         '',         MetaData.None);
    static BeginDragDataKey = MuralBase.RegisterProperty<(() => DragStartSpec) | undefined>(RowVM, 'BeginDragData', undefined,  MetaData.None);

    private _indexInList: number;

    constructor(label: string, indexInList: number)
    {
        super();
        const id = 'r' + (_nextId++);
        this.set_property_value(RowVM.IdKey,    id);
        this.set_property_value(RowVM.LabelKey, label);
        // The closure captures the host VM so source-side hooks can
        // update its status fields.
        this._indexInList = indexInList;
    }

    get Id():             string { return this.get_property_value(RowVM.IdKey); }
    get Label():          string { return this.get_property_value(RowVM.LabelKey); }
    get BeginDragData():  (() => DragStartSpec) | undefined { return this.get_property_value(RowVM.BeginDragDataKey); }
    set BeginDragData(v:  (() => DragStartSpec) | undefined) { this.set_property_value(RowVM.BeginDragDataKey, v); }
}

// Per-file row in the OS-drop receiver's bound collection. Pure data —
// the view templates render Name / Size.
export class DroppedFileVM extends MuralBase
{
    static NameKey = MuralBase.RegisterProperty(DroppedFileVM, 'Name', '', MetaData.None);
    static SizeKey = MuralBase.RegisterProperty(DroppedFileVM, 'Size', '', MetaData.None);

    constructor(name: string, sizeBytes: number)
    {
        super();
        this.set_property_value(DroppedFileVM.NameKey, name);
        this.set_property_value(DroppedFileVM.SizeKey, formatSize(sizeBytes));
    }
    get Name(): string { return this.get_property_value(DroppedFileVM.NameKey); }
    get Size(): string { return this.get_property_value(DroppedFileVM.SizeKey); }
}

function formatSize(bytes: number): string
{
    if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '?';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

export class DragDropExtendedVM extends MuralBase
{
    static RowsKey         = MuralBase.RegisterProperty<ObservableCollection<RowVM> | undefined>(DragDropExtendedVM, 'Rows',         undefined, MetaData.None);
    static DroppedFilesKey = MuralBase.RegisterProperty<ObservableCollection<DroppedFileVM> | undefined>(DragDropExtendedVM, 'DroppedFiles', undefined, MetaData.None);
    // Status strings driven by source-side hooks (8.3) and by the
    // file-drop receiver. Plain DPs so triggers / bindings can
    // observe them.
    static LastEffectKey   = MuralBase.RegisterProperty(DragDropExtendedVM, 'LastEffect',   '—',       MetaData.None);
    static ShiftHintKey    = MuralBase.RegisterProperty(DragDropExtendedVM, 'ShiftHint',    'Hold Shift to cancel the drag.', MetaData.None);
    static FileStatusKey   = MuralBase.RegisterProperty(DragDropExtendedVM, 'FileStatus',   'Drag OS files here.',            MetaData.None);

    constructor()
    {
        super();
        const rows = new ObservableCollection<RowVM>();
        // 30 rows — long enough to exercise auto-scroll on a moderate
        // viewport (~280px tall).
        const labels: string[] = [
            'Apple', 'Banana', 'Cherry', 'Date', 'Eggplant', 'Fig',
            'Grape', 'Honeydew', 'Iceberg', 'Jujube', 'Kiwi', 'Lemon',
            'Mango', 'Nectarine', 'Olive', 'Papaya', 'Quince', 'Raspberry',
            'Strawberry', 'Tangerine', 'Ugli', 'Vanilla', 'Watermelon',
            'Xigua', 'Yam', 'Zucchini', 'Apricot', 'Blueberry',
            'Cantaloupe', 'Dragonfruit',
        ];
        for (let i = 0; i < labels.length; i++) rows.Add(new RowVM(labels[i], i));
        this.set_property_value(DragDropExtendedVM.RowsKey, rows);
        this.set_property_value(DragDropExtendedVM.DroppedFilesKey, new ObservableCollection<DroppedFileVM>());

        // BeginDragData is installed on each row in a second pass so
        // the closure captures `this` (the host VM) — the source-side
        // hooks update LastEffect / status on the host, not on the
        // row.
        for (let i = 0; i < rows.Count; i++)
        {
            const row = rows.Get(i);
            if (row === undefined) continue;
            row.set_property_value(RowVM.BeginDragDataKey, (): DragStartSpec => {
                const idx = this._indexOf(row);
                return {
                    data:    new DataObject().Set(FMT_FROM_INDEX, idx),
                    effects: DragDropEffects.Move,
                    // 8.3 — feedback hook. Receiver's chosen Effect
                    // bubbles to the status bar so the demo surfaces
                    // what the OS cursor would be doing.
                    onFeedback: (effect: DragDropEffects) => {
                        this.set_property_value(DragDropExtendedVM.LastEffectKey, effectName(effect));
                    },
                    // 8.3 — continue hook. Returning false cancels the
                    // drag. Polled by the framework every move sample.
                    // We use a dynamic check (window.event would be
                    // ideal but we want a host-agnostic VM) — instead,
                    // the host VM exposes a CancelDragNow flag that the
                    // bootstrap's Shift key listener flips.
                    onContinueQuery: () => !this._shiftHeld(),
                };
            });
        }
    }

    get Rows():         ObservableCollection<RowVM> | undefined { return this.get_property_value(DragDropExtendedVM.RowsKey); }
    get DroppedFiles(): ObservableCollection<DroppedFileVM> | undefined { return this.get_property_value(DragDropExtendedVM.DroppedFilesKey); }
    get LastEffect():   string { return this.get_property_value(DragDropExtendedVM.LastEffectKey); }
    set LastEffect(v:   string) { this.set_property_value(DragDropExtendedVM.LastEffectKey, v); }
    get ShiftHint():    string { return this.get_property_value(DragDropExtendedVM.ShiftHintKey); }
    set ShiftHint(v:    string) { this.set_property_value(DragDropExtendedVM.ShiftHintKey, v); }
    get FileStatus():   string { return this.get_property_value(DragDropExtendedVM.FileStatusKey); }
    set FileStatus(v:   string) { this.set_property_value(DragDropExtendedVM.FileStatusKey, v); }

    // Set by the bootstrap's window-level keydown / keyup listener.
    // Read by the per-row OnContinueQuery callback (8.3).
    private _shiftFlag = false;
    SetShiftHeld(v: unknown): void { this._shiftFlag = !!v; }
    _shiftHeld(): boolean    { return this._shiftFlag; }

    // Called by the OS-drop behavior when a file lands on the receiver.
    // Pushes a DroppedFileVM into the bound collection and updates the
    // status line. Mirrors the way the reorder behavior calls VM
    // methods through the existing wiring.
    OnFileDropped(name: string, sizeBytes: number): void
    {
        const dropped = this.DroppedFiles;
        if (dropped === undefined) return;
        const file = new DroppedFileVM(name, sizeBytes);
        dropped.Add(file);
        this.set_property_value(
            DragDropExtendedVM.FileStatusKey,
            `Dropped "${name}" (${formatSize(sizeBytes)}). Total: ${dropped.Count}.`,
        );
    }

    _indexOf(row: RowVM): number
    {
        const rows = this.Rows;
        if (rows === undefined) return -1;
        for (let i = 0; i < rows.Count; i++)
        {
            if (rows.Get(i) === row) return i;
        }
        return -1;
    }
}

function effectName(effect: DragDropEffects): string
{
    if (effect & DragDropEffects.Copy) return 'Copy';
    if (effect & DragDropEffects.Move) return 'Move';
    if (effect & DragDropEffects.Link) return 'Link';
    return 'None';
}
