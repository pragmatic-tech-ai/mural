import {
    MuralBase,
    RelayCommand,
    type CommandBase,
} from '../../../runtime/index.js';
import { CommandManager } from '../../commands/command-manager.js';
import { findDescriptor } from '../../../runtime/model-internals.js';
import type { Diagram } from '../diagram.js';
import {
    alignLeft,
    alignRight,
    alignTop,
    alignMiddle,
    alignCenter,
    type AlignTarget,
} from '../commands/align.js';
import {
    distributeHorizontal,
    distributeVertical,
} from '../commands/distribute.js';
import {
    selectedTopLevel,
    selectedTopLevelGroups,
    flattenToLeaves,
} from '../commands/group-ops.js';
import {
    wrapTargets,
    selectedContainers,
} from '../commands/container-ops.js';
import {
    GeometryCombineMode,
    isGeometricItem,
    type IGeometricItem,
} from '../commands/combine.js';
import { TextAlignment } from '../../../visual-engine/index.js';
import { TextPlacement } from '../shape-text.js';
import { primaryFormatTarget } from '../behaviors/format-painter-behavior.js';
import { Panel, Visual } from '../../../runtime/index.js';
import { Figure } from '../figure.js';
import { Connector } from '../connector.js';
import { ZOrderMode, reorderZ, type ZAccess } from '../commands/zorder.js';

// Internal collaborator owned by Diagram. Owns the default RelayCommand
// instances installed onto Diagram's Command DPs at construction time.
// Consumers can override any command by writing their own RelayCommand
// to the corresponding Diagram DP — last-writer-wins per § 7.1 of
// [docs/diagram-control.md](../../../docs/diagram-control.md).
// Default impls run after the constructor; consumer writes happen later
// and naturally shadow.
//
// Phase D ships the 5 align commands (Left / Right / Top / Middle /
// Center). Phases E-G add Distribute, Group / Ungroup, and Combine.
//
// CanExecute guards: alignment requires ≥ 2 IFigure-shaped selected
// items. SelectionChanged subscription drives RaiseCanExecuteChanged
// on every command so bound Buttons / MenuItems re-query enabled state
// without per-command wiring on the consumer side.
export class DiagramCommands
{
    private readonly _diagram: Diagram;

    // Cached command refs — used by the SelectionChanged listener to
    // fan out RaiseCanExecuteChanged. Indexed by name so future
    // additions (distribute, group/ungroup, combine) stay tidy here.
    private readonly _commands: Map<string, CommandBase> = new Map();

    constructor(diagram: Diagram)
    {
        this._diagram = diagram;
        this._installAlignCommands();
        this._installZOrderCommands();
        this._installDistributeCommands();
        this._installGroupCommands();
        this._installContainerCommands();
        this._installCombineCommands();
        this._installTextFormatCommands();
        this._installCopyFormatCommand();
        this._installClipboardCommands();
        diagram.AddSelectionChangedListener(() => this._raiseCanExecuteAll());
    }

    private _installAlignCommands(): void
    {
        const canAlign = (): boolean => this._collectSelected().length >= 2;
        const Diagram = this._diagram.constructor as typeof import('../diagram.js').Diagram;

        this._install(Diagram.AlignLeftCommandKey, 'AlignLeft',
            new RelayCommand(() => alignLeft(this._collectSelected()), canAlign,
                { Text: 'Align Left',   Description: 'Align selected shapes to the left edge of the leftmost shape.' }));
        this._install(Diagram.AlignRightCommandKey, 'AlignRight',
            new RelayCommand(() => alignRight(this._collectSelected()), canAlign,
                { Text: 'Align Right',  Description: 'Align selected shapes to the right edge of the rightmost shape.' }));
        this._install(Diagram.AlignTopCommandKey, 'AlignTop',
            new RelayCommand(() => alignTop(this._collectSelected()), canAlign,
                { Text: 'Align Top',    Description: 'Align selected shapes to the top edge of the topmost shape.' }));
        this._install(Diagram.AlignMiddleCommandKey, 'AlignMiddle',
            new RelayCommand(() => alignMiddle(this._collectSelected()), canAlign,
                { Text: 'Align Middle', Description: 'Center selected shapes vertically on a shared horizontal axis.' }));
        this._install(Diagram.AlignCenterCommandKey, 'AlignCenter',
            new RelayCommand(() => alignCenter(this._collectSelected()), canAlign,
                { Text: 'Align Center', Description: 'Center selected shapes horizontally on a shared vertical axis.' }));
    }

