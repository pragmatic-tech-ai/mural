import {
    MetaData,
    MuralBase,
    Element,
    Size,
    Storyboard,
    StoryboardState,
    DoubleAnimation,
    Easings,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { TranslateTransform } from '../../visual-engine/index.js';
import { Arc } from '../../basic/shapes/arc.js';
import { Border } from '../../basic/border.js';
import { TemplatedControl } from '../../basic/templated-control.js';

// M3 Progress Indicator — feedback for an in-flight operation. Two
// variants per the M3 spec:
//   * Linear  — horizontal track with a moving fill segment.
//   * Circular — ring with a sweeping arc.
//
// Each variant supports a Determinate mode (Value in 0..1 drives the
// fill / arc length) and an Indeterminate mode (the fill / arc
// continuously cycles to signal "working" without a quantifiable
// progress fraction).
//
// mural ships the Linear variant here. Circular needs an Arc geometry
// primitive in the visual-engine before the template can express it
// declaratively; the surface is registered so the Variant trigger
// ladder is ready when that lands.
export enum ProgressIndicatorVariant
{
    Linear   = 'Linear',
    Circular = 'Circular',
}

// Linear-indeterminate motion. One sweep is a fixed-fraction segment
// translating from fully off the left edge to fully off the right; the
// track clips it (PART_Track.ClipToBounds). RepeatBehavior=Infinity
// loops it. The segment width and the translate span are pixel values,
// so the control rebuilds the sweep whenever its arranged width changes
// (ArrangeOverride) — the same clock-owned-Storyboard pattern
// LoadingIndicator uses, but along X instead of a rotation.
const SWEEP_MS         = 1500;
const SEGMENT_FRACTION = 0.4;

export class ProgressIndicator extends TemplatedControl
{
    public static readonly VariantKey = MuralBase.RegisterProperty<ProgressIndicatorVariant>(
        ProgressIndicator, 'Variant', ProgressIndicatorVariant.Linear,
        MetaData.Render);

    // Value in [0, 1]. The template clamps for display; an out-of-
    // range Value stays on the DP (same convention Slider uses) so a
    // binding-source's raw signal isn't lost.
    public static readonly ValueKey = MuralBase.RegisterProperty<number>(
        ProgressIndicator, 'Value', 0, MetaData.Render);

    // When true, ignore Value and show the indeterminate animation: a
    // fixed-width fill segment sweeps across the track continuously.
    // The control owns a looping Storyboard (started while indeterminate
    // and loaded, stopped otherwise) that drives a TranslateTransform on
    // PART_Fill.
    public static readonly IsIndeterminateKey = MuralBase.RegisterProperty<boolean>(
        ProgressIndicator, 'IsIndeterminate', false, MetaData.Render);

    public get Variant(): ProgressIndicatorVariant { return this.get_property_value(ProgressIndicator.VariantKey); }
    public set Variant(v: ProgressIndicatorVariant) { this.set_property_value(ProgressIndicator.VariantKey, v); }

    public get Value(): number { return this.get_property_value(ProgressIndicator.ValueKey); }
    public set Value(v: number) { this.set_property_value(ProgressIndicator.ValueKey, v); }

    public get IsIndeterminate(): boolean { return this.get_property_value(ProgressIndicator.IsIndeterminateKey); }
    public set IsIndeterminate(v: boolean) { this.set_property_value(ProgressIndicator.IsIndeterminateKey, v); }

    static
    {
        MuralBase.OverrideMetadata(
            ProgressIndicator, Element.DefaultStyleKeyKey,
            { default_value: ProgressIndicator });
    }

    constructor()
    {
        super();
        this.applyDefaultStyle();
        this.adoptParts();
        this.syncFillGeometry();
        // Stop while off-screen (frame economy) and (re)start on load; the
        // ctor also refreshes so a control shown without a Loaded edge (or
        // tested headless) still animates when indeterminate.
        this.AddLoadedListener(() => this.refreshAnimation());
        this.AddUnloadedListener(() => this.stopAnimation());
        this.refreshAnimation();
    }

    // PART_Fill (the active-progress sweep) is an Arc whose EndAngle is
    // driven by the consumer's Value. The trigger DSL doesn't carry
    // arithmetic, so the angle-from-value mapping happens here. Track
    // is a full circle the consumer doesn't drive.
    private _fillArc: Arc | undefined;
    private _linearFill: Border | undefined;
    private _translate: TranslateTransform | undefined;
    private _storyboard: Storyboard | undefined;
    private _sweepWidth = 0;
    private adoptParts(): void
    {
        this._fillArc    = this.GetTemplateChild('PART_Fill') as Arc | undefined;
        this._linearFill = this.GetTemplateChild('PART_Fill') as Border | undefined;
        // Note: the Linear template's PART_Fill is a Border (Width-driven)
        // and the Circular template's PART_Fill is an Arc (EndAngle-driven).
        // GetTemplateChild returns the same name to either; the class
        // tells them apart by instanceof at sync time.

        // Linear fill carries the sweep transform. Create it ONCE and reuse
        // across re-adopts (applyDefaultStyle + ctor both adopt): a fresh
        // transform each call would orphan the one the running Storyboard
        // targets.
        if (this._linearFill instanceof Border)
        {
            this._translate ??= new TranslateTransform();
            this._linearFill.RenderTransform = this._translate;
        }
    }

    private syncFillGeometry(): void
    {
        const value = Math.max(0, Math.min(1, this.Value));
        // Circular: Fill is an Arc — sweep StartAngle..StartAngle+360×value.
        if (this._fillArc instanceof Arc)
        {
            const start = this._fillArc.StartAngle;
            this._fillArc.EndAngle = start + 360 * value;
        }
        // Linear determinate fill sizing is consumer-driven (unchanged); the
        // indeterminate sweep below owns PART_Fill's Width while it runs.
    }

    // ── Indeterminate sweep lifecycle ──────────────────────────────
    // Mirrors LoadingIndicator: a looping Storyboard the control owns,
    // (re)started when indeterminate + loaded, stopped otherwise.

    // Test / consumer hook — true while the sweep Storyboard is ticking.
    public get IsAnimating(): boolean
    {
        return this._storyboard?.State === StoryboardState.Running;
    }

    private refreshAnimation(): void
    {
        if (this.IsIndeterminate) this.startAnimation();
        else                      this.stopAnimation();
    }

    private startAnimation(): void
    {
        if (this._storyboard?.State === StoryboardState.Running) return;
        const translate = this._translate;
        const fill      = this._linearFill;
        if (translate === undefined || !(fill instanceof Border)) return;

        // Segment width + translate span are in pixels; both are 0 until the
        // first arrange gives us a width, at which point ArrangeOverride
        // rebuilds the sweep. Running-but-motionless keeps IsAnimating true
        // from the moment indeterminate is set.
        const segment = SEGMENT_FRACTION * this._sweepWidth;
        if (this._sweepWidth > 0) fill.Width = segment;

        const sb = new Storyboard();
        sb.Add(translate, 'X', new DoubleAnimation({
            From: -segment, To: this._sweepWidth, Duration: SWEEP_MS,
            RepeatBehavior: Infinity, Easing: Easings.Standard,
        }));
        sb.Begin();
        this._storyboard = sb;
    }

    private stopAnimation(): void
    {
        this._storyboard?.Stop();
        this._storyboard = undefined;
        // Return the segment to the origin so a later determinate fill isn't
        // left offset by the sweep.
        if (this._translate !== undefined) this._translate.X = 0;
    }

    private rebuildAnimation(width: number): void
    {
        this._sweepWidth = width;
        if (!this.IsIndeterminate) return;
        this.stopAnimation();
        this.startAnimation();
    }

    protected override ArrangeOverride(finalSize: Size): Size
    {
        const size = super.ArrangeOverride(finalSize);
        // Learn the track width (the sweep span) and rebuild when it changes.
        if (this.IsIndeterminate && finalSize.Width > 0 && finalSize.Width !== this._sweepWidth)
        {
            this.rebuildAnimation(finalSize.Width);
        }
        return size;
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue:   unknown,
        newValue:   unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        if (descriptor.Name === 'Template' && newValue !== oldValue)
        {
            // Template swapped — the old fill / transform are gone; re-adopt
            // the new part, then restart the sweep against it.
            this.stopAnimation();
            this.adoptParts();
            this.syncFillGeometry();
            this.refreshAnimation();
            return;
        }
        if (descriptor.Owner === ProgressIndicator && descriptor.Name === 'Value')
        {
            this.syncFillGeometry();
        }
        if (descriptor.Owner === ProgressIndicator && descriptor.Name === 'IsIndeterminate')
        {
            this.refreshAnimation();
        }
    }
}
