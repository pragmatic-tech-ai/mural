import { Observable } from '../../runtime/index.js';
import { type Disposable } from '@pragmatic-tech-ai/todl-runtime';
import { GridProperty } from './grid-property.js';
import { type IPropertyBag } from './property-bag.js';
import { type DataTemplate } from '../../basic/templates/data-template.js';

/**
 * Editor-template resolver: given a `PropertyItem`, return the `DataTemplate`
 * that should render its editor row.  This is the same shape as
 * `ItemsControl.ItemTemplateSelector`; the property grid's own selector
 * resolves EditorTemplateKey → IsReadOnly → per-kind template.
 */
export type EditorTemplateResolver = (item: PropertyItem) => DataTemplate | undefined;

/**
 * Row view-model for a single property in the property grid.
 *
 * Wraps a `GridProperty` descriptor and an `IPropertyBag` and presents a
 * reactive `Value` getter/setter pair.  External bag mutations bubble up as
 * `PropertyChanged("Value")` so the grid row can respond without polling.
 *
 * Extends `Observable` (lightweight INPC root) — NOT `MuralBase`.
 */
export class PropertyItem extends Observable {
    readonly Descriptor: GridProperty;
    private readonly _bag: IPropertyBag;
    private _subscription: Disposable | null;

    constructor(descriptor: GridProperty, bag: IPropertyBag) {
        super();
        this.Descriptor = descriptor;
        this._bag = bag;
        this._subscription = bag.Observe(descriptor.Name).subscribe(() => {
            const newValue = bag.GetValue(descriptor.Name);
            this.RaisePropertyChanged('Value', undefined, newValue);
        });
    }

    public get Value(): unknown {
        return this._bag.GetValue(this.Descriptor.Name);
    }

    public set Value(v: unknown) {
        if (this.IsReadOnly) {
            return;
        }
        this._bag.SetValue(this.Descriptor.Name, v);
    }

    public get IsReadOnly(): boolean {
        return this.Descriptor.IsReadOnly || this._bag.IsReadOnly(this.Descriptor.Name);
    }

    /**
     * Unsubscribes the bag observer.  Safe to call more than once.
     */
    public dispose(): void {
        if (this._subscription !== null) {
            this._subscription.dispose();
            this._subscription = null;
        }
    }
}

/**
 * Grouping view-model for a set of `PropertyItem` rows under a named heading.
 *
 * `IsExpanded` is a reactive boolean (default `true`) that fires
 * `PropertyChanged("IsExpanded")` when its value actually changes.
 *
 * Extends `Observable` (lightweight INPC root) — NOT `MuralBase`.
 */
export class PropertyCategory extends Observable {
    readonly Header: string;
    readonly Items: readonly PropertyItem[];
    private _isExpanded: boolean = true;

    /**
     * The property grid's editor-template resolver, injected at build time so
     * the inner rows `ItemsControl` (authored inside a DataTemplate, where the
     * templated parent — the grid — is not reachable via TemplateBinding) can
     * bind `ItemTemplateSelector = $EditorSelector` and instantiate ONLY the
     * selected editor per row.  Set once by `PropertyGrid.rebuildGroups`; never
     * mutated afterward, so a plain readonly field (no INPC needed).
     */
    readonly EditorSelector: EditorTemplateResolver | undefined;

    constructor(
        header: string,
        items: readonly PropertyItem[],
        editorSelector?: EditorTemplateResolver,
    ) {
        super();
        this.Header = header;
        this.Items = items;
        this.EditorSelector = editorSelector;
    }

    public get IsExpanded(): boolean {
        return this._isExpanded;
    }

    public set IsExpanded(v: boolean) {
        const old = this._isExpanded;
        if (old === v) {
            return;
        }
        this._isExpanded = v;
        this.RaisePropertyChanged('IsExpanded', old, v);
    }
}
