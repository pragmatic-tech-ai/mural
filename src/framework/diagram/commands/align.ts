// Pure alignment math — operates on any objects exposing { Left, Top,
// Width, Height } as writable number properties. The diagrammer's
// IFigure interface (src/framework/diagram/contracts/i-figure.ts when
// it lands) is the canonical contract; consumers can pass any duck-typed
// array.
//
// All five functions:
//   * require ≥ 2 items (PowerPoint / Visio parity — 1-item alignment
//     is a no-op since nothing to align against)
//   * mutate `items` in-place; no return value
//   * use the SELECTION'S OWN bbox as the reference frame, NOT a canvas
//     or page reference (matches every drawing tool from Visio to Figma
//     to PowerPoint)
//
// AlignLeft / Right / Top use edge alignment: every shape gets pulled
// to the leftmost / rightmost / topmost edge.
//
// AlignMiddle / Center use centroid alignment: every shape's vertical /
// horizontal centre lines up on a shared axis, with the axis derived
// from the selection bbox's midpoint.

export interface AlignTarget
{
    Left:   number;
    Top:    number;
    Width:  number;
    Height: number;
}

export function alignLeft(items: readonly AlignTarget[]): void
{
    if (items.length < 2) return;
    const minLeft = Math.min(...items.map(n => n.Left));
    for (const n of items) n.Left = minLeft;
}

export function alignRight(items: readonly AlignTarget[]): void
{
    if (items.length < 2) return;
    // Right-edge alignment: every shape's right edge lines up with the
    // selection's max right edge. Each shape's new Left = sharedRight - width.
    const sharedRight = Math.max(...items.map(n => n.Left + n.Width));
    for (const n of items) n.Left = sharedRight - n.Width;
}

export function alignTop(items: readonly AlignTarget[]): void
{
    if (items.length < 2) return;
    const minTop = Math.min(...items.map(n => n.Top));
    for (const n of items) n.Top = minTop;
}

// "Middle" = horizontal middle line (vertical centres aligned on a
// shared horizontal axis). PowerPoint nomenclature.
export function alignMiddle(items: readonly AlignTarget[]): void
{
    if (items.length < 2) return;
    const top    = Math.min(...items.map(n => n.Top));
    const bottom = Math.max(...items.map(n => n.Top + n.Height));
    const midY   = (top + bottom) / 2;
    for (const n of items) n.Top = midY - n.Height / 2;
}

// "Center" = vertical centre line (horizontal centres aligned on a
// shared vertical axis). PowerPoint nomenclature.
export function alignCenter(items: readonly AlignTarget[]): void
{
    if (items.length < 2) return;
    const left  = Math.min(...items.map(n => n.Left));
    const right = Math.max(...items.map(n => n.Left + n.Width));
    const midX  = (left + right) / 2;
    for (const n of items) n.Left = midX - n.Width / 2;
}
