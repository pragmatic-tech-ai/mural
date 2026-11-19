import { DataObject, DragDropEffects, MetaData, MuralBase, type ServiceKey } from '../../../runtime/index.js';
import { TOOLBOX_ITEM_FORMAT } from '../behaviors/canvas-drop-behavior.js';
import type { ToolboxVisualDescriptor } from './toolbox-visual-descriptor.js';
import type { IToolboxDropFactory } from './toolbox-drop-factory.js';

// One droppable palette entry. Carries its visual descriptor (resolved by
// the palette tile / canvas node), a FactoryKey (the drop factory), and a
// BeginDragData callback the tile template wires to OnDragStart. Base class;
// app-specific kinds subclass but the base already carries all palette/drop
// needs. FactoryKey is a plain field, not a DP — it is read in TS on drop,
// never bound in markup.
export class ToolboxItem extends MuralBase
{
    public static readonly IdKey = MuralBase.RegisterProperty<string>(
        ToolboxItem, 'Id', '', MetaData.None);
    public static readonly LabelKey = MuralBase.RegisterProperty<string>(
        ToolboxItem, 'Label', '', MetaData.None);
    public static readonly DescriptorKey = MuralBase.RegisterProperty<ToolboxVisualDescriptor | undefined>(
        ToolboxItem, 'Descriptor', undefined, MetaData.None);
    public static readonly BeginDragDataKey = MuralBase.RegisterProperty<(() => { data: DataObject; effects: DragDropEffects }) | undefined>(
        ToolboxItem, 'BeginDragData', undefined, MetaData.None);

    constructor(
        id: string,
        label: string,
        descriptor: ToolboxVisualDescriptor,
        public readonly FactoryKey: ServiceKey<IToolboxDropFactory>,
    )
    {
        super();
        this.set_property_value(ToolboxItem.IdKey, id);
        this.set_property_value(ToolboxItem.LabelKey, label);
        this.set_property_value(ToolboxItem.DescriptorKey, descriptor);
        this.set_property_value(ToolboxItem.BeginDragDataKey, () => ({
            data:    new DataObject().Set(TOOLBOX_ITEM_FORMAT, this.Id),
            effects: DragDropEffects.Copy,
        }));
    }

    public get Id():         string { return this.get_property_value(ToolboxItem.IdKey); }
    public get Label():      string { return this.get_property_value(ToolboxItem.LabelKey); }
    public get Descriptor(): ToolboxVisualDescriptor | undefined { return this.get_property_value(ToolboxItem.DescriptorKey); }
    public get BeginDragData(): (() => { data: DataObject; effects: DragDropEffects }) | undefined
    {
        return this.get_property_value(ToolboxItem.BeginDragDataKey);
    }
}
