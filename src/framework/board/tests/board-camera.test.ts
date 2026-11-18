import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { initTestApp } from '../../../basic/tests/test-app.js';
import { Rect } from '../../../visual-engine/primitives.js';
import { MuralBase, ObservableCollection } from '../../../runtime/index.js';
import { Shape } from '../../../basic/shapes/shape.js';
import { ScaleTransform } from '../../../visual-engine/index.js';
import { Board } from '../board.js';
import { Connector } from '../connector.js';

describe('Board camera', () => {
    beforeEach(() => { initTestApp(); });

    test('exposes an identity camera by default', () => {
        const d = new Board();
        assert.equal(d.Zoom, 1);
        assert.equal(d.ScrollX, 0);
        assert.equal(d.ScrollY, 0);
    });

    test('SetCamera clamps zoom and writes zoom + scroll offset', () => {
        const d = new Board();
        d.SetCamera({ zoom: 99, offsetX: 12, offsetY: 34 });
        assert.equal(d.Zoom, 4);          // CAMERA_MAX
        assert.equal(d.ScrollX, 12);
        assert.equal(d.ScrollY, 34);
    });

    test('ScrollX/ScrollY lower-clamp to 0', () => {
        const d = new Board();
        d.ScrollX = -50;
        assert.equal(d.ScrollX, 0);
    });

    test('Zoom drives PART_Camera.LayoutTransform scale', () => {
        const d = new Board();
        d.SetCamera({ zoom: 2, offsetX: 0, offsetY: 0 });
        const host = d.GetTemplateChild('PART_Camera');
        const lt = host?.LayoutTransform as ScaleTransform | undefined;
        assert.ok(lt !== undefined, 'PART_Camera has a LayoutTransform');
        assert.equal(lt!.ScaleX, 2);
        assert.equal(lt!.ScaleY, 2);
    });

    test('ZoomIn/ZoomOut about the viewport center round-trip; ResetZoom -> identity', () => {
        const d = new Board();
        d._testViewport(500, 300);
        d.SetCamera({ zoom: 1, offsetX: 0, offsetY: 0 });
        d.ZoomIn();
        assert.ok(d.Zoom > 1);
        d.ZoomOut();
        assert.ok(Math.abs(d.Zoom - 1) < 1e-9);
        assert.ok(Math.abs(d.ScrollX) < 1e-9);
        assert.ok(Math.abs(d.ScrollY) < 1e-9);
        d.SetCamera({ zoom: 2, offsetX: 10, offsetY: 20 });
        d.ResetZoom();
        assert.equal(d.Zoom, 1);
        assert.equal(d.ScrollX, 0);
        assert.equal(d.ScrollY, 0);
    });

    test('Fit frames the content bounds into the viewport', () => {
        const d = new Board();
        d._testViewport(500, 300);
        d._testContent(new Rect(0, 0, 100, 100));
        d.Fit();
        assert.ok(Math.abs(d.Zoom - Math.min((500 - 48) / 100, (300 - 48) / 100)) < 1e-9);
    });

    test('HostToContent = (host - arrangedRect chain) / Zoom', () => {
        const d = new Board();
        d._testViewport(500, 300);
        // At zoom 1 the host maps through the ArrangedRect chain untouched.
        d.SetCamera({ zoom: 1, offsetX: 0, offsetY: 0 });
        const a = d.HostToContent(120, 80);
        // At zoom 2 the same host point maps to half the content coordinate.
        d.SetCamera({ zoom: 2, offsetX: 0, offsetY: 0 });
        const b = d.HostToContent(120, 80);
        assert.ok(Math.abs(b.X - a.X / 2) < 1e-9);
        assert.ok(Math.abs(b.Y - a.Y / 2) < 1e-9);
    });

    test('zoom commands are present for the overlay + host keyboard to bind', () => {
        const d = new Board();
        assert.ok(d.ZoomInCommand !== undefined);
        assert.ok(d.ZoomOutCommand !== undefined);
        assert.ok(d.ResetZoomCommand !== undefined);
        assert.ok(d.FitCommand !== undefined);
        assert.ok(d.FitToSelectionCommand !== undefined);
    });

    test('connector hit band scales inversely with zoom', () => {
        const d = new Board();
        const c = new Connector();
        const connectors = new ObservableCollection<MuralBase>();
        connectors.Add(c);
        d.Connectors = connectors;
        d.SetCamera({ zoom: 2, offsetX: 0, offsetY: 0 });
        const w = c.get_property_value(Shape.HitTestStrokeWidthKey);
        assert.ok(Math.abs(w - 14 / 2) < 1e-6, `expected 7, got ${w}`);
    });
});
