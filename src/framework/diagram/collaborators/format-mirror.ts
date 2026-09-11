import { MuralBase, type PropertyKey, type Disposable } from '../../../runtime/index.js';
import {
    Brush,
    Color,
    Pen,
    SolidColorBrush,
    type TextAlignment,
} from '../../../visual-engine/index.js';
import { type DataTemplate } from '../../../basic/templates/data-template.js';
import { CommandManager } from '../../commands/command-manager.js';
import type { Diagram } from '../diagram.js';
import type { Connector } from '../connector.js';
import type { ShapeText, TextPlacement, ITextStyleTarget } from '../shape-text.js';
import { flattenToLeaves } from '../commands/group-ops.js';

// Internal collaborator owned by Diagram. Mirrors a single editor-owned
// Brush + Pen pair onto every IFormattable leaf in the selection, and
// re-seeds the editor pair from the selection's first leaf on every
// SelectionChanged.
//
// Two duck-typed contracts on selected items (entirely independent —
// an item may satisfy both, either, or neither):
//   * IFillableItem    { Fill:   Brush | undefined }
//   * IStrokableItem   { Stroke: Pen   | undefined }
//
// Items without the property are skipped silently — keeps the
// collaborator from caring about Group / text-only / unknown VM
// shapes. The flattenToLeaves walk handles "selecting a group
// applies format to all its leaves" without needing to know
// whether the consumer's group VM is the Phase B Group class or a
// custom IGroup-shaped MuralBase.
//
// Pen-shaped DPs: BroadcastWholePen on each FormatStroke replacement
// copies all 6 Pen DPs (Brush, Thickness, DashStyle, LineCap, LineJoin,
// MiterLimit) onto each leaf's Stroke pen IN PLACE, preserving per-
// leaf Pen identity. Per-property edits made on FormatStroke (via the
// editor wiring a PenEditor onto it) fire individual listener
// callbacks and broadcast just the changed property. Same pattern as
// the demo — see diagram-vm.mjs:1036-1167.
//
// `_seedingFormat` reentrancy gate prevents the broadcast pathway from
// firing during a seed-driven write — a fresh selection shouldn't
// replay the first leaf's values onto every OTHER leaf.

interface IFillableItem { Fill:   Brush | undefined; }
interface IStrokableItem { Stroke: Pen   | undefined; }
// A shape whose label carries paragraph alignment + block placement — the
// figure leaves (each owns a ShapeText via `.Text`). Groups flatten away, so
// the mirror only ever sees leaves. Alignment routes through ShapeText's
// ApplyParagraphAlignment / CurrentParagraphAlignment so edit mode targets the
// caret paragraph; placement is a whole-shape DP.
interface ITextualItem { Text?: ShapeText; }
// A content view-model whose label lives outside a ShapeText (an arch node's
// `$Label` tile) opts into the text/character channels by exposing its own
// ITextStyleTarget. `_textTargetOf` prefers a leaf's ShapeText and falls back to
// this — the character/paragraph analogue of the Fill/Stroke paint-target
// redirect (`_paintTargets`). Block placement stays ShapeText-only.
interface ITextStyleHost { TextStyle?: ITextStyleTarget; }

// Heterogeneous-typed array of Pen DP keys. Each entry is a
// `PropertyKey<T>` for a different `T`; the broadcast loops treat them
// uniformly as `PropertyKey<unknown>` so the set/get pair compiles
// without per-key narrowing (the runtime DP system carries the actual
// type identity in the key.descriptor — no behavioral change).
const PEN_KEYS: PropertyKey<unknown>[] = [
    Pen.BrushKey       as PropertyKey<unknown>,
    Pen.ThicknessKey   as PropertyKey<unknown>,
    Pen.DashStyleKey   as PropertyKey<unknown>,
    Pen.LineCapKey     as PropertyKey<unknown>,
    Pen.LineJoinKey    as PropertyKey<unknown>,
    Pen.MiterLimitKey  as PropertyKey<unknown>,
];

export enum ConnectorEnd
{
    Source = 'Source',
    Target = 'Target',
}

export class FormatMirror
{
    private readonly _diagram: Diagram;

