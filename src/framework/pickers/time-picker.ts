import {
    MetaData,
    MuralBase,
    Color,
    HorizontalAlignment,
    VerticalAlignment,
    Element,
    type PropertyDescriptor,
} from '../../runtime/index.js';
import { SolidColorBrush, CornerRadius, Pen, type Brush } from '../../visual-engine/index.js';
import { TemplatedControl } from '../../basic/templated-control.js';
import { ClickableBorder } from '../../basic/clickable-border.js';
import { TextBlock } from '../../basic/text-block.js';
import { Canvas } from '../../basic/panels/canvas.js';
import { Line } from '../../basic/shapes/line.js';

// Material 3 Time Picker — the analog clock-dial variant (§18.9). A 12-hour
// dial with an AM/PM toggle and a digital HH:MM readout. Clicking the hour
// readout selects the hour ring; clicking the minute readout selects the
// minute ring; clicking a number on the dial sets that unit. A hand line
// tracks the current selection.
//
// Hour is stored 0-23 (so a bound VM gets an unambiguous 24h value); the
// dial shows 1-12 and the AM/PM buttons flip the 12h ↔ 24h mapping. Minute
// is 0-59; the dial marks every 5th minute but the hand points precisely.
//
// The Modal / docked dialog wrappers (M3 wraps this dial in a dialog with
// OK/Cancel) layer on via the overlay infra; this control is the reusable
// dial body — mirrors the DatePicker Docked-body approach.
enum TimePickerMode { Hour = 'Hour', Minute = 'Minute' }

const CENTER = 128;   // clock face is 256×256
const NUM_R  = 100;   // radius of the number ring
const HAND_R = 88;    // hand length (stops short of the numbers)
const CELL   = 36;
const TRANSPARENT = new SolidColorBrush(new Color(0, 0, 0, 0));

// Angle (radians) for a clock position measured clockwise from 12 o'clock.
function angleFor(fractionOfTurn: number): number
{
    return fractionOfTurn * 2 * Math.PI;
}

export class TimePicker extends TemplatedControl
{
    public static readonly HourKey = MuralBase.RegisterProperty<number>(
        TimePicker, 'Hour', 9, MetaData.None | MetaData.BindsTwoWayByDefault);
    public static readonly MinuteKey = MuralBase.RegisterProperty<number>(
        TimePicker, 'Minute', 0, MetaData.None | MetaData.BindsTwoWayByDefault);

    public get Hour(): number { return this.get_property_value(TimePicker.HourKey); }
    public set Hour(v: number) { this.set_property_value(TimePicker.HourKey, v); }

    public get Minute(): number { return this.get_property_value(TimePicker.MinuteKey); }
    public set Minute(v: number) { this.set_property_value(TimePicker.MinuteKey, v); }

    static
    {
        MuralBase.OverrideMetadata(TimePicker, Element.DefaultStyleKeyKey, { default_value: TimePicker });
    }

    private _mode = TimePickerMode.Hour;
    private _face:        Canvas    | undefined;
    private _hourLabel:   TextBlock | undefined;
    private _minuteLabel: TextBlock | undefined;
    private _amButton:    ClickableBorder | undefined;
    private _pmButton:    ClickableBorder | undefined;

    constructor()
    {
        super();
        this.applyDefaultStyle();
        this.adoptParts();
        this.rebuild();
    }

    private adoptParts(): void
    {
        const root = this.templateRoot;
        if (root === undefined) throw new Error('TimePicker template did not materialise (Template = @DefaultTimePicker?).');
        this._face        = root.FindName('PART_ClockFace')  as Canvas    | undefined;
        this._hourLabel   = root.FindName('PART_HourLabel')  as TextBlock | undefined;
        this._minuteLabel = root.FindName('PART_MinuteLabel') as TextBlock | undefined;
        this._amButton    = root.FindName('PART_AmButton')   as ClickableBorder | undefined;
        this._pmButton    = root.FindName('PART_PmButton')   as ClickableBorder | undefined;
        if (this._face === undefined) throw new Error('TimePicker template missing PART_ClockFace');

        // The readouts are ClickableBorders wrapping the number text (so they
        // can switch the active ring). Wire mode switches + AM/PM.
        const hourHit = root.FindName('PART_HourHit') as ClickableBorder | undefined;
        const minHit  = root.FindName('PART_MinuteHit') as ClickableBorder | undefined;
        if (hourHit !== undefined) hourHit.onClick = (): void => this.setMode(TimePickerMode.Hour);
        if (minHit  !== undefined) minHit.onClick  = (): void => this.setMode(TimePickerMode.Minute);
        if (this._amButton !== undefined) this._amButton.onClick = (): void => this.setMeridiem(false);
        if (this._pmButton !== undefined) this._pmButton.onClick = (): void => this.setMeridiem(true);
    }

    // ── Derived time helpers ────────────────────────────────────────
    private isPm(): boolean { return this.Hour >= 12; }
    private displayHour(): number { const h = this.Hour % 12; return h === 0 ? 12 : h; }

    private setMode(mode: TimePickerMode): void
    {
        if (this._mode === mode) return;
        this._mode = mode;
        this.rebuild();
    }

    private setMeridiem(pm: boolean): void
    {
        if (pm === this.isPm()) return;
        this.Hour = pm ? (this.Hour % 12) + 12 : this.Hour % 12;
    }

