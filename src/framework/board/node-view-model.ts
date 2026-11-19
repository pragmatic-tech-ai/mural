import type { Group } from './group.js';
import { MetaData, MuralBase } from '../../runtime/index.js';

// Identity + content contract every board content node view-model satisfies.
// A content VM carries NO visual information: its container Figure owns geometry
// (Left/Top/Width/Height/Rotation), the sizing mode (SizeToContent/UserSized),
// and the side-endpoint host role. The document's NodeVisualStore is the durable
// geometry truth, keyed by this VM's Id; the container is seeded from it on
// realize (board.ts bindContainer → Board.ContainerBound → BoardDocument).
// Data-driven content node kinds (e.g. Plexus ArchNodeVM) extend this; text /
// callout and geometric shape nodes are self-painting Figures (TextNode /
// Callout / shape Figures), not VMs.
export class NodeViewModel extends MuralBase
{
    // Join key between the content VM and its visual record / container. The
    // ONLY property the container cannot derive on its own, so it stays on the
    // VM (mirrored onto the container in bindContainer for endpoint resolution).
    public static readonly IdKey = MuralBase.RegisterProperty<string | undefined>(NodeViewModel, 'Id', undefined, MetaData.None);

    public get Id():     string | undefined { return this.get_property_value(NodeViewModel.IdKey); }
    public set Id(v:     string | undefined) { this.set_property_value(NodeViewModel.IdKey, v); }

    /** Enclosing group, or undefined when top-level. View-invisible
     *  structural metadata, so a plain field (mirrors Figure.Parent). */
    public Parent: Group | undefined = undefined;
}