    // Per-pen-property subscriptions attached to the current FormatStroke
    // instance. Detach + reattach on every FormatStroke DP change.
    private readonly _strokeListeners: Disposable[] = [];
    private _attachedPen: Pen | undefined = undefined;

    private _seedingFormat = false;

    // Edit-selection subscriptions on the current selection's ShapeTexts, so
    // a caret move inside an editing shape re-reflects the alignment toolbar.
    private _editSelSubs: Array<{ text: ShapeText; handler: () => void }> = [];

    constructor(diagram: Diagram)
    {
        this._diagram = diagram;
        const Diagram = diagram.constructor as typeof import('../diagram.js').Diagram;
        diagram.AddSelectionChangedListener(() => this._seedFromSelection());
        // Connector selection rides the same format channel — the
        // user can click a connector's hover halo, the editor seeds
        // from the connector's Pen, and per-property edits broadcast
        // back. § "Clicking the adorner clears figure selection" is
        // honored upstream by the hover-halo behavior, so the seed
        // here only ever picks from ONE population at a time.
        diagram.AddConnectorSelectionChangedListener(() => this._seedFromSelection());
        diagram.PropertyChanged(Diagram.SelectionFormatFillKey).subscribe(  () => this._broadcastFill());
        diagram.PropertyChanged(Diagram.SelectionFormatStrokeKey).subscribe(() => this._onFormatStrokeChanged());
        // Cap channel — same seed/broadcast shape as Fill/Stroke, but
        // targets only selected connectors' Source/TargetCapTemplate DPs.
        diagram.PropertyChanged(Diagram.SelectionFormatSourceCapKey).subscribe(() => this._broadcastCap(ConnectorEnd.Source));
        diagram.PropertyChanged(Diagram.SelectionFormatTargetCapKey).subscribe(() => this._broadcastCap(ConnectorEnd.Target));
        // Per-end cap size rides the same seed/broadcast shape as the cap
        // templates, targeting each selected connector's Source/TargetCapScale.
        diagram.PropertyChanged(Diagram.SelectionFormatSourceCapScaleKey).subscribe(() => this._broadcastCapScale(ConnectorEnd.Source));
        diagram.PropertyChanged(Diagram.SelectionFormatTargetCapScaleKey).subscribe(() => this._broadcastCapScale(ConnectorEnd.Target));
        // Text-format channel — paragraph alignment + label placement,
        // seeded from the first selected shape and broadcast onto every
        // selected shape's Text.
        diagram.PropertyChanged(Diagram.SelectionTextAlignmentKey).subscribe(() => this._broadcastTextAlignment());
        diagram.PropertyChanged(Diagram.SelectionTextPlacementKey).subscribe(() => this._broadcastTextPlacement());
        // Character-style channel — font family / size / colour + the four
        // decoration booleans, broadcast onto every selected shape's label.
        diagram.PropertyChanged(Diagram.SelectionFontFamilyKey).subscribe(  () => this._broadcast((t, d) => t.ApplyFontFamily(d.SelectionFontFamily)));
        diagram.PropertyChanged(Diagram.SelectionFontSizeKey).subscribe(    () => this._broadcast((t, d) => t.ApplyFontSize(d.SelectionFontSize)));
        diagram.PropertyChanged(Diagram.SelectionFontColorHexKey).subscribe(() => this._broadcast((t, d) => t.ApplyForeground(hexToBrush(d.SelectionFontColorHex))));
        diagram.PropertyChanged(Diagram.SelectionBoldKey).subscribe(          () => this._broadcast((t, d) => t.ApplyBold(d.SelectionBold)));
        diagram.PropertyChanged(Diagram.SelectionItalicKey).subscribe(        () => this._broadcast((t, d) => t.ApplyItalic(d.SelectionItalic)));
        diagram.PropertyChanged(Diagram.SelectionUnderlineKey).subscribe(     () => this._broadcast((t, d) => t.ApplyUnderline(d.SelectionUnderline)));
        diagram.PropertyChanged(Diagram.SelectionStrikethroughKey).subscribe( () => this._broadcast((t, d) => t.ApplyStrikethrough(d.SelectionStrikethrough)));

        // Keep the toolbar's Toggles-presentation buttons in sync with the
        // selection's text state. Their IsChecked is `= $IsActive`, which the
        // ToolbarService only re-reads (via DiagramDocument.IsActive → these DPs)
        // on a global requery PULSE. Selection CHANGES already pulse (the command
        // collaborator's _raiseCanExecuteAll), but a command-driven format change
        // (clicking an align/decoration button) mutates the DP WITHOUT changing
        // the selection — so without this the previously-active button stays lit
        // (e.g. Center stays toggled after clicking Left, breaking the alignment
        // radio group). Pulse on every toggle-backing DP change so RefreshActive
        // States re-reads all of them.
        const pulseRequery = (): void => CommandManager.InvalidateRequerySuggested();
        diagram.PropertyChanged(Diagram.SelectionTextAlignmentKey).subscribe(pulseRequery);
        diagram.PropertyChanged(Diagram.SelectionBoldKey).subscribe(          pulseRequery);
        diagram.PropertyChanged(Diagram.SelectionItalicKey).subscribe(        pulseRequery);
        diagram.PropertyChanged(Diagram.SelectionUnderlineKey).subscribe(     pulseRequery);
        diagram.PropertyChanged(Diagram.SelectionStrikethroughKey).subscribe( pulseRequery);
    }

