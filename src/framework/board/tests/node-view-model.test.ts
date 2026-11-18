import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeViewModel } from '../node-view-model.js';

test('NodeViewModel is content + identity only — no geometry DPs', () => {
    const vm = new NodeViewModel() as unknown as Record<string, unknown>;
    // Geometry (position/size), sizing mode, and side-endpoint host all moved to
    // the container Figure; the VM carries none of it.
    for (const prop of ['Left', 'Top', 'Width', 'Height', 'SizeToContent', 'UserSized'])
    {
        assert.equal(vm[prop], undefined, `${prop} must not exist on a content VM`);
    }
});

test('NodeViewModel Id DP round-trips', () => {
    const vm = new NodeViewModel();
    assert.equal(vm.Id, undefined);
    vm.Id = 'n42';
    assert.equal(vm.Id, 'n42');
});
