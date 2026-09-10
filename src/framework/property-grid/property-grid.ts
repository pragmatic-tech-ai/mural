import {
    Element,
    MetaData,
    MuralBase,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { DataTemplate } from '../../basic/templates/data-template.js';
import { ItemsControl, type ItemTemplateSelector } from '../base/items-control.js';
import { type IPropertyBag } from './property-bag.js';
import { type GridProperty } from './grid-property.js';
import { PropertyKind } from './grid-property.js';
import { PropertyItem, PropertyCategory } from './property-item.js';

// PropertyGrid — an ItemsControl subclass that projects (Descriptors, Target)
// into a list of PropertyCategory groups, each containing PropertyItem rows.
//
// Outer ItemsSource = PropertyCategory[]; Task 7's template renders each
// category's Items through an inner ItemsControl using EditorTemplateSelector.
//
// Default-style key is overridden in the static block so that a
// `Style [TargetType=PropertyGrid]` in the merged resources dict is found by
// applyDefaultStyle(). Task 7 will author that style; this class works without
// it (no ctor template wiring needed).
export class PropertyGrid extends ItemsControl
{
    // ── Descriptors DP ────────────────────────────────────────────────
    public static readonly DescriptorsKey =
        MuralBase.RegisterProperty<readonly GridProperty[] | undefined>(
            PropertyGrid, 'Descriptors', undefined, MetaData.None,
        );

    // ── Target DP ────────────────────────────────────────────────────
    public static readonly TargetKey =
        MuralBase.RegisterProperty<IPropertyBag | undefined>(
            PropertyGrid, 'Target', undefined, MetaData.None,
        );

    // ── Per-kind editor-template DPs ─────────────────────────────────
    // Set by the default Style (Task 7). Exposed as plain DPs so Style
    // Setters can write them and tests can write them directly.

    public static readonly TextEditorTemplateKey =
        MuralBase.RegisterProperty<DataTemplate | undefined>(
            PropertyGrid, 'TextEditorTemplate', undefined, MetaData.None,
        );

    public static readonly NumberEditorTemplateKey =
        MuralBase.RegisterProperty<DataTemplate | undefined>(
            PropertyGrid, 'NumberEditorTemplate', undefined, MetaData.None,
        );

    public static readonly BooleanEditorTemplateKey =
        MuralBase.RegisterProperty<DataTemplate | undefined>(
            PropertyGrid, 'BooleanEditorTemplate', undefined, MetaData.None,
        );

    public static readonly EnumEditorTemplateKey =
        MuralBase.RegisterProperty<DataTemplate | undefined>(
            PropertyGrid, 'EnumEditorTemplate', undefined, MetaData.None,
        );

    public static readonly MultilineEditorTemplateKey =
        MuralBase.RegisterProperty<DataTemplate | undefined>(
            PropertyGrid, 'MultilineEditorTemplate', undefined, MetaData.None,
        );

    public static readonly ColorEditorTemplateKey =
        MuralBase.RegisterProperty<DataTemplate | undefined>(
            PropertyGrid, 'ColorEditorTemplate', undefined, MetaData.None,
        );

    public static readonly ReadOnlyEditorTemplateKey =
        MuralBase.RegisterProperty<DataTemplate | undefined>(
            PropertyGrid, 'ReadOnlyEditorTemplate', undefined, MetaData.None,
        );

    static
    {
        // Registers the theme-lookup key so applyDefaultStyle() picks up
        // `Style [TargetType=PropertyGrid]` from the merged dictionaries.
        // Task 7 will author that Style and set the seven editor-template DPs.
        MuralBase.OverrideMetadata(PropertyGrid, Element.DefaultStyleKeyKey, {
            default_value: PropertyGrid,
        });
    }

    // Live PropertyItems from the last successful build. Held so they can be
    // disposed when Descriptors or Target changes.
    private _liveItems: PropertyItem[] = [];

    constructor()
    {
        super();
        // Apply the default Style (task 7 will provide it). If no Style is
        // present in the current theme (e.g., during unit tests without the
        // task-7 template), applyDefaultStyle() is a no-op.
        this.applyDefaultStyle();

        // Install the editor-template selector on the inherited
        // ItemTemplateSelector DP so that ItemsControl's
        // GetContainerForItemOverride uses it when the outer items are
        // PropertyCategory. Task 7's inner ItemsControl should bind its own
        // ItemTemplateSelector to PropertyGrid.EditorTemplateSelector.
        // (The outer selector receives PropertyCategory; the inner receives
        //  PropertyItem — they are different. We leave the outer selector
        //  undefined here and let Task 7 set it via the template.)
    }

    // ── Descriptors ───────────────────────────────────────────────────

    public get Descriptors(): readonly GridProperty[] | undefined
    {
        return this.get_property_value(PropertyGrid.DescriptorsKey);
    }

    public set Descriptors(value: readonly GridProperty[] | undefined)
    {
        this.set_property_value(PropertyGrid.DescriptorsKey, value);
    }

    // ── Target ────────────────────────────────────────────────────────

    public get Target(): IPropertyBag | undefined
    {
        return this.get_property_value(PropertyGrid.TargetKey);
    }

    public set Target(value: IPropertyBag | undefined)
    {
        this.set_property_value(PropertyGrid.TargetKey, value);
    }

    // ── Per-kind editor-template accessors ────────────────────────────

    public get TextEditorTemplate(): DataTemplate | undefined
    {
        return this.get_property_value(PropertyGrid.TextEditorTemplateKey);
    }

    public set TextEditorTemplate(value: DataTemplate | undefined)
    {
        this.set_property_value(PropertyGrid.TextEditorTemplateKey, value);
    }

    public get NumberEditorTemplate(): DataTemplate | undefined
    {
        return this.get_property_value(PropertyGrid.NumberEditorTemplateKey);
    }

    public set NumberEditorTemplate(value: DataTemplate | undefined)
    {
        this.set_property_value(PropertyGrid.NumberEditorTemplateKey, value);
    }

    public get BooleanEditorTemplate(): DataTemplate | undefined
    {
        return this.get_property_value(PropertyGrid.BooleanEditorTemplateKey);
    }

    public set BooleanEditorTemplate(value: DataTemplate | undefined)
    {
        this.set_property_value(PropertyGrid.BooleanEditorTemplateKey, value);
    }

    public get EnumEditorTemplate(): DataTemplate | undefined
    {
        return this.get_property_value(PropertyGrid.EnumEditorTemplateKey);
    }

    public set EnumEditorTemplate(value: DataTemplate | undefined)
    {
        this.set_property_value(PropertyGrid.EnumEditorTemplateKey, value);
    }

    public get MultilineEditorTemplate(): DataTemplate | undefined
    {
        return this.get_property_value(PropertyGrid.MultilineEditorTemplateKey);
    }

    public set MultilineEditorTemplate(value: DataTemplate | undefined)
    {
        this.set_property_value(PropertyGrid.MultilineEditorTemplateKey, value);
    }

    public get ColorEditorTemplate(): DataTemplate | undefined
    {
        return this.get_property_value(PropertyGrid.ColorEditorTemplateKey);
    }

    public set ColorEditorTemplate(value: DataTemplate | undefined)
    {
        this.set_property_value(PropertyGrid.ColorEditorTemplateKey, value);
    }

    public get ReadOnlyEditorTemplate(): DataTemplate | undefined
    {
        return this.get_property_value(PropertyGrid.ReadOnlyEditorTemplateKey);
    }

    public set ReadOnlyEditorTemplate(value: DataTemplate | undefined)
    {
        this.set_property_value(PropertyGrid.ReadOnlyEditorTemplateKey, value);
    }

    // ── Editor-template selector ──────────────────────────────────────
    //
    // Selects the DataTemplate for a given PropertyItem. Resolution order:
    //   1. If item.Descriptor.EditorTemplateKey is set, look it up in the
    //      logical-tree resource chain (TryFindResource). If found, return it.
    //   2. If item.IsReadOnly, return ReadOnlyEditorTemplate.
    //   3. Return the per-kind DP template.
    //
    // Exposed as a getter returning a bound function so Task 7's inner
    // ItemsControl can bind `ItemTemplateSelector` to this property:
    //   `ItemTemplateSelector = $PropertyGrid.EditorTemplateSelector`
    //
    // Tests call `grid.EditorTemplateSelector(item)` directly.
    public get EditorTemplateSelector(): ItemTemplateSelector
    {
        // Return a stable bound function. Recreating it per-call is cheap and
        // avoids storing state in the closure — each call sees the current DPs.
        return (item: unknown): DataTemplate | undefined =>
            this.selectEditorTemplate(item as PropertyItem);
    }

    private selectEditorTemplate(item: PropertyItem): DataTemplate | undefined
    {
        // Step 1 — per-descriptor override via resource key.
        const editorKey = item.Descriptor.EditorTemplateKey;
        if (editorKey !== undefined)
        {
            const resolved = this.TryFindResource(editorKey);
            if (resolved instanceof DataTemplate) return resolved;
            // Key is set but not found — fall through to per-kind lookup.
        }

        // Step 2 — read-only guard (after key check, before kind check).
        if (item.IsReadOnly) return this.ReadOnlyEditorTemplate;

        // Step 3 — per-kind mapping.
        return this.templateForKind(item.Descriptor.Kind);
    }

    private templateForKind(kind: PropertyKind): DataTemplate | undefined
    {
        switch (kind)
        {
            case PropertyKind.Text:          return this.TextEditorTemplate;
            case PropertyKind.MultilineText: return this.MultilineEditorTemplate;
            case PropertyKind.Number:        return this.NumberEditorTemplate;
            case PropertyKind.Boolean:       return this.BooleanEditorTemplate;
            case PropertyKind.Enum:          return this.EnumEditorTemplate;
            case PropertyKind.Color:         return this.ColorEditorTemplate;
            default:                         return this.ReadOnlyEditorTemplate;
        }
    }

    // ── Property-change handler ────────────────────────────────────────

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Name === 'Descriptors' || descriptor.Name === 'Target')
        {
            this.rebuildGroups();
        }
    }

    // ── Group builder ─────────────────────────────────────────────────

    private rebuildGroups(): void
    {
        // Dispose prior rows unconditionally — even if the new build fails
        // there should be no dangling live observers.
        this.disposeLiveItems();

        const descriptors = this.Descriptors;
        const target = this.Target;

        if (descriptors === undefined || descriptors.length === 0 || target === undefined)
        {
            // No items to show — set an empty array on ItemsSource.
            this.setItemsSource([]);
            return;
        }

        // Build PropertyItems and group them by category in first-seen order.
        const categoryOrder: string[] = [];
        const categoryMap = new Map<string, PropertyItem[]>();

        for (const desc of descriptors)
        {
            const cat = desc.Category;
            let bucket = categoryMap.get(cat);
            if (bucket === undefined)
            {
                categoryOrder.push(cat);
                bucket = [];
                categoryMap.set(cat, bucket);
            }
            const item = new PropertyItem(desc, target);
            bucket.push(item);
            this._liveItems.push(item);
        }

        const categories: PropertyCategory[] = categoryOrder.map(
            header => new PropertyCategory(header, categoryMap.get(header)!),
        );

        this.setItemsSource(categories);
    }

    // Sets ItemsSource by bypassing the "Items cannot be set while
    // ItemsSource is non-undefined" guard: we always set ItemsSource, not
    // Items directly. ItemsControl.ItemsSource setter routes to
    // OnPropertyChanged('ItemsSource') → refreshItemsFromSource().
    private setItemsSource(categories: PropertyCategory[]): void
    {
        this.ItemsSource = categories;
    }

    private disposeLiveItems(): void
    {
        for (const item of this._liveItems)
        {
            item.Dispose();
        }
        this._liveItems = [];
    }
}
