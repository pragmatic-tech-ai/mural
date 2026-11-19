import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../../runtime/index.js';
import { Figure } from '../figure.js';
import { Callout } from '../callout.js';

function scene(): { c: Callout; target: Figure }
{
    Application.current = null; new Application();
    const c = new Callout(); c.Left = 0; c.Top = 0; c.Width = 100; c.Height = 40;
    const target = Figure.fromKind('rectangle', 300, 200, { width: 80, height: 60 });
    return { c, target };
}

describe('Callout', () => {
    test('is a TextNode (hence a Figure)', () => {
        const { c } = scene();
        assert.ok(c instanceof Figure);
    });
    test('LeaderGeometry undefined with no target', () => {
        const { c } = scene();
        assert.equal(c.LeaderGeometry, undefined);
    });
    test('LeaderGeometry defined after setting a target; LeaderTargetId is target Id', () => {
        const { c, target } = scene(); target.Id = 'tgt';
        c.LeaderTargetNode = target;
        assert.ok(c.LeaderGeometry !== undefined);
        assert.equal(c.LeaderTargetId, 'tgt');
    });
    test('LeaderGeometry recomputes when the target moves', () => {
        const { c, target } = scene();
        c.LeaderTargetNode = target;
        const before = c.LeaderGeometry;
        target.Left = 500;
        assert.notEqual(c.LeaderGeometry, before);
    });
    test('Detach stops tracking: later target moves do not recompute', () => {
        const { c, target } = scene();
        c.LeaderTargetNode = target;
        c.DetachLeader();
        const after = c.LeaderGeometry;
        target.Left = 999;
        assert.equal(c.LeaderGeometry, after);
    });
});
