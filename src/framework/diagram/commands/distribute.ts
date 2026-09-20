// Pure distribute math — spaces ≥ 3 shapes evenly along an axis with
// the extremes (leftmost / rightmost OR topmost / bottommost) pinned
// in place. Inner shapes get equal gaps between consecutive
// (right-edge → next-left-edge) pairs.
//
// Edge-gap (not centroid-gap) distribution — PowerPoint / Visio / Figma
// convention. Order-stable: sorts the input by primary axis before
// computing, so the result depends only on the set of shapes, not the
// selection order.
//
// No-op for fewer than 3 items: alignment-only (2 shapes) is what
// AlignXxx already provides; distributing 1 is meaningless.

export interface DistributeTarget
{
    Left:   number;
    Top:    number;
    Width:  number;
    Height: number;
}

export function distributeHorizontal(items: readonly DistributeTarget[]): void
{
    if (items.length < 3) return;
    const sorted = [...items].sort((a, b) => a.Left - b.Left);
    const leftmost  = sorted[0]!;
    const rightmost = sorted[sorted.length - 1]!;
    const totalSpan = (rightmost.Left + rightmost.Width) - leftmost.Left;
    const widthSum  = sorted.reduce((acc, n) => acc + n.Width, 0);
    const gap       = (totalSpan - widthSum) / (sorted.length - 1);
    let cursor = leftmost.Left + leftmost.Width + gap;
    for (let i = 1; i < sorted.length - 1; i++)
    {
        sorted[i]!.Left = cursor;
        cursor += sorted[i]!.Width + gap;
    }
}

export function distributeVertical(items: readonly DistributeTarget[]): void
{
    if (items.length < 3) return;
    const sorted = [...items].sort((a, b) => a.Top - b.Top);
    const topmost    = sorted[0]!;
    const bottommost = sorted[sorted.length - 1]!;
    const totalSpan = (bottommost.Top + bottommost.Height) - topmost.Top;
    const heightSum = sorted.reduce((acc, n) => acc + n.Height, 0);
    const gap       = (totalSpan - heightSum) / (sorted.length - 1);
    let cursor = topmost.Top + topmost.Height + gap;
    for (let i = 1; i < sorted.length - 1; i++)
    {
        sorted[i]!.Top = cursor;
        cursor += sorted[i]!.Height + gap;
    }
}
