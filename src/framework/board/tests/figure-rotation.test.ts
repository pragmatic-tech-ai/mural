import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { RotateTransform } from '../../../visual-engine/index.js';
import { Figure } from '../figure.js';

describe('Figure rotation + base size', () => {
    test('setting Rotation installs a RotateTransform with that angle and centered origin', () => {
        Application.current = null; new Application();
        const f = Figure.fromKind('rectangle', 0, 0, { width: 80, height: 40 });
        assert.equal(f.Rotation, 0);
        f.Rotation = 30;
        const t = f.RenderTransform;
        assert.ok(t instanceof RotateTransform, 'RenderTransform is a RotateTransform');
        assert.equal((t as RotateTransform).Angle, 30);
        assert.equal(f.RenderTransformOrigin.X, 0.5);
        assert.equal(f.RenderTransformOrigin.Y, 0.5);
    });
    test('BaseWidth/BaseHeight seed from the factory size', () => {
        Application.current = null; new Application();
        const f = Figure.fromKind('rectangle', 0, 0, { width: 120, height: 60 });
        assert.equal(f.BaseWidth, 120);
        assert.equal(f.BaseHeight, 60);
    });
});
