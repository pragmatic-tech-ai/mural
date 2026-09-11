import type { Visual } from '../../runtime/index.js';
import type { DataTemplate } from './data-template.js';

// WPF's DataTemplateSelector, as a class family. A selector picks the
// DataTemplate for `item` in the context of `container` (the presenter /
// item-container asking) — returning undefined falls the consumer back to its
// own ItemTemplate / ContentTemplate.
//
// The DPs that consume selectors accept EITHER a selector object or a plain
// function (TemplateSelection), so existing function-typed call sites keep
// working; `resolve` is the single normalization point. Object selectors are
// what markup can author (a function literal can't appear in .mu).
export type TemplateSelectorFn = (item: unknown, container: Visual) => DataTemplate | undefined;
export type TemplateSelection  = DataTemplateSelector | TemplateSelectorFn;

export abstract class DataTemplateSelector
{
    public abstract SelectTemplate(item: unknown, container: Visual): DataTemplate | undefined;

    // Wrap a plain function as a selector object — the adapter that lets the
    // union DP, and quick inline pickers, become first-class selectors.
    public static fromFn(fn: TemplateSelectorFn): DataTemplateSelector
    {
        return new FnDataTemplateSelector(fn);
    }

    // Resolve EITHER form (object, function, or undefined) — call sites use this
    // instead of a typeof check. Static, not a free function (house OOP style).
    public static resolve(sel: TemplateSelection | undefined, item: unknown, container: Visual): DataTemplate | undefined
    {
        if (sel === undefined) return undefined;
        return sel instanceof DataTemplateSelector ? sel.SelectTemplate(item, container) : sel(item, container);
    }
}

class FnDataTemplateSelector extends DataTemplateSelector
{
    constructor(private readonly fn: TemplateSelectorFn) { super(); }
    public SelectTemplate(item: unknown, container: Visual): DataTemplate | undefined { return this.fn(item, container); }
}