    private _leaves(): MuralBase[]
    {
        return flattenToLeaves(this._diagram.SelectedItems);
    }

    // The text-style target for a leaf: its own ShapeText (a geometric shape's
    // caption) or, failing that, a content VM's exposed ITextStyleTarget (an arch
    // node's `$Label` tile). The character + paragraph-alignment channels route
    // through this so both populations respond to the Text page. Block placement
    // stays on `.Text` only — a VM label tile has no inside/outside placement.
    private _textTargetOf(leaf: MuralBase | undefined): ITextStyleTarget | undefined
    {
        if (leaf === undefined) return undefined;
        return (leaf as ITextualItem).Text ?? (leaf as ITextStyleHost).TextStyle;
    }

    // Fill / Stroke style the paint SURFACE. A selected leaf that is itself
    // paintable — a geometric shape Figure carries Fill/Stroke DPs — styles
    // directly; a content VM (an arch node: no Fill/Stroke of its own) styles its
    // CONTAINER Figure, the rounded-rect card the Style page edits. The text /
    // character channels stay on _leaves() (they target the shape's own Text).
    private _paintTargets(): MuralBase[]
    {
        const gen = (this._diagram as unknown as { Generator?: { ContainerFromItem(i: unknown): unknown } }).Generator;
        const out: MuralBase[] = [];
        for (const leaf of this._leaves())
        {
            if ('Fill' in (leaf as object) || 'Stroke' in (leaf as object)) { out.push(leaf); continue; }
            const container = gen?.ContainerFromItem(leaf) as MuralBase | undefined;
            out.push(container ?? leaf);
        }
        return out;
    }

    // Selected connectors flattened to IStrokableItem targets. Connectors
    // don't nest (no group analog), so the array is the selection list
    // verbatim. Pulled out as a method to mirror _leaves() — broadcast
    // helpers iterate both.
    private _strokeTargetsFromConnectors(): MuralBase[]
    {
        return [...this._diagram.SelectedConnectors] as unknown as MuralBase[];
    }

