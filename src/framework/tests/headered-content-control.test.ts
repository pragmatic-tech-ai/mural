import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { Application, MetaData, MuralBase } from '../../runtime/index.js';
import { HeaderedContentControl } from '../base/headered-content-control.js';
import { DataTemplate } from '../../basic/index.js';
import { TabItem } from '../tabs/tabs.js';

class Probe extends HeaderedContentControl
{
    public static readonly NoiseKey = MuralBase.RegisterProperty<number>(
        Probe, 'Noise', 0, MetaData.None);
}

describe('HeaderedContentControl — base DPs', () => {

    test('Header default is undefined', () => {
        Application.current = null;
        new Application();
        const p = new Probe();
        assert.equal(p.Header, undefined);
    });

    test('HeaderTemplate default is undefined', () => {
        Application.current = null;
        new Application();
        const p = new Probe();
        assert.equal(p.HeaderTemplate, undefined);
    });

    test('Header accepts string', () => {
        Application.current = null;
        new Application();
        const p = new Probe();
        p.Header = 'Files';
        assert.equal(p.Header, 'Files');
    });

    test('Header accepts an arbitrary object (WPF parity — `unknown`)', () => {
        Application.current = null;
        new Application();
        const p = new Probe();
        const vm = { title: 'arbitrary' };
        p.Header = vm;
        assert.equal(p.Header, vm);
    });

    test('HeaderTemplate accepts a DataTemplate', () => {
        Application.current = null;
        new Application();
        const p = new Probe();
        const t = new DataTemplate(() => undefined!);
        p.HeaderTemplate = t;
        assert.equal(p.HeaderTemplate, t);
    });

    test('PropertyChanged fires on Header write', () => {
        Application.current = null;
        new Application();
        const p = new Probe();
        let fired = 0;
        p.PropertyChanged(HeaderedContentControl.HeaderKey).subscribe(() => fired++);
        p.Header = 'one';
        p.Header = 'two';
        assert.equal(fired, 2);
    });
});

describe('TabItem — inherits HeaderedContentControl', () => {

    test('TabItem is a HeaderedContentControl', () => {
        Application.current = null;
        new Application();
        const ti = new TabItem();
        assert.ok(ti instanceof HeaderedContentControl,
            'TabItem must extend HeaderedContentControl after Phase H migration');
    });

    test('TabItem.Header survives the type-broadening (string still works)', () => {
        Application.current = null;
        new Application();
        const ti = new TabItem();
        ti.Header = 'Files';
        assert.equal(ti.Header, 'Files');
    });

    test('TabItem.HeaderTemplate is settable from the new base', () => {
        Application.current = null;
        new Application();
        const ti = new TabItem();
        const t = new DataTemplate(() => undefined!);
        ti.HeaderTemplate = t;
        assert.equal(ti.HeaderTemplate, t);
    });
});
