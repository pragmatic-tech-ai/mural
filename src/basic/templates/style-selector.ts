import type { Style, Visual } from '../../runtime/index.js';

// WPF's StyleSelector, as a class family — the Style-valued sibling of
// DataTemplateSelector. Picks the Style for `item` in the context of `container`
// (e.g. an ItemsControl item container); undefined falls the consumer back to its
// own ItemContainerStyle. Consumers accept EITHER a selector object or a plain
// function (StyleSelection); `resolve` is the single normalization point.
export type StyleSelectorFn = (item: unknown, container: Visual) => Style | undefined;
export type StyleSelection  = StyleSelector | StyleSelectorFn;

export abstract class StyleSelector
{
    public abstract SelectStyle(item: unknown, container: Visual): Style | undefined;

    public static fromFn(fn: StyleSelectorFn): StyleSelector
    {
        return new FnStyleSelector(fn);
    }

    public static resolve(sel: StyleSelection | undefined, item: unknown, container: Visual): Style | undefined
    {
        if (sel === undefined) return undefined;
        return sel instanceof StyleSelector ? sel.SelectStyle(item, container) : sel(item, container);
    }
}

class FnStyleSelector extends StyleSelector
{
    constructor(private readonly fn: StyleSelectorFn) { super(); }
    public SelectStyle(item: unknown, container: Visual): Style | undefined { return this.fn(item, container); }
}