    private _seedFromSelection(): void
    {
        const Diagram = this._diagram.constructor as typeof import('../diagram.js').Diagram;
        const leaves = this._leaves();
        const connectors = this._strokeTargetsFromConnectors();
        // Re-point the caret-move subscriptions at the new selection so an
        // editing shape's caret move re-reflects the alignment toolbar.
        this._rewireEditListeners(leaves);
        this._seedingFormat = true;
        try
        {
            // Cap channel + the "show caps" signal. A connector-only
            // selection drives the cap section; the first connector seeds
            // both end dropdowns. Done first so the early-return below
            // (no formattable target at all) still leaves these coherent
            // (no connectors → undefined caps, IsConnector false).
            const selConnectors = this._diagram.SelectedConnectors;
            const firstConn: Connector | undefined = selConnectors[0];
            this._diagram.set_property_value(Diagram.SelectionIsConnectorKey,
                selConnectors.length > 0 && leaves.length === 0);
            this._diagram.set_property_value(Diagram.SelectionFormatSourceCapKey,
                firstConn !== undefined ? firstConn.SourceCapTemplate : undefined);
            this._diagram.set_property_value(Diagram.SelectionFormatTargetCapKey,
                firstConn !== undefined ? firstConn.TargetCapTemplate : undefined);
            this._diagram.set_property_value(Diagram.SelectionFormatSourceCapScaleKey,
                firstConn !== undefined ? firstConn.SourceCapScale : 1);
            this._diagram.set_property_value(Diagram.SelectionFormatTargetCapScaleKey,
                firstConn !== undefined ? firstConn.TargetCapScale : 1);

            // Text channel — seed from the first selected shape's label (both
            // undefined when the selection has no shape leaves, so the
            // toolbars show nothing active). Alignment reads the caret
            // paragraph when the shape is being edited (Part 2). Done alongside
            // the cap channel, before the early return, so these stay coherent.
            const firstTarget = this._textTargetOf(leaves[0]);
            const firstText = (leaves[0] as ITextualItem | undefined)?.Text;
            this._diagram.set_property_value(Diagram.SelectionTextAlignmentKey, firstTarget?.CurrentParagraphAlignment());
            this._diagram.set_property_value(Diagram.SelectionTextPlacementKey, firstText?.Placement);
            this._seedCharFormat(firstTarget);

            if (leaves.length === 0 && connectors.length === 0)
            {
                this._diagram.set_property_value(Diagram.SelectionFormatFillKey,   undefined);
                this._diagram.set_property_value(Diagram.SelectionFormatStrokeKey, undefined);
                return;
            }
            // Figure leaves win when both populations are non-empty —
            // mirrors the broadcast preference (figures own Fill, both
            // own Stroke). The hover-halo behavior clears figure
            // selection on connector pick, so the mixed-population case
            // only arises if a caller bypasses the halo. Fill/Stroke seed
            // from the paint SURFACE (a content VM's container Figure), not
            // the VM leaf itself.
            const paintTargets = this._paintTargets();
            const firstStrokable: MuralBase | undefined =
                paintTargets.length > 0 ? paintTargets[0] : connectors[0];
            const firstFill = paintTargets.length > 0
                ? (paintTargets[0] as unknown as Partial<IFillableItem>).Fill
                : undefined;
            this._diagram.set_property_value(Diagram.SelectionFormatFillKey, firstFill);
            const firstStroke = (firstStrokable as unknown as Partial<IStrokableItem>).Stroke;
            // Clone the pen so the editor doesn't mutate the first
            // target's Pen by-reference — broadcast back copies
            // properties onto each target's OWN Pen, preserving per-
            // target identity.
            this._diagram.set_property_value(Diagram.SelectionFormatStrokeKey,
                firstStroke !== undefined ? clonePen(firstStroke) : undefined);
        }
        finally
        {
            this._seedingFormat = false;
        }
    }

    // Broadcast the chosen cap template onto every selected connector's
    // matching end. Gated by _seedingFormat so a fresh selection's seed
    // (which writes the cap DPs) doesn't replay the first connector's caps
    // onto the others.
    private _broadcastCap(end: ConnectorEnd): void
    {
        if (this._seedingFormat) return;
        const tpl: DataTemplate | undefined = end === ConnectorEnd.Source
            ? this._diagram.SelectionFormatSourceCap
            : this._diagram.SelectionFormatTargetCap;
        for (const conn of this._diagram.SelectedConnectors)
        {
            if (end === ConnectorEnd.Source) conn.SourceCapTemplate = tpl;
            else                  conn.TargetCapTemplate = tpl;
        }
    }

