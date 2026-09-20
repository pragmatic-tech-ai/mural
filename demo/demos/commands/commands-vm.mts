// CommandsVM — exercises all three command surfaces (Menu, ToolBar,
// ContextMenu) over the framework Diagram. Extends DiagramDocument with:
//
//   * Alignment commands (AlignLeft / AlignTop / AlignRight / AlignBottom)
//     operating on whichever Figures are selected.
//   * Cut / Copy / Paste / Delete / Duplicate / SelectAll / Undo /
//     Redo  — RelayCommands that update the Status string. Real
//     clipboard / undo plumbing is out of scope; the demo's job is to
//     show that one ICommand instance drives the toolbar, the menu,
//     AND each node's context menu in lockstep.
//   * HasSelection — bool DP the bootstrap writes from the Diagram's
//     SelectionChanged event. The selection-gated commands' CanExecute
//     reads it; CanExecuteChanged pulses on every flip.
//
// Per-shape Figure subclasses (RectFigure / EllipseFigure / NoteFigure)
// live in THIS file so commands.mu can hang a per-TargetType Style
// (ContextMenu attached + selection chrome) off each. The kinds are
// shape-catalog-backed: 'rectangle' / 'ellipse' / 'rectangle' (note
// reuses the rectangle path with a paper-yellow fill and rounded "Note"
// label). The framework's auto-BasedOn machinery splices the Figure
// theme Style underneath the demo's subclass styles, so Template flows
// from the framework while the demo's setters / triggers add chrome.

import {
    MetaData,
    MuralBase,
    Color,
    RelayCommand,
} from '@pragmatic-tech-ai/mural/runtime';
import { SolidColorBrush, Visual } from '@pragmatic-tech-ai/mural/visual-engine';
import { Figure } from '@pragmatic-tech-ai/mural/framework';
import { DiagramDocument, type DiagramStorage } from '@pragmatic-tech-ai/mural/framework';

// A Figure subclass constructor carrying the demo's per-kind marker.
type FigureCtor = (new (id: string, left: number, top: number) => Figure) & { DemoKind: string };

// One clipboard entry — the data Cut/Copy stash and Paste replays.
interface ClipEntry
{
    kind: string;
    left: number;
    top:  number;
}

// Cross-class internal: DiagramDocument's private id counter, reached by
// CreateNode override to keep node ids monotonic with the base.
interface DiagramDocumentNextId
{
    _nextId: number;
}

const NODE_W = 130;
const NODE_H = 60;

const brush = (hex: string): SolidColorBrush => new SolidColorBrush(Color.FromHex(hex));
const BG_RECT    = brush('#bfdbfe');
const BG_ELLIPSE = brush('#bbf7d0');
const BG_NOTE    = brush('#fde68a');

// Per-kind Figure subclasses — pure TargetType discriminators with
// default Fill / LabelText overrides so each kind drops onto the canvas
// pre-coloured. The catalog kind ('rectangle' / 'ellipse') drives the
// geometry; the subclass only carries per-instance defaults and an
// implicit `Style[TargetType=*Figure]` hook for ContextMenu chrome.

export class RectFigure extends Figure
{
    static DemoKind = 'rect';
    static
    {
        MuralBase.OverrideMetadata(RectFigure, Visual.FillKey, { default_value: BG_RECT });
    }
    constructor(id: string, left: number, top: number)
    {
        super();
        this.Id        = id;
        this.Left      = left;
        this.Top       = top;
        this.Width     = NODE_W;
        this.Height    = NODE_H;
        this.LabelText = 'Rectangle';
        this.ApplyCatalogKind('rectangle');
    }
}

export class EllipseFigure extends Figure
{
    static DemoKind = 'ellipse';
    static
    {
        MuralBase.OverrideMetadata(EllipseFigure, Visual.FillKey, { default_value: BG_ELLIPSE });
    }
    constructor(id: string, left: number, top: number)
    {
        super();
        this.Id        = id;
        this.Left      = left;
        this.Top       = top;
        this.Width     = NODE_W;
        this.Height    = NODE_H;
        this.LabelText = 'Ellipse';
        this.ApplyCatalogKind('ellipse');
    }
}

export class NoteFigure extends Figure
{
    static DemoKind = 'note';
    static
    {
        MuralBase.OverrideMetadata(NoteFigure, Visual.FillKey, { default_value: BG_NOTE });
    }
    constructor(id: string, left: number, top: number)
    {
        super();
        this.Id        = id;
        this.Left      = left;
        this.Top       = top;
        this.Width     = NODE_W;
        this.Height    = NODE_H;
        this.LabelText = 'Note';
        // Notes reuse the rectangle path — flat sticky-note silhouette,
        // distinguished by Fill + Label rather than geometry.
        this.ApplyCatalogKind('rectangle');
    }
}

