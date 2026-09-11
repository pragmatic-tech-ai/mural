import type { Visual } from '../../runtime/index.js';
import { DataTemplate } from './data-template.js';
import { DataTemplateSelector } from './data-template-selector.js';

// A selector keyed by the item's TYPE — the scoped, assignable form of mural's
// implicit `DataTemplate [DataType=X]` resolution. Matches `item.constructor`
// against `cases` walking the prototype chain most-derived-first (reusing
// DataTemplate.walkTypeChain, so `[DataType=Derived]` wins over `[DataType=Base]`
// and a Base entry still catches other Base subclasses), falling back to
// `fallback` when nothing matches.
export class TypeTemplateSelector extends DataTemplateSelector
{
    constructor(
        private readonly cases: ReadonlyMap<Function, DataTemplate>,
        private readonly fallback?: DataTemplate,
    ) { super(); }

    public SelectTemplate(item: unknown, _container: Visual): DataTemplate | undefined
    {
        if (item === null || item === undefined) return this.fallback;
        const hit = DataTemplate.walkTypeChain((item as object).constructor, (t) => this.cases.get(t));
        return hit ?? this.fallback;
    }
}
