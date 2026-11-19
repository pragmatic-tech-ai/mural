import { Application, MetaData, MuralBase, type PropertyDescriptor } from '../../../runtime/index.js';
import { ContentControl } from '../../base/content-control.js';
import { VisualContext, type IToolboxVisualResolver } from './toolbox-visual-resolver.js';
import type { ToolboxVisualDescriptor } from './toolbox-visual-descriptor.js';

// The one Control every toolbox surface routes its visual through, so
// "resolve + host + subscribe" lives in exactly one place. Keys on the
// descriptor (a canvas node / preview is not a ToolboxItem). Sets the
// resolved Visual as Content (ContentControl slots a Visual directly), and
// re-hosts in place when the resolver signals the real visual arrived.
export class ToolboxVisualPresenter extends ContentControl
{
    public static readonly DescriptorKey = MuralBase.RegisterProperty<ToolboxVisualDescriptor | undefined>(
        ToolboxVisualPresenter, 'Descriptor', undefined, MetaData.None);
    public static readonly ContextKey = MuralBase.RegisterProperty<VisualContext>(
        ToolboxVisualPresenter, 'Context', VisualContext.Tile, MetaData.None);

    private _resolver: IToolboxVisualResolver | undefined;
    private _attached = false;
    private readonly _onChanged = (key: string): void => {
        if (this.Descriptor !== undefined && key === this.Descriptor.Key) this.resolveNow();
    };
    private readonly _onAttached = (): void => { this._attached = true; this.subscribeAndResolve(); };
    private readonly _onDetached = (): void => { this._attached = false; this.unsubscribe(); };

    constructor()
    {
        super();
        this.applyDefaultStyle();
        this.AddAttachedListener(this._onAttached);
        this.AddDetachedListener(this._onDetached);
    }

    public get Descriptor(): ToolboxVisualDescriptor | undefined { return this.get_property_value(ToolboxVisualPresenter.DescriptorKey); }
    public set Descriptor(v: ToolboxVisualDescriptor | undefined) { this.set_property_value(ToolboxVisualPresenter.DescriptorKey, v); }
    public get Context(): VisualContext { return this.get_property_value(ToolboxVisualPresenter.ContextKey); }
    public set Context(v: VisualContext) { this.set_property_value(ToolboxVisualPresenter.ContextKey, v); }

    protected override OnPropertyChanged(descriptor: PropertyDescriptor, oldValue: unknown, newValue: unknown): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Name === 'Descriptor' || descriptor.Name === 'Context')
        {
            // Re-point the subscription + re-resolve whenever the inputs change.
            this.unsubscribe();
            if (this._attached) this.subscribeAndResolve();
        }
    }

    private subscribeAndResolve(): void
    {
        const desc = this.Descriptor;
        if (desc === undefined) { this.Content = undefined; return; }
        const resolver = Application.current?.Services.get(desc.ResolverKey);
        this._resolver = resolver;
        resolver?.AddChangedListener(this._onChanged);
        this.resolveNow();
    }

    private resolveNow(): void
    {
        const desc = this.Descriptor;
        if (desc === undefined || this._resolver === undefined) { this.Content = undefined; return; }
        this.Content = this._resolver.Resolve(desc, this.Context);
    }

    private unsubscribe(): void
    {
        this._resolver?.RemoveChangedListener(this._onChanged);
        this._resolver = undefined;
    }

    // ── Test-only seams (headless can't mount into a window) ──
    public _forceAttachedForTest(): void { this._onAttached(); }
    public _forceDetachedForTest(): void { this._onDetached(); }
}