    // Panel.ZIndex accessor over any Visual — the wrapper for the pure zorder
    // math. Figures and connectors share one z-space on the diagram canvas.
    private static readonly Z: ZAccess<Visual> = {
        get: (v) => Panel.GetZIndex(v),
        set: (v, z) => Panel.SetZIndex(v, z),
    };

    private _installZOrderCommands(): void
    {
        const Diagram = this._diagram.constructor as typeof import('../diagram.js').Diagram;
        const canReorder = (): boolean => this._selectedReorderables().length >= 1;

        this._install(Diagram.BringToFrontCommandKey, 'BringToFront',
            new RelayCommand(() => this._reorder(ZOrderMode.Front), canReorder,
                { Text: 'Bring to Front', Description: 'Move the selected shape(s) in front of all others.' }));
        this._install(Diagram.SendToBackCommandKey, 'SendToBack',
            new RelayCommand(() => this._reorder(ZOrderMode.Back), canReorder,
                { Text: 'Send to Back', Description: 'Move the selected shape(s) behind all others.' }));
        this._install(Diagram.BringForwardCommandKey, 'BringForward',
            new RelayCommand(() => this._reorder(ZOrderMode.Forward), canReorder,
                { Text: 'Bring Forward', Description: 'Move the selected shape(s) one step toward the front.' }));
        this._install(Diagram.SendBackwardCommandKey, 'SendBackward',
            new RelayCommand(() => this._reorder(ZOrderMode.Backward), canReorder,
                { Text: 'Send Backward', Description: 'Move the selected shape(s) one step toward the back.' }));
    }

    // Selected top-level figures plus selected connectors — the visuals a
    // z-order command may restack. Connectors share the canvas with the
    // top-level figures, so they reorder in one unified stack. (Content nodes
    // and nested group members are excluded via selectedTopLevel / the Figure
    // filter.)
    private _selectedReorderables(): Visual[]
    {
        const figs = selectedTopLevel(this._diagram.SelectedItems)
            .filter((i): i is Figure => i instanceof Figure);
        return [...figs, ...this._diagram.SelectedConnectors];
    }

    // Group the selection by visual parent (the canvas, or a container's child
    // host) and reorder each parent's Figure+Connector children independently,
    // so z is scoped per parent. Cap/label visuals are excluded — they mirror
    // their connector's z (see DiagramConnectorsMaterializer).
    private _reorder(mode: ZOrderMode): void
    {
        const targets = this._selectedReorderables();
        if (targets.length === 0) return;
        const byParent = new Map<Panel, Visual[]>();
        for (const t of targets)
        {
            const parent = t.GetVisualParent();
            if (!(parent instanceof Panel)) continue;
            let group = byParent.get(parent);
            if (group === undefined) { group = []; byParent.set(parent, group); }
            group.push(t);
        }
        for (const [parent, selected] of byParent)
        {
            const siblings = [...parent.Children].filter(
                (c): c is Visual => c instanceof Figure || c instanceof Connector);
            reorderZ(mode, selected, siblings, DiagramCommands.Z);
        }
    }

    private _installDistributeCommands(): void
    {
        const canDistribute = (): boolean => this._collectSelected().length >= 3;
        const Diagram = this._diagram.constructor as typeof import('../diagram.js').Diagram;

        this._install(Diagram.DistributeHorizontalCommandKey, 'DistributeHorizontal',
            new RelayCommand(() => distributeHorizontal(this._collectSelected()), canDistribute,
                { Text: 'Distribute Horizontally', Description: 'Space three or more shapes evenly between the leftmost and rightmost.' }));
        this._install(Diagram.DistributeVerticalCommandKey, 'DistributeVertical',
            new RelayCommand(() => distributeVertical(this._collectSelected()), canDistribute,
                { Text: 'Distribute Vertically',   Description: 'Space three or more shapes evenly between the topmost and bottommost.' }));
    }

