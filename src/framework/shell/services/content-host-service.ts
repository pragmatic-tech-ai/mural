import {
    ServiceBase,
    ServiceKey,
} from '../../../runtime/index.js';

// Backs a shell's main Content region (PART_ContentHost). A thin presenter
// service: whatever object is handed to View() becomes the region's content,
// rendered through a DataTemplate matched to the object's runtime type — the
// same implicit-by-type dispatch ContentControl uses for non-Visual content.
// The region binds `Content = $service(ContentHostService).Content`, so
// anything in the app can resolve this service and call View(x) to swap what
// the shell shows without reaching the content control.
//
// The base presents ONE object at a time. DocumentsContentHostService layers
// an open-document workspace (Open / Close / Save) on top and drives View()
// from its ActiveDocument — register that subclass against this same Key to
// turn the region into a tabbed-document host.
export class ContentHostService extends ServiceBase
{
    public static readonly Key = new ServiceKey<ContentHostService>('ContentHostService');

    // The object currently presented. Read-only to the view (a region binds
    // `$Content`); mutated only through View(). `unknown` because the content
    // is arbitrary — a Visual slotted directly, or a MuralBase rendered via its
    // DataTemplate.
    private _content: unknown = undefined;

    public get Content(): unknown { return this._content; }

    // Present `content` in the host region, replacing whatever was shown.
    // Pass undefined to clear the region to its empty state.
    public View(content: unknown): void
    {
        const old = this._content;
        this._content = content;
        this.RaisePropertyChanged('Content', old, content);
    }
}