    // Broadcast the chosen paragraph alignment onto every selected shape's
    // label. Gated by _seedingFormat so a fresh selection's seed doesn't
    // replay the first shape's alignment onto the others. undefined (no
    // shape selected) is a no-op.
    private _broadcastTextAlignment(): void
    {
        if (this._seedingFormat) return;
        const align = this._diagram.SelectionTextAlignment;
        if (align === undefined) return;
        for (const leaf of this._leaves())
        {
            // Routes per mode inside ShapeText: caret paragraph while editing,
            // every paragraph for rich content, the block default for plain. A
            // content VM's label tile aligns at block level via its target.
            this._textTargetOf(leaf)?.ApplyParagraphAlignment(align);
        }
    }

    // (Re)subscribe to every selected shape's edit-selection-changed signal.
    // Fires on caret moves inside an editing shape (and on edit begin/end);
    // we re-seed just the alignment DP from the caret paragraph.
    private _rewireEditListeners(leaves: MuralBase[]): void
    {
        for (const s of this._editSelSubs) s.text.RemoveEditSelectionChangedListener(s.handler);
        this._editSelSubs = [];
        for (const leaf of leaves)
        {
            const text = (leaf as ITextualItem).Text;
            if (text === undefined) continue;
            const handler = (): void => this._reseedTextFormat();
            text.AddEditSelectionChangedListener(handler);
            this._editSelSubs.push({ text, handler });
        }
    }

    // Re-seed the caret-scoped text DPs (alignment + character style) from the
    // first selected shape's current caret paragraph / run — used when the
    // editor caret moves so the toolbars track the caret's formatting.
    private _reseedTextFormat(): void
    {
        const firstTarget = this._textTargetOf(this._leaves()[0]);
        this._seedingFormat = true;
        try
        {
            this._diagram.SelectionTextAlignment = firstTarget?.CurrentParagraphAlignment();
            this._seedCharFormat(firstTarget);
        }
        finally { this._seedingFormat = false; }
    }

    // Seed the character-style DPs from a shape's label (the caret run while
    // editing). Caller owns the _seedingFormat gate. undefined shape → defaults.
    private _seedCharFormat(text: ITextStyleTarget | undefined): void
    {
        const D = this._diagram.constructor as typeof import('../diagram.js').Diagram;
        this._diagram.set_property_value(D.SelectionFontFamilyKey,   text?.CurrentFontFamily() ?? '');
        this._diagram.set_property_value(D.SelectionFontSizeKey,     text?.CurrentFontSize() ?? 12);
        this._diagram.set_property_value(D.SelectionFontColorHexKey, brushToHex(text?.CurrentForeground()));
        this._diagram.set_property_value(D.SelectionBoldKey,          text?.CurrentBold() ?? false);
        this._diagram.set_property_value(D.SelectionItalicKey,        text?.CurrentItalic() ?? false);
        this._diagram.set_property_value(D.SelectionUnderlineKey,     text?.CurrentUnderline() ?? false);
        this._diagram.set_property_value(D.SelectionStrikethroughKey, text?.CurrentStrikethrough() ?? false);
    }

    // Broadcast a character-style edit onto every selected shape's label. Gated
    // by _seedingFormat so a fresh selection's seed doesn't replay the first
    // shape's style onto the others.
    private _broadcast(apply: (text: ITextStyleTarget, diagram: Diagram) => void): void
    {
        if (this._seedingFormat) return;
        for (const leaf of this._leaves())
        {
            const text = this._textTargetOf(leaf);
            if (text !== undefined) apply(text, this._diagram);
        }
    }

    // ── Command-driven character-style force-apply ─────────────────────
    // Reflect on the Selection* DP (suppressed) then apply to every leaf,
    // unconditionally — so a decoration toggle command re-applies even when the
    // reflected DP already equals the value. Mirrors ApplyTextAlignment.
    public ApplyBold(on: boolean): void { this._forceApplyChar((D) => D.SelectionBoldKey, on, (t) => t.ApplyBold(on)); }
    public ApplyItalic(on: boolean): void { this._forceApplyChar((D) => D.SelectionItalicKey, on, (t) => t.ApplyItalic(on)); }
    public ApplyUnderline(on: boolean): void { this._forceApplyChar((D) => D.SelectionUnderlineKey, on, (t) => t.ApplyUnderline(on)); }
    public ApplyStrikethrough(on: boolean): void { this._forceApplyChar((D) => D.SelectionStrikethroughKey, on, (t) => t.ApplyStrikethrough(on)); }
    public ApplyFontFamily(family: string): void { this._forceApplyChar((D) => D.SelectionFontFamilyKey, family, (t) => t.ApplyFontFamily(family)); }
    public ApplyFontSize(size: number): void { this._forceApplyChar((D) => D.SelectionFontSizeKey, size, (t) => t.ApplyFontSize(size)); }
    public ApplyFontColorHex(hex: string): void { this._forceApplyChar((D) => D.SelectionFontColorHexKey, hex, (t) => t.ApplyForeground(hexToBrush(hex))); }