    private _installGroupCommands(): void
    {
        const Diagram = this._diagram.constructor as typeof import('../diagram.js').Diagram;

        const canGroup   = (): boolean => selectedTopLevel(this._diagram.SelectedItems).length >= 2;
        const canUngroup = (): boolean => selectedTopLevelGroups(this._diagram.SelectedItems).length >= 1;

        this._install(Diagram.GroupCommandKey, 'Group',
            new RelayCommand(
                () => this._diagram._fireGroupRequested({ Items: selectedTopLevel(this._diagram.SelectedItems) }),
                canGroup,
                { Text: 'Group', Description: 'Wrap the current top-level selection in a new group.' }));
        this._install(Diagram.UngroupCommandKey, 'Ungroup',
            new RelayCommand(
                () => this._diagram._fireUngroupRequested({ Groups: selectedTopLevelGroups(this._diagram.SelectedItems) }),
                canUngroup,
                { Text: 'Ungroup', Description: 'Dissolve the currently-selected group(s), re-parenting their members to the surrounding scope.' }));
    }

    private _installContainerCommands(): void
    {
        const Diagram = this._diagram.constructor as typeof import('../diagram.js').Diagram;

        const canWrap   = (): boolean => wrapTargets(this._diagram.SelectedItems).length >= 1;
        const canUnwrap = (): boolean => selectedContainers(this._diagram.SelectedItems).length >= 1;

        this._install(Diagram.WrapInContainerCommandKey, 'WrapInContainer',
            new RelayCommand(
                () => this._diagram._fireWrapRequested({ Items: wrapTargets(this._diagram.SelectedItems) }),
                canWrap,
                { Text: 'Wrap in container', Description: 'Enclose the current top-level selection in a new container.' }));
        this._install(Diagram.UnwrapContainerCommandKey, 'UnwrapContainer',
            new RelayCommand(
                () => this._diagram._fireUnwrapRequested({ Containers: selectedContainers(this._diagram.SelectedItems) }),
                canUnwrap,
                { Text: 'Unwrap container', Description: 'Dissolve the selected container(s), keeping their contents.' }));
    }

    private _installCombineCommands(): void
    {
        const Diagram = this._diagram.constructor as typeof import('../diagram.js').Diagram;

        // Combine needs ≥ 2 selected items that EACH have a Geometry —
        // the merge op needs something to fold. Items without Geometry
        // (text-only labels, etc.) are silently excluded.
        const canCombine = (): boolean => this._collectCombinable().length >= 2;

        const fireCombine = (mode: GeometryCombineMode): (() => void) => () =>
            this._diagram._fireCombineRequested({
                Items: this._collectCombinable(),
                Mode:  mode,
            });

        this._install(Diagram.CombineUnionCommandKey, 'CombineUnion',
            new RelayCommand(fireCombine(GeometryCombineMode.Union), canCombine,
                { Text: 'Combine — Union',     Description: 'Merge the selected shapes into a single union.' }));
        this._install(Diagram.CombineIntersectCommandKey, 'CombineIntersect',
            new RelayCommand(fireCombine(GeometryCombineMode.Intersect), canCombine,
                { Text: 'Combine — Intersect', Description: 'Keep only the overlapping area of the selected shapes.' }));
        this._install(Diagram.CombineSubtractCommandKey, 'CombineSubtract',
            new RelayCommand(fireCombine(GeometryCombineMode.Exclude), canCombine,
                { Text: 'Combine — Subtract',  Description: 'Subtract subsequent shapes from the first.' }));
        this._install(Diagram.CombineExcludeCommandKey, 'CombineExclude',
            new RelayCommand(fireCombine(GeometryCombineMode.Xor), canCombine,
                { Text: 'Combine — Exclude',   Description: 'Keep only the non-overlapping areas (XOR).' }));
    }

