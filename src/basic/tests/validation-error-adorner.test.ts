import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from './test-app.js';

import {
    AdornerDecorator,
    AdornerLayer,
    Application,
    Rect,
    Size,
    Validation,
    Element,
    Visual,
    type DrawingContext,
} from '../../runtime/index.js';
import { ValidationErrorAdorner } from '../validation-error-adorner.js';
import { Border } from '../border.js';
import { TextBox } from '../text-box.js';

const dummyRule = { validate: (_v: unknown) => ({ ok: true }) };
const ERROR = {
    rule: dummyRule,
    errorContent: 'bad',
};

class TestVisual extends Element
{
    constructor()
    {
        super();
        this.Width  = 100;
        this.Height = 40;
    }
    protected override MeasureOverride(_a: Size): Size { return Size.Zero; }
    protected override RenderOverride(_dc: DrawingContext): void {}
}

function setup()
{
    const decorator = new AdornerDecorator();
    const target = new TestVisual();
    decorator.Child = target;
    const host = new Border();
    host.SetChild(decorator);
    host.Measure(new Size(400, 400));
    host.Arrange(new Rect(0, 0, 400, 400));
    return { decorator, target, host };
}

describe('ValidationErrorAdorner', () => {
    beforeEach(() => { initTestApp(); });

    test('AttachTo finds the layer and installs an adorner', () => {
        const { decorator, target } = setup();
        const detach = ValidationErrorAdorner.AttachTo(target);
        assert.ok(detach !== undefined);
        const adorners = decorator.AdornerLayer.GetAdorners(target);
        assert.equal(adorners?.length, 1);
        assert.ok(adorners![0] instanceof ValidationErrorAdorner);
        detach!();
    });

    test('AttachTo returns undefined when no AdornerDecorator is in scope', () => {
        const orphan = new TestVisual();
        const host = new Border();
        host.SetChild(orphan);
        const detach = ValidationErrorAdorner.AttachTo(orphan);
        assert.equal(detach, undefined);
    });

    test('detach thunk removes the adorner from the layer', () => {
        const { decorator, target } = setup();
        const detach = ValidationErrorAdorner.AttachTo(target)!;
        detach();
        assert.equal(decorator.AdornerLayer.GetAdorners(target), undefined);
    });

    test('adorner positions at the adorned element\'s rect', () => {
        const { decorator, target } = setup();
        // Adorner positioned by the layer at the target's rect in
        // layer-local frame. Border has no Padding so the decorator's
        // Child (target) lives at (0, 0) within the decorator, which is
        // also the layer's frame origin.
        const adorner = new ValidationErrorAdorner(target);
        decorator.AdornerLayer.Add(adorner);
        decorator.InvalidateMeasure();
        decorator.Measure(new Size(400, 400));
        decorator.Arrange(new Rect(0, 0, 400, 400));
        // Target is Width=100, Height=40 — with horizontal Stretch +
        // explicit Width=100 it sits CENTERED in the 400-wide slot.
        const tr = target.ArrangedRect;
        const ar = adorner.ArrangedRect;
        assert.equal(ar.X,      tr.X);
        assert.equal(ar.Y,      tr.Y);
        assert.equal(ar.Width,  tr.Width);
        assert.equal(ar.Height, tr.Height);
    });

    test('HasError change schedules a repaint via InvalidateVisual', () => {
        const { target } = setup();
        const adorner = new ValidationErrorAdorner(target);
        // Track InvalidateVisual to confirm the listener wired up.
        let invalidations = 0;
        const orig = adorner.InvalidateVisual.bind(adorner);
        adorner.InvalidateVisual = () => { invalidations++; orig(); };
        Validation.SetErrors(target, dummyRule, [ERROR]);
        assert.equal(invalidations, 1);
        Validation.SetErrors(target, dummyRule, []);
        assert.equal(invalidations, 2);
    });

    test('Dispose unsubscribes — subsequent HasError changes don\'t repaint', () => {
        const { target } = setup();
        const adorner = new ValidationErrorAdorner(target);
        let invalidations = 0;
        const orig = adorner.InvalidateVisual.bind(adorner);
        adorner.InvalidateVisual = () => { invalidations++; orig(); };
        Validation.SetErrors(target, dummyRule, [ERROR]);
        assert.equal(invalidations, 1);
        adorner.dispose();
        Validation.SetErrors(target, dummyRule, []);
        assert.equal(invalidations, 1, 'no further repaints after Dispose');
    });

    test('integration: TextBox under a decorator gets an adorner via AttachTo', () => {
        const decorator = new AdornerDecorator();
        const tb = new TextBox();
        decorator.Child = tb;
        const host = new Border();
        host.SetChild(decorator);
        host.Measure(new Size(400, 400));
        host.Arrange(new Rect(0, 0, 400, 400));
        const detach = ValidationErrorAdorner.AttachTo(tb);
        assert.ok(detach !== undefined);
        detach!();
    });
});
