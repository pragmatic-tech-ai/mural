import { ServiceKey } from '../../runtime/index.js';

// The command context a board document activates — the identity tag that joins
// the board's toolbar commands to the active document. A ServiceKey used purely
// as a context key (never resolved): a CommandDefinition declares
// `Context = BoardEditingContext`, BoardDocument exposes it in its live
// CommandContexts, and the ToolbarService shows the command iff the two match.
// Shareable — any document type that activates this context lights up the same
// commands.
export const BoardEditingContext = new ServiceKey<unknown>('board.editing');

// Stable ids for the board's editing commands. BoardDocument maps each to the
// Board control's corresponding command when it interprets Execute / CanExecute
// (see board-document.ts). An app declares matching CommandDefinitions (chrome)
// in its `.commands:` block with these exact Id strings — same markup-string ↔
// code-constant contract as SettingDefinition keys.
export enum BoardCommandId
{
    AlignLeft   = 'board.align.left',
    AlignRight  = 'board.align.right',
    AlignTop    = 'board.align.top',
    AlignMiddle = 'board.align.middle',
    AlignCenter = 'board.align.center',
    DistributeHorizontal = 'board.distribute.horizontal',
    DistributeVertical   = 'board.distribute.vertical',
    Group   = 'board.group',
    Ungroup = 'board.ungroup',
    CombineUnion     = 'board.combine.union',
    CombineIntersect = 'board.combine.intersect',
    CombineSubtract  = 'board.combine.subtract',
    CombineExclude   = 'board.combine.exclude',
    // Text-format — paragraph alignment WITHIN the label, and label placement
    // WITHIN the shape footprint (the two label toolbars).
    TextAlignLeft    = 'board.text.align.left',
    TextAlignCenter  = 'board.text.align.center',
    TextAlignRight   = 'board.text.align.right',
    TextAlignJustify = 'board.text.align.justify',
    TextPlaceTopLeft     = 'board.text.place.top-left',
    TextPlaceTop         = 'board.text.place.top',
    TextPlaceTopRight    = 'board.text.place.top-right',
    TextPlaceLeft        = 'board.text.place.left',
    TextPlaceCenter      = 'board.text.place.center',
    TextPlaceRight       = 'board.text.place.right',
    TextPlaceBottomLeft  = 'board.text.place.bottom-left',
    TextPlaceBottom      = 'board.text.place.bottom',
    TextPlaceBottomRight = 'board.text.place.bottom-right',
    // Character decorations — bold / italic / underline / strikethrough.
    TextBold          = 'board.text.bold',
    TextItalic        = 'board.text.italic',
    TextUnderline     = 'board.text.underline',
    TextStrikethrough = 'board.text.strikethrough',
    // Grow / shrink font one point.
    TextSizeIncrease  = 'board.text.size.increase',
    TextSizeDecrease  = 'board.text.size.decrease',
}