    private _installTextFormatCommands(): void
    {
        const Diagram = this._diagram.constructor as typeof import('../diagram.js').Diagram;
        // Enabled whenever the selection carries at least one label-bearing shape.
        const canText = (): boolean => this._collectTextLeaves().length >= 1;

        // Paragraph alignment WITHIN the label block. Execute force-applies to
        // every selected label (edit mode targets the caret paragraph, rich
        // targets every paragraph, plain the block default — routed in ShapeText).
        this._install(Diagram.SetTextAlignLeftCommandKey, 'SetTextAlignLeft',
            new RelayCommand(() => this._diagram.ApplySelectionTextAlignment(TextAlignment.Left), canText,
                { Text: 'Align Text Left',    Description: 'Left-align the text within the selected shape(s).' }));
        this._install(Diagram.SetTextAlignCenterCommandKey, 'SetTextAlignCenter',
            new RelayCommand(() => this._diagram.ApplySelectionTextAlignment(TextAlignment.Center), canText,
                { Text: 'Align Text Center',  Description: 'Center the text within the selected shape(s).' }));
        this._install(Diagram.SetTextAlignRightCommandKey, 'SetTextAlignRight',
            new RelayCommand(() => this._diagram.ApplySelectionTextAlignment(TextAlignment.Right), canText,
                { Text: 'Align Text Right',   Description: 'Right-align the text within the selected shape(s).' }));
        this._install(Diagram.SetTextAlignJustifyCommandKey, 'SetTextAlignJustify',
            new RelayCommand(() => this._diagram.ApplySelectionTextAlignment(TextAlignment.Justify), canText,
                { Text: 'Justify Text',       Description: 'Justify the text within the selected shape(s).' }));

        // Label placement WITHIN the shape footprint — the 3×3 anchor grid.
        const place = (p: TextPlacement): (() => void) => () => this._diagram.ApplySelectionTextPlacement(p);
        this._install(Diagram.SetTextPlacementTopLeftCommandKey, 'SetTextPlacementTopLeft',
            new RelayCommand(place(TextPlacement.TopLeft), canText,
                { Text: 'Place Label Top-Left',     Description: 'Anchor the label to the top-left of the selected shape(s).' }));
        this._install(Diagram.SetTextPlacementTopCommandKey, 'SetTextPlacementTop',
            new RelayCommand(place(TextPlacement.Top), canText,
                { Text: 'Place Label Top',          Description: 'Anchor the label to the top edge of the selected shape(s).' }));
        this._install(Diagram.SetTextPlacementTopRightCommandKey, 'SetTextPlacementTopRight',
            new RelayCommand(place(TextPlacement.TopRight), canText,
                { Text: 'Place Label Top-Right',    Description: 'Anchor the label to the top-right of the selected shape(s).' }));
        this._install(Diagram.SetTextPlacementLeftCommandKey, 'SetTextPlacementLeft',
            new RelayCommand(place(TextPlacement.Left), canText,
                { Text: 'Place Label Left',         Description: 'Anchor the label to the left edge of the selected shape(s).' }));
        this._install(Diagram.SetTextPlacementCenterCommandKey, 'SetTextPlacementCenter',
            new RelayCommand(place(TextPlacement.Center), canText,
                { Text: 'Place Label Center',       Description: 'Center the label within the selected shape(s).' }));
        this._install(Diagram.SetTextPlacementRightCommandKey, 'SetTextPlacementRight',
            new RelayCommand(place(TextPlacement.Right), canText,
                { Text: 'Place Label Right',        Description: 'Anchor the label to the right edge of the selected shape(s).' }));
        this._install(Diagram.SetTextPlacementBottomLeftCommandKey, 'SetTextPlacementBottomLeft',
            new RelayCommand(place(TextPlacement.BottomLeft), canText,
                { Text: 'Place Label Bottom-Left',  Description: 'Anchor the label to the bottom-left of the selected shape(s).' }));
        this._install(Diagram.SetTextPlacementBottomCommandKey, 'SetTextPlacementBottom',
            new RelayCommand(place(TextPlacement.Bottom), canText,
                { Text: 'Place Label Bottom',       Description: 'Anchor the label to the bottom edge of the selected shape(s).' }));
        this._install(Diagram.SetTextPlacementBottomRightCommandKey, 'SetTextPlacementBottomRight',
            new RelayCommand(place(TextPlacement.BottomRight), canText,
                { Text: 'Place Label Bottom-Right', Description: 'Anchor the label to the bottom-right of the selected shape(s).' }));

        // Decoration toggles — Execute flips the current reflected state onto
        // every selected label (the selected text run(s) while editing).
        this._install(Diagram.SetTextBoldCommandKey, 'SetTextBold',
            new RelayCommand(() => this._diagram.ApplySelectionBold(!this._diagram.SelectionBold), canText,
                { Text: 'Bold',          Description: 'Toggle bold on the selected shape(s) — the selected text while editing.' }));
        this._install(Diagram.SetTextItalicCommandKey, 'SetTextItalic',
            new RelayCommand(() => this._diagram.ApplySelectionItalic(!this._diagram.SelectionItalic), canText,
                { Text: 'Italic',        Description: 'Toggle italic on the selected shape(s) — the selected text while editing.' }));
        this._install(Diagram.SetTextUnderlineCommandKey, 'SetTextUnderline',
            new RelayCommand(() => this._diagram.ApplySelectionUnderline(!this._diagram.SelectionUnderline), canText,
                { Text: 'Underline',     Description: 'Toggle underline on the selected shape(s) — the selected text while editing.' }));
        this._install(Diagram.SetTextStrikethroughCommandKey, 'SetTextStrikethrough',
            new RelayCommand(() => this._diagram.ApplySelectionStrikethrough(!this._diagram.SelectionStrikethrough), canText,
                { Text: 'Strikethrough', Description: 'Toggle strikethrough on the selected shape(s) — the selected text while editing.' }));

        // Grow / shrink font one point — steps each selected label's own size.
        this._install(Diagram.IncreaseFontSizeCommandKey, 'IncreaseFontSize',
            new RelayCommand(() => this._diagram.BumpSelectionFontSize(1), canText,
                { Text: 'Increase Font Size', Description: 'Grow the selected shape(s) text one point — the selected text while editing.' }));
        this._install(Diagram.DecreaseFontSizeCommandKey, 'DecreaseFontSize',
            new RelayCommand(() => this._diagram.BumpSelectionFontSize(-1), canText,
                { Text: 'Decrease Font Size', Description: 'Shrink the selected shape(s) text one point — the selected text while editing.' }));
    }

