import {
    Behavior,
    MetaData,
    MuralBase,
    type Disposable,
    type Visual,
} from '../../runtime/index.js';
import { resolveKey } from '../../runtime/model-internals.js';

// LogBehavior — debugging aid that prints a `console.log` line every
// time the host Visual's named DP changes. Authored from markup:
//
//   MenuItem [Header="Cut"] {
//       Behaviors {
//           LogBehavior [Property="IsMouseOver"]
//           LogBehavior [Property="IsPressed", Tag="cut-pressed"]
//       }
//   }
//
// The output shape is:
//
//   [LogBehavior cut-pressed] MenuItem.IsPressed: false → true
//
// (The `Tag` prefix is omitted when not set.) Use this to confirm
// triggers / hit-test / DP propagation reach a Visual without having
// to instrument the framework or sprinkle one-off console.logs into
// the consumer's code.
//
// Lifetime: subscribes on OnAttached, unsubscribes on OnDetached. The
// Behavior base re-fires OnDetached on every visualParent → undefined
// transition, so re-attach cycles produce one listener at a time
// rather than stacking.
export class LogBehavior extends Behavior
{
    public static readonly PropertyKey = MuralBase.RegisterProperty<string | undefined>(
        LogBehavior, 'Property', undefined, MetaData.None);

    public static readonly TagKey = MuralBase.RegisterProperty<string | undefined>(
        LogBehavior, 'Tag', undefined, MetaData.None);

    public get Property():  string | undefined { return this.get_property_value(LogBehavior.PropertyKey); }
    public set Property(v: string | undefined) { this.set_property_value(LogBehavior.PropertyKey, v); }

    public get Tag():  string | undefined { return this.get_property_value(LogBehavior.TagKey); }
    public set Tag(v: string | undefined) { this.set_property_value(LogBehavior.TagKey, v); }

    private _sub: Disposable | undefined;

    public override OnAttached(visual: Visual): void
    {
        const prop = this.Property;
        if (prop === undefined || prop.length === 0) return;
        const key       = resolveKey(visual, undefined, prop);
        const tag       = this.Tag !== undefined ? `${this.Tag} ` : '';
        const className = visual.constructor.name;
        this._sub = visual.PropertyChanged(key).subscribe(({ oldValue, newValue }) =>
        {
            // Stringify carefully — DPs hold Visuals, Brushes, etc. that
            // print awkwardly when concatenated. For primitives a plain
            // template literal is fine; for objects we lean on the
            // constructor name so the line stays one-liner readable.
            console.log(
                `[LogBehavior ${tag}]${className}.${prop}: ${formatValue(oldValue)} → ${formatValue(newValue)}`,
            );
        });
    }

    public override OnDetached(_visual: Visual): void
    {
        this._sub?.dispose();
        this._sub = undefined;
    }
}

function formatValue(v: unknown): string
{
    if (v === undefined) return 'undefined';
    if (v === null)      return 'null';
    if (typeof v === 'string')  return JSON.stringify(v);
    if (typeof v === 'number')  return String(v);
    if (typeof v === 'boolean') return String(v);
    const ctor = (v as { constructor?: { name?: string } }).constructor?.name;
    return ctor ?? String(v);
}
