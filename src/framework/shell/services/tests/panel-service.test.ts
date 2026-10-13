import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ServiceProvider } from '../../../../runtime/index.js';
import { PanelService, PanelSection } from '../panel-service.js';

class TestPanel extends PanelService
{
    public constructor(sections: readonly string[])
    {
        super(new ServiceProvider(), sections);
    }
}

describe('PanelService', () =>
{
    test('a subclass exposes one PanelSection per supplied title, in order', () =>
    {
        const panel = new TestPanel(['Alpha', 'Beta']);
        assert.equal(panel.Sections.Count, 2);
        assert.ok(panel.Sections.Get(0) instanceof PanelSection);
        assert.deepEqual(panel.Sections.ToArray().map(s => s.Label), ['Alpha', 'Beta']);
    });

    test('PanelSection carries its label', () =>
    {
        assert.equal(new PanelSection('Hello').Label, 'Hello');
    });

    test('an empty section list yields an empty collection', () =>
    {
        assert.equal(new TestPanel([]).Sections.Count, 0);
    });
});