    private _installCopyFormatCommand(): void
    {
        const Diagram = this._diagram.constructor as typeof import('../diagram.js').Diagram;
        // Enabled when a format is available to pick up (a formattable item is
        // selected), OR the brush is already loaded — so a press can toggle it
        // back off. Execute flips the mode DP; the format-painter behavior owns
        // the capture-on-true / drop-on-false transitions.
        const canCopy = (): boolean =>
            this._diagram.FormatPainterActive || primaryFormatTarget(this._diagram) !== undefined;

        this._install(Diagram.CopyFormatCommandKey, 'CopyFormat',
            new RelayCommand(
                () => { this._diagram.FormatPainterActive = !this._diagram.FormatPainterActive; },
                canCopy,
                { Text: 'Copy Format', Description: 'Pick up the selected shape\'s format, then click shapes to apply it. Press Esc to stop.' }));
    }

    private _installClipboardCommands(): void
    {
        const Diagram = this._diagram.constructor as typeof import('../diagram.js').Diagram;
        // Copy / Cut need something selected; Paste is always enabled (the OS
        // clipboard can't be peeked synchronously — the mutator no-ops on
        // foreign / empty text).
        const hasSelection = (): boolean =>
            this._diagram.SelectedItems.length > 0 || this._diagram.SelectedConnectors.length > 0;

        this._install(Diagram.CopyCommandKey, 'Copy',
            new RelayCommand(() => this._diagram._requestCopy(), hasSelection,
                { Text: 'Copy', Description: 'Copy the selected shapes to the clipboard.' }));
        this._install(Diagram.CutCommandKey, 'Cut',
            new RelayCommand(() => this._diagram._requestCut(), hasSelection,
                { Text: 'Cut', Description: 'Cut the selected shapes to the clipboard.' }));
        this._install(Diagram.PasteCommandKey, 'Paste',
            new RelayCommand(() => this._diagram._requestPaste(), () => true,
                { Text: 'Paste', Description: 'Paste shapes from the clipboard.' }));
    }

