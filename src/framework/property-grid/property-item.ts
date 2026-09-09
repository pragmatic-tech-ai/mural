import { Observable } from '../../runtime/index.js';
import { GridProperty } from './grid-property.js';
import { type IPropertyBag } from './property-bag.js';

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
    private _disposer: (() => void) | null;

    constructor(descriptor: GridProperty, bag: IPropertyBag) {
        super();
        this.Descriptor = descriptor;
        this._bag = bag;
        this._disposer = bag.Observe(descriptor.Name, () => {
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
    public Dispose(): void {
        if (this._disposer !== null) {
            this._disposer();
            this._disposer = null;
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

    constructor(header: string, items: readonly PropertyItem[]) {
        super();
        this.Header = header;
        this.Items = items;
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
