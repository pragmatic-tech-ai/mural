import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceKey } from '../../../../runtime/index.js';
import { ToolboxVisualDescriptor } from '../toolbox-visual-descriptor.js';
import { type IToolboxVisualResolver } from '../toolbox-visual-resolver.js';
import { type IToolboxDropFactory } from '../toolbox-drop-factory.js';
import { ToolboxItem } from '../toolbox-item.js';
import { ToolboxRepository } from '../toolbox-repository.js';

function item(id: string): ToolboxItem
{
    const rk = new ServiceKey<IToolboxVisualResolver>('r');
    const fk = new ServiceKey<IToolboxDropFactory>('f');
    return new ToolboxItem(id, id, new ToolboxVisualDescriptor(rk, id), fk);
}

test('EnsurePage is get-or-create', () => {
    const repo = new ToolboxRepository();
    const a = repo.EnsurePage('shapes', 'Shapes');
    const b = repo.EnsurePage('shapes', 'Shapes');
    assert.equal(a, b);
    assert.equal(repo.Pages.Count, 1);
});

test('ItemById finds an item across pages, miss returns undefined', () => {
    const repo = new ToolboxRepository();
    repo.EnsurePage('p1', 'P1').Items.Add(item('x'));
    repo.EnsurePage('p2', 'P2').Items.Add(item('y'));
    assert.equal(repo.ItemById('y')?.Id, 'y');
    assert.equal(repo.ItemById('missing'), undefined);
});

test('RemovePage and Clear', () => {
    const repo = new ToolboxRepository();
    repo.EnsurePage('p1', 'P1');
    repo.EnsurePage('p2', 'P2');
    repo.RemovePage('p1');
    assert.equal(repo.Pages.Count, 1);
    repo.Clear();
    assert.equal(repo.Pages.Count, 0);
});

test('repository has a stable service Key', () => {
    assert.ok(ToolboxRepository.Key instanceof ServiceKey);
});
