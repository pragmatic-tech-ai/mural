import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initTestApp } from '../../tests/test-app.js';
import { ItemsControl } from '../../../framework/base/items-control.js';
import { DataTemplate, HierarchicalDataTemplate } from '../data-template.js';
import { TextBlock } from '../../text-block.js';
import { HierarchicalItemsBinder } from '../hierarchical-items-binder.js';

initTestApp();

// Plain data record — mirrors tree-view.test.ts's `Node` shape.
interface Node { Name: string; children?: Node[]; }

test('BindChildItems propagates ItemTemplate/selector/ItemsSource for a hierarchical template and returns true', () =>
{
    const owner = new ItemsControl();
    owner.ItemTemplate = new HierarchicalDataTemplate(
        (d) => new TextBlock((d as Node).Name),
        (d) => (d as Node).children,
    );

    const kids: Node[] = [{ Name: 'child' }];
    const item: Node = { Name: 'root', children: kids };
    const child = new ItemsControl();

    const result = HierarchicalItemsBinder.BindChildItems(owner, item, child);

    assert.equal(result, true);
    assert.equal(child.ItemsSource, kids);
    assert.equal(child.ItemTemplate, owner.ItemTemplate);
    assert.equal(child.ItemTemplateSelector, owner.ItemTemplateSelector);
});

test('BindChildItems returns false and leaves child untouched for a plain (non-hierarchical) template', () =>
{
    const owner = new ItemsControl();
    owner.ItemTemplate = new DataTemplate((d) => new TextBlock((d as Node).Name));

    const item: Node = { Name: 'root' };
    const child = new ItemsControl();

    const result = HierarchicalItemsBinder.BindChildItems(owner, item, child);

    assert.equal(result, false);
    assert.equal(child.ItemsSource, undefined);
    assert.equal(child.ItemTemplate, undefined);
});