    // Step each selected label's OWN size by delta (the caret run while editing),
    // preserving relative sizing across a mixed selection, then reflect the first
    // shape's new size on the DP (suppressed so it doesn't re-broadcast).
    public BumpFontSize(delta: number): void
    {
        for (const leaf of this._leaves())
        {
            const text = this._textTargetOf(leaf);
            if (text !== undefined) text.ApplyFontSize(clampFontSize(text.CurrentFontSize() + delta));
        }
        const firstText = (this._leaves()[0] as ITextualItem | undefined)?.Text;
        const D = this._diagram.constructor as typeof import('../diagram.js').Diagram;
        this._seedingFormat = true;
        try { this._diagram.set_property_value(D.SelectionFontSizeKey, firstText?.CurrentFontSize() ?? 12); }
        finally { this._seedingFormat = false; }
    }

    private _forceApplyChar<T>(
        key: (D: typeof import('../diagram.js').Diagram) => PropertyKey<T>,
        value: T,
        apply: (text: ITextStyleTarget) => void,
    ): void
    {
        const D = this._diagram.constructor as typeof import('../diagram.js').Diagram;
        this._seedingFormat = true;
        try { this._diagram.set_property_value(key(D), value); }
        finally { this._seedingFormat = false; }
        for (const leaf of this._leaves())
        {
            const text = this._textTargetOf(leaf);
            if (text !== undefined) apply(text);
        }
    }

    // Broadcast the chosen label placement onto every selected shape.
    private _broadcastTextPlacement(): void
    {
        if (this._seedingFormat) return;
        const placement = this._diagram.SelectionTextPlacement;
        if (placement === undefined) return;
        for (const leaf of this._leaves())
        {
            const text = (leaf as ITextualItem).Text;
            if (text !== undefined) text.Placement = placement;
        }
    }

    // ── Command-driven force-apply ──────────────────────────────────────
    // Reflect the value on the Selection* DP (for the active-state toggles) AND
    // apply it to every selected leaf — unconditionally, unlike the DP-change
    // broadcast above which no-ops when the reflected DP already equals the
    // value. The reflect write is done under _seedingFormat so it doesn't also
    // fire the _broadcast* listener (that would double-apply). Used by the
    // Diagram's text-format commands (and any programmatic ApplySelectionText*).
    public ApplyTextAlignment(align: TextAlignment): void
    {
        const Diagram = this._diagram.constructor as typeof import('../diagram.js').Diagram;
        this._seedingFormat = true;
        try { this._diagram.set_property_value(Diagram.SelectionTextAlignmentKey, align); }
        finally { this._seedingFormat = false; }
        for (const leaf of this._leaves())
        {
            this._textTargetOf(leaf)?.ApplyParagraphAlignment(align);
        }
    }

    public ApplyTextPlacement(placement: TextPlacement): void
    {
        const Diagram = this._diagram.constructor as typeof import('../diagram.js').Diagram;
        this._seedingFormat = true;
        try { this._diagram.set_property_value(Diagram.SelectionTextPlacementKey, placement); }
        finally { this._seedingFormat = false; }
        for (const leaf of this._leaves())
        {
            const text = (leaf as ITextualItem).Text;
            if (text !== undefined) text.Placement = placement;
        }
    }

