import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { TextNode } from '../text-node.js';

describe('TextNode — GrowShape auto-fit', () => {
    beforeEach(() => { initTestApp(); });

    test('long text grows Width/Height past the 120x44 default', () => {
        const vm = new TextNode();
        const w0 = vm.Width, h0 = vm.Height;
        vm.LabelText = 'A very long label that should not fit inside the default text box footprint';
        assert.ok(vm.Width > w0, `expected Width to grow from ${w0}, got ${vm.Width}`);
        assert.ok(vm.Height >= h0, `expected Height not to shrink from ${h0}, got ${vm.Height}`);
    });

    test('grow-only: a shorter label does not shrink the box', () => {
        const vm = new TextNode();
        vm.LabelText = 'A very long label that grows the box well beyond its default width';
        const wGrown = vm.Width;
        vm.LabelText = 'x';
        assert.equal(vm.Width, wGrown, 'grow-only: must not shrink');
    });

    test('idempotent: re-measuring the same text does not oscillate', () => {
        const vm = new TextNode();
        vm.LabelText = 'Stable label content for idempotence';
        const w1 = vm.Width, h1 = vm.Height;
        vm.LabelText = 'Stable label content for idempotence';
        assert.equal(vm.Width, w1);
        assert.equal(vm.Height, h1);
    });
});