    // Selected leaves that carry a label (duck-typed on `.Text`). Groups
    // flatten to their leaf shapes; connectors / label-less items are skipped.
    private _collectTextLeaves(): MuralBase[]
    {
        return flattenToLeaves(this._diagram.SelectedItems)
            .filter((leaf) => (leaf as { Text?: unknown }).Text !== undefined);
    }

    private _collectCombinable(): (import('../../../runtime/index.js').MuralBase & IGeometricItem)[]
    {
        const out: (import('../../../runtime/index.js').MuralBase & IGeometricItem)[] = [];
        for (const item of this._diagram.SelectedItems)
        {
            if (isGeometricItem(item)) out.push(item);
        }
        return out;
    }

    private _install(key: import('../../../runtime/index.js').PropertyKey<RelayCommand | undefined>, name: string, command: RelayCommand): void
    {
        this._diagram.set_property_value(key, command);
        this._commands.set(name, command);
    }

    // Re-evaluate every command's CanExecute. Drives Button.IsEnabled
    // update — the binding pipeline subscribes to each command's
    // CanExecuteChanged event, which RaiseCanExecuteChanged fires.
    private _raiseCanExecuteAll(): void
    {
        for (const cmd of this._commands.values())
        {
            cmd.RaiseCanExecuteChanged();
        }
        // Selection changed → command executability may have too. Pulse the
        // global requery so a data-driven ToolbarService (whose CommandViewModel
        // RelayCommands dispatch to this diagram via ICommandTarget, not to these
        // internal commands directly) re-evaluates CanExecute. Harmless when no
        // ToolbarService is present — the pulse just has no subscribers.
        CommandManager.InvalidateRequerySuggested();
    }

    private _collectSelected(): AlignTarget[]
    {
        // Walk each selected entity to its top-level ancestor before
        // adding to the align/distribute target list. Without this,
        // marquee-selecting across a group picks the leaf Figures
        // directly — and then alignCenter / alignLeft / distribute
        // operate on each member individually, collapsing the group's
        // internal spacing onto a shared axis. Walking up to the
        // outermost Group preserves the group as a single rigid entity
        // whose Left/Top setter translates every member together.
        //
        // Dedupe via a Set: two selected members of the same group
        // resolve to the same top-level Group, but we only align it
        // once.
        const seen = new Set<MuralBase>();
        const out: AlignTarget[] = [];
        for (const item of this._diagram.SelectedItems)
        {
            if (!(item instanceof MuralBase)) continue;
            let top: MuralBase = item;
            for (;;)
            {
                const parent = (top as unknown as { Parent?: unknown }).Parent;
                if (!(parent instanceof MuralBase)) break;
                top = parent as MuralBase;
            }
            // A content-node item (NodeViewModel) carries no geometry — its
            // container Figure does (container-owned-geometry). Resolve to the
            // container so align/distribute can read+write its bounds; otherwise
            // _isFigureShape rejects the VM and the node is silently dropped from
            // the operation (and canAlign disables the toolbar). A geometric-shape
            // item is already figure-shaped, and a VM can't be a group member, so
            // this only rescues top-level content nodes.
            if (!this._isFigureShape(top))
            {
                const container = this._diagram.Generator.ContainerFromItem(top);
                if (container instanceof MuralBase) top = container;
            }
            if (seen.has(top)) continue;
            seen.add(top);
            if (this._isFigureShape(top))
            {
                out.push(top as unknown as AlignTarget);
            }
        }
        return out;
    }

    private _isFigureShape(item: unknown): item is MuralBase
    {
        if (!(item instanceof MuralBase)) return false;
        const klass = item.constructor as Function;
        return findDescriptor(klass, 'Left')   !== undefined
            && findDescriptor(klass, 'Top')    !== undefined
            && findDescriptor(klass, 'Width')  !== undefined
            && findDescriptor(klass, 'Height') !== undefined;
    }
}