const CMD_KIND_TO_CLASS: Record<string, FigureCtor> = {
    rect:    RectFigure,
    ellipse: EllipseFigure,
    note:    NoteFigure,
};

export class CommandsVM extends DiagramDocument
{
    // All command surfaces in commands.mu bind via $-syntax
    // (DataContextBinding), which resolves through MuralBase.HasProperty —
    // unregistered plain fields are invisible. Register every command
    // CommandsVM owns as a DP.
    //
    // The Align* / Distribute* / Group* / Ungroup* / Combine* surfaces
    // are populated by the bootstrap from the framework Diagram control's
    // own RelayCommand instances (CommandsVM owns the proxy DPs so the
    // menu / toolbar markup can bind them through `$AlignLeftCommand`).
    static HasSelectionKey       = MuralBase.RegisterProperty<boolean>(CommandsVM, 'HasSelection',       false,     MetaData.None);
    // Classic (Menu + ToolBar) vs Ribbon chrome toggle. TwoWay so the
    // header's mode Checkbox round-trips. The demo's DataTemplate triggers
    // swap the two chrome containers off this flag.
    static IsRibbonModeKey       = MuralBase.RegisterProperty<boolean>(CommandsVM, 'IsRibbonMode',       false,     MetaData.BindsTwoWayByDefault);
    // Contextual "Format" tab commands — Z-order stubs (real z-order is
    // out of scope; the demo shows the contextual tab + selection gating).
    static BringFrontCommandKey  = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'BringFrontCommand',  undefined, MetaData.None);
    static SendBackCommandKey    = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'SendBackCommand',    undefined, MetaData.None);
    static CutCommandKey         = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'CutCommand',         undefined, MetaData.None);
    static CopyCommandKey        = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'CopyCommand',        undefined, MetaData.None);
    static PasteCommandKey       = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'PasteCommand',       undefined, MetaData.None);
    static DeleteCommandKey      = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'DeleteCommand',      undefined, MetaData.None);
    static DuplicateCommandKey   = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'DuplicateCommand',   undefined, MetaData.None);
    static SelectAllCommandKey   = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'SelectAllCommand',   undefined, MetaData.None);
    static AlignBottomCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'AlignBottomCommand', undefined, MetaData.None);
    static UndoCommandKey        = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'UndoCommand',        undefined, MetaData.None);
    static RedoCommandKey        = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'RedoCommand',        undefined, MetaData.None);

    // Proxy DPs for the framework Diagram's command surface — the
    // bootstrap (commands.mjs) copies the Diagram's own RelayCommand
    // instances into these so the menu / toolbar bindings reach them
    // via `$AlignLeftCommand` etc.
    static AlignLeftCommandKey            = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'AlignLeftCommand',            undefined, MetaData.None);
    static AlignRightCommandKey           = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'AlignRightCommand',           undefined, MetaData.None);
    static AlignTopCommandKey             = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'AlignTopCommand',             undefined, MetaData.None);
    static AlignMiddleCommandKey          = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'AlignMiddleCommand',          undefined, MetaData.None);
    static AlignCenterCommandKey          = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'AlignCenterCommand',          undefined, MetaData.None);
    static DistributeHorizontalCommandKey = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'DistributeHorizontalCommand', undefined, MetaData.None);
    static DistributeVerticalCommandKey   = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'DistributeVerticalCommand',   undefined, MetaData.None);
    static GroupCommandKey                = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'GroupCommand',                undefined, MetaData.None);
    static UngroupCommandKey              = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'UngroupCommand',              undefined, MetaData.None);
    static CombineUnionCommandKey         = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'CombineUnionCommand',         undefined, MetaData.None);
    static CombineIntersectCommandKey     = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'CombineIntersectCommand',     undefined, MetaData.None);
    static CombineSubtractCommandKey      = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'CombineSubtractCommand',      undefined, MetaData.None);
    static CombineExcludeCommandKey       = MuralBase.RegisterProperty<RelayCommand | undefined>(CommandsVM, 'CombineExcludeCommand',       undefined, MetaData.None);

    // Cut/Copy stash replayed by Paste. Plain field — view-invisible state.
    private _clipboard: ClipEntry[] = [];

    constructor(storage?: DiagramStorage)
    {
        super(storage);

        const setStatus = (msg: string): void => this.set_property_value(DiagramDocument.StatusKey, msg);
        const selected = (): Figure[] => {
            const out: Figure[] = [];
            const nodes = this.Nodes;
            for (let i = 0; i < nodes.Count; i++)
            {
                const v = nodes.Get(i);
                // This demo only ever creates Figure subclasses via CreateNode,
                // so every selected node is a Figure (carries Left/Top setters
                // + DemoKind). Narrow the Figure|Group|NodeViewModel element to
                // Figure (NodeViewModel has no IsSelected — selection is on the
                // container).
                if (v instanceof Figure && v.IsSelected) out.push(v);
            }
            return out;
        };
        const hasSel = (): boolean => this.HasSelection;

        // ── Edit commands (selection-gated) ───────────────────────────
        this.set_property_value(CommandsVM.CutCommandKey, new RelayCommand(() => {
            const s = selected();
            this._clipboard = s.map((n) => ({ kind: (n.constructor as FigureCtor).DemoKind, left: n.Left, top: n.Top }));
            this.DeleteNodes(s);
            setStatus(`Cut ${s.length} node${s.length === 1 ? '' : 's'}.`);
        }, hasSel));
        this.set_property_value(CommandsVM.CopyCommandKey, new RelayCommand(() => {
            const s = selected();
            this._clipboard = s.map((n) => ({ kind: (n.constructor as FigureCtor).DemoKind, left: n.Left, top: n.Top }));
            setStatus(`Copied ${s.length} node${s.length === 1 ? '' : 's'}.`);
        }, hasSel));
        this.set_property_value(CommandsVM.PasteCommandKey, new RelayCommand(() => {
            const c = this._clipboard ?? [];
            for (const e of c) this.CreateNode(e.kind, e.left + 20, e.top + 20);
            setStatus(`Pasted ${c.length} node${c.length === 1 ? '' : 's'}.`);
        }, () => Array.isArray(this._clipboard) && this._clipboard.length > 0));
        this.set_property_value(CommandsVM.DeleteCommandKey, new RelayCommand(() => this.DeleteNodes(selected()), hasSel));
        this.set_property_value(CommandsVM.DuplicateCommandKey, new RelayCommand(() => {
            const s = selected();
            for (const n of s) this.CreateNode((n.constructor as FigureCtor).DemoKind, n.Left + 24, n.Top + 24);
            setStatus(`Duplicated ${s.length} node${s.length === 1 ? '' : 's'}.`);
        }, hasSel));
        this.set_property_value(CommandsVM.SelectAllCommandKey, new RelayCommand(() => {
            const nodes = this.Nodes;
            for (let i = 0; i < nodes.Count; i++)
            {
                const v = nodes.Get(i);
                if (v instanceof Figure) v.IsSelected = true;
            }
            this.set_property_value(CommandsVM.HasSelectionKey, nodes.Count > 0);
            this._raiseGated();
            setStatus(`Selected ${nodes.Count} node${nodes.Count === 1 ? '' : 's'}.`);
        }));

        // ── Alignment commands ────────────────────────────────────────
        // AlignLeft / Right / Top / Middle / Center proxy to the framework
        // Diagram's own RelayCommands (filled in by the bootstrap). The
        // local AlignBottom stays here — the framework's align surface
        // doesn't include it (Top + Middle + bbox-relative-bottom-via-
        // Middle covers the common cases; demo needed the explicit
        // bottom-edge gesture for its toolbar parity).
        this.set_property_value(CommandsVM.AlignBottomCommandKey, new RelayCommand(() => this._align('bottom'), hasSel));

        // ── Z-order (contextual Format tab) ───────────────────────────
        this.set_property_value(CommandsVM.BringFrontCommandKey, new RelayCommand(() => {
            const s = selected();
            setStatus(`Bring to front: ${s.length} node${s.length === 1 ? '' : 's'}.`);
        }, hasSel));
        this.set_property_value(CommandsVM.SendBackCommandKey, new RelayCommand(() => {
            const s = selected();
            setStatus(`Send to back: ${s.length} node${s.length === 1 ? '' : 's'}.`);
        }, hasSel));

        // ── Stubs ────────────────────────────────────────────────────
        this.set_property_value(CommandsVM.UndoCommandKey, new RelayCommand(() => setStatus('Undo — no-op stub.')));
        this.set_property_value(CommandsVM.RedoCommandKey, new RelayCommand(() => setStatus('Redo — no-op stub.')));

        this._clipboard = [];
    }

    // Commands-local kind map — 'rect' / 'ellipse' / 'note' map to the
    // per-kind Figure subclasses defined above. Overrides the inherited
    // DiagramDocument.CreateNode (which routes through Figure.fromKind
    // against the framework SHAPE_CATALOG keyed by the catalog kind name
    // — 'rectangle' / 'ellipse' / …). Returns null for unknown kinds.
    // Base CreateNode returns Figure | null (shapes are self-painting Figures);
    // this demo creates custom Figure subclasses instead, so the override is
    // well-typed with no cast.
    override CreateNode(kind: string, left: number, top: number): Figure | null
    {
        const Cls = CMD_KIND_TO_CLASS[kind];
        if (Cls === undefined) return null;
        // `_nextId` is the base DiagramDocument's private id counter; reach in
        // through a named interface (cross-class internal — see CLAUDE.md).
        const id = 'n' + (this as unknown as DiagramDocumentNextId)._nextId++;
        const fig = new Cls(id, left, top);
        this.Nodes.Add(fig);
        return fig;
    }

    get HasSelection():      boolean { return this.get_property_value(CommandsVM.HasSelectionKey); }
    set HasSelection(v:      boolean) { this.set_property_value(CommandsVM.HasSelectionKey, v); }
    get IsRibbonMode():      boolean { return this.get_property_value(CommandsVM.IsRibbonModeKey); }
    set IsRibbonMode(v:      boolean) { this.set_property_value(CommandsVM.IsRibbonModeKey, v); }
    get BringFrontCommand(): RelayCommand | undefined { return this.get_property_value(CommandsVM.BringFrontCommandKey); }
    get SendBackCommand():   RelayCommand | undefined { return this.get_property_value(CommandsVM.SendBackCommandKey); }
    get CutCommand():        RelayCommand | undefined { return this.get_property_value(CommandsVM.CutCommandKey); }
    get CopyCommand():       RelayCommand | undefined { return this.get_property_value(CommandsVM.CopyCommandKey); }
    get PasteCommand():      RelayCommand | undefined { return this.get_property_value(CommandsVM.PasteCommandKey); }
    get DeleteCommand():     RelayCommand | undefined { return this.get_property_value(CommandsVM.DeleteCommandKey); }
    get DuplicateCommand():  RelayCommand | undefined { return this.get_property_value(CommandsVM.DuplicateCommandKey); }
    get SelectAllCommand():  RelayCommand | undefined { return this.get_property_value(CommandsVM.SelectAllCommandKey); }
    get AlignBottomCommand(): RelayCommand | undefined { return this.get_property_value(CommandsVM.AlignBottomCommandKey); }
    get UndoCommand():       RelayCommand | undefined { return this.get_property_value(CommandsVM.UndoCommandKey); }
    get RedoCommand():       RelayCommand | undefined { return this.get_property_value(CommandsVM.RedoCommandKey); }

    /** Bootstrap calls this when the Diagram's SelectionChanged fires.
     *  Flipping HasSelection re-pulses CanExecuteChanged on every
     *  selection-gated command so toolbar / menu / context-menu chrome
     *  refreshes in lockstep. */
    PublishSelectionState(hasSelection: boolean): void
    {
        if (this.HasSelection === hasSelection) return;
        this.set_property_value(CommandsVM.HasSelectionKey, hasSelection);
        this._raiseGated();
    }

    _raiseGated(): void
    {
        for (const name of [
            'CutCommand', 'CopyCommand', 'DeleteCommand',
            'DuplicateCommand', 'AlignBottomCommand',
            'BringFrontCommand', 'SendBackCommand',
        ])
        {
            // Dynamic getter access over a name list — bridge to the
            // RelayCommand-valued getters via an index signature.
            (this as unknown as Record<string, RelayCommand>)[name].RaiseCanExecuteChanged();
        }
        this.PasteCommand?.RaiseCanExecuteChanged();
    }

    _align(mode: string): void
    {
        const sel: Figure[] = [];
        const nodes = this.Nodes;
        for (let i = 0; i < nodes.Count; i++)
        {
            const v = nodes.Get(i);
            // Demo nodes are all Figures (see selected()); narrow for Left/Top
            // writes below (NodeViewModel has no IsSelected).
            if (v instanceof Figure && v.IsSelected) sel.push(v);
        }
        if (sel.length === 0) return;
        switch (mode)
        {
            case 'left':   { const min = Math.min(...sel.map((n) => n.Left));               for (const n of sel) n.Left = min;               break; }
            case 'right':  { const max = Math.max(...sel.map((n) => n.Left + NODE_W));      for (const n of sel) n.Left = max - NODE_W;      break; }
            case 'center': { const avg = sel.reduce((s, n) => s + n.Left + NODE_W / 2, 0) / sel.length; for (const n of sel) n.Left = avg - NODE_W / 2; break; }
            case 'top':    { const min = Math.min(...sel.map((n) => n.Top));                for (const n of sel) n.Top  = min;               break; }
            case 'bottom': { const max = Math.max(...sel.map((n) => n.Top + NODE_H));       for (const n of sel) n.Top  = max - NODE_H;      break; }
            case 'middle': { const avg = sel.reduce((s, n) => s + n.Top + NODE_H / 2, 0) / sel.length; for (const n of sel) n.Top  = avg - NODE_H / 2; break; }
        }
        this.set_property_value(DiagramDocument.StatusKey, `Align ${mode}: ${sel.length} node${sel.length === 1 ? '' : 's'}.`);
    }
}