    private brush(key: string, fallback: Brush): Brush
    {
        return (this.TryFindResource(key) as Brush | undefined) ?? fallback;
    }

    private rebuild(): void
    {
        const face = this._face;
        if (face === undefined) return;

        const primary          = this.brush('AccentInk',          new SolidColorBrush(new Color(103, 80, 164, 255)));
        const onPrimary        = this.brush('AccentInkOn',        new SolidColorBrush(new Color(255, 255, 255, 255)));
        const onSurface        = this.brush('Ink',        new SolidColorBrush(new Color(28, 27, 31, 255)));

        // Digital readout + active-ring emphasis.
        if (this._hourLabel   !== undefined) this._hourLabel.Text   = String(this.displayHour());
        if (this._minuteLabel !== undefined) this._minuteLabel.Text = this.Minute.toString().padStart(2, '0');
        if (this._hourLabel   !== undefined) this._hourLabel.Foreground   = this._mode === TimePickerMode.Hour   ? primary : onSurface;
        if (this._minuteLabel !== undefined) this._minuteLabel.Foreground = this._mode === TimePickerMode.Minute ? primary : onSurface;
        this.paintMeridiem(primary, onPrimary, onSurface);

        for (const c of [...face.visualChildren]) face.RemoveChild(c);

        // The hand — from centre to the current selection.
        const selFrac = this._mode === TimePickerMode.Hour
            ? this.displayHour() / 12
            : this.Minute / 60;
        const a  = angleFor(selFrac);
        const hx = CENTER + HAND_R * Math.sin(a);
        const hy = CENTER - HAND_R * Math.cos(a);
        const hand = new Line();
        hand.X1 = CENTER; hand.Y1 = CENTER; hand.X2 = hx; hand.Y2 = hy;
        hand.Stroke = new Pen(primary, 2);
        Canvas.SetLeft(hand, 0); Canvas.SetTop(hand, 0);
        face.AddChild(hand);

        // Centre pivot dot.
        const pivot = new ClickableBorder();
        pivot.Width = 8; pivot.Height = 8;
        pivot.CornerRadius = new CornerRadius(4, 4, 4, 4);
        pivot.Fill = primary;
        Canvas.SetLeft(pivot, CENTER - 4); Canvas.SetTop(pivot, CENTER - 4);
        face.AddChild(pivot);

        // The 12 numbers for the active ring.
        for (let i = 1; i <= 12; i++)
        {
            const value = this._mode === TimePickerMode.Hour ? i : (i % 12) * 5; // 12→0, 1→5, …, 11→55
            const frac  = i / 12;
            const ang   = angleFor(frac);
            const cx    = CENTER + NUM_R * Math.sin(ang);
            const cy    = CENTER - NUM_R * Math.cos(ang);

            const selected = this._mode === TimePickerMode.Hour
                ? this.displayHour() === i
                : this.Minute === value;

            const cell = new ClickableBorder();
            cell.Width = CELL; cell.Height = CELL;
            cell.CornerRadius = new CornerRadius(CELL / 2, CELL / 2, CELL / 2, CELL / 2);
            cell.Fill = selected ? primary : TRANSPARENT;
            Canvas.SetLeft(cell, cx - CELL / 2);
            Canvas.SetTop(cell, cy - CELL / 2);

            const label = new TextBlock();
            label.Text = this._mode === TimePickerMode.Hour ? String(i) : value.toString().padStart(2, '0');
            label.Foreground = selected ? onPrimary : onSurface;
            label.HorizontalAlignment = HorizontalAlignment.Center;
            label.VerticalAlignment   = VerticalAlignment.Center;
            cell.SetChild(label);

            cell.onClick = (): void => this.pick(value);
            face.AddChild(cell);
        }
    }

    private paintMeridiem(primary: Brush, onPrimary: Brush, onSurface: Brush): void
    {
        const pm = this.isPm();
        if (this._amButton !== undefined)
        {
            this._amButton.Fill = pm ? TRANSPARENT : primary;
            const t = this._amButton.child as TextBlock | undefined;
            if (t !== undefined) t.Foreground = pm ? onSurface : onPrimary;
        }
        if (this._pmButton !== undefined)
        {
            this._pmButton.Fill = pm ? primary : TRANSPARENT;
            const t = this._pmButton.child as TextBlock | undefined;
            if (t !== undefined) t.Foreground = pm ? onPrimary : onSurface;
        }
    }

    // Commit a dial click into the active unit, preserving AM/PM for hours.
    private pick(value: number): void
    {
        if (this._mode === TimePickerMode.Hour)
        {
            // value is 1-12 → map to 0-23 honouring the current meridiem.
            const base = value % 12;                 // 12 → 0
            this.Hour = this.isPm() ? base + 12 : base;
        }
        else
        {
            this.Minute = value;
        }
    }

    protected override OnPropertyChanged(
        descriptor: PropertyDescriptor,
        oldValue: unknown,
        newValue: unknown,
    ): void
    {
        super.OnPropertyChanged(descriptor, oldValue, newValue);
        const name = descriptor.Name;
        if (name === 'Template' && newValue !== oldValue)
        {
            this.adoptParts();
            this.rebuild();
            return;
        }
        if (descriptor.Owner === TimePicker && (name === 'Hour' || name === 'Minute'))
        {
            this.rebuild();
        }
    }
}
