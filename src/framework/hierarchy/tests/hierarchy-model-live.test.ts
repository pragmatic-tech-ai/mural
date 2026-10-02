import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServiceProvider, ServiceKey } from '../../../runtime/index.js';
import {
    HierarchyModel, HierarchyContributorRegistry, HierarchyContributorDefinition,
    NodeContribution, NodeSeverity,
    type IHierarchyContributor, type HierarchyNode,
} from '../index.js';

function node(key: string, ext: unknown): HierarchyNode
{
    return { Key: key, Caption: key, IconKey: '', ExtObject: ext, Severity: NodeSeverity.Ok };
}

test('a runtime Register keyed to an already-realized node re-contributes live', () =>
{
    const provider = new ServiceProvider();
    const reg = new HierarchyContributorRegistry(provider);
    const model = new HierarchyModel(reg);
    const root = model.SeedRoot(node('solution', {}));
    model.RealizeChildren(root);
    assert.equal(model.ChildrenOf(root).length, 0);

    const tok = new ServiceKey<IHierarchyContributor>('late');
    provider.registerInstance(tok, { ParentKeys: ['solution'], Order: 0,
        Contribute: () => new NodeContribution([node('project', { id: 'p' })]) } as IHierarchyContributor);
    const d = new HierarchyContributorDefinition();
    d.ParentKeys = ['solution']; d.Contributor = tok; d.Order = 0;
    const sub = reg.Register(d);                        // Changed -> model re-contributes root

    assert.equal(model.ChildrenOf(root).length, 1);

    sub.dispose();                                      // Changed -> re-contribute -> stale keyed child pruned
    assert.equal(model.ChildrenOf(root).length, 0);   // the disposer removes what it added (spec §9)
});
