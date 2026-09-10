// The connector's caption is a hit-test-visible ShapeText mounted as a SIBLING
// of the connector (not a child), so a visual-ancestor walk from the label can't
// reach the connector. connectorFromSource bridges that: it matches the label
// visual against the live connectors by LabelInstance, so clicking / hovering a
// connector's label targets the connector.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Application, ObservableCollection, type MuralBase } from '../../../runtime/index.js';
import { Point } from '../../../visual-engine/index.js';
import { Connector } from '../connector.js';
import { ConnectorEndpoint } from '../connector-endpoint.js';
import { Diagram } from '../diagram.js';
import { connectorFromSource } from '../behaviors/connector-interactions-behavior.js';
import { RoutingMode } from '../routing/router.js';
import '../routing/straight-router.js';

function makeConnector(label: string): Connector
{
    const c = new Connector();
    c.RoutingMode = RoutingMode.Straight;
    c.Source = new ConnectorEndpoint({ FreePoint: new Point(0, 0) });
    c.Target = new ConnectorEndpoint({ FreePoint: new Point(100, 0) });
    c.LabelText = label;
    return c;
}

function diagramWith(c: Connector): Diagram
{
    const d = new Diagram();
    d.Connectors = new ObservableCollection<MuralBase>([c]);
    return d;
}

describe('connector label participates in the hit surface', () => {
    beforeEach(() => { Application.current = null; new Application(); });

    test('the label visual resolves to its owning connector', () => {
        const c = makeConnector('calls');
        assert.equal(connectorFromSource(diagramWith(c), c.LabelInstance), c);
    });

    test('a direct hit on the connector path still resolves (regression)', () => {
        const c = makeConnector('calls');
        assert.equal(connectorFromSource(diagramWith(c), c), c);
    });

    test('a ShapeText that is not any live connector\'s label resolves to nothing', () => {
        const c = makeConnector('calls');
        const stray = makeConnector('other');   // its label is a ShapeText, but not in d.Connectors
        assert.equal(connectorFromSource(diagramWith(c), stray.LabelInstance), undefined);
    });

    test('an unrelated non-label visual resolves to nothing', () => {
        const c = makeConnector('calls');
        assert.equal(connectorFromSource(diagramWith(c), c.Source), undefined);
    });
});