    // Broadcast the chosen cap size onto every selected connector's matching
    // end. Gated by _seedingFormat like _broadcastCap.
    private _broadcastCapScale(end: ConnectorEnd): void
    {
        if (this._seedingFormat) return;
        const scale: number = end === ConnectorEnd.Source
            ? this._diagram.SelectionFormatSourceCapScale
            : this._diagram.SelectionFormatTargetCapScale;
        for (const conn of this._diagram.SelectedConnectors)
        {
            if (end === ConnectorEnd.Source) conn.SourceCapScale = scale;
            else                  conn.TargetCapScale = scale;
        }
    }

    private _broadcastFill(): void
    {
        if (this._seedingFormat) return;
        const brush = this._diagram.SelectionFormatFill;
        for (const target of this._paintTargets())
        {
            if ('Fill' in (target as object))
            {
                (target as unknown as IFillableItem).Fill = brush;
            }
        }
    }

    private _onFormatStrokeChanged(): void
    {
        // Detach from the prior pen first.
        this._detachStrokeListeners();
        const pen = this._diagram.SelectionFormatStroke;
        if (pen !== undefined) this._attachStrokeListeners(pen);
        // Replacement itself is a broadcast — copy every property onto
        // each leaf's pen IN PLACE. Seed-driven replacements are gated.
        if (!this._seedingFormat) this._broadcastWholePen();
    }

    private _attachStrokeListeners(pen: Pen): void
    {
        this._attachedPen = pen;
        for (const key of PEN_KEYS)
        {
            this._strokeListeners.push(
                pen.PropertyChanged(key).subscribe(() => this._broadcastStrokeProp(key)),
            );
        }
    }

    private _detachStrokeListeners(): void
    {
        if (this._attachedPen === undefined) return;
        for (const sub of this._strokeListeners) sub.dispose();
        this._strokeListeners.length = 0;
        this._attachedPen = undefined;
    }

    private _broadcastStrokeProp(key: PropertyKey<unknown>): void
    {
        if (this._seedingFormat) return;
        const editorPen = this._diagram.SelectionFormatStroke;
        if (editorPen === undefined) return;
        const value = editorPen.get_property_value(key);
        for (const target of this._strokeTargets())
        {
            target.set_property_value(key, value);
        }
    }

    private _broadcastWholePen(): void
    {
        const editorPen = this._diagram.SelectionFormatStroke;
        if (editorPen === undefined) return;
        for (const target of this._strokeTargets())
        {
            for (const key of PEN_KEYS)
            {
                target.set_property_value(key, editorPen.get_property_value(key));
            }
        }
    }

    // Union of figure-leaf pens and selected-connector pens. Each entry
    // is the Pen instance owned by the target (NOT the editor pen) — we
    // mutate its DPs in place so the target's identity survives broadcast.
    private _strokeTargets(): Pen[]
    {
        const out: Pen[] = [];
        for (const target of this._paintTargets())
        {
            const pen = (target as unknown as Partial<IStrokableItem>).Stroke;
            if (pen !== undefined) out.push(pen);
        }
        for (const conn of this._strokeTargetsFromConnectors())
        {
            const pen = (conn as unknown as Partial<IStrokableItem>).Stroke;
            if (pen !== undefined) out.push(pen);
        }
        return out;
    }
}

// Font-colour rides the character-style channel as a hex string (so a
// ColorPicker.ColorHex binds it directly); ShapeText works in Brush terms, so
// convert at this boundary. A non-solid brush seeds as black (the picker has no
// gradient representation).
function hexToBrush(hex: string): SolidColorBrush { return new SolidColorBrush(Color.FromHex(hex)); }

// Keep a bumped font size in a sane, whole-point range.
function clampFontSize(n: number): number { return Math.max(1, Math.min(999, Math.round(n))); }
function brushToHex(brush: Brush | undefined): string
{
    return brush instanceof SolidColorBrush ? brush.Color.ToHex() : '#000000';
}

// Per-property copy into a fresh Pen instance — preserves the editor's
// independence from the source pen's identity. The cloned pen is what
// the FormatStroke DP holds; broadcasts copy ITS values back onto each
// leaf's own Pen.
function clonePen(src: Pen): Pen
{
    const out = new Pen();
    for (const key of PEN_KEYS) out.set_property_value(key, src.get_property_value(key));
    return out;
}
